'use strict';

const {
    nonManpowerLines,
    confirmationMapFromRows,
    isLineIncludedOnInvoice,
    invoiceQuantityForLine,
    filterLinesForInvoice,
    mapLinesForInvoice,
    buildBillableSnapshot,
    assertPeriodReviewed,
    assertContractConfirmations,
} = require('../src/modules/serviceOrders/billableConfirmations');

describe('billableConfirmations — zeroed non-manpower lines stay on invoice', () => {
    const lines = [
        { id: 1, name: 'Manpower A', is_manpower_dependent: true, rate: 100000, line_number: '1' },
        { id: 2, name: 'Consumables', is_manpower_dependent: false, rate: 27020, line_number: '2' },
        { id: 3, name: 'Garbage', is_manpower_dependent: false, rate: 10750, line_number: '3' },
        { id: 4, name: 'Manpower B', isManpowerDependent: true, rate: 50000, line_number: '4' },
    ];

    test('nonManpowerLines returns only non-manpower', () => {
        const nm = nonManpowerLines(lines);
        expect(nm.map((l) => l.id)).toEqual([2, 3]);
    });

    test('unchecked non-manpower still listed with qty 0 / amount 0 (Chakpirana garbage case)', () => {
        const map = confirmationMapFromRows([
            { line_id: 2, billable: true },
            { line_id: 3, billable: false },
        ]);
        // All lines remain present — never omitted when unchecked.
        expect(filterLinesForInvoice(lines, map).map((l) => l.id)).toEqual([1, 2, 3, 4]);

        const mapped = mapLinesForInvoice(lines, map);
        const garbage = mapped.find((m) => m.line.id === 3);
        const consumables = mapped.find((m) => m.line.id === 2);
        const manpower = mapped.find((m) => m.line.id === 1);

        expect(garbage.billable).toBe(false);
        expect(garbage.quantity).toBe(0);
        expect(garbage.amount).toBe(0);
        expect(invoiceQuantityForLine(lines[2], map)).toBe(0);

        expect(consumables.billable).toBe(true);
        expect(consumables.quantity).toBe(1);
        expect(consumables.amount).toBe(27020);

        expect(manpower.billable).toBe(true);
        expect(manpower.quantity).toBe(1);
        expect(manpower.amount).toBe(100000);

        const gross = mapped.reduce((s, m) => s + m.amount, 0);
        expect(gross).toBe(100000 + 27020 + 0 + 50000);
    });

    test('default (no confirmations) zeros non-manpower; manpower full; all lines present', () => {
        const map = confirmationMapFromRows([]);
        const mapped = mapLinesForInvoice(lines, map);
        expect(mapped.map((m) => m.line.id)).toEqual([1, 2, 3, 4]);
        expect(mapped.filter((m) => m.line.is_manpower_dependent || m.line.isManpowerDependent)
            .every((m) => m.quantity === 1 && m.amount === m.rate)).toBe(true);
        expect(mapped.filter((m) => !(m.line.is_manpower_dependent || m.line.isManpowerDependent))
            .every((m) => m.quantity === 0 && m.amount === 0)).toBe(true);
        expect(isLineIncludedOnInvoice(lines[2], map)).toBe(false);
    });

    test('all confirmed → full rates; all unchecked non-manpower → manpower-only gross', () => {
        const allOn = confirmationMapFromRows([
            { line_id: 2, billable: true },
            { line_id: 3, billable: true },
        ]);
        const allOff = confirmationMapFromRows([
            { line_id: 2, billable: false },
            { line_id: 3, billable: false },
        ]);
        const withExtras = mapLinesForInvoice(lines, allOn).reduce((s, m) => s + m.amount, 0);
        const manpowerOnly = mapLinesForInvoice(lines, allOff).reduce((s, m) => s + m.amount, 0);
        expect(withExtras).toBe(100000 + 27020 + 10750 + 50000);
        expect(manpowerOnly).toBe(150000);
        expect(withExtras - manpowerOnly).toBe(27020 + 10750);
        // Unchecked lines still present as zero rows
        expect(mapLinesForInvoice(lines, allOff).find((m) => m.line.id === 3).quantity).toBe(0);
    });

    test('snapshot lists every line; chargedOnInvoice false for unchecked', () => {
        const map = confirmationMapFromRows([{ line_id: 2, billable: true }]);
        const snap = buildBillableSnapshot(lines, map);
        expect(snap.find((s) => s.lineId === 1).includedOnInvoice).toBe(true);
        expect(snap.find((s) => s.lineId === 2).includedOnInvoice).toBe(true);
        expect(snap.find((s) => s.lineId === 3).includedOnInvoice).toBe(true);
        expect(snap.find((s) => s.lineId === 3).billable).toBe(false);
        expect(snap.find((s) => s.lineId === 3).chargedOnInvoice).toBe(false);
        expect(snap.find((s) => s.lineId === 3).quantity).toBe(0);
        expect(snap.find((s) => s.lineId === 2).chargedOnInvoice).toBe(true);
        expect(snap.find((s) => s.lineId === 2).quantity).toBe(1);
    });
});

describe('billableConfirmations — period review gate', () => {
    test('assertPeriodReviewed throws CONFIRMATIONS_REQUIRED when no review row', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({ rows: [] }),
        };
        await expect(assertPeriodReviewed(pool, 'SO-PSO-TARUJABBA', 7, 2026))
            .rejects.toMatchObject({ status: 409, code: 'CONFIRMATIONS_REQUIRED' });
    });

    test('assertPeriodReviewed passes when review saved (even all unchecked)', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{
                    service_order_id: 'SO-PSO-TARUJABBA',
                    period_year: 2026,
                    period_month: 7,
                    reviewed_by: 'ops@asil.com.pk',
                    reviewed_at: new Date().toISOString(),
                }],
            }),
        };
        const row = await assertPeriodReviewed(pool, 'SO-PSO-TARUJABBA', 7, 2026);
        expect(row.reviewed_by).toBe('ops@asil.com.pk');
    });

    test('assertContractConfirmations blocks when any site missing review', async () => {
        const soRow = {
            id: 'SO-PSO-TARUJABBA',
            site_code: 'TARUJABBA',
            name: 'Tarujabba Depot',
            contract_id: 'CTR-PSO-NORTH-ZONE',
            lines: [
                { id: 10, name: 'MP', is_manpower_dependent: true, rate: 1 },
                { id: 11, name: 'Garbage', is_manpower_dependent: false, rate: 2 },
            ],
        };
        const pool = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [soRow] })
                .mockResolvedValueOnce({ rows: [soRow] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] }),
        };
        await expect(assertContractConfirmations(pool, 'CTR-PSO-NORTH-ZONE', 7, 2026))
            .rejects.toMatchObject({
                status: 409,
                code: 'CONFIRMATIONS_REQUIRED',
                details: { missing: [expect.objectContaining({ siteCode: 'TARUJABBA' })] },
            });
    });
});

describe('billableConfirmations — idempotent recompute shape', () => {
    test('same confirmation map yields identical qty/amount for every line', () => {
        const lines = [
            { id: 1, is_manpower_dependent: true, rate: 10 },
            { id: 2, is_manpower_dependent: false, rate: 5 },
        ];
        const map = confirmationMapFromRows([{ line_id: 2, billable: true }]);
        const a = mapLinesForInvoice(lines, map).map((m) => [m.line.id, m.quantity, m.amount]);
        const b = mapLinesForInvoice(lines, map).map((m) => [m.line.id, m.quantity, m.amount]);
        expect(a).toEqual(b);
        expect(a).toEqual([[1, 1, 10], [2, 1, 5]]);
    });
});
