'use strict';
/** Smoke checks without Jest: node tests/portalClaims.smoke.js */
const p = require('../src/modules/claims/portalService');
const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };

assert(p.normalizeAuthority('self') === 'SELF', 'SELF');
assert(p.normalizeAuthority('Laiba@asil.com.pk') === 'laiba@asil.com.pk', 'email lower');
const w = p.periodWindow(2026, 7);
assert(w.claimMonth === 6 && w.settlementMonth === 7, 'period window');
assert(p.validateOtRow({ claim_date: '2026-07-13', ot_hours: 2, ot_multiplier: 'Double' }).errors.length === 0, 'double ok');
assert(p.validateOtRow({ claim_date: '2026-07-12', ot_hours: 2, ot_multiplier: 'Single' }).errors.length > 0, 'sunday single bad');
console.log('portalClaims.smoke OK');
