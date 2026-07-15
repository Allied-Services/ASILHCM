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

    it('validateOtRow rejects Sunday single and weekday triple', () => {
        const sun = validateOtRow({ claim_date: '2026-07-12', ot_hours: 2, ot_multiplier: 'Single' });
        assert.ok(sun.errors.some(e => /Sunday/i.test(e)));

        const mon = validateOtRow({ claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Triple' });
        assert.ok(mon.errors.some(e => /Triple|weekday/i.test(e)));

        const ok = validateOtRow({ claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Double' });
        assert.equal(ok.errors.length, 0);
        assert.equal(ok.factor, 2);
    });
});
