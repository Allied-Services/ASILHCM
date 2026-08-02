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
                if (sql.includes('CREATE OR REPLACE VIEW')) {
                    expect(sql).toContain('WITH costs AS');
                    expect(sql).toContain('UNION');
                    expect(sql).toContain("NOT IN ('Void', 'Voided')");
                    return { rows: [] };
                }
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
    const { computeStatutoryForMonth, upsertStatutoryLedger, getStatutoryLedger } = require('../src/modules/compliance/service');

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

    test('upsertStatutoryLedger persists aggregate rows for the period', async () => {
        const rows = [];
        const pool = {
            query: async (sql, params) => {
                if (sql.includes('DELETE FROM statutory_ledger')) return { rows: [] };
                if (sql.includes('INSERT INTO statutory_ledger')) {
                    rows.push({
                        id: rows.length + 1,
                        authority: params[2],
                        employee_share: params[3],
                        employer_share: params[4],
                        period_month: params[0],
                        period_year: params[1],
                    });
                    return { rows: [rows[rows.length - 1]] };
                }
                if (sql.includes('FROM statutory_ledger')) return { rows };
                return { rows: [] };
            },
        };
        const computed = {
            eobi: { employee: 100, employer: 200, total: 300 },
            sessi: { employee: 0, employer: 50, total: 50 },
            incomeTax: 76.92,
        };
        const saved = await upsertStatutoryLedger(pool, 6, 2026, computed);
        expect(saved).toHaveLength(3);
        const ledger = await getStatutoryLedger(pool, { month: 6, year: 2026 });
        expect(ledger).toHaveLength(3);
        expect(ledger.find(r => r.authority === 'EOBI').employer_share).toBe(200);
    });
});

describe('provinceSalesTaxRate', () => {
    const { provinceSalesTaxRate } = require('../src/core/regionTax');

    test('uses DB-driven rate when province matches', () => {
        const rates = [{ province: 'Sindh', salesTaxPct: 10 }];
        expect(provinceSalesTaxRate('Sindh', rates)).toBe(0.1);
    });

    test('falls back to statutory Sindh rate when rates empty', () => {
        expect(provinceSalesTaxRate('Karachi', [])).toBe(0.13);
    });

    test('unknown province uses federal default', () => {
        expect(provinceSalesTaxRate('Atlantis', [])).toBe(0.13);
    });
});

describe('generateInvoiceNumber', () => {
    const { generateInvoiceNumber } = require('../src/modules/payrollrun/service');

    test('uses MAX suffix + 1 so deleted numbers are not reused', async () => {
        const pool = {
            query: async (sql) => {
                expect(sql).toContain('MAX(CAST(SUBSTRING');
                return { rows: [{ max_seq: 5 }] };
            },
        };
        const invNo = await generateInvoiceNumber(pool, 2026, 6);
        expect(invNo).toBe('INV-JUN26-006');
    });
});

describe('generateInvoiceFromRun rate-card billing', () => {
    const { generateInvoiceFromRun } = require('../src/modules/payrollrun/service');

    test('applies regional sales tax and due_date from policy credit_days', async () => {
        let insertParams = null;
        const pool = {
            query: async (sql, params) => {
                if (sql.includes('FROM payroll_runs WHERE id')) {
                    return { rows: [{ id: 7, status: 'locked', contract_id: 'CTR-1', period_month: 6, period_year: 2026 }] };
                }
                if (sql.includes('FROM contracts c')) {
                    return { rows: [{ id: 'CTR-1', contract_name: 'Test Contract', client_name: 'TEST Client' }] };
                }
                if (sql.includes('SELECT computed FROM payroll_run_rows')) {
                    return { rows: [{ computed: { billSource: 'rate_card', billAmount: 100000, totalPayrollCost: 50000 } }] };
                }
                if (sql.includes('FROM contract_policies')) {
                    return { rows: [{ credit_days: 45, challans_required: [] }] };
                }
                if (sql.includes("key = 'region_tax'")) return { rows: [] };
                if (sql.includes('GROUP BY e.province')) {
                    return { rows: [{ province: 'Sindh', cnt: '1' }] };
                }
                if (sql.includes('MAX(CAST(SUBSTRING')) return { rows: [{ max_seq: 0 }] };
                if (sql.startsWith('INSERT INTO client_invoices')) {
                    insertParams = params;
                    return { rows: [{ id: 99, invoice_number: params[0], sales_tax: params[9], grand_total: params[10] }] };
                }
                if (sql.includes('UPDATE payroll_runs')) return { rows: [] };
                return { rows: [] };
            },
        };

        await generateInvoiceFromRun(pool, { runId: 7, generatedBy: 'test@asil.com.pk' });
        expect(insertParams).not.toBeNull();
        expect(insertParams[9]).toBe(13000);
        expect(insertParams[10]).toBe(113000);
        expect(insertParams[13]).toBe('45');
    });
});

