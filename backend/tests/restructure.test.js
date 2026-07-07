'use strict';

const { computePrSheetRow } = require('../src/payroll/prSheetEngine');

describe('PR sheet payroll engine', () => {
    test('computes Wafi-style OT and service charge from PR sheet rules', () => {
        const policy = {
            standard_month_days: 30,
            ot_divisor_days: 26,
            ot_divisor_hours: 8,
            service_charge_pct: 0.18,
            bonus_accrual_months: 12,
            gratuity_accrual_months: 12,
        };
        const row = computePrSheetRow({
            newSalary: 87416,
            paidDays: 30,
            workingDays: 30,
            ot2: 0,
            ot3: 17,
            salesTaxRate: 0.18,
            medicalCoverage: 3159,
        }, policy);

        expect(row.salaryForDays).toBe(87416);
        expect(row.overtimeAmount).toBeGreaterThan(20000);
        expect(row.serviceCharges).toBe(Math.round(row.totalPayrollCost * 0.18));
        expect(row.totalCost).toBe(row.totalPayrollCost + row.serviceCharges + row.salesTax);
    });

    test('respects paid days proration', () => {
        const row = computePrSheetRow({
            newSalary: 30000,
            paidDays: 15,
            workingDays: 30,
        }, { standard_month_days: 30 });
        expect(row.salaryForDays).toBe(15000);
    });
});

describe('intake classifier', () => {
    const { matchInboxRules } = require('../src/intake/classifier');

    test('classifies attendance emails', () => {
        const r = matchInboxRules('supervisor@client.com', 'Monthly attendance sheet March');
        expect(r.classification).toBe('attendance');
    });

    test('classifies client domain emails', () => {
        const r = matchInboxRules('user@wafi-energy.com', 'Leave notification');
        expect(['client_event', 'unknown']).toContain(r.classification);
    });

    test('classifies procurement keyword', () => {
        const r = matchInboxRules('buyer@client.com', 'Procurement request for PPE');
        expect(r.classification).toBe('procurement');
    });
});

describe('constraints validateAction', () => {
    const { validateAction } = require('../src/modules/constraints/service');

    test('blocks bill approve when unmatched', async () => {
        const result = await validateAction(null, 'bill_approve', {
            billable: true,
            matchStatus: 'unmatched',
        });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('BUDGET_UNMATCHED');
    });

    test('allows bill approve when matched', async () => {
        const result = await validateAction(null, 'bill_approve', {
            billable: true,
            matchStatus: 'matched',
        });
        expect(result.ok).toBe(true);
    });
});

describe('constraints upsertPolicy', () => {
    const { upsertPolicy } = require('../src/modules/constraints/service');

    test('updates existing row for same contract, project, and effective_from', async () => {
        let updated = false;
        const pool = {
            query: async (sql) => {
                if (sql.includes('SELECT id FROM contract_policies')) {
                    return { rows: [{ id: 42 }] };
                }
                if (sql.startsWith('UPDATE contract_policies')) {
                    updated = true;
                    return { rows: [{ id: 42, contract_id: 'CTR-1', challans_required: '["EOBI"]' }] };
                }
                throw new Error('unexpected query: ' + sql.slice(0, 40));
            },
        };
        const row = await upsertPolicy(pool, {
            contract_id: 'CTR-1',
            challans_required: ['EOBI'],
            effective_from: '2026-06-01',
        });
        expect(updated).toBe(true);
        expect(row.id).toBe(42);
    });

    test('inserts when no matching policy exists', async () => {
        let inserted = false;
        const pool = {
            query: async (sql) => {
                if (sql.includes('SELECT id FROM contract_policies')) return { rows: [] };
                if (sql.startsWith('INSERT INTO contract_policies')) {
                    inserted = true;
                    return { rows: [{ id: 1, contract_id: 'CTR-2' }] };
                }
                throw new Error('unexpected query');
            },
        };
        const row = await upsertPolicy(pool, { contract_id: 'CTR-2' });
        expect(inserted).toBe(true);
        expect(row.contract_id).toBe('CTR-2');
    });
});

