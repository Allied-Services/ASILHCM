'use strict';

const {
    resolvePayrollSheetInputs,
    resolvePayrollSheetPaidDays,
    resolveSheetModelAComputeInput,
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

    test('canonical: positive hub OT can raise sheet OT', () => {
        const r = resolvePayrollSheetInputs({
            sheet: { ot2_hrs: 2, ot3_hrs: 0, reimbursement: 0 },
            attOt: { ot2: 0, ot3: 0 },
            monthlyOv: { ot2_hours: 10, ot3_hours: 3 },
            claimAgg: {},
            hasClaims: false,
            sourceMode: 'canonical',
        });
        expect(r.ot2).toBe(10);
        expect(r.ot3).toBe(3);
    });

    test('canonical: claims OT merges upward; claims win OPD/expense when present', () => {
        const r = resolvePayrollSheetInputs({
            sheet: { ot2_hrs: 5, reimbursement: 1000, opd_claim: 50 },
            attOt: {},
            monthlyOv: null,
            claimAgg: { ot2: 8, opd: 200, expense: 500 },
            hasClaims: true,
            sourceMode: 'canonical',
        });
        expect(r.ot2).toBe(8);
        expect(r.opd).toBe(200);
        expect(r.expense).toBe(500);
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

describe('resolveSheetModelAComputeInput — full working month is full salary', () => {
    test('26 present of 26 weekdays does not 26/30-cut salary (ASILFM/SPL/22/165 shape)', () => {
        const flags = resolveSheetModelAComputeInput({
            paidDays: 26,
            workingDays: 26,
            presentDaysForModelA: 26,
            absentDaysForModelA: null,
            sheetPaidDays: 26,
            modelABasis: 30,
        });
        expect(flags.modelA).toBe(true);
        expect(flags.expectedDays).toBe(26);
        expect(flags.presentDays).toBe(26);
        expect(flags.calendarBasis).toBeUndefined();

        const row = computePrSheetRow({
            newSalary: 40000,
            ot2: 29,
            month: 8,
            year: 2026,
            ...flags,
        }, OT_POLICY);
        expect(row.overtimeAmount).toBe(11154);
        expect(row.salaryForDays).toBe(40000);
        expect(row.modelA.absentDays).toBe(0);
        expect(row.gross).toBe(51154);
    });

    test('forcing expectedDays=30 with 26 present is the 45,821 bug — resolver must not do that', () => {
        const flags = resolveSheetModelAComputeInput({
            paidDays: 26,
            workingDays: 26,
            presentDaysForModelA: 26,
            absentDaysForModelA: null,
            sheetPaidDays: 26,
            modelABasis: 30,
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
        expect(flags.expectedDays).not.toBe(30);
        expect(flags.calendarBasis).not.toBe(30);
    });

    test('explicit 4 calendar absents still prorate 26/30', () => {
        const flags = resolveSheetModelAComputeInput({
            paidDays: 26,
            workingDays: 26,
            presentDaysForModelA: 26,
            absentDaysForModelA: 4,
            sheetPaidDays: 26,
            modelABasis: 30,
        });
        expect(flags.absentDays).toBe(4);
        expect(flags.expectedDays).toBe(30);
        const row = computePrSheetRow({
            newSalary: 40000,
            ot2: 29,
            ...flags,
        }, OT_POLICY);
        expect(row.salaryForDays).toBe(Math.round(40000 * 26 / 30));
        expect(row.gross).toBe(45821);
    });

    test('partial month (20 of 26) uses working-day ratio, not Model A 20/30', () => {
        const flags = resolveSheetModelAComputeInput({
            paidDays: 20,
            workingDays: 26,
            presentDaysForModelA: 20,
            absentDaysForModelA: null,
            sheetPaidDays: 20,
            modelABasis: 30,
        });
        expect(flags.modelA).toBe(false);
        expect(flags.paidDays).toBe(20);
        expect(flags.workingDays).toBe(26);
        const row = computePrSheetRow({
            newSalary: 40000,
            ot2: 0,
            ...flags,
        }, OT_POLICY);
        expect(row.salaryForDays).toBe(Math.round(40000 * 20 / 26));
    });
});
