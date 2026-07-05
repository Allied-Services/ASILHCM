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
});
