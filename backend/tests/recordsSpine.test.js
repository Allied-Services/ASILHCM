'use strict';

const { inferCommercialType, shapeRulebook, ROUTING_MODES } = require('../src/modules/records/rulebook');
const { resolveClaimsRouting } = require('../src/modules/claims/claimsEligibility');
const { assertSheetWritable, assertRunAllowed } = require('../src/modules/records/engineFlag');
const {
    parseDelimited,
    mapRow,
    assertCycleFileHeaders,
    headerLineForMode,
    templateColumns,
    buildTemplateCsv,
    templateFilename,
    employeeActiveInPeriod,
} = require('../src/modules/records/machineFile');
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

    test('auto official mailbox with no Focal/LM is employee final', () => {
        const r = resolveClaimsRouting({ email: 'emp@wafi-energy.com' });
        expect(r.profile).toBe('employee_only');
        expect(r.fillerEmail).toBe(r.approverEmail);
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

    test('assertRunAllowed allows Fixed Value even when stored engine is legacy', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{ payroll_engine: 'legacy', commercial_type: 'fixed_value' }],
            }),
        };
        await expect(assertRunAllowed(pool, 'CTR-PSO-NORTH-ZONE')).resolves.toBeUndefined();
    });

    test('assertRunAllowed allows service-order billing as Fixed Value', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{ payroll_engine: 'legacy', billing_model: 'service_order_deduction' }],
            }),
        };
        await expect(assertRunAllowed(pool, 'CTR-X')).resolves.toBeUndefined();
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

    test('rejects a data line with no header for the selected mode', () => {
        expect(() => parseDelimited('ASIL/PSO-375/25,Muhammad Masood,13,0,0', 'absent_only'))
            .toThrow(/First row must be the header: employee_id,name,absent_days,ot2,ot3/);
    });

    test('accepts absent-only paste when the header is present', () => {
        const rows = parseDelimited(
            'employee_id,name,absent_days,ot2,ot3\nASIL/PSO-375/25,Muhammad Masood,13,0,0',
            'absent_only'
        );
        expect(rows).toHaveLength(1);
        expect(mapRow(rows[0], 'absent_only')).toMatchObject({
            employee_id: 'ASIL/PSO-375/25',
            employee_name: 'Muhammad Masood',
            absent_days: 13,
            ot2_hours: 0,
            ot3_hours: 0,
        });
    });

    test('headerLineForMode matches the on-screen template', () => {
        expect(headerLineForMode('absent_only')).toBe('employee_id,name,absent_days,ot2,ot3');
        expect(() => assertCycleFileHeaders(['asil_pso_375_25', 'muhammad_masood', '13'], 'absent_only'))
            .toThrow(/First row must be the header/);
    });
});

describe('records spine — cycle file templates', () => {
    const people = [
        { id: 'ASIL-1', name: 'Ali Khan' },
        { id: 'ASIL-2', name: 'Sara, Bibi' },
    ];

    test.each([
        ['full_ledger', ['employee_id', 'name', 'present_days', 'absent_days', 'hours', 'ot2', 'ot3']],
        ['hours', ['employee_id', 'name', 'hours', 'ot2', 'ot3']],
        ['days', ['employee_id', 'name', 'present_days', 'absent_days', 'ot2', 'ot3']],
        ['absent_only', ['employee_id', 'name', 'absent_days', 'ot2', 'ot3']],
    ])('%s template columns start with employee_id and name', (mode, cols) => {
        expect(templateColumns(mode)).toEqual(cols);
        expect(templateColumns(mode)[0]).toBe('employee_id');
        expect(templateColumns(mode)[1]).toBe('name');
    });

    test('unknown mode falls back to full ledger columns', () => {
        expect(templateColumns('nope')).toEqual(templateColumns('full_ledger'));
    });

    test('preloads employee_id and name and leaves value columns blank', () => {
        const csv = buildTemplateCsv('hours', people);
        const rows = parseDelimited(csv);
        expect(rows).toHaveLength(2);
        expect(rows[0].employee_id).toBe('ASIL-1');
        expect(rows[0].name).toBe('Ali Khan');
        expect(rows[0].hours).toBe('');
        expect(rows[0].ot2).toBe('');
        expect(mapRow(rows[0], 'hours')).toMatchObject({
            employee_id: 'ASIL-1',
            employee_name: 'Ali Khan',
            hours: null,
            ot2_hours: null,
        });
        expect(rows[1].name).toBe('Sara, Bibi');
        expect(mapRow(rows[1], 'hours').employee_name).toBe('Sara, Bibi');
    });

    test('days and absent-only templates round-trip through the parser', () => {
        const days = parseDelimited(buildTemplateCsv('days', people));
        expect(mapRow(days[0], 'days').present_days).toBeNull();
        const absent = parseDelimited(buildTemplateCsv('absent_only', people));
        expect(mapRow(absent[0], 'absent_only').absent_days).toBeNull();
        expect(mapRow(absent[0], 'absent_only').employee_id).toBe('ASIL-1');
    });

    test('filename includes mode, contract, and period', () => {
        expect(templateFilename('CTR-WAFI', 2026, 8, 'hours')).toBe('cycle_hours_CTR-WAFI_2026-08.csv');
    });

    test('active-for-month includes joiners and mid-month leavers, excludes future joiners and prior leavers', () => {
        expect(employeeActiveInPeriod({ active: 'Yes', doj: '2026-08-10' }, 2026, 8)).toBe(true);
        expect(employeeActiveInPeriod({ active: 'No', last_working_day: '2026-08-12' }, 2026, 8)).toBe(true);
        expect(employeeActiveInPeriod({ active: 'Yes', doj: '2026-09-01' }, 2026, 8)).toBe(false);
        expect(employeeActiveInPeriod({ active: 'No', last_working_day: '2026-07-31' }, 2026, 8)).toBe(false);
        expect(employeeActiveInPeriod({ active: 'Yes' }, 2026, 8)).toBe(true);
        expect(employeeActiveInPeriod({ active: 'No' }, 2026, 8)).toBe(false);
    });

    test('template builder asks the roster for the selected contract and period', async () => {
        const { listActiveEmployeesForPeriod, buildCycleFileTemplate } = require('../src/modules/records/machineFile');
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{ id: 'ASIL-1', name: 'Ali Khan' }],
            }),
        };
        const people = await listActiveEmployeesForPeriod(pool, 'CTR-1', 2026, 8);
        expect(people).toEqual([{ id: 'ASIL-1', name: 'Ali Khan' }]);
        expect(pool.query.mock.calls[0][1]).toEqual(['CTR-1', 2026, 8]);
        const pack = await buildCycleFileTemplate(pool, {
            contractId: 'CTR-1', year: 2026, month: 8, inputMode: 'days',
        });
        expect(pack.filename).toBe('cycle_days_CTR-1_2026-08.csv');
        expect(pack.count).toBe(1);
        expect(pack.csv).toContain('ASIL-1,Ali Khan');
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
