'use strict';

const {
    updateFvInvoiceNumber,
    FV_REGENERATABLE_STATUSES,
    printInvoiceHtml,
    parseInvoiceNotes,
} = require('../src/modules/serviceOrders/billing');
const {
    mapLinesForInvoice,
    confirmationMapFromRows,
} = require('../src/modules/serviceOrders/billableConfirmations');
const { renderInvoiceHtml } = require('../src/modules/serviceOrders/invoiceHtml');

describe('FV invoice — unchecked lines zeroed but present', () => {
    test('Chakpirana-shaped: garbage unchecked qty 0; consumables full', () => {
        const lines = [
            { id: 101, name: 'Manpower', is_manpower_dependent: true, rate: 500000 },
            { id: 102, name: 'Provision of consumables', is_manpower_dependent: false, rate: 27020 },
            { id: 103, name: 'Removal of garbage / solid waste', is_manpower_dependent: false, rate: 10750 },
        ];
        const map = confirmationMapFromRows([
            { line_id: 102, billable: true },
            { line_id: 103, billable: false },
        ]);
        const stamped = mapLinesForInvoice(lines, map);
        expect(stamped).toHaveLength(3);
        const garbage = stamped.find((m) => m.line.id === 103);
        const consumables = stamped.find((m) => m.line.id === 102);
        expect(garbage.quantity).toBe(0);
        expect(garbage.amount).toBe(0);
        expect(consumables.quantity).toBe(1);
        expect(consumables.amount).toBe(27020);
        expect(stamped.reduce((s, m) => s + m.amount, 0)).toBe(500000 + 27020);
    });

    test('invoice HTML shows qty 0.00 and PKR 0 for unchecked line', () => {
        const html = renderInvoiceHtml({
            computed: {
                invoiceNumber: 'INV-JUL26-0002',
                siteName: 'Chakpirana Depot',
                siteCode: 'CHAKPIRANA',
                resources: 8,
                province: 'Punjab',
                netTaxable: 527020,
                provincialSt: 84323.2,
                grandTotal: 611343.2,
                taxRate: 0.16,
                lineItems: [
                    { description: 'Manpower — 7/2026', quantity: 1, rate: 500000, amount: 500000 },
                    { description: 'Provision of consumables — 7/2026', quantity: 1, rate: 27020, amount: 27020 },
                    { description: 'Removal of garbage / solid waste — 7/2026', quantity: 0, rate: 10750, amount: 0 },
                ],
            },
        });
        expect(html).toContain('INV-JUL26-0002');
        expect(html).toMatch(/Removal of garbage/);
        expect(html).toMatch(/0\.00/);
    });
});

describe('FV invoice — regenerate status gate', () => {
    test('Draft / Raised / Sent are regeneratable; Paid / Voided are not', () => {
        expect(FV_REGENERATABLE_STATUSES.has('draft')).toBe(true);
        expect(FV_REGENERATABLE_STATUSES.has('raised')).toBe(true);
        expect(FV_REGENERATABLE_STATUSES.has('sent')).toBe(true);
        expect(FV_REGENERATABLE_STATUSES.has('paid')).toBe(false);
        expect(FV_REGENERATABLE_STATUSES.has('voided')).toBe(false);
    });
});

describe('FV invoice — invoice number patch', () => {
    test('updateFvInvoiceNumber persists and uniqueness rejects clashes', async () => {
        const row = {
            id: 42,
            invoice_number: 'INV-JUL26-0002',
            status: 'Draft',
            notes: JSON.stringify({
                source: 'fixed_value_service_order',
                service_order_id: 'SO-PSO-CHAKPIRANA',
            }),
        };
        const updated = { ...row, invoice_number: 'INV-JUL26-CHAK-01' };
        const pool = {
            query: jest.fn()
                // SELECT existing
                .mockResolvedValueOnce({ rows: [row] })
                // uniqueness check
                .mockResolvedValueOnce({ rows: [] })
                // UPDATE
                .mockResolvedValueOnce({ rows: [updated] }),
        };
        const result = await updateFvInvoiceNumber(pool, 42, 'INV-JUL26-CHAK-01');
        expect(result.invoice_number).toBe('INV-JUL26-CHAK-01');
        expect(pool.query).toHaveBeenNthCalledWith(
            3,
            expect.stringMatching(/UPDATE client_invoices/i),
            [42, 'INV-JUL26-CHAK-01']
        );

        const clashPool = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [row] })
                .mockResolvedValueOnce({ rows: [{ id: 99 }] }),
        };
        await expect(updateFvInvoiceNumber(clashPool, 42, 'INV-TAKEN'))
            .rejects.toMatchObject({ status: 409, code: 'INVOICE_NUMBER_TAKEN' });
    });

    test('print payload uses stored invoice_number after patch', async () => {
        const invRow = {
            id: 7,
            invoice_number: 'INV-JUL26-CUSTOM',
            client: 'PSO',
            contract: 'North Zone',
            period_month: 7,
            period_year: 2026,
            subtotal: 100,
            sales_tax: 16,
            wht: 15,
            grand_total: 116,
            line_items: JSON.stringify([
                { description: 'Garbage — 7/2026', quantity: 0, rate: 10750, amount: 0 },
            ]),
            notes: JSON.stringify({
                source: 'fixed_value_service_order',
                service_order_id: 'SO-PSO-CHAKPIRANA',
                site_code: 'CHAKPIRANA',
                site_name: 'Chakpirana Depot',
                tax_rate: 0.16,
            }),
        };
        const pool = {
            query: jest.fn()
                // loadServiceOrdersByIds
                .mockResolvedValueOnce({ rows: [] })
                // listDeductions
                .mockResolvedValueOnce({ rows: [] }),
        };
        const html = await printInvoiceHtml(pool, invRow, 'invoice');
        expect(html).toContain('INV-JUL26-CUSTOM');
        expect(parseInvoiceNotes(invRow.notes).service_order_id).toBe('SO-PSO-CHAKPIRANA');
    });
});
