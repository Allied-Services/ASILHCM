'use strict';

const {
    updateFvInvoiceNumber,
    FV_REGENERATABLE_STATUSES,
    printInvoiceHtml,
    parseInvoiceNotes,
    addManualDeduction,
    deleteManualDeduction,
} = require('../src/modules/serviceOrders/billing');
const {
    mapLinesForInvoice,
    confirmationMapFromRows,
} = require('../src/modules/serviceOrders/billableConfirmations');
const {
    renderInvoiceHtml,
    attributeDeductions,
    shortageLabel,
} = require('../src/modules/serviceOrders/invoiceHtml');
const { replaceLines, buildOldToNewLineIdMap } = require('../src/modules/serviceOrders/crud');

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

describe('FV invoice — per-line shortages (Chakpirana July)', () => {
    const officeRoles = [
        { designation: 'Conservancy Supervisory Services', count: 1 },
        { designation: 'Sweeping / Cleaning Services', count: 4 },
        { designation: 'Gardening Services', count: 1 },
        { designation: 'M&R Support services', count: 1 },
        { designation: 'Sealing Services', count: 2 },
        { designation: 'Lube Handling', count: 1 },
        { designation: 'Lab service', count: 1 },
        { designation: 'Office service', count: 1 },
        { designation: 'OMC Physical Reporting', count: 1 },
        { designation: 'Additional general services', count: 2 },
    ];
    const tankRoles = [
        { designation: 'Fuel Oil Handling Services', count: 14 },
    ];

    const lineItems = [
        {
            lineId: 201,
            description: 'Office/Misc Services — 7/2026',
            name: 'Office/Misc Services',
            quantity: 1,
            rate: 823618,
            amount: 823618,
            isManpowerDependent: true,
            roles: officeRoles,
            soLineNumber: 1,
        },
        {
            lineId: 202,
            description: 'Services for forklifter operation/driving — 7/2026',
            name: 'Services for forklifter operation/driving',
            quantity: 1,
            rate: 56991,
            amount: 56991,
            isManpowerDependent: true,
            roles: [{ designation: 'Forklift Operation Services', count: 1 }],
            soLineNumber: 2,
        },
        {
            lineId: 203,
            description: 'Housekeeping services (Consumables) — 7/2026',
            name: 'Housekeeping services (Consumables)',
            quantity: 1,
            rate: 27806,
            amount: 27806,
            isManpowerDependent: false,
            roles: [],
            soLineNumber: 3,
        },
        {
            lineId: 204,
            description: 'Removal of garbage / solid waste — 7/2026',
            name: 'Removal of garbage / solid waste',
            quantity: 0,
            rate: 10750,
            amount: 0,
            isManpowerDependent: false,
            roles: [],
            soLineNumber: 4,
        },
        {
            lineId: 205,
            description: 'Services for Tank-lorry receipt operation — 7/2026',
            name: 'Services for Tank-lorry receipt operation',
            quantity: 1,
            rate: 802256,
            amount: 802256,
            isManpowerDependent: true,
            roles: tankRoles,
            soLineNumber: 5,
        },
    ];

    // line_id null — must re-attribute via designation (simulates post-resync orphans)
    const deductions = [
        {
            id: 1, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-055/25',
            employee_name: 'Nabeel Hussain', employee_designation: 'Lube Handling Services',
            days_absent: 1, amount: 1830.26,
        },
        {
            id: 2, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-056/25',
            employee_name: 'M Rasab', employee_designation: 'Lube Handling Services',
            days_absent: 1, amount: 1830.26,
        },
        {
            id: 3, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-063/25',
            employee_name: 'Umar Sajjad', employee_designation: 'Sweeping / Cleaning Services',
            days_absent: 1, amount: 1830.26,
        },
        {
            id: 4, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-070/25',
            employee_name: 'M.Ansar', employee_designation: 'Sealing Services',
            days_absent: 2, amount: 3660.52,
        },
        {
            id: 5, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-082/25',
            employee_name: 'Naveed Bhatti', employee_designation: 'Sweeping / Cleaning Services',
            days_absent: 2, amount: 3660.52,
        },
        {
            id: 6, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-083/25',
            employee_name: 'Rafaqat Masih', employee_designation: 'Sweeping / Cleaning Services',
            days_absent: 6, amount: 10981.57,
        },
        {
            id: 7, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-090/25',
            employee_name: 'Sheraz Ahmad', employee_designation: 'Fuel Oil Handling Services',
            days_absent: 1, amount: 1910.13,
        },
        {
            id: 8, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-091/25',
            employee_name: 'Zubair Ali', employee_designation: 'Fuel Oil Handling Services',
            days_absent: 1, amount: 1910.13,
        },
        {
            id: 9, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-092/25',
            employee_name: 'Muhammad Zaheer', employee_designation: 'Fuel Oil Handling Services',
            days_absent: 1, amount: 1910.13,
        },
    ];

    const gross = 1710671;
    const totalDeductions = 29523.78;
    const netTaxable = 1681147.22;
    const provincialSt = 268983.56;
    const grandTotal = 1950130.78;

    test('orphan deductions attribute to Line 1 and Line 5 via designation', () => {
        const { byLine, orphans } = attributeDeductions(lineItems, deductions);
        expect(orphans).toHaveLength(0);
        expect(byLine.get('201')).toHaveLength(6);
        expect(byLine.get('205')).toHaveLength(3);
        const line1Amt = byLine.get('201').reduce((s, d) => s + d.amount, 0);
        const line5Amt = byLine.get('205').reduce((s, d) => s + d.amount, 0);
        expect(Math.round(line1Amt * 100) / 100).toBe(23793.39);
        expect(Math.round(line5Amt * 100) / 100).toBe(5730.39);
    });

    test('shortage label matches June mockup format with daily rate', () => {
        expect(shortageLabel(deductions[0])).toBe(
            '• Nabeel Hussain (Lube Handling Services) — 1 day absent (@ Rs. 1,830.26/day)'
        );
        expect(shortageLabel(deductions[3])).toBe(
            '• M.Ansar (Sealing Services) — 2 days absent (@ Rs. 1,830.26/day)'
        );
        expect(shortageLabel({
            employee_name: 'X', employee_designation: 'Y', days_absent: 0, amount: 100,
        })).toBe('• X (Y) — 0 days absent');
    });

    test('invoice HTML nests shortages under lines; no catch-all block', () => {
        const html = renderInvoiceHtml({
            computed: {
                invoiceNumber: '5352',
                siteName: 'Chakpirana Depot',
                siteCode: 'CHAKPIRANA',
                resources: 30,
                province: 'Punjab',
                periodMonth: 7,
                periodYear: 2026,
                contractName: 'PSO North Zone Operations',
                lineItems,
                deductions,
                gross,
                totalDeductions,
                netTaxable,
                provincialSt,
                grandTotal,
                taxRate: 0.16,
            },
        });

        expect(html).toContain('LESS: Services Not Fully Delivered / Shortages:');
        expect(html).not.toContain('LESS: Additional Shortages / Adjustments');
        expect(html).toContain('Nabeel Hussain (Lube Handling Services) — 1 day absent (@ Rs. 1,830.26/day)');
        expect(html).toContain('Rafaqat Masih (Sweeping / Cleaning Services) — 6 days absent (@ Rs. 1,830.26/day)');
        expect(html).toContain('Sheraz Ahmad (Fuel Oil Handling Services) — 1 day absent (@ Rs. 1,910.13/day)');
        expect(html).toContain('Rs. 799,824.61'); // Line 1 net
        expect(html).toContain('Rs. 796,525.61'); // Line 5 net
        expect(html).toContain('Rs. 1,710,671.00');
        expect(html).toContain('LESS: Shortage / Deductions');
        expect(html).toContain('-Rs. 29,523.78');
        expect(html).toContain('Rs. 1,681,147.22');
        expect(html).toContain('PKR 1,950,130.78');
        expect(html).toContain('Adjusted Total Deductions');
        expect(html).toContain('-Rs. 23,793.39');
    });

    test('manual deduction without designation stays in catch-all', () => {
        const html = renderInvoiceHtml({
            computed: {
                invoiceNumber: 'DRAFT',
                siteName: 'Chakpirana Depot',
                periodMonth: 7,
                periodYear: 2026,
                lineItems,
                deductions: [
                    ...deductions,
                    { id: 99, line_id: null, type: 'adjustment', amount: 500, note: 'Other adjustment' },
                ],
                gross,
                totalDeductions: totalDeductions + 500,
                netTaxable: netTaxable - 500,
                provincialSt: 0,
                grandTotal: netTaxable - 500,
                taxRate: 0.16,
            },
        });
        expect(html).toContain('LESS: Additional Shortages / Adjustments');
        expect(html).toContain('Other adjustment');
        expect(html).toContain('Nabeel Hussain (Lube Handling Services)');
        expect(html.indexOf('LESS: Additional Shortages / Adjustments'))
            .toBeLessThan(html.indexOf('Gross Total Contract Value'));
    });

    test('Janitor designation attributes to Office/Misc, not catch-all', () => {
        const janitorDeds = [
            {
                id: 82, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-082/25',
                employee_name: 'Naveed Bhatti', employee_designation: 'Janitor',
                days_absent: 2, amount: 3660.52,
            },
            {
                id: 83, line_id: null, type: 'absence', employee_id: 'ASIL/PSO-083/25',
                employee_name: 'Rafaqat Masih', employee_designation: 'Janitor',
                days_absent: 6, amount: 10981.57,
            },
        ];
        const { byLine, orphans } = attributeDeductions(lineItems, janitorDeds);
        expect(orphans).toHaveLength(0);
        expect(byLine.get('201')).toHaveLength(2);

        const html = renderInvoiceHtml({
            computed: {
                invoiceNumber: '5352',
                siteName: 'Chakpirana Depot',
                siteCode: 'CHAKPIRANA',
                periodMonth: 7,
                periodYear: 2026,
                lineItems,
                deductions: janitorDeds,
                gross,
                totalDeductions: 14642.09,
                netTaxable: gross - 14642.09,
                provincialSt: 0,
                grandTotal: gross - 14642.09,
                taxRate: 0.16,
            },
        });
        expect(html).not.toContain('LESS: Additional Shortages / Adjustments');
        expect(html).toContain('Naveed Bhatti (Janitor) — 2 days absent');
        expect(html).toContain('Rafaqat Masih (Janitor) — 6 days absent');
        expect(html).toContain('Rs. 808,975.91'); // 823618 - 14642.09
    });
});

