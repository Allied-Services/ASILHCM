'use strict';

const {
    resolvePayrollSheetInputs,
    resolvePayrollSheetPaidDays,
    resolveSheetModelAComputeInput,
    isWeekdayShapedPaidDays,
    liftPaidDaysToCalendarMonth,
} = require('../src/modules/payrollSheet/resolveInputs');
const { computePrSheetRow } = require('../src/payroll/prSheetEngine');

describe('resolvePayrollSheetInputs — sheet OT must survive hub zeros', () => {
    test('canonical: monthly hub OT=0 does not wipe sheet OT', () => {
        const r = resolvePayrollSheetInputs({
            sheet: { ot2_hrs: 9, ot3_hrs: 6, opd_claim: 0, reimbursement: 20000 },
            attOt: { ot1: 0, ot2: 0, ot3: 0 },
            monthlyOv: { ot1_hours: 0, ot2_hours: 0, ot3_hours: 0 },
            claimAgg: { ot1: 0, ot2: 0, ot3: 0, opd: 0, expense: 0 },
            hasClaims: false,
            sourceMode: 'canonical',
        });
        expect(r.ot2).toBe(9);
        expect(r.ot3).toBe(6);
        expect(r.expense).toBe(20000);
    });

    test('canonical: positive hub OT raises only when sheet OT is 0', () => {
        const keep = resolvePayrollSheetInputs({
            sheet: { ot2_hrs: 2, ot3_hrs: 0, reimbursement: 0 },
            attOt: { ot2: 0, ot3: 0 },
            monthlyOv: { ot2_hours: 10, ot3_hours: 3 },
            claimAgg: {},
            hasClaims: false,
            sourceMode: 'canonical',
        });
        expect(keep.ot2).toBe(2);
        expect(keep.ot3).toBe(3);

        const fill = resolvePayrollSheetInputs({
            sheet: { ot2_hrs: 0, ot3_hrs: 0, reimbursement: 0 },
            attOt: { ot2: 0, ot3: 0 },
            monthlyOv: { ot2_hours: 10, ot3_hours: 3 },
            claimAgg: {},
            hasClaims: false,
            sourceMode: 'canonical',
        });
        expect(fill.ot2).toBe(10);
        expect(fill.ot3).toBe(3);
    });

    test('canonical: sheet OT/OPD/expense survive when already > 0', () => {
        const r = resolvePayrollSheetInputs({
            sheet: { ot2_hrs: 5, reimbursement: 1000, opd_claim: 50 },
            attOt: {},
            monthlyOv: null,
            claimAgg: { ot2: 8, opd: 200, expense: 500 },
            hasClaims: true,
            sourceMode: 'canonical',
        });
        expect(r.ot2).toBe(5);
        expect(r.opd).toBe(50);
        expect(r.expense).toBe(1000);
    });

    test('canonical: typed sheet expense 12000 wins over claim 6000', () => {
        const r = resolvePayrollSheetInputs({
            sheet: { reimbursement: 12000, opd_claim: 0, ot2_hrs: 0 },
            attOt: {},
            monthlyOv: null,
            claimAgg: { ot2: 0, opd: 0, expense: 6000 },
            hasClaims: true,
            sourceMode: 'canonical',
        });
        expect(r.expense).toBe(12000);
        expect(r.opd).toBe(0);
    });

    test('canonical: empty August sheet fills from July portal-shaped claimAgg', () => {
        const r = resolvePayrollSheetInputs({
            sheet: { ot2_hrs: 0, ot3_hrs: 0, opd_claim: 0, reimbursement: 0 },
            attOt: {},
            monthlyOv: null,
            claimAgg: { ot1: 0, ot2: 9, ot3: 0, opd: 18211, expense: 2200 },
            hasClaims: true,
            sourceMode: 'canonical',
        });
        expect(r.ot2).toBe(9);
        expect(r.opd).toBe(18211);
        expect(r.expense).toBe(2200);
    });

    test('sheet_inputs: ignores hub/claims and uses sheet only', () => {
        const r = resolvePayrollSheetInputs({
            sheet: { ot2_hrs: 9, ot3_hrs: 6, reimbursement: 20000 },
            attOt: { ot2: 99 },
            monthlyOv: { ot2_hours: 50 },
            claimAgg: { ot2: 40, expense: 1 },
            hasClaims: true,
            sourceMode: 'sheet_inputs',
        });
        expect(r.ot2).toBe(9);
        expect(r.ot3).toBe(6);
        expect(r.expense).toBe(20000);
    });

    test('idempotent: two resolves with same sheet match', () => {
        const sheet = { ot2_hrs: 17, ot3_hrs: 0, reimbursement: 0 };
        const a = resolvePayrollSheetInputs({
            sheet, attOt: {}, monthlyOv: { ot2_hours: 0 }, claimAgg: {}, hasClaims: false, sourceMode: 'canonical',
        });
        const b = resolvePayrollSheetInputs({
            sheet: { ...sheet, ot2_hrs: a.ot2, ot3_hrs: a.ot3 },
            attOt: {}, monthlyOv: { ot2_hours: 0 }, claimAgg: {}, hasClaims: false, sourceMode: 'canonical',
        });
        expect(b).toEqual(a);
    });
});

