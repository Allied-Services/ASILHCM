'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
    resolveClaimsRouting,
    resolveClaimsCategory,
    ruleMatchesEmployee,
    evaluateEmployeeEligibility,
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

    test('personal Gmail is not a Portal Claims filler', () => {
        const r = resolveClaimsRouting({ email: 'emp@gmail.com' });
        assert.equal(r.fillerEmail, null);
        assert.equal(r.profile, 'employee_then_asil');
        const c = resolveClaimsCategory({ email: 'emp@gmail.com' });
        assert.equal(c.category, 'Setup needed');
    });

    test('personal Gmail with focal still routes to the focal', () => {
        const r = resolveClaimsRouting({
            email: 'emp@gmail.com',
            claim_authority: 'focal@wafi-energy.com',
        });
        assert.equal(r.profile, 'focal_only');
        assert.equal(r.fillerEmail, 'focal@wafi-energy.com');
    });
});

describe('claimsEligibility rules', () => {
    test('wafi rule matcher still knows FM vs non-FM', () => {
        const rule = {
            active: true,
            client_pattern: 'wafi',
            dept_exclude: ['Facility Management'],
            eligible: true,
        };
        assert.equal(ruleMatchesEmployee(rule, { client: 'Wafi Energy', dept: 'IT' }), true);
        assert.equal(ruleMatchesEmployee(rule, { client: 'Wafi Energy', dept: 'Facility Management' }), false);
    });

    test('no matching rule is eligible — send-screen filters decide the audience', async () => {
        const wafiRule = {
            active: true,
            client_pattern: 'wafi',
            dept_exclude: ['Facility Management'],
            eligible: true,
        };
        const fm = await evaluateEmployeeEligibility(null, { client: 'Wafi Energy', dept: 'Facility Management' }, [wafiRule]);
        const pso = await evaluateEmployeeEligibility(null, { client: 'PSO', dept: 'Operations' }, [wafiRule]);
        const none = await evaluateEmployeeEligibility(null, { client: 'Wafi Energy', dept: 'IT' }, []);
        assert.equal(fm.eligible, true);
        assert.equal(pso.eligible, true);
        assert.equal(none.eligible, true);
    });
});