describe('aggregateClaimInputs', () => {
    const { aggregateClaimInputs } = require('../src/modules/payrollrun/service');

    test('aggregates OT and medical claim items', () => {
        const result = aggregateClaimInputs([
            { id: 1, claim_type: 'overtime', claimed_items: [{ ot2: 5, ot3: 2 }] },
            { id: 2, claim_type: 'medical', claimed_items: [{ amount: 3000 }] },
        ]);
        expect(result).toEqual({ ot1: 0, ot2: 5, ot3: 2, opd: 3000, expense: 0, claimIds: [1, 2] });
    });

    test('tolerates claimed_items object or empty object (Wafi/legacy shapes)', () => {
        const result = aggregateClaimInputs([
            { id: 3, claim_type: 'medical', claimed_items: { amount: 1200 } },
            { id: 4, claim_type: 'expense', claimed_items: {} },
            { id: 5, claim_type: 'overtime', claimed_items: '{"ot2":4}' },
        ]);
        expect(result.opd).toBe(1200);
        expect(result.expense).toBe(0);
        expect(result.ot2).toBe(4);
        expect(result.claimIds).toEqual([3, 4, 5]);
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

describe('xero bill classifier', () => {
    const { classifyXeroBill } = require('../src/modules/xeroBillImport/classifier');

    test('classifies FM bill with site from account code', () => {
        const result = classifyXeroBill({
            InvoiceID: 'abc',
            LineItems: [{
                AccountCode: 'FM-106',
                Description: 'FM-106 - FM - T&S - Bhakkar',
                Tracking: [{ Name: 'Tracking Category', Option: 'FM' }],
            }],
        });
        expect(result.owned).toBe(true);
        expect(result.site).toBe('Bhakkar');
        expect(result.trackingCategory).toBe('FM');
    });

    test('sends unknown tracking to review', () => {
        const result = classifyXeroBill({
            InvoiceID: 'xyz',
            LineItems: [{ Tracking: [{ Name: 'Tracking Category', Option: 'Karachi' }] }],
        });
        expect(result.owned).toBe(false);
        expect(result.importStatus).toBe('Needs Review');
    });
});

describe('receipt split', () => {
    const { computeReceiptSplit } = require('../src/modules/ar/receipts');

    test('splits grand total into cash, income tax WHT, and sales tax withheld', () => {
        const split = computeReceiptSplit({
            id: 1,
            invoice_number: 'INV-TEST',
            subtotal: 100000,
            sales_tax: 16000,
            grand_total: 116000,
        }, 6);
        expect(split.income_tax_wht).toBe(6000);
        expect(split.sales_tax_withheld_by_client).toBe(3200);
        expect(split.sales_tax_self_paid).toBe(12800);
        expect(split.cash_received).toBe(106800);
    });
});

describe('HBL export row', () => {
    const { buildHblRow } = require('../src/modules/xeroBillImport/hblExport');

    test('builds HBL-to-HBL row with template columns', () => {
        const row = buildHblRow({
            vendor: 'Acme',
            total: 50000,
            vendor_bank_account: '01037901498903',
            invoice_no: 'BILL-1',
        }, 'hbl_same', 'BLMay-', 0);
        expect(row['Beneficiary Account Number']).toBe('01037901498903');
        expect(row['Transaction Amount']).toBe(50000);
        expect(row['Customer Reference Number']).toBe('BLMay-0001');
        expect(row['Purpose of Payment']).toBe('012');
    });

    test('builds HBL-to-Other row with alternate column names', () => {
        const row = buildHblRow({
            vendor: 'Acme',
            total: 25000,
            vendor_bank_account: '12345',
            invoice_no: 'INV-9',
        }, 'hbl_other', 'REF-', 2);
        expect(row['Customer Reference No']).toBe('REF-0003');
        expect(row['Pupose of Payment']).toBe('012');
        expect(row['Invoice Number']).toBe('INV-9');
    });
});

describe('billable invoice builder', () => {
    const { getBillableCandidates, createInvoiceFromBillable } = require('../src/modules/xeroBillImport/billableInvoice');

    test('getBillableCandidates filters uninvoiced billable bills', async () => {
        const pool = {
            query: async (sql, params) => {
                expect(params[0]).toBe('Wafi Energy');
                expect(sql).toContain('invoiced_in IS NULL');
                return { rows: [{ id: 'B1', site: 'Bhakkar', total: 1000 }] };
            },
        };
        const rows = await getBillableCandidates(pool, { client: 'Wafi Energy', period_month: 6, period_year: 2026 });
        expect(rows).toHaveLength(1);
    });

    test('createInvoiceFromBillable links bills and sets invoiced_in', async () => {
        let updateSql = '';
        const pool = {
            query: async (sql, params) => {
                if (sql.includes('FROM bills WHERE id = ANY')) {
                    return { rows: [{ id: 'B1', amount: 100000, gst: 16000, total: 116000, site: 'Bhakkar', vendor: 'Vendor A' }] };
                }
                if (sql.includes('MAX(CAST(SUBSTRING')) return { rows: [{ max_seq: 2 }] };
                if (sql.startsWith('INSERT INTO client_invoices')) {
                    return { rows: [{ id: 55, invoice_number: params[0] }] };
                }
                if (sql.includes('UPDATE bills SET invoiced_in')) {
                    updateSql = sql;
                    return { rows: [] };
                }
                return { rows: [] };
            },
        };
        const result = await createInvoiceFromBillable(pool, {
            client: 'Wafi Energy',
            period_month: 6,
            period_year: 2026,
            bill_ids: ['B1'],
            created_by: 'test@asil.com.pk',
        });
        expect(result.billsLinked).toBe(1);
        expect(updateSql).toContain('invoiced_in');
        expect(result.invoice.id).toBe(55);
    });
});

describe('receipt preview and post', () => {
    const { previewReceiptSplit } = require('../src/modules/ar/receipts');

    test('previewReceiptSplit returns lines for multiple invoices', async () => {
        const pool = {
            query: async (sql) => {
                if (sql.includes('FROM client_invoices')) {
                    return {
                        rows: [
                            { id: 1, invoice_number: 'INV-1', subtotal: 50000, sales_tax: 8000, grand_total: 58000, contract_id: null },
                            { id: 2, invoice_number: 'INV-2', subtotal: 100000, sales_tax: 16000, grand_total: 116000, contract_id: null },
                        ],
                    };
                }
                if (sql.includes('client_income_tax_wht_pct')) return { rows: [{ value: 6 }] };
                if (sql.includes('contract_policies')) return { rows: [] };
                return { rows: [] };
            },
        };
        const result = await previewReceiptSplit(pool, { invoice_ids: [1, 2] });
        expect(result.lines).toHaveLength(2);
        expect(result.totals.cash_received).toBeGreaterThan(0);
    });
});

describe('receipt delete helpers', () => {
    const { deleteReceiptById, purgeTestReceipts } = require('../src/modules/ar/receipts');

    test('deleteReceiptById removes lines then header', async () => {
        const calls = [];
        const pool = {
            query: async (sql, params) => {
                calls.push({ sql, params });
                if (sql.includes('invoice_receipt_lines')) return { rowCount: 2 };
                if (sql.includes('invoice_receipts')) return { rowCount: 1 };
                return { rowCount: 0 };
            },
        };
        const result = await deleteReceiptById(pool, '42');
        expect(result).toEqual({ ok: true, id: 42, linesDeleted: 2 });
        expect(calls[0].sql).toContain('invoice_receipt_lines');
        expect(calls[1].sql).toContain('invoice_receipts');
        expect(calls[1].params).toEqual([42]);
    });

    test('deleteReceiptById 404 when header missing', async () => {
        const pool = {
            query: async (sql) => {
                if (sql.includes('invoice_receipt_lines')) return { rowCount: 0 };
                return { rowCount: 0 };
            },
        };
        await expect(deleteReceiptById(pool, 9)).rejects.toMatchObject({ status: 404 });
    });

    test('purgeTestReceipts deletes TEST-% clients', async () => {
        const calls = [];
        const pool = {
            query: async (sql) => {
                calls.push(sql);
                return { rowCount: 3 };
            },
        };
        const result = await purgeTestReceipts(pool);
        expect(result.receiptsDeleted).toBe(3);
        expect(calls.some(s => s.includes("LIKE 'TEST-%'"))).toBe(true);
    });
});

describe('xero bills sync job registration', () => {
    test('mountModules registers nightly xero.bills.sync', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.join(__dirname, '../mountModules.js'), 'utf8');
        expect(src).toContain("'xero.bills.sync'");
        expect(src).toContain("scheduleJob('xero.bills.sync', {}, '0 1 * * *')");
        expect(src).toContain('runXeroBillsSyncJob');
    });
});