describe('parseConfigValue', () => {
    const { parseConfigValue } = require('../src/core/jsonConfig');

    test('parses JSON string values', () => {
        expect(parseConfigValue('{"access_token":"abc"}')).toEqual({ access_token: 'abc' });
    });

    test('returns object values unchanged', () => {
        const obj = { access_token: 'xyz', expires_at: 123 };
        expect(parseConfigValue(obj)).toBe(obj);
    });
});

describe('purgeContract', () => {
    const { purgeContract } = require('../src/modules/admin/purgeContract');

    test('preview mode lists employees without deleting', async () => {
        const deletes = [];
        const pool = {
            query: async (sql) => {
                if (sql.trim().startsWith('DELETE')) deletes.push(sql);
                if (sql.includes('FROM employees')) return { rows: [{ id: 'TEST-001', name: 'Test' }] };
                if (sql.includes('FROM contracts')) return { rows: [{ id: 'CTR-1', contract_name: 'Test' }] };
                return { rows: [] };
            },
        };
        const result = await purgeContract(pool, { contract_id: 'CTR-1' }, { confirm: false });
        expect(result.preview.employees).toHaveLength(1);
        expect(result.message).toContain('confirm=yes');
        expect(deletes).toHaveLength(0);
    });

    test('confirm mode runs delete statements', async () => {
        const deletes = [];
        const pool = {
            query: async (sql) => {
                if (sql.trim().startsWith('DELETE')) deletes.push(sql);
                if (sql.includes('FROM employees')) return { rows: [{ id: 'TEST-001', name: 'Test' }] };
                return { rowCount: 1, rows: [] };
            },
        };
        const result = await purgeContract(pool, { contract_id: 'CTR-1', client_id: 'CLT-1' }, { confirm: true });
        expect(result.ok).toBe(true);
        expect(deletes.length).toBeGreaterThan(5);
        expect(result.results.contract).toBe(1);
    });
});

describe('listContractPnl', () => {
    const { listContractPnl } = require('../src/modules/pnl/service');

    test('filters by month and year and returns margin fields', async () => {
        const pool = {
            query: async (sql, params) => {
                if (sql.includes('CREATE OR REPLACE VIEW')) return { rows: [] };
                expect(params).toEqual([2026, 6]);
                expect(sql).toContain('period_year = $1');
                expect(sql).toContain('period_month = $2');
                return {
                    rows: [{
                        contract_id: 'CTR-1',
                        contract_name: 'Test',
                        period_year: 2026,
                        period_month: 6,
                        total_cost: '68176.00',
                        total_revenue: '115385.00',
                        margin_abs: '47209.00',
                        margin_pct: '40.91',
                    }],
                };
            },
        };
        const rows = await listContractPnl(pool, { year: 2026, month: 6 });
        expect(rows[0].contract_id).toBe('CTR-1');
        expect(rows[0].margin_pct).toBe('40.91');
    });
});

describe('invoice challan attachments', () => {
    const { attachInvoiceChallan, getInvoiceChallanStatus } = require('../src/modules/compliance/service');

    test('attachInvoiceChallan records attachment and status reflects present', async () => {
        const attachments = [];
        const pool = {
            query: async (sql, params) => {
                if (sql.includes('SELECT id FROM client_invoices')) return { rows: [{ id: 9 }] };
                if (sql.includes('DELETE FROM invoice_attachments')) return { rows: [] };
                if (sql.includes('INSERT INTO invoice_attachments')) {
                    attachments.push(params[1]);
                    return { rows: [{ id: 1, invoice_id: params[0], attachment_type: params[1] }] };
                }
                if (sql.includes('FROM client_invoices ci')) {
                    return { rows: [{ challans_required: JSON.stringify(['EOBI', 'SESSI']) }] };
                }
                if (sql.includes('FROM invoice_attachments')) {
                    return { rows: attachments.map(t => ({ attachment_type: t })) };
                }
                return { rows: [] };
            },
        };
        await attachInvoiceChallan(pool, 9, 'EOBI');
        const status = await getInvoiceChallanStatus(pool, 9);
        expect(status.present).toContain('EOBI');
        expect(status.missing).toEqual(['SESSI']);
        expect(status.ok).toBe(false);
    });
});

