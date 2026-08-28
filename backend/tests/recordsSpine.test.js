'use strict';

const { inferCommercialType, shapeRulebook, ROUTING_MODES } = require('../src/modules/records/rulebook');
const { resolveClaimsRouting } = require('../src/modules/claims/claimsEligibility');
const { assertSheetWritable, assertRunAllowed } = require('../src/modules/records/engineFlag');
const { parseDelimited, mapRow } = require('../src/modules/records/machineFile');
const { assertCostPlusInvoiceAllowed, assertSoInvoiceAllowed } = require('../src/modules/records/costPlusInvoice');
const { assertNoOpenConflicts } = require('../src/modules/records/provenance');

describe('records spine — rulebook', () => {
    test('PSO / SO billing infers fixed_value', () => {
        expect(inferCommercialType({ billing_model: 'service_order_deduction' }, { id: 'CTR-X' })).toBe('fixed_value');
        expect(inferCommercialType({}, { id: 'CTR-PSO-NORTH-ZONE' })).toBe('fixed_value');
        expect(inferCommercialType({}, { service_type: 'Fixed Value Conservancy' })).toBe('fixed_value');
    });

    test('default commercial type is cost_plus', () => {
        expect(inferCommercialType({}, { id: 'CTR-1773048704450' })).toBe('cost_plus');
    });

    test('stored commercial_type wins over id inference', () => {
        expect(inferCommercialType({ commercial_type: 'cost_plus' }, { id: 'CTR-PSO-X' })).toBe('cost_plus');
    });

    test('shapeRulebook defaults engine to legacy and routing to auto', () => {
        const book = shapeRulebook({ id: 'CTR-1', contract_name: 'Wafi' }, {}, {});
        expect(book.payroll_engine).toBe('legacy');
        expect(book.routing_mode).toBe('auto');
        expect(ROUTING_MODES).toContain('employee_then_focal');
    });
});

describe('records spine — routing modes a–g', () => {
    test('auto still prefers Focal then LM', () => {
        const r = resolveClaimsRouting({
            claim_authority: 'focal@wafi.com',
            line_manager_email: 'lm@wafi.com',
            email: 'emp@wafi.com',
        });
        expect(r.profile).toBe('focal_then_lm');
    });

    test('path a employee_then_focal', () => {
        const r = resolveClaimsRouting(
            { email: 'emp@wafi-energy.com', claim_authority: 'focal@wafi.com' },
            { routing_mode: 'employee_then_focal' }
        );
        expect(r.fillerEmail).toBe('emp@wafi-energy.com');
        expect(r.approverEmail).toBe('focal@wafi.com');
    });

    test('path g supervisor then contract focal', () => {
        const r = resolveClaimsRouting(
            { asil_site_supervisor_email: 'sup@asil.com.pk' },
            { routing_mode: 'asil_supervisor_then_focal', allied_contract_focal_email: 'cf@asil.com.pk' }
        );
        expect(r.profile).toBe('asil_supervisor_then_focal');
        expect(r.approverEmail).toBe('cf@asil.com.pk');
    });
});

describe('records spine — engine flag', () => {
    test('assertSheetWritable 409 when contract is on runs', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{ employee_id: 'E1', contract_id: 'CTR-R', payroll_engine: 'runs', name: 'A' }],
            }),
        };
        await expect(assertSheetWritable(pool, ['E1'])).rejects.toMatchObject({
            status: 409,
            code: 'CONTRACT_ON_RUNS_ENGINE',
        });
    });

    test('assertRunAllowed 409 on legacy engine', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{ payroll_engine: 'legacy' }],
            }),
        };
        await expect(assertRunAllowed(pool, 'CTR-1')).rejects.toMatchObject({
            status: 409,
            code: 'CONTRACT_ON_LEGACY_ENGINE',
        });
    });

    test('assertRunAllowed 409 POLICY_MISSING when no policy row', async () => {
        const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
        await expect(assertRunAllowed(pool, 'CTR-1')).rejects.toMatchObject({
            status: 409,
            code: 'POLICY_MISSING',
        });
    });
});

describe('records spine — machine file parse', () => {
    test('parses hours and absent-only columns', () => {
        const rows = parseDelimited('employee_id,name,hours,absent_days\nASIL-1,Ali,160,2');
        expect(rows).toHaveLength(1);
        const mapped = mapRow(rows[0], 'hours');
        expect(mapped.employee_id).toBe('ASIL-1');
        expect(mapped.hours).toBe(160);
        expect(mapped.absent_days).toBe(2);
    });
});

describe('records spine — invoice guards', () => {
    test('cost-plus writer refuses fixed_value', async () => {
        const pool = {
            query: jest.fn()
                .mockResolvedValueOnce({
                    rows: [{ id: 'CTR-PSO', contract_name: 'PSO', client_id: 'C1', service_type: 'Fixed Value' }],
                })
                .mockResolvedValueOnce({
                    rows: [{ commercial_type: 'fixed_value', billing_model: 'service_order_deduction' }],
                })
                .mockResolvedValueOnce({ rows: [{}] }),
        };
        await expect(assertCostPlusInvoiceAllowed(pool, 'CTR-PSO')).rejects.toMatchObject({
            status: 409,
            code: 'USE_SO_INVOICE',
        });
    });

    test('SO writer refuses cost_plus', async () => {
        const pool = {
            query: jest.fn()
                .mockResolvedValueOnce({
                    rows: [{ id: 'CTR-W', contract_name: 'Wafi', client_id: 'C1' }],
                })
                .mockResolvedValueOnce({
                    rows: [{ commercial_type: 'cost_plus', billing_model: 'headcount_rate' }],
                })
                .mockResolvedValueOnce({ rows: [{}] }),
        };
        await expect(assertSoInvoiceAllowed(pool, 'CTR-W')).rejects.toMatchObject({
            status: 409,
            code: 'USE_COST_PLUS_INVOICE',
        });
    });
});

describe('records spine — conflicts block lock', () => {
    test('open conflicts throw INPUT_CONFLICTS', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{ employee_id: 'E1', field: 'ot2_hrs' }],
            }),
        };
        await expect(assertNoOpenConflicts(pool, 2026, 8)).rejects.toMatchObject({
            status: 409,
            code: 'INPUT_CONFLICTS',
        });
    });

    test('rows without field are ignored (lock mock safety)', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{ employee_id: 'E1' }],
            }),
        };
        await expect(assertNoOpenConflicts(pool, 2026, 8)).resolves.toBeUndefined();
    });
});
