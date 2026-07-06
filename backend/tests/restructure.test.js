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

describe('compliance computeStatutoryForMonth', () => {
    const { computeStatutoryForMonth } = require('../src/modules/compliance/service');

    test('EOBI and SESSI totals are non-zero for locked payroll', async () => {
        const pool = {
            query: async () => ({
                rows: [{ gross: 35000, province: 'Sindh', contract_id: 'c1' }],
            }),
        };
        const result = await computeStatutoryForMonth(pool, 6, 2026);
        expect(result.eobi.total).toBeGreaterThan(0);
        expect(result.sessi.total).toBeGreaterThan(0);
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