describe('compliance computeStatutoryForMonth', () => {
    const { computeStatutoryForMonth } = require('../src/modules/compliance/service');

    test('EOBI and SESSI totals are non-zero for locked payroll', async () => {
        const pool = {
            query: async (sql) => {
                if (sql.includes('payroll_run_rows')) {
                    return { rows: [] };
                }
                return { rows: [{ gross: 35000, province: 'Sindh', contract_id: 'c1' }] };
            },
        };
        const result = await computeStatutoryForMonth(pool, 6, 2026);
        expect(result.eobi.total).toBeGreaterThan(0);
        expect(result.sessi.total).toBeGreaterThan(0);
    });

    test('sums legacy payroll and payroll run rows without double count', async () => {
        let call = 0;
        const pool = {
            query: async (sql) => {
                call += 1;
                if (sql.includes('payroll_run_rows')) {
                    expect(sql).toContain('NOT IN');
                    return {
                        rows: [{
                            employee_id: 'emp2',
                            province: 'Punjab',
                            computed: { wht: 500, eobiEmployee: 400, eobiEmployer: 800, sessiEmployee: 0, sessiEmployer: 200, gross: 40000 },
                        }],
                    };
                }
                return { rows: [{ gross: 35000, province: 'Sindh', contract_id: 'c1', employee_id: 'emp1' }] };
            },
        };
        const result = await computeStatutoryForMonth(pool, 6, 2026);
        expect(result.incomeTax).toBeGreaterThanOrEqual(500);
        expect(result.headcount).toBe(2);
        expect(call).toBe(2);
    });
});

describe('aggregateClaimInputs', () => {
    const { aggregateClaimInputs } = require('../src/modules/payrollrun/service');

    test('aggregates OT and medical claim items', () => {
        const result = aggregateClaimInputs([
            { id: 1, claim_type: 'overtime', claimed_items: [{ ot2: 5, ot3: 2 }] },
            { id: 2, claim_type: 'medical', claimed_items: [{ amount: 3000 }] },
        ]);
        expect(result).toEqual({ ot2: 5, ot3: 2, opd: 3000, expense: 0, claimIds: [1, 2] });
    });
});

describe('payroll run helpers', () => {
    const { classifyOtDate } = require('../src/modules/payrollrun/service');
    const { computePrSheetRow } = require('../src/payroll/prSheetEngine');

    test('classifyOtDate: Sunday -> ot2, holiday -> ot3', () => {
        const holidays = new Set(['2026-07-04']);
        expect(classifyOtDate(new Date('2026-07-05'), holidays)).toBe('ot2'); // Sunday
        expect(classifyOtDate(new Date('2026-07-04'), holidays)).toBe('ot3'); // holiday
        expect(classifyOtDate(new Date('2026-07-06'), holidays)).toBe('ot2'); // Monday
    });

    test('computePrSheetRow OT formula', () => {
        const policy = { standard_month_days: 30, ot_divisor_days: 26, ot_divisor_hours: 8, service_charge_pct: 0.18 };
        const salary = 41600;
        const row = computePrSheetRow({ newSalary: salary, paidDays: 26, workingDays: 30, ot2: 10, ot3: 8, salesTaxRate: 0.18 }, policy);
        const expectedOt = Math.round(salary / 26 / 8 * (2 * 10 + 3 * 8));
        expect(row.overtimeAmount).toBe(expectedOt);
    });
});
