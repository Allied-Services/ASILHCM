'use strict';

const {
    portalAmountsFromItems,
    sheetHasValues,
    amountsMatch,
    classifyResponseRow,
    writePortalAmountsToSheet,
    listResponseBoard,
    pickSubmission,
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

    test('invite sent vs waiting Focal vs waiting LM', () => {
        expect(classifyResponseRow({ subStatus: 'invited', inviteSent: true, portal: {}, sheet: emptySheet })).toBe('invite_sent');
        expect(classifyResponseRow({
            subStatus: 'invited', inviteSent: true, portal, sheet: emptySheet,
            routingProfile: 'focal_then_lm',
        })).toBe('waiting_focal');
        expect(classifyResponseRow({
            subStatus: 'draft', inviteSent: true, portal: {}, sheet: emptySheet,
            routingProfile: 'focal_then_lm',
        })).toBe('waiting_focal');
        expect(classifyResponseRow({
            subStatus: 'submitted', inviteSent: true, portal, sheet: emptySheet,
            routingProfile: 'focal_then_lm',
        })).toBe('waiting_lm');
    });

    test('splits employee fill, ASIL approve, no-claims, and rejected', () => {
        expect(classifyResponseRow({
            subStatus: 'draft', inviteSent: true, portal: {}, sheet: emptySheet,
            routingProfile: 'employee_then_lm',
        })).toBe('waiting_employee');
        expect(classifyResponseRow({
            subStatus: 'submitted', inviteSent: true, portal, sheet: emptySheet,
            routingProfile: 'employee_then_asil',
        })).toBe('waiting_asil');
        expect(classifyResponseRow({ subStatus: 'no_claims', inviteSent: true, portal: {}, sheet: emptySheet })).toBe('no_claims');
        expect(classifyResponseRow({ subStatus: 'rejected', inviteSent: true, portal, sheet: emptySheet })).toBe('rejected');
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

    test('replace overwrites sheet OT / medical / expense', async () => {
        const pool = {
            query: jest.fn()
                .mockResolvedValueOnce({
                    rows: [{ ot2_hrs: 1, ot3_hrs: 0, opd_claim: 0, reimbursement: 50, locked: false }],
                })
                .mockResolvedValueOnce({ rows: [] }),
        };
        const r = await writePortalAmountsToSheet(pool, {
            employeeId: 'ASIL-W-0911', month: 8, year: 2026, portal, replace: true,
        });
        expect(r.wrotePayroll).toBe(true);
        expect(r.blocked).toBeNull();
        expect(pool.query.mock.calls[1][1]).toEqual(['ASIL-W-0911', 8, 2026, 8, 0, 0, 2400]);
    });

    test('matching sheet is already applied, not blocked', async () => {
        const pool = {
            query: jest.fn().mockResolvedValueOnce({
                rows: [{ ot2_hrs: 8, ot3_hrs: 0, opd_claim: 0, reimbursement: 2400, locked: false }],
            }),
        };
        const r = await writePortalAmountsToSheet(pool, {
            employeeId: 'ASIL-W-0911', month: 8, year: 2026, portal,
        });
        expect(r.wrotePayroll).toBe(false);
        expect(r.alreadyMatched).toBe(true);
        expect(r.blocked).toBeNull();
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

describe('pickSubmission', () => {
    test('prefers July work with uploaded items over a newer empty row', () => {
        const itemsBySub = new Map([
            [10, [{ claim_type: 'OT', ot_hours: 6, ot_multiplier_factor: 2 }]],
            [99, []],
        ]);
        const picked = pickSubmission([
            {
                id: 99, status: 'in_payroll', campaign_mode: 'actual',
                claim_month: 8, claim_year: 2026, channel: 'manual_override',
            },
            {
                id: 10, status: 'approved', campaign_mode: 'actual',
                claim_month: 7, claim_year: 2026, channel: 'admin_correction',
            },
        ], { workMonth: 7, workYear: 2026, itemsBySub });
        expect(picked.id).toBe(10);
        expect(picked.status).toBe('approved');
    });
});

describe('listResponseBoard period match', () => {
    test('finds an August campaign that stores July work', async () => {
        const eligible = [{
            id: 'E1', name: 'Ayesha', client: 'Wafi', location: 'Karachi',
            filler_email: 'focal@wafi', approver_email: 'lm@wafi',
            claims_category: 'Focal + LM', routing_profile: 'focal_then_lm',
        }];
        const pool = {
            query: jest.fn()
                .mockResolvedValueOnce({
                    rows: [{
                        id: 9, campaign_mode: 'actual',
                        claim_month: 7, claim_year: 2026,
                        settlement_month: 8, settlement_year: 2026,
                        campaign_month: 8, campaign_year: 2026,
                    }],
                })
                .mockResolvedValueOnce({
                    rows: [{
                        id: 1, employee_id: 'E1', status: 'submitted',
                        filler_email: 'focal@wafi', approver_email: 'lm@wafi',
                        routing_profile: 'focal_then_lm', channel: 'portal',
                        batch_id: 3, period_id: 9, campaign_mode: 'actual',
                        submitted_at: '2026-08-17T10:00:00Z', approved_at: null,
                    }],
                })
                .mockResolvedValueOnce({ rows: [{
                    submission_id: 1, claim_type: 'OT', ot_hours: 8, ot_multiplier_factor: 2, amount: 0,
                }] })
                .mockResolvedValueOnce({
                    rows: [{
                        id: 3, period_id: 9, filler_email: 'focal@wafi',
                        invite_sent_at: '2026-08-15', invite_delivered: true,
                        invite_opened_at: '2026-08-16', last_reminder_at: '2026-08-20', reminder_count: 2,
                    }],
                })
                .mockResolvedValueOnce({
                    rows: [{
                        period_id: 9, approver_email: 'lm@wafi',
                        invite_sent_at: '2026-08-17', last_reminder_at: null, reminder_count: 0,
                    }],
                })
                .mockResolvedValueOnce({ rows: [] }),
        };
        const r = await listResponseBoard(pool, async () => ({ eligible }), {
            workMonth: 7, workYear: 2026, payMonth: 8, payYear: 2026, client: 'Wafi',
        });
        expect(r.ok).toBe(true);
        expect(r.invite_logged).toBe(1);
        expect(r.people[0].status).toBe('waiting_lm');
        expect(r.people[0].desk_status).toBe('pending_lm');
        expect(r.people[0].claim_summary).toMatch(/OT2/);
        expect(r.people[0].last_activity_label).toBe('Submitted');
        expect(r.people[0].focal_email).toBe('focal@wafi');
        expect(r.people[0].approver_email).toBe('lm@wafi');
        expect(r.desk_counts.pending_lm).toBe(1);
        expect(r.period_label).toMatch(/7\/2026 work/);
        expect(pool.query.mock.calls[0][1]).toEqual([7, 2026, 8, 2026]);
    });
});
