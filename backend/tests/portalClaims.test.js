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

describe('portalClaims helpers', () => {
    it('normalizeAuthority SELF and email', () => {
        assert.equal(normalizeAuthority('self'), 'SELF');
        assert.equal(normalizeAuthority('SELF'), 'SELF');
        assert.equal(normalizeAuthority('Laiba.Mughal@asil.com.pk'), 'laiba.mughal@asil.com.pk');
        assert.equal(normalizeAuthority(''), null);
        assert.equal(normalizeAuthority(null), null);
    });

    it('periodWindow claim = previous month, settlement = campaign month', () => {
        const w = periodWindow(2026, 7);
        assert.equal(w.claimMonth, 6);
        assert.equal(w.claimYear, 2026);
        assert.equal(w.settlementMonth, 7);
        assert.equal(w.settlementYear, 2026);
        assert.equal(FILL_CLOSE_DAY, 22);
        assert.equal(APPROVE_CLOSE_DAY, 25);
    });

    it('validateOtRow rejects Sunday single and weekday triple; weekday needs after-shift OT', () => {
        const period = { claim_month: 7, claim_year: 2026 };
        const sun = validateOtRow({ claim_date: '2026-07-12', ot_hours: 2, ot_multiplier: 'Single' }, period);
        assert.ok(sun.errors.some(e => /Sunday/i.test(e)));

        const mon = validateOtRow({ claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Triple', time_from: '05:00 PM', time_to: '07:00 PM' }, period);
        assert.ok(mon.errors.some(e => /Only Double|Triple \(3×\)|weekday/i.test(e)));
        assert.ok(mon.errors.some(e => /13-JUL-2026/i.test(e)));

        const early = validateOtRow({
            claim_date: '2026-07-13', ot_hours: 6, ot_multiplier: 'Double',
            time_from: '09:00 AM', time_to: '03:00 PM',
        }, period);
        assert.ok(early.errors.some(e => /mandatory 8 hours|do not qualify/i.test(e)));

        const weekdayNoTimes = validateOtRow({ claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Double' }, period);
        assert.ok(weekdayNoTimes.errors.some(e => /Time From|mandatory 8/i.test(e)));

        const ok = validateOtRow({
            claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Double',
            time_from: '5pm', time_to: '19:00',
        }, period);
        assert.equal(ok.errors.length, 0, ok.errors.join('; '));
        assert.equal(ok.factor, 2);
    });

    it('validateOtRow rejects dates outside claim month with DD-MON-YYYY and claims@asil.com.pk', () => {
        const period = { claim_month: 6, claim_year: 2026 };
        const may = validateOtRow({
            claim_date: '15-05-2026', ot_hours: 2, ot_multiplier: 'Double',
            time_from: '5:00 PM', time_to: '7:00 PM',
        }, period);
        assert.ok(may.errors.some(e => /15-MAY-2026/i.test(e) && /May 2026/i.test(e) && /claims@asil\.com\.pk/i.test(e)));
    });
});
