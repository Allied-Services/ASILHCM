'use strict';

const {
    resolvePayrollSheetInputs,
    resolvePayrollSheetPaidDays,
} = require('../src/modules/payrollSheet/resolveInputs');

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
