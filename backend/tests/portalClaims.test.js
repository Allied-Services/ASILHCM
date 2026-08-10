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
        assert.equal(FILL_CLOSE_DAY, 17);
        assert.equal(APPROVE_CLOSE_DAY, 22);
    });

    it('periodWindowFromClaim anchors deadlines to claim month', () => {
        const { periodWindowFromClaim } = require('../src/modules/claims/portalService');
        const w = periodWindowFromClaim(2026, 7);
        assert.equal(w.claimMonth, 7);
        assert.equal(w.settlementMonth, 8);
        assert.equal(w.fillCloseAt.getUTCDate(), 17);
        assert.equal(w.approveCloseAt.getUTCDate(), 22);
        assert.equal(w.fillOpenAt.getUTCDate(), 1);
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
});
