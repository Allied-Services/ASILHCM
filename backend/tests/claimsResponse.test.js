'use strict';

const {
    portalAmountsFromItems,
    sheetHasValues,
    amountsMatch,
    classifyResponseRow,
    writePortalAmountsToSheet,
} = require('../src/modules/claims/claimsResponse');

describe('portalAmountsFromItems', () => {
    test('maps 1x hours into ot2Write at half', () => {
        const p = portalAmountsFromItems([
            { claim_type: 'OT', ot_hours: 4, ot_multiplier_factor: 1 },
            { claim_type: 'OT', ot_hours: 8, ot_multiplier_factor: 2 },
            { claim_type: 'OT', ot_hours: 3, ot_multiplier_factor: 3 },
            { claim_type: 'EXPENSE', amount: 2400 },
            { claim_type: 'MEDICAL', amount: 1800 },
        ]);
        expect(p.ot1).toBe(4);
        expect(p.ot2).toBe(8);
        expect(p.ot3).toBe(3);
        expect(p.ot2Write).toBe(10);
        expect(p.expense).toBe(2400);
        expect(p.medical).toBe(1800);
    });
});

describe('sheet compare', () => {
    test('empty sheet is safe to import', () => {
        expect(sheetHasValues({ ot2_hrs: 0, ot3_hrs: 0, opd_claim: 0, reimbursement: 0 })).toBe(false);
        expect(sheetHasValues(null)).toBe(false);
    });

    test('any OT / medical / expense blocks auto-import', () => {
        expect(sheetHasValues({ ot2_hrs: 6, ot3_hrs: 0, opd_claim: 0, reimbursement: 0 })).toBe(true);
        expect(sheetHasValues({ ot2_hrs: 0, ot3_hrs: 0, opd_claim: 1200, reimbursement: 0 })).toBe(true);
        expect(sheetHasValues({ ot2_hrs: 0, ot3_hrs: 0, opd_claim: 0, reimbursement: 900 })).toBe(true);
    });

    test('match uses the 1x→ot2Write mapping', () => {
        const portal = portalAmountsFromItems([
            { claim_type: 'OT', ot_hours: 4, ot_multiplier_factor: 1 },
            { claim_type: 'OT', ot_hours: 8, ot_multiplier_factor: 2 },
        ]);
        expect(amountsMatch(portal, { ot2_hrs: 10, ot3_hrs: 0, opd_claim: 0, reimbursement: 0 })).toBe(true);
        expect(amountsMatch(portal, { ot2_hrs: 18, ot3_hrs: 4, opd_claim: 0, reimbursement: 0 })).toBe(false);
    });
});

describe('classifyResponseRow', () => {
    const emptySheet = { ot2_hrs: 0, ot3_hrs: 0, opd_claim: 0, reimbursement: 0 };
    const portal = { ot2Write: 8, ot3: 0, medical: 0, expense: 2400 };

    test('audience with no row is not invited', () => {
        expect(classifyResponseRow({ subStatus: null, inviteSent: false, portal: {}, sheet: emptySheet })).toBe('not_invited');
    });

    test('invite sent vs waiting fill vs waiting LM', () => {
        expect(classifyResponseRow({ subStatus: 'invited', inviteSent: true, portal: {}, sheet: emptySheet })).toBe('invite_sent');
        expect(classifyResponseRow({ subStatus: 'draft', inviteSent: true, portal: {}, sheet: emptySheet })).toBe('waiting_fill');
        expect(classifyResponseRow({ subStatus: 'submitted', inviteSent: true, portal, sheet: emptySheet })).toBe('waiting_lm');
    });

    test('approved + matching sheet = on_sheet', () => {
        expect(classifyResponseRow({
            subStatus: 'in_payroll',
            portal,
            sheet: { ot2_hrs: 8, ot3_hrs: 0, opd_claim: 0, reimbursement: 2400 },
        })).toBe('on_sheet');
    });

    test('approved + other sheet numbers = other_data', () => {
        expect(classifyResponseRow({
            subStatus: 'approved',
            portal,
            sheet: { ot2_hrs: 18, ot3_hrs: 4, opd_claim: 1200, reimbursement: 6500 },
        })).toBe('other_data');
    });

    test('approved + empty sheet = ready_import', () => {
        expect(classifyResponseRow({ subStatus: 'approved', portal, sheet: emptySheet })).toBe('ready_import');
    });

    test('sample never counts as on_sheet', () => {
        expect(classifyResponseRow({
            subStatus: 'in_payroll',
            sample: true,
            portal,
            sheet: { ot2_hrs: 8, ot3_hrs: 0, opd_claim: 0, reimbursement: 2400 },
        })).not.toBe('on_sheet');
    });
});

describe('writePortalAmountsToSheet', () => {
    const portal = { ot2Write: 8, ot3: 0, medical: 0, expense: 2400 };

    test('refuses when the sheet already has OT / medical / expense', async () => {
        const pool = {
            query: jest.fn().mockResolvedValueOnce({
                rows: [{ ot2_hrs: 18, ot3_hrs: 4, opd_claim: 1200, reimbursement: 0, locked: false }],
            }),
        };
        const r = await writePortalAmountsToSheet(pool, {
            employeeId: 'ASIL-W-0911', month: 8, year: 2026, portal,
        });
        expect(r.wrotePayroll).toBe(false);
        expect(r.blocked).toBe('SHEET_HAS_OTHER_DATA');
        expect(pool.query).toHaveBeenCalledTimes(1);
    });

    test('writes when the four columns are empty', async () => {
        const pool = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] }),
        };
        const r = await writePortalAmountsToSheet(pool, {
            employeeId: 'ASIL-W-1042', month: 8, year: 2026, portal,
        });
        expect(r.wrotePayroll).toBe(true);
        expect(r.blocked).toBeNull();
        expect(pool.query).toHaveBeenCalledTimes(2);
        expect(pool.query.mock.calls[1][1]).toEqual(['ASIL-W-1042', 8, 2026, 8, 0, 0, 2400]);
    });
});
