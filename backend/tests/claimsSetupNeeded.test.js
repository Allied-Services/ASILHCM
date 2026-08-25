'use strict';

const {
    buildSetupNeededHtml,
    filterSetupNeeded,
    SADIA_SETUP_EMAIL,
} = require('../src/modules/claims/claimsCampaign');
const { isFinalSubmitProfile } = require('../src/modules/claims/claimsEligibility');

describe('setup needed notify', () => {
    test('filters setup needed rows and keeps Sadia as the ops mailbox', () => {
        const skipped = [
            { employee_id: 'A', category: 'setup_needed', name: 'No Route' },
            { employee_id: 'B', category: 'not_eligible', name: 'Skip' },
            { employee_id: 'C', category: 'setup_needed', name: 'Also Missing' },
        ];
        expect(filterSetupNeeded(skipped).map((r) => r.employee_id)).toEqual(['A', 'C']);
        expect(filterSetupNeeded(skipped, { onlyEmployeeIds: ['C'] }).map((r) => r.employee_id)).toEqual(['C']);
        expect(SADIA_SETUP_EMAIL).toBe('sadia.komal@asil.com.pk');
    });

    test('email names the gap and includes a Portal Claims link', () => {
        const html = buildSetupNeededHtml({
            period: { claim_month: 8, claim_year: 2026 },
            people: [{ name: 'No Route Person', employee_id: 'ASIL/SPL-1', client: 'Wafi', contract_name: 'BPO' }],
            link: 'https://asil-hcm-frontend.onrender.com/?tab=claims_portal&setup_needed=1',
        });
        expect(html).toMatch(/no Focal/i);
        expect(html).toMatch(/ASIL\/SPL-1/);
        expect(html).toMatch(/tab=claims_portal&setup_needed=1/);
        expect(html).toMatch(/Sadia|setup needed|work mailbox/i);
    });

    test('LM only and Focal only submits are final', () => {
        expect(isFinalSubmitProfile('lm_only')).toBe(true);
        expect(isFinalSubmitProfile('focal_only')).toBe(true);
        expect(isFinalSubmitProfile('employee_then_lm')).toBe(false);
    });
});
