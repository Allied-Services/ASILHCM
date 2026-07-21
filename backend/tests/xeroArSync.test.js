'use strict';

const {
    mapXeroStatus,
    mapXeroArInvoice,
    xeroDateToIso,
} = require('../src/modules/ar/xeroArSync');

describe('Xero AR invoice sync mapping', () => {
    test('maps Xero statuses to local AR statuses', () => {
        expect(mapXeroStatus('PAID')).toBe('Paid');
        expect(mapXeroStatus('AUTHORISED')).toBe('Raised');
        expect(mapXeroStatus('VOIDED')).toBe('Voided');
        expect(mapXeroStatus('DRAFT')).toBe('Draft');
    });

    test('parses Xero /Date()/ timestamps', () => {
        expect(xeroDateToIso('/Date(1719792000000+0000)/')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('mapXeroArInvoice builds overwrite payload', () => {
        const mapped = mapXeroArInvoice({
            InvoiceID: 'abc-123',
            InvoiceNumber: 'INV-1001',
            Status: 'AUTHORISED',
            Total: 110000,
            SubTotal: 100000,
            TotalTax: 10000,
            AmountDue: 110000,
            AmountPaid: 0,
            Date: '2026-06-01',
            DueDate: '2026-06-30',
            Reference: 'Wafi FM',
            Contact: { Name: 'Wafi Energy' },
            LineItems: [{ Description: 'Manpower', Quantity: 1, UnitAmount: 100000, LineAmount: 100000 }],
        });
        expect(mapped.invoice_number).toBe('INV-1001');
        expect(mapped.client).toBe('Wafi Energy');
        expect(mapped.grand_total).toBe(110000);
        expect(mapped.sales_tax).toBe(10000);
        expect(mapped.status).toBe('Raised');
        expect(mapped.xero_invoice_id).toBe('abc-123');
        expect(mapped.period_month).toBe(6);
        expect(mapped.period_year).toBe(2026);
    });

    test('fully paid invoice maps to Paid', () => {
        const mapped = mapXeroArInvoice({
            InvoiceID: 'p1',
            InvoiceNumber: 'INV-PAID',
            Status: 'AUTHORISED',
            Total: 5000,
            SubTotal: 5000,
            TotalTax: 0,
            AmountDue: 0,
            AmountPaid: 5000,
            Date: '2026-01-15',
            Contact: { Name: 'Client' },
            LineItems: [],
        });
        expect(mapped.status).toBe('Paid');
    });
});

describe('purge excel payroll helper', () => {
    test('preview mode does not delete', async () => {
        const { purgeExcelPayrollImports } = require('../src/modules/admin/purgeExcelPayroll');
        const calls = [];
        const pool = {
            query: async (sql) => {
                calls.push(sql);
                return { rows: [{ id: 1, contract_id: 'C1', period_month: 1, period_year: 2025, locked_by: 'excel_import:x', status: 'locked' }], rowCount: 1 };
            },
        };
        const preview = await purgeExcelPayrollImports(pool, { confirm: false });
        expect(preview.preview).toBe(true);
        expect(preview.runCount).toBe(1);
        expect(calls.some(s => /DELETE FROM payroll_runs/i.test(s))).toBe(false);
    });
});
