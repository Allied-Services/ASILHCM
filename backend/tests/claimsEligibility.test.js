'use strict';

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
        expect(r.profile).toBe('focal_then_lm');
        expect(r.category).toBe('Focal + LM');
        expect(r.initiator).toBe('focal');
    });

    test('focal only when no lm', () => {
        const r = resolveClaimsRouting({
            claim_authority: 'focal@wafi.com',
            email: 'emp@wafi.com',
        });
        expect(r.profile).toBe('focal_only');
        expect(r.approverEmail).toBe('focal@wafi.com');
    });

    test('employee + lm when no focal', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi.com',
            line_manager_email: 'lm@wafi.com',
        });
        expect(r.profile).toBe('employee_then_lm');
        expect(r.initiator).toBe('employee');
    });

    test('employee + asil when no focal or lm', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi.com',
        });
        expect(r.profile).toBe('employee_then_asil');
        expect(r.approverEmail).toBe('huzaifa.rafaqat@asil.com.pk');
    });

    test('not eligible category', () => {
        const c = resolveClaimsCategory({ email: 'x@y.com' }, { eligible: false });
        expect(c.category).toBe('Not eligible');
    });

    test('personal Gmail is not a Portal Claims filler', () => {
        const r = resolveClaimsRouting({ email: 'emp@gmail.com' });
        expect(r.fillerEmail).toBe(null);
        expect(r.profile).toBe('employee_then_asil');
        const c = resolveClaimsCategory({ email: 'emp@gmail.com' });
        expect(c.category).toBe('Setup needed');
    });

    test('personal Gmail with focal still routes to the focal', () => {
        const r = resolveClaimsRouting({
            email: 'emp@gmail.com',
            claim_authority: 'focal@wafi-energy.com',
        });
        expect(r.profile).toBe('focal_only');
        expect(r.fillerEmail).toBe('focal@wafi-energy.com');
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
        expect(ruleMatchesEmployee(rule, { client: 'Wafi Energy', dept: 'IT' })).toBe(true);
        expect(ruleMatchesEmployee(rule, { client: 'Wafi Energy', dept: 'Facility Management' })).toBe(false);
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
        expect(fm.eligible).toBe(true);
        expect(pso.eligible).toBe(true);
        expect(none.eligible).toBe(true);
    });
});
