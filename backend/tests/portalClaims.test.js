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

    it('validateOtRow rejects Sunday single and weekday triple; weekday needs Time From/To', () => {
        const period = { claim_month: 7, claim_year: 2026 };
        const sun = validateOtRow({ claim_date: '2026-07-12', ot_hours: 2, ot_multiplier: 'Single' }, period);
        assert.ok(sun.errors.some(e => /Sunday/i.test(e)));

        const mon = validateOtRow({ claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Triple', time_from: '05:00 PM', time_to: '07:00 PM' }, period);
        assert.ok(mon.errors.some(e => /Triple|Eid/i.test(e)));

        const weekdayNoTimes = validateOtRow({ claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Double' }, period);
        assert.ok(weekdayNoTimes.errors.some(e => /Time From|8-hour|weekday/i.test(e)));

        const ok = validateOtRow({
            claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Double',
            time_from: '5pm', time_to: '19:00',
        }, period);
        assert.equal(ok.errors.length, 0, ok.errors.join('; '));
        assert.equal(ok.factor, 2);
    });

    it('validateOtRow rejects dates outside claim month with claims@asil.com.pk guidance', () => {
        const period = { claim_month: 6, claim_year: 2026 };
        const may = validateOtRow({
            claim_date: '15-05-2026', ot_hours: 2, ot_multiplier: 'Double',
            time_from: '5:00 PM', time_to: '7:00 PM',
        }, period);
        assert.ok(may.errors.some(e => /May 2026/i.test(e) && /claims@asil\.com\.pk/i.test(e)));
    });
});
