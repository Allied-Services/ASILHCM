'use strict';

const {
    nonManpowerLines,
    confirmationMapFromRows,
    isLineIncludedOnInvoice,
    filterLinesForInvoice,
    buildBillableSnapshot,
    assertPeriodReviewed,
    assertContractConfirmations,
} = require('../src/modules/serviceOrders/billableConfirmations');

describe('billableConfirmations — line filtering', () => {
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

    test('default (no confirmations) excludes non-manpower; manpower unchanged', () => {
        const map = confirmationMapFromRows([]);
        const billed = filterLinesForInvoice(lines, map);
        expect(billed.map((l) => l.id)).toEqual([1, 4]);
        expect(billed.every((l) => l.is_manpower_dependent || l.isManpowerDependent)).toBe(true);
    });

    test('confirmed billable non-manpower lines are included', () => {
        const map = confirmationMapFromRows([
            { line_id: 2, billable: true },
            { line_id: 3, billable: false },
        ]);
        const billed = filterLinesForInvoice(lines, map);
        expect(billed.map((l) => l.id)).toEqual([1, 2, 4]);
        expect(isLineIncludedOnInvoice(lines[2], map)).toBe(false);
    });

    test('all confirmed → invoice includes all lines and totals drop when unchecked', () => {
        const allOn = confirmationMapFromRows([
            { line_id: 2, billable: true },
            { line_id: 3, billable: true },
        ]);
        const allOff = confirmationMapFromRows([
            { line_id: 2, billable: false },
            { line_id: 3, billable: false },
        ]);
        const withExtras = filterLinesForInvoice(lines, allOn)
            .reduce((s, l) => s + Number(l.rate), 0);
        const manpowerOnly = filterLinesForInvoice(lines, allOff)
            .reduce((s, l) => s + Number(l.rate), 0);
        expect(withExtras).toBe(100000 + 27020 + 10750 + 50000);
        expect(manpowerOnly).toBe(150000);
        expect(withExtras - manpowerOnly).toBe(27020 + 10750);
    });

    test('snapshot marks includedOnInvoice for stamp metadata', () => {
        const map = confirmationMapFromRows([{ line_id: 2, billable: true }]);
        const snap = buildBillableSnapshot(lines, map);
        expect(snap.find((s) => s.lineId === 1).includedOnInvoice).toBe(true);
        expect(snap.find((s) => s.lineId === 2).includedOnInvoice).toBe(true);
        expect(snap.find((s) => s.lineId === 3).includedOnInvoice).toBe(false);
        expect(snap.find((s) => s.lineId === 3).billable).toBe(false);
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
    test('same confirmation map yields identical included line set', () => {
        const lines = [
            { id: 1, is_manpower_dependent: true, rate: 10 },
            { id: 2, is_manpower_dependent: false, rate: 5 },
        ];
        const map = confirmationMapFromRows([{ line_id: 2, billable: true }]);
        const a = filterLinesForInvoice(lines, map).map((l) => l.id);
        const b = filterLinesForInvoice(lines, map).map((l) => l.id);
        expect(a).toEqual(b);
        expect(a).toEqual([1, 2]);
    });
});
