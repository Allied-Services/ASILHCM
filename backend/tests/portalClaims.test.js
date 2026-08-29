'use strict';

/**
 * Unit tests for portal claims helpers (no DB).
 * Uses Node's built-in test runner: node --test tests/portalClaims.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeAuthority,
    periodWindow,
    validateOtRow,
    resolveSupportCategory,
    FILL_CLOSE_DAY,
    APPROVE_CLOSE_DAY,
} = require('../src/modules/claims/portalService');
const { dateParseErrorMessage, toIsoDate } = require('../src/modules/claims/portalExcel');

describe('portalClaims helpers', () => {
    it('normalizeAuthority SELF and email', () => {
        assert.equal(normalizeAuthority('self'), 'SELF');
        assert.equal(normalizeAuthority('SELF'), 'SELF');
        assert.equal(normalizeAuthority('Laiba.Mughal@asil.com.pk'), 'laiba.mughal@asil.com.pk');
        assert.equal(normalizeAuthority(''), null);
        assert.equal(normalizeAuthority(null), null);
    });

    it('periodWindow claim = previous month, settlement = campaign month', () => {
        const w = periodWindow(2026, 8);
        assert.equal(w.claimMonth, 7);
        assert.equal(w.claimYear, 2026);
        assert.equal(w.settlementMonth, 8);
        assert.equal(w.settlementYear, 2026);
        assert.equal(FILL_CLOSE_DAY, 18);
        assert.equal(APPROVE_CLOSE_DAY, 22);
    });

    it('periodWindowFromClaim anchors fill/approve close to campaign month (following_month)', () => {
        const { periodWindowFromClaim } = require('../src/modules/claims/portalService');
        const w = periodWindowFromClaim(2026, 7);
        assert.equal(w.claimMonth, 7);
        assert.equal(w.settlementMonth, 8);
        assert.equal(w.campaignMonth, 8);
        assert.equal(w.fillCloseAt.getUTCMonth(), 7);
        assert.equal(w.fillCloseAt.getUTCDate(), 18);
        assert.equal(w.approveCloseAt.getUTCMonth(), 7);
        assert.equal(w.approveCloseAt.getUTCDate(), 22);
        assert.equal(w.fillOpenAt.getUTCDate(), 1);
    });

    it('periodWindowFromClaim can put a deadline in the current claim month', () => {
        const { periodWindowFromClaim } = require('../src/modules/claims/portalService');
        const w = periodWindowFromClaim(2026, 7, {
            calendar_apply: true,
            claims_pay_timing: 'following_month',
            submit_deadline_day: 10,
            submit_deadline_month: 'current_month',
            approve_deadline_day: 22,
            approve_deadline_month: 'following_month',
        });
        assert.equal(w.settlementMonth, 8);
        assert.equal(w.submitDeadlineMonth, 'current_month');
        assert.equal(w.approveDeadlineMonth, 'following_month');
        assert.equal(w.fillCloseAt.getUTCMonth(), 6);
        assert.equal(w.fillCloseAt.getUTCDate(), 10);
        assert.equal(w.approveCloseAt.getUTCMonth(), 7);
        assert.equal(w.approveCloseAt.getUTCDate(), 22);
    });

    it('July 2026 fill and LM approve are closed now; sample stays open', () => {
        const { isAfterFillClose, isAfterApproveClose, FILL_CLOSED_MESSAGE } = require('../src/modules/claims/portalService');
        const july = {
            claim_month: 7,
            claim_year: 2026,
            fill_close_at: '2026-08-27T18:59:59.000Z',
            approve_close_at: '2026-08-27T18:59:59.000Z',
            campaign_mode: 'actual',
        };
        assert.equal(FILL_CLOSED_MESSAGE, 'Deadline has expired.');
        assert.equal(isAfterFillClose(july, Date.parse('2026-08-25T17:00:00Z')), true);
        assert.equal(isAfterFillClose(july, Date.parse('2026-08-27T18:00:00Z')), true);
        assert.equal(isAfterFillClose({ ...july, campaign_mode: 'sample' }, Date.parse('2026-08-27T18:00:00Z')), false);
        assert.equal(isAfterApproveClose(july, Date.parse('2026-08-27T18:00:00Z')), true);
        assert.equal(isAfterApproveClose({ ...july, campaign_mode: 'sample' }, Date.parse('2026-08-27T18:00:00Z')), false);
        const august = {
            claim_month: 8,
            claim_year: 2026,
            fill_close_at: '2026-09-18T18:59:59.000Z',
            campaign_mode: 'actual',
        };
        assert.equal(isAfterFillClose(august, Date.parse('2026-08-27T12:00:00Z')), false);
    });

    it('contract without an applied deadline stays open even after July close', () => {
        const { isFillClosedForPolicy, isApproveClosedForPolicy } = require('../src/modules/claims/portalService');
        const july = {
            claim_month: 7,
            claim_year: 2026,
            fill_close_at: '2026-08-27T18:59:59.000Z',
            approve_close_at: '2026-08-27T18:59:59.000Z',
            campaign_mode: 'actual',
        };
        assert.equal(isFillClosedForPolicy(july, { calendar_apply: false }), false);
        assert.equal(isFillClosedForPolicy(july, { calendar_apply: true }), false);
        assert.equal(isApproveClosedForPolicy(july, { calendar_apply: true, approve_deadline_day: null }), false);
        assert.equal(isFillClosedForPolicy(july, {
            calendar_apply: true,
            submit_deadline_day: 18,
        }), true);
        assert.equal(isApproveClosedForPolicy(july, {
            calendar_apply: true,
            approve_deadline_day: 22,
        }), true);
    });

    it('sendFillerBatchReminder does not mail after July fill close', async () => {
        const { sendFillerBatchReminder } = require('../src/modules/claims/portalService');
        let mailed = false;
        const r = await sendFillerBatchReminder(
            { query: async () => { throw new Error('should not query'); } },
            {
                claim_month: 7,
                claim_year: 2026,
                campaign_mode: 'actual',
                last_reminder_at: null,
                invite_sent_at: '2026-08-01T00:00:00Z',
            },
            async () => { mailed = true; },
        );
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'fill_closed');
        assert.equal(mailed, false);
    });

    it('sendApproverPeriodReminder does not mail after July approve close', async () => {
        const { sendApproverPeriodReminder } = require('../src/modules/claims/portalService');
        let mailed = false;
        const r = await sendApproverPeriodReminder(
            {
                query: async () => ({
                    rows: [{
                        claim_month: 7,
                        claim_year: 2026,
                        campaign_mode: 'actual',
                        approve_close_at: '2026-08-27T18:59:59.000Z',
                    }],
                }),
            },
            3,
            'lm@example.com',
            async () => { mailed = true; },
        );
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'approve_closed');
        assert.equal(mailed, false);
    });

    it('refreshOpenPeriodFillClose does not rewind a later promised close', async () => {
        const { refreshOpenPeriodFillClose, periodWindowFromClaim } = require('../src/modules/claims/portalService');
        let queried = false;
        const pool = { query: async () => { queried = true; return { rows: [] }; } };
        const w = periodWindowFromClaim(2026, 7);
        const period = {
            id: 3,
            status: 'open',
            fill_close_at: '2026-08-27T18:59:59.000Z',
            approve_close_at: '2026-08-27T18:59:59.000Z',
        };
        const out = await refreshOpenPeriodFillClose(pool, period, w);
        assert.equal(queried, false);
        assert.equal(out.fill_close_at, period.fill_close_at);
    });

    it('validateOtRow: OT Start/End required; 3× only on gazetted holidays; 2× always OK', () => {
        const period = { claim_month: 7, claim_year: 2026 };

        const sun = validateOtRow({
            claim_date: '2026-07-12', ot_multiplier: 'Single',
            time_from: '5:00 PM', time_to: '7:00 PM',
        }, period);
        assert.ok(sun.errors.some(e => /Sunday/i.test(e)));

        const weekdayTriple = validateOtRow({
            claim_date: '2026-07-13', ot_multiplier: '3X',
            time_from: '05:00 PM', time_to: '07:00 PM',
        }, period);
        assert.ok(weekdayTriple.errors.some(e => /Triple \(3×\)|gazetted/i.test(e)));
        assert.ok(weekdayTriple.errors.some(e => /13-JUL-2026/i.test(e)));

        // Early daytime OT start is allowed for claiming (LM reviews) — not rejected as "before 5pm"
        const earlyOk = validateOtRow({
            claim_date: '2026-07-13', ot_multiplier: '2X',
            time_from: '09:00 AM', time_to: '11:00 AM',
        }, period);
        assert.equal(earlyOk.errors.length, 0, earlyOk.errors.join('; '));
        assert.equal(earlyOk.ot_hours, 2);
        assert.equal(earlyOk.factor, 2);

        const noTimes = validateOtRow({
            claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Double',
        }, period);
        assert.ok(noTimes.errors.some(e => /OT Start|OT End/i.test(e)));

        const ok = validateOtRow({
            claim_date: '2026-07-13', ot_multiplier: 'Double',
            time_from: '5pm', time_to: '19:00',
        }, period);
        assert.equal(ok.errors.length, 0, ok.errors.join('; '));
        assert.equal(ok.factor, 2);
        assert.equal(ok.ot_hours, 2);
    });

    it('validateOtRow allows 3× on gazetted holiday (not only Eid)', () => {
        const period = { claim_month: 8, claim_year: 2026 };
        const indDay = validateOtRow({
            claim_date: '2026-08-14', ot_multiplier: '3X',
            time_from: '9:00 AM', time_to: '1:00 PM',
        }, period);
        assert.equal(indDay.errors.length, 0, indDay.errors.join('; '));
        assert.equal(indDay.factor, 3);
        assert.equal(indDay.ot_hours, 4);
    });

    it('validateOtRow rejects dates outside claim month with DD-MON-YYYY and claims@asil.com.pk', () => {
        const period = { claim_month: 6, claim_year: 2026 };
        const may = validateOtRow({
            claim_date: '15-05-2026', ot_multiplier: 'Double',
            time_from: '5:00 PM', time_to: '7:00 PM',
        }, period);
        assert.ok(may.errors.some(e => /15-MAY-2026/i.test(e) && /May 2026/i.test(e) && /claims@asil\.com\.pk/i.test(e)));
    });

    it('dateParseErrorMessage explains impossible calendar days like 31 June', () => {
        assert.equal(toIsoDate('31.06.2026'), null);
        const msg = dateParseErrorMessage('31.06.2026', 'Overtime row 16');
        assert.match(msg, /31 June 2026/i);
        assert.match(msg, /only 30 days/i);
        assert.match(msg, /correct the file and upload again/i);
    });

    it('resolveSupportCategory maps mis-clicks when only one claim type exists', () => {
        assert.equal(
            resolveSupportCategory('expense_support', ['MEDICAL']),
            'medical_support'
        );
        assert.equal(
            resolveSupportCategory('medical_support', ['EXPENSE']),
            'expense_support'
        );
        assert.equal(
            resolveSupportCategory('expense_support', ['EXPENSE', 'MEDICAL']),
            'expense_support'
        );
        assert.equal(
            resolveSupportCategory('medical_support', ['EXPENSE', 'MEDICAL']),
            'medical_support'
        );
    });

    it('parseClaimsNumber keeps Excel thousand separators as real money', () => {
        const { parseClaimsNumber } = require('../src/modules/claims/portalService');
        assert.equal(parseClaimsNumber('80,823'), 80823);
        assert.equal(parseClaimsNumber('9,672'), 9672);
        assert.equal(parseClaimsNumber('"90,112"'), 90112);
        assert.equal(parseClaimsNumber('500'), 500);
        assert.equal(parseClaimsNumber(''), 0);
        assert.equal(parseClaimsNumber('22.5'), 22.5);
    });

    it('applyPortalCorrection rejects the template example code', async () => {
        const { applyPortalCorrection } = require('../src/modules/claims/portalService');
        let queried = 0;
        const pool = { query: async () => { queried += 1; return { rows: [] }; } };
        const r = await applyPortalCorrection(pool, async () => {}, {
            employeeId: 'ASIL/SPL-001',
            workMonth: 7,
            workYear: 2026,
            medicalAmount: 500,
            reason: 'Manual upload correction',
            resubmitToLm: false,
        });
        assert.equal(r.ok, false);
        assert.match(r.error, /template example/i);
        assert.equal(queried, 0);
    });

    it('normalizeManualImportRow defaults pay month to the following settlement month', () => {
        const { normalizeManualImportRow, followingClaimSettlement } = require('../src/modules/claims/portalService');
        const settle = followingClaimSettlement(7, 2026);
        assert.equal(settle.month, 8);
        assert.equal(settle.year, 2026);
        const n = normalizeManualImportRow({
            Code: 'ASIL/SPL-91/21',
            'OT (x2)': '4',
            OPD: '500',
            Reason: 'July correction',
            'Send to LM?': 'Y',
        }, { workMonth: 7, workYear: 2026 });
        assert.equal(n.employeeId, 'ASIL/SPL-91/21');
        assert.equal(n.workMonth, 7);
        assert.equal(n.workYear, 2026);
        assert.equal(n.payMonth, 8);
        assert.equal(n.payYear, 2026);
        assert.equal(n.resubmitToLm, true);
        assert.equal(n.ot2Hours, 4);
        assert.equal(n.medicalAmount, 500);
    });

    it('normalizeManualImportRow reads quoted Excel headers and Send to LM = N', () => {
        const { normalizeManualImportRow } = require('../src/modules/claims/portalService');
        const n = normalizeManualImportRow({
            '"Code"': 'ASIL/SPL-91/21',
            '"Work Month"': '7',
            '"Work Year"': '2026',
            '"Send to LM?"': 'N',
            '"Replace Existing?"': 'Y',
        });
        assert.equal(n.employeeId, 'ASIL/SPL-91/21');
        assert.equal(n.resubmitToLm, false);
        assert.equal(n.mode, 'replace');
        assert.equal(n.payMonth, 8);
    });

    it('normalizeEmployeeCode maps Asif Arain sheet typo to the live roster id', () => {
        const { normalizeEmployeeCode } = require('../src/modules/claims/portalService');
        assert.equal(normalizeEmployeeCode('ASILFM//SPL/304/21'), 'ASIL/SPL-304/21');
        assert.equal(normalizeEmployeeCode('ASILFM/SPL/304/21'), 'ASIL/SPL-304/21');
        assert.equal(normalizeEmployeeCode('ASILFM/SPL/22/16'), 'ASILFM/SPL/22/16');
    });

    it('normalizeManualImportRow ignores a shifted year of 7 and uses the filter default', () => {
        const { normalizeManualImportRow } = require('../src/modules/claims/portalService');
        const n = normalizeManualImportRow({
            Code: 'ASIL/SPL-417/21',
            'Work Month': '0',
            'Work Year': '7',
            Exp: '80,823',
            'Send to LM?': 'N',
        }, { workMonth: 7, workYear: 2026 });
        assert.equal(n.employeeId, 'ASIL/SPL-417/21');
        assert.equal(n.workMonth, 7);
        assert.equal(n.workYear, 2026);
        assert.equal(n.expenseAmount, 80823);
        assert.equal(n.resubmitToLm, false);
    });

    it('applyPortalCorrection Send to LM = N replaces portal amounts and never emails', async () => {
        const { applyPortalCorrection } = require('../src/modules/claims/portalService');
        const sql = [];
        let mailed = 0;
        const pool = {
            query: async (text, vals) => {
                sql.push(String(text).replace(/\s+/g, ' ').trim());
                if (/FROM employees/i.test(text)) {
                    return { rows: [{ id: 'ASIL/SPL-400/21', name: 'Mohsin', claim_authority: null, line_manager_email: 'lm@wafi-energy.com', email: 'x@wafi-energy.com' }] };
                }
                if (/FROM portal_claim_periods/i.test(text) || /INSERT INTO portal_claim_periods/i.test(text)) {
                    return { rows: [{ id: 9, claim_month: 7, claim_year: 2026, settlement_month: 8, settlement_year: 2026, status: 'open' }] };
                }
                if (/FROM portal_claim_submissions/i.test(text)) {
                    return { rows: [{ id: 44, status: 'submitted', channel: 'portal' }] };
                }
                if (/INSERT INTO portal_claim_submissions/i.test(text)) {
                    return { rows: [{ id: 44 }] };
                }
                return { rows: [], rowCount: 1 };
            },
        };
        const sendAppEmail = async () => { mailed += 1; };
        const r = await applyPortalCorrection(pool, sendAppEmail, {
            employeeId: 'ASIL/SPL-400/21',
            workMonth: 7,
            workYear: 2026,
            ot1Hours: 0,
            ot2Hours: 0,
            ot3Hours: 0,
            expenseAmount: 0,
            medicalAmount: 500,
            reason: 'Manual upload correction',
            createdBy: 'test',
            dryRun: false,
            notifyLm: true,
            resubmitToLm: false,
        });
        assert.equal(r.ok, true);
        assert.equal(r.resubmitToLm, false);
        assert.equal(r.lmNotified, false);
        assert.equal(r.approverEmail, null);
        assert.equal(mailed, 0);
        assert.ok(sql.some((s) => /SET status = 'approved'/i.test(s)));
        assert.ok(!sql.some((s) => /SET status = 'submitted'/i.test(s)));
        assert.match(r.message, /No Focal or LM email/i);
    });

    it('validateOtRow upgrades gazetted holiday Double input to Triple', () => {
        const period = { claim_month: 8, claim_year: 2026 };
        const aug14 = validateOtRow({
            claim_date: '2026-08-14',
            ot_multiplier: 'Double',
            time_from: '5:00 PM',
            time_to: '7:00 PM',
        }, period);
        assert.equal(aug14.errors.length, 0, aug14.errors.join('; '));
        assert.equal(aug14.factor, 3);
        assert.equal(aug14.ot_multiplier, 'Triple');
    });
});
