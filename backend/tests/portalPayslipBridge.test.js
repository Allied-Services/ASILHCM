'use strict';

const {
    mapWorldARowToSummary,
    mapWorldBRowToSummary,
    mergePayslipSummaries,
} = require('../src/modules/portal/payslipBridge');

describe('portal payslipBridge', () => {
    test('mapWorldBRowToSummary reads computed JSON fields', () => {
        const summary = mapWorldBRowToSummary({
            period_month: 7,
            period_year: 2026,
            run_status: 'locked',
            run_id: 42,
            computed: { gross: 50000, netPay: 42000, wht: 3000, eobiEmployee: 400 },
            inputs: { advanceDeduction: 1500 },
        });
        expect(summary).toMatchObject({
            month: 7,
            year: 2026,
            gross: 50000,
            net: 42000,
            wht: 3000,
            eobi: 400,
            advance: 1500,
            source: 'world_b',
            runId: 42,
        });
    });

    test('mergePayslipSummaries prefers World B for same period', () => {
        const worldA = [mapWorldARowToSummary({
            month: 7, year: 2026, gross: 100, net: 80, wht: 10, eobi_ee: 400, adv: 0, status: 'Locked',
        })];
        const worldB = [mapWorldBRowToSummary({
            period_month: 7,
            period_year: 2026,
            run_status: 'locked',
            run_id: 1,
            computed: { gross: 50000, netPay: 42000, wht: 3000, eobiEmployee: 400 },
            inputs: {},
        })];
        const merged = mergePayslipSummaries(worldA, worldB);
        expect(merged).toHaveLength(1);
        expect(merged[0].source).toBe('world_b');
        expect(merged[0].net).toBe(42000);
    });

    test('mergePayslipSummaries keeps both periods sorted newest first', () => {
        const worldA = [
            mapWorldARowToSummary({ month: 6, year: 2026, gross: 1, net: 1, wht: 0, eobi_ee: 400, adv: 0, status: 'Locked' }),
        ];
        const worldB = [
            mapWorldBRowToSummary({
                period_month: 7, period_year: 2026, run_status: 'locked', run_id: 2,
                computed: { gross: 2, netPay: 2, wht: 0, eobiEmployee: 400 }, inputs: {},
            }),
        ];
        const merged = mergePayslipSummaries(worldA, worldB);
        expect(merged.map(p => `${p.year}-${p.month}`)).toEqual(['2026-7', '2026-6']);
    });
});
