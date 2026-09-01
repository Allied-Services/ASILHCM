'use strict';

const {
    resolveClaimsRouting,
    resolveClaimsCategory,
    ruleMatchesEmployee,
    evaluateEmployeeEligibility,
    employeeMatchesAudience,
    normalizeAudienceFilters,
    countEligibleEmployees,
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

    test('personal email + focal + lm → focal_then_lm (focal fills)', () => {
        const r = resolveClaimsRouting({
            email: 'personal@gmail.com',
            claim_authority: 'focal@wafi.com',
            line_manager_email: 'lm@wafi.com',
        });
        expect(r.profile).toBe('focal_then_lm');
        expect(r.fillerEmail).toBe('focal@wafi.com');
    });

    test('no focal + lm + personal email → lm_only', () => {
        const r = resolveClaimsRouting({
            email: 'imamgardezi@gmail.com',
            line_manager_email: 'sadia.komal@asil.com.pk',
        });
        expect(r.profile).toBe('lm_only');
        expect(r.fillerEmail).toBe('sadia.komal@asil.com.pk');
    });

    test('no focal + lm + official email → lm_only (LM fills final)', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi-energy.com',
            line_manager_email: 'lm@wafi.com',
        });
        expect(r.profile).toBe('lm_only');
        expect(r.fillerEmail).toBe('lm@wafi.com');
        expect(r.approverEmail).toBe('lm@wafi.com');
        expect(r.initiator).toBe('lm');
    });

    test('asil.com.pk employee + LM → lm_only (LM fills final)', () => {
        const r = resolveClaimsRouting({
            email: 'iman.akbar@asil.com.pk',
            line_manager_email: 'sadia.komal@asil.com.pk',
        });
        expect(r.profile).toBe('lm_only');
        expect(r.fillerEmail).toBe('sadia.komal@asil.com.pk');
        expect(r.approverEmail).toBe('sadia.komal@asil.com.pk');
    });

    test('focal + no lm + official email → focal_only (focal fills final)', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi-energy.com',
            claim_authority: 'focal@wafi.com',
        });
        expect(r.profile).toBe('focal_only');
        expect(r.fillerEmail).toBe('focal@wafi.com');
        expect(r.approverEmail).toBe('focal@wafi.com');
    });

    test('focal + lm + official email → focal_then_lm (focal fills)', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi-energy.com',
            claim_authority: 'focal@wafi.com',
            line_manager_email: 'lm@wafi.com',
        });
        expect(r.profile).toBe('focal_then_lm');
        expect(r.fillerEmail).toBe('focal@wafi.com');
        expect(r.approverEmail).toBe('lm@wafi.com');
        expect(r.initiator).toBe('focal');
    });

    test('official work mailbox with no focal or lm is employee final', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi-energy.com',
        });
        expect(r.profile).toBe('employee_only');
        expect(r.category).toBe('Employee final');
        expect(r.fillerEmail).toBe('emp@wafi-energy.com');
        expect(r.approverEmail).toBe('emp@wafi-energy.com');
        expect(r.initiator).toBe('employee');
    });

    test('personal Gmail with no focal or LM → Sadia fills final', () => {
        const r = resolveClaimsRouting({ email: 'emp@gmail.com' });
        expect(r.profile).toBe('lm_only');
        expect(r.fillerEmail).toBe('sadia.komal@asil.com.pk');
        expect(r.approverEmail).toBe('sadia.komal@asil.com.pk');
        const c = resolveClaimsCategory({ email: 'emp@gmail.com' });
        expect(c.category).toBe('ASIL only');
    });

    test('not eligible category', () => {
        const c = resolveClaimsCategory({ email: 'x@y.com' }, { eligible: false });
        expect(c.category).toBe('Not eligible');
    });

    test('Gmail + LM with no Focal is LM only (final)', () => {
        const r = resolveClaimsRouting({
            email: 'emp@gmail.com',
            line_manager_email: 'M.Aamir@wafi-energy.com',
        });
        expect(r.profile).toBe('lm_only');
        expect(r.category).toBe('LM only');
        expect(r.fillerEmail).toBe('m.aamir@wafi-energy.com');
        expect(r.approverEmail).toBe('m.aamir@wafi-energy.com');
        expect(r.initiator).toBe('lm');
    });

    test('Amjad Shaikh proof: no email, no Focal, LM Aamir is final', () => {
        const emp = {
            id: 'ASILFM/SPL/22/23',
            name: 'Amjad Shaikh',
            email: null,
            claim_authority: null,
            line_manager_email: 'M.Aamir@wafi-energy.com',
        };
        const r = resolveClaimsRouting(emp);
        expect(r.profile).toBe('lm_only');
        expect(r.fillerEmail).toBe('m.aamir@wafi-energy.com');
        const c = resolveClaimsCategory(emp);
        expect(c.category).toBe('LM only');
    });

    test('Ahmad Hussain Gmail + Focal is Focal only, not employee invite', () => {
        const r = resolveClaimsRouting({
            email: 'aahmadhussain33@gmail.com',
            claim_authority: 'Akhtar.Ali@wafi-energy.com',
        });
        expect(r.profile).toBe('focal_only');
        expect(r.fillerEmail).toBe('akhtar.ali@wafi-energy.com');
    });

    test('personal Gmail with focal still routes to the focal', () => {
        const r = resolveClaimsRouting({
            email: 'emp@gmail.com',
            claim_authority: 'focal@wafi-energy.com',
        });
        expect(r.profile).toBe('focal_only');
        expect(r.fillerEmail).toBe('focal@wafi-energy.com');
    });

    test('explicit employee_then_focal uses employee work mailbox', () => {
        const r = resolveClaimsRouting({
            email: 'emp@wafi-energy.com',
            claim_authority: 'focal@wafi.com',
        }, { routing_mode: 'employee_then_focal' });
        expect(r.profile).toBe('employee_then_focal');
        expect(r.fillerEmail).toBe('emp@wafi-energy.com');
        expect(r.approverEmail).toBe('focal@wafi.com');
    });

    test('explicit employee_then_lm uses employee then LM', () => {
        const r = resolveClaimsRouting({
            email: 'emp@asil.com.pk',
            line_manager_email: 'lm@wafi.com',
        }, { routing_mode: 'employee_then_lm' });
        expect(r.profile).toBe('employee_then_lm');
        expect(r.fillerEmail).toBe('emp@asil.com.pk');
        expect(r.approverEmail).toBe('lm@wafi.com');
    });

    test('dedicated payroll resource fills final when no official mailbox', () => {
        const r = resolveClaimsRouting(
            { email: 'emp@gmail.com' },
            { dedicated_payroll_resource_email: 'payroll.owner@asil.com.pk' }
        );
        expect(r.profile).toBe('lm_only');
        expect(r.category).toBe('ASIL only');
        expect(r.fillerEmail).toBe('payroll.owner@asil.com.pk');
        expect(r.approverEmail).toBe('payroll.owner@asil.com.pk');
    });

    test('asil_supervisor_then_focal uses location supervisor', () => {
        const r = resolveClaimsRouting({
            asil_site_supervisor_email: 'site.asil@asil.com.pk',
        }, {
            routing_mode: 'asil_supervisor_then_focal',
            allied_contract_focal_email: 'focal@asil.com.pk',
        });
        expect(r.profile).toBe('asil_supervisor_then_focal');
        expect(r.fillerEmail).toBe('site.asil@asil.com.pk');
        expect(r.approverEmail).toBe('focal@asil.com.pk');
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

    test('audience filters match client / contract / dept / location', () => {
        const emp = {
            client: 'Wafi Energy Pakistan Pvt Ltd',
            contract_id: 'CTR-W',
            contract_name: 'Wafi BPO',
            dept: 'Ops',
            location: 'Karachi',
        };
        expect(normalizeAudienceFilters({ filterClient: ' Wafi ' }).client).toBe('Wafi');
        expect(employeeMatchesAudience(emp, { filterClient: 'Wafi Energy Pakistan Pvt Ltd' })).toBe(true);
        expect(employeeMatchesAudience(emp, { filterClient: 'PSO' })).toBe(false);
        expect(employeeMatchesAudience(emp, {
            filterClient: 'Wafi Energy Pakistan Pvt Ltd',
            filterContract: 'CTR-W',
            filterDept: 'Ops',
            filterLoc: 'Karachi',
        })).toBe(true);
        expect(employeeMatchesAudience(emp, { filterContract: 'Wafi BPO' })).toBe(true);
        expect(employeeMatchesAudience(emp, { filterLoc: 'Lahore' })).toBe(false);
    });

    test('countEligibleEmployees adds client/contract to the SQL', async () => {
        const pool = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] }),
        };
        await countEligibleEmployees(pool, {
            filterClient: 'Wafi Energy Pakistan Pvt Ltd',
            filterContract: 'CTR-W',
        });
        expect(pool.query).toHaveBeenCalledTimes(2);
        const [sql, params] = pool.query.mock.calls[1];
        expect(sql).toMatch(/e\.client = \$1/);
        expect(sql).toMatch(/e\.contract_id = \$2/);
        expect(params).toEqual(['Wafi Energy Pakistan Pvt Ltd', 'CTR-W']);
    });
});
