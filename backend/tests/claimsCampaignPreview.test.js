'use strict';

jest.mock('../src/modules/claims/claimsEligibility', () => ({
    countEligibleEmployees: jest.fn(),
    resolveClaimsCategory: jest.fn(),
}));

const { countEligibleEmployees } = require('../src/modules/claims/claimsEligibility');
const { createCampaignAugust } = require('../src/modules/claims/claimsCampaign');

const FOCAL = {
    id: 'ASIL-1',
    name: 'Ali Focal Team',
    filler_email: 'focal@wafi.example',
    approver_email: 'lm@wafi.example',
    routing_profile: 'focal_then_lm',
    claims_category: 'Focal + LM',
    cohort_type: 'focal',
};
const EMP = {
    id: 'ASIL-2',
    name: 'No Focal Employee',
    filler_email: 'emp@wafi.example',
    approver_email: 'lm2@wafi.example',
    routing_profile: 'employee_then_lm',
    claims_category: 'Employee + LM',
    cohort_type: 'employee',
};

describe('createCampaignAugust preview', () => {
    const period = {
        id: 99,
        claim_month: 8,
        claim_year: 2026,
        settlement_month: 9,
        settlement_year: 2026,
    };
    const pool = { query: jest.fn() };

    beforeEach(() => {
        pool.query.mockReset();
        process.env.CLAIMS_SAMPLE_EMAIL = 'shezad.mumtaz@asil.com.pk';
        countEligibleEmployees.mockResolvedValue({
            eligible: [FOCAL, EMP],
            skipped: [],
            rules: [],
        });
    });

    it('builds subject/html/mailTo for both templates and does not write', async () => {
        const result = await createCampaignAugust(pool, {
            period: { ...period },
            preview: true,
            campaignMode: 'actual',
            FRONTEND_URL: 'https://asil-hcm-frontend.onrender.com',
            buildFillerInviteHtml: ({ employeeCount, fillerEmail }) =>
                `<html>FOCAL ${fillerEmail} ${employeeCount}</html>`,
        });

        expect(pool.query).not.toHaveBeenCalled();
        expect(result.recipients).toHaveLength(2);

        const focal = result.recipients.find(r => r.template === 'focal');
        const emp = result.recipients.find(r => r.template === 'employee');
        expect(focal.mailTo).toBe('focal@wafi.example');
        expect(focal.sampleRedirect).toBe(false);
        expect(focal.subject).toMatch(/ASIL Claims 8\/2026/);
        expect(focal.html).toContain('FOCAL focal@wafi.example');
        expect(focal.employees[0]).toEqual(expect.objectContaining({ id: 'ASIL-1', name: 'Ali Focal Team' }));
        expect(result.employees).toHaveLength(2);
        expect(emp.mailTo).toBe('emp@wafi.example');
        expect(emp.html).toMatch(/Your claims/);
        expect(emp.html).toContain('No Focal Employee');
        expect(result.summary).toEqual({
            recipientCount: 2,
            employeeCount: 2,
            byProfile: { focal_then_lm: 1, employee_then_lm: 1 },
        });
    });

    it('SAMPLE mode redirects mailTo and applies onlyEmails', async () => {
        const result = await createCampaignAugust(pool, {
            period: { ...period },
            preview: true,
            campaignMode: 'sample',
            onlyEmails: ['focal@wafi.example'],
            FRONTEND_URL: 'https://example.com',
            buildFillerInviteHtml: () => '<html>x</html>',
        });

        expect(pool.query).not.toHaveBeenCalled();
        expect(result.recipients).toHaveLength(1);
        expect(result.recipients[0].fillerEmail).toBe('focal@wafi.example');
        expect(result.recipients[0].mailTo).toBe('shezad.mumtaz@asil.com.pk');
        expect(result.recipients[0].sampleRedirect).toBe(true);
        expect(result.recipients[0].subject).toMatch(/^\[SAMPLE/);
    });

    it('onlyEmployeeIds keeps just those employees', async () => {
        const result = await createCampaignAugust(pool, {
            period: { ...period },
            preview: true,
            campaignMode: 'actual',
            onlyEmployeeIds: ['ASIL-2'],
            FRONTEND_URL: 'https://example.com',
            buildFillerInviteHtml: () => '<html>x</html>',
        });
        expect(pool.query).not.toHaveBeenCalled();
        expect(result.employees).toHaveLength(1);
        expect(result.employees[0].id).toBe('ASIL-2');
        expect(result.recipients).toHaveLength(1);
        expect(result.recipients[0].template).toBe('employee');
    });
});