describe('resolvePayrollSheetPaidDays', () => {
    test('sheet paid_days wins over hub present_days', () => {
        const r = resolvePayrollSheetPaidDays({
            sheet: { paid_days: 31 },
            monthlyOv: { present_days: 2 },
            attendancePaidDays: 0,
        });
        expect(r.paidDays).toBe(31);
    });
});

const OT_POLICY = {
    standard_month_days: 30,
    ot_divisor_days: 26,
    ot_divisor_hours: 8,
    service_charge_pct: 0.18,
};

describe('liftPaidDaysToCalendarMonth — Sundays are paid', () => {
    test('26 weekdays on a 31-day month lifts to 31', () => {
        expect(isWeekdayShapedPaidDays(26, 31)).toBe(true);
        expect(liftPaidDaysToCalendarMonth(26, 31)).toBe(31);
    });

    test('26 on a 30-day month lifts to 30', () => {
        expect(liftPaidDaysToCalendarMonth(26, 30)).toBe(30);
    });

    test('true 1-day absence (30 of 31) is not lifted', () => {
        expect(isWeekdayShapedPaidDays(30, 31)).toBe(false);
        expect(liftPaidDaysToCalendarMonth(30, 31)).toBe(30);
    });

    test('empty paid days default to the calendar month', () => {
        expect(liftPaidDaysToCalendarMonth(0, 31)).toBe(31);
    });
});

describe('resolveSheetModelAComputeInput — Paid Days are the calendar month', () => {
    test('26 stored PD on August 31 → full salary + OT (ASILFM/SPL/22/165)', () => {
        const flags = resolveSheetModelAComputeInput({
            paidDays: 26,
            workingDays: 26,
            presentDaysForModelA: 26,
            absentDaysForModelA: null,
            sheetPaidDays: 26,
            modelABasis: 30,
            calendarDays: 31,
        });
        expect(flags.persistPaidDays).toBe(31);
        expect(flags.presentDays).toBe(31);
        expect(flags.expectedDays).toBe(31);
        expect(flags.calendarBasis).toBe(31);

        const row = computePrSheetRow({
            newSalary: 40000,
            ot2: 29,
            month: 8,
            year: 2026,
            modelA: flags.modelA,
            presentDays: flags.presentDays,
            expectedDays: flags.expectedDays,
            calendarBasis: flags.calendarBasis,
        }, OT_POLICY);
        expect(row.overtimeAmount).toBe(11154);
        expect(row.salaryForDays).toBe(40000);
        expect(row.modelA.absentDays).toBe(0);
        expect(row.gross).toBe(51154);
    });

    test('legacy 26/30 wiring is the 45,821 bug — resolver must persist 31 not 26', () => {
        const flags = resolveSheetModelAComputeInput({
            paidDays: 26,
            workingDays: 26,
            presentDaysForModelA: 26,
            absentDaysForModelA: null,
            sheetPaidDays: 26,
            modelABasis: 30,
            calendarDays: 31,
        });
        const wrong = computePrSheetRow({
            newSalary: 40000,
            ot2: 29,
            modelA: true,
            presentDays: 26,
            expectedDays: 30,
            calendarBasis: 30,
        }, OT_POLICY);
        expect(wrong.gross).toBe(45821);
        expect(flags.persistPaidDays).toBe(31);
        expect(flags.presentDays).toBe(31);
    });

    test('explicit 4 calendar absents still cut Gross; Paid Days stay the month', () => {
        const flags = resolveSheetModelAComputeInput({
            paidDays: 26,
            workingDays: 26,
            presentDaysForModelA: 26,
            absentDaysForModelA: 4,
            sheetPaidDays: 26,
            modelABasis: 30,
            calendarDays: 31,
        });
        expect(flags.absentDays).toBe(4);
        expect(flags.persistPaidDays).toBe(31);
        const row = computePrSheetRow({
            newSalary: 40000,
            ot2: 29,
            month: 8,
            year: 2026,
            modelA: flags.modelA,
            presentDays: flags.presentDays,
            expectedDays: flags.expectedDays,
            calendarBasis: flags.calendarBasis,
            absentDays: flags.absentDays,
        }, OT_POLICY);
        expect(row.salaryForDays).toBe(Math.round(40000 * 27 / 31));
        expect(row.gross).toBe(Math.round(40000 * 27 / 31) + 11154);
    });

    test('mid-month 20 calendar days prorates 20/31, not 20/26', () => {
        const flags = resolveSheetModelAComputeInput({
            paidDays: 20,
            workingDays: 26,
            presentDaysForModelA: 20,
            absentDaysForModelA: null,
            sheetPaidDays: 20,
            modelABasis: 30,
            calendarDays: 31,
        });
        expect(flags.persistPaidDays).toBe(20);
        expect(flags.presentDays).toBe(20);
        expect(flags.expectedDays).toBe(31);
        const row = computePrSheetRow({
            newSalary: 40000,
            ot2: 0,
            month: 8,
            year: 2026,
            modelA: flags.modelA,
            presentDays: flags.presentDays,
            expectedDays: flags.expectedDays,
            calendarBasis: flags.calendarBasis,
        }, OT_POLICY);
        expect(row.salaryForDays).toBe(Math.round(40000 * 20 / 31));
    });
});
