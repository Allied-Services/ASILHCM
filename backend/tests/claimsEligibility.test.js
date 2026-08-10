'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
    resolveClaimsRouting,
    resolveClaimsCategory,
    ruleMatchesEmployee,
} = require('../src/modules/claims/claimsEligibility');

describe('claimsEligibility routing', () => {
    test('focal + lm → focal_then_lm', () => {
        const r = resolveClaimsRouting({
            claim_authority: 'focal@wafi.com',
            line_manager_email: 'lm@wafi.com',
            email: 'emp@wafi.com',
        });
        assert.equal(r.profile, 'focal_then_lm');
        assert.equal(r.category, 'Focal + LM');
        assert.equal(r.initiator, 'focal');
    });

    test('focal only when no lm', () => {
        const r = resolveClaimsRouting({
            claim_authority: 'focal@wafi.com',
            email: 'emp@wafi.com',
        });
        assert.equal(r.profile, 'focal_only');
        assert.equal(r.approverEmail, 'focal@wafi.com');
    });

    test('employee + lm when no focal', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi.com',
            line_manager_email: 'lm@wafi.com',
        });
        assert.equal(r.profile, 'employee_then_lm');
        assert.equal(r.initiator, 'employee');
    });

    test('employee + asil when no focal or lm', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi.com',
        });
        assert.equal(r.profile, 'employee_then_asil');
        assert.equal(r.approverEmail, 'huzaifa.rafaqat@asil.com.pk');
    });

    test('not eligible category', () => {
        const c = resolveClaimsCategory({ email: 'x@y.com' }, { eligible: false });
        assert.equal(c.category, 'Not eligible');
    });
});

describe('claimsEligibility rules', () => {
    test('wafi rule excludes facility management dept', () => {
        const rule = {
            active: true,
            client_pattern: 'wafi',
            dept_exclude: ['Facility Management'],
            eligible: true,
        };
        assert.equal(ruleMatchesEmployee(rule, { client: 'Wafi Energy', dept: 'IT' }), true);
        assert.equal(ruleMatchesEmployee(rule, { client: 'Wafi Energy', dept: 'Facility Management' }), false);
    });
});