describe('FV replaceLines — re-points so_deductions.line_id', () => {
    test('buildOldToNewLineIdMap prefers line_number then name', () => {
        const oldLines = [
            { id: 10, line_number: '1', name: 'Office/Misc Services' },
            { id: 11, line_number: '2', name: 'Forklift' },
        ];
        const newLines = [
            { id: 50, line_number: '1', name: 'Office/Misc Services' },
            { id: 51, line_number: '2', name: 'Forklift Ops' },
        ];
        const map = buildOldToNewLineIdMap(oldLines, newLines);
        expect(map.get(10)).toBe(50);
        expect(map.get(11)).toBe(51);
    });

    test('replaceLines captures links, re-inserts, and UPDATEs deductions', async () => {
        const oldLines = [
            {
                id: 10, line_number: '1', name: 'Office/Misc Services', unit: 'AU',
                quantity: 12, rate: 823618, total_amount: 9883416,
                is_manpower_dependent: true, roles: [{ designation: 'Lube Handling', count: 1 }],
            },
        ];
        const newLine = {
            id: 99, line_number: '1', name: 'Office/Misc Services', unit: 'AU',
            quantity: 12, rate: 823618, total_amount: 9883416,
            is_manpower_dependent: true, roles: [{ designation: 'Lube Handling', count: 1 }],
        };

        const queries = [];
        const client = {
            query: jest.fn(async (sql, params) => {
                queries.push({ sql, params });
                if (/BEGIN|COMMIT|ROLLBACK/i.test(sql)) return { rows: [] };
                if (/SELECT id, line_id FROM so_deductions/i.test(sql)) {
                    return { rows: [{ id: 7, line_id: 10 }] };
                }
                if (/DELETE FROM service_order_lines/i.test(sql)) return { rows: [] };
                if (/INSERT INTO service_order_lines/i.test(sql)) return { rows: [newLine] };
                if (/UPDATE so_deductions/i.test(sql)) return { rows: [], rowCount: 1 };
                if (/UPDATE service_orders SET total_value/i.test(sql)) return { rows: [] };
                return { rows: [] };
            }),
            release: jest.fn(),
        };
        const pool = {
            connect: jest.fn(async () => client),
            query: jest.fn(async (sql) => {
                if (/FROM service_orders so WHERE so.id/i.test(sql)) {
                    return {
                        rows: [{
                            id: 'SO-PSO-CHAKPIRANA',
                            lines: oldLines,
                        }],
                    };
                }
                return { rows: [] };
            }),
        };

        const result = await replaceLines(pool, 'SO-PSO-CHAKPIRANA', [{
            line_number: '1',
            name: 'Office/Misc Services',
            unit: 'AU',
            quantity: 12,
            rate: 823618,
            total_amount: 9883416,
            is_manpower_dependent: true,
            roles: [{ designation: 'Lube Handling', count: 1 }],
        }]);

        expect(result.lines[0].id).toBe(99);
        const updateCall = queries.find((q) => /UPDATE so_deductions/i.test(q.sql));
        expect(updateCall).toBeTruthy();
        expect(updateCall.params[0]).toEqual([7]);
        expect(updateCall.params[1]).toEqual([99]);
        expect(updateCall.params[2]).toBe('SO-PSO-CHAKPIRANA');
        expect(client.release).toHaveBeenCalled();
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

describe('FV invoice — manual adjustments', () => {
    test('addManualDeduction persists note and defaults type to adjustment', async () => {
        const inserted = {
            id: 55,
            service_order_id: 'SO-PSO-CHAKPIRANA',
            period_month: 7,
            period_year: 2026,
            type: 'adjustment',
            amount: 1830.26,
            source: 'manual',
            note: 'Credit — June services not delivered',
        };
        const pool = {
            query: jest.fn().mockResolvedValueOnce({ rows: [inserted] }),
        };
        const row = await addManualDeduction(pool, {
            service_order_id: 'SO-PSO-CHAKPIRANA',
            period_month: 7,
            period_year: 2026,
            amount: 1830.26,
            note: 'Credit — June services not delivered',
        }, 'ar@asil.com.pk');
        expect(row.note).toBe('Credit — June services not delivered');
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringMatching(/INSERT INTO so_deductions/i),
            expect.arrayContaining([
                'SO-PSO-CHAKPIRANA',
                null,
                7,
                2026,
                'adjustment',
                null,
                null,
                1830.26,
                'ar@asil.com.pk',
                'Credit — June services not delivered',
            ])
        );
    });

    test('addManualDeduction rejects zero or negative amount', async () => {
        const pool = { query: jest.fn() };
        await expect(addManualDeduction(pool, {
            service_order_id: 'SO-PSO-X',
            period_month: 7,
            period_year: 2026,
            amount: 0,
            note: 'x',
        })).rejects.toMatchObject({ status: 400 });
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('deleteManualDeduction removes only source=manual rows', async () => {
        const pool = {
            query: jest.fn().mockResolvedValueOnce({
                rows: [{ id: 55, source: 'manual', amount: 100 }],
            }),
        };
        const row = await deleteManualDeduction(pool, 'SO-PSO-CHAKPIRANA', 55);
        expect(row.id).toBe(55);
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringMatching(/DELETE FROM so_deductions/i),
            [55, 'SO-PSO-CHAKPIRANA']
        );
        expect(pool.query.mock.calls[0][0]).toMatch(/source = 'manual'/);

        const miss = { query: jest.fn().mockResolvedValueOnce({ rows: [] }) };
        await expect(deleteManualDeduction(miss, 'SO-PSO-CHAKPIRANA', 99))
            .rejects.toMatchObject({ status: 404 });
    });
});
