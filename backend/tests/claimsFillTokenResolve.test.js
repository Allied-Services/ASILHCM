'use strict';

const { stableFillerToken, hashToken } = require('../src/modules/claims/claimsMail');
const {
    resolveFillerFromToken,
    provisionFillerBatch,
    getBatchByToken,
} = require('../src/modules/claims/portalService');

jest.mock('../src/modules/claims/claimsEligibility', () => ({
    countEligibleEmployees: jest.fn(),
    listCampaignFilterOptions: jest.fn(),
    resolveClaimsCategory: jest.fn(),
    resolveClaimsRouting: jest.fn(),
    resolveClaimsRoutingForEmployee: jest.fn(),
    isFinalSubmitProfile: jest.fn(),
    listRules: jest.fn(),
    upsertRule: jest.fn(),
    previewRuleMatch: jest.fn(),
    employeeMatchesAudience: jest.fn(),
    HUZAIFA_FALLBACK: 'huzaifa@asil.com.pk',
}));

const { countEligibleEmployees } = require('../src/modules/claims/claimsEligibility');

describe('claims fill token resolve', () => {
    const period = { id: 42, claim_month: 8, claim_year: 2026, status: 'open', campaign_mode: 'actual' };
    const fillerEmail = 'mukesh.solanky@asil.com.pk';
    let token;
    let pool;

    beforeEach(() => {
        process.env.CLAIMS_LINK_SECRET = 'test-claims-secret';
        token = stableFillerToken(period.id, fillerEmail);
        pool = { query: jest.fn() };
        countEligibleEmployees.mockResolvedValue({
            eligible: [{
                id: 'ASIL-FM-1',
                name: 'Test Employee',
                filler_email: fillerEmail,
                approver_email: 'lm@wafi.example',
                routing_profile: 'focal_then_lm',
                cohort_type: 'focal',
            }],
            skipped: [],
            rules: [],
        });
    });

    afterEach(() => {
        delete process.env.CLAIMS_LINK_SECRET;
    });

    it('resolveFillerFromToken matches period + focal email', async () => {
        pool.query
            .mockResolvedValueOnce({ rows: [period] })
            .mockResolvedValueOnce({ rows: [{ email: fillerEmail }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ email: fillerEmail }] });

        const resolved = await resolveFillerFromToken(pool, token);
        expect(resolved).toEqual({
            periodId: period.id,
            fillerEmail,
            period,
        });
    });

    it('getBatchByToken provisions batch when hash row is missing', async () => {
        const batchRow = {
            id: 7,
            period_id: period.id,
            filler_email: fillerEmail,
            invite_token_hash: hashToken(token),
            claim_month: 8,
            claim_year: 2026,
            settlement_month: 9,
            settlement_year: 2026,
            fill_close_at: null,
            approve_close_at: null,
            fill_open_at: null,
            period_status: 'open',
            campaign_mode: 'actual',
        };

        pool.query.mockImplementation((sql) => {
            const q = String(sql);
            if (q.includes('invite_token_hash = $1')) return Promise.resolve({ rows: [] });
            if (q.includes('FROM portal_claim_periods') && q.includes('claim_year >= 2026')) {
                return Promise.resolve({ rows: [period] });
            }
            if (q.includes('FROM portal_claim_batches') && q.includes('DISTINCT LOWER')) {
                return Promise.resolve({ rows: [{ email: fillerEmail }] });
            }
            if (q.includes('ALTER TABLE employees ADD COLUMN')) return Promise.resolve({ rows: [] });
            if (q.includes('FROM employees') && q.includes('claim_authority')) {
                return Promise.resolve({ rows: [{ email: fillerEmail }] });
            }
            if (q.includes('INSERT INTO portal_claim_batches')) return Promise.resolve({ rows: [{ id: batchRow.id }] });
            if (q.includes('INSERT INTO portal_claim_submissions')) return Promise.resolve({ rows: [] });
            if (q.includes('WHERE b.id = $1')) return Promise.resolve({ rows: [batchRow] });
            return Promise.resolve({ rows: [] });
        });

        const batch = await getBatchByToken(pool, token);
        expect(batch).toEqual(batchRow);
    });
});
