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

    test('personal email + focal + lm → focal_then_lm (focal fills)', () => {
        const r = resolveClaimsRouting({
            email: 'personal@gmail.com',
            claim_authority: 'focal@wafi.com',
            line_manager_email: 'lm@wafi.com',
        });
        assert.equal(r.profile, 'focal_then_lm');
        assert.equal(r.fillerEmail, 'focal@wafi.com');
    });

    test('no focal + lm + personal email → lm_only', () => {
        const r = resolveClaimsRouting({
            email: 'imamgardezi@gmail.com',
            line_manager_email: 'sadia.komal@asil.com.pk',
        });
        assert.equal(r.profile, 'lm_only');
        assert.equal(r.fillerEmail, 'sadia.komal@asil.com.pk');
    });

    test('no focal + lm + official email → lm_only (LM fills final)', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi-energy.com',
            line_manager_email: 'lm@wafi.com',
        });
        assert.equal(r.profile, 'lm_only');
        assert.equal(r.fillerEmail, 'lm@wafi.com');
        assert.equal(r.approverEmail, 'lm@wafi.com');
        assert.equal(r.initiator, 'lm');
    });

    test('focal + no lm + official email → focal_only (focal fills final)', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi-energy.com',
            claim_authority: 'focal@wafi.com',
        });
        assert.equal(r.profile, 'focal_only');
        assert.equal(r.fillerEmail, 'focal@wafi.com');
        assert.equal(r.approverEmail, 'focal@wafi.com');
    });

    test('focal + lm + official email → focal_then_lm (focal fills)', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi-energy.com',
            claim_authority: 'focal@wafi.com',
            line_manager_email: 'lm@wafi.com',
        });
        assert.equal(r.profile, 'focal_then_lm');
        assert.equal(r.fillerEmail, 'focal@wafi.com');
        assert.equal(r.approverEmail, 'lm@wafi.com');
        assert.equal(r.initiator, 'focal');
    });

    test('employee + Sadia when no focal or lm and official email', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi-energy.com',
        });
        assert.equal(r.profile, 'employee_then_asil');
        assert.equal(r.approverEmail, 'sadia.komal@asil.com.pk');
        assert.equal(r.fillerEmail, 'emp@wafi-energy.com');
    });

    test('no focal, no lm + personal email → Sadia fills final', () => {
        const r = resolveClaimsRouting({
            email: 'personal@gmail.com',
        });
        assert.equal(r.profile, 'lm_only');
        assert.equal(r.fillerEmail, 'sadia.komal@asil.com.pk');
        assert.equal(r.approverEmail, 'sadia.komal@asil.com.pk');
        assert.equal(r.initiator, 'lm');
    });

    test('not eligible category', () => {
        const c = resolveClaimsCategory({ email: 'x@y.com' }, { eligible: false });
        assert.equal(c.category, 'Not eligible');
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
