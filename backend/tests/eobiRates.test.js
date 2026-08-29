'use strict';

const {
    calculateEOBI,
    eobiRatesForPeriod,
    calculatePayrollSheetMonthlyIncomeTax,
} = require('../taxEngine');
const { computePrSheetRow } = require('../src/payroll/prSheetEngine');

describe('period-aware EOBI', () => {
    test('no period keeps the pre-Aug 2026 amounts', () => {
        expect(calculateEOBI().employeeShare).toBe(400);
        expect(calculateEOBI().employerShare).toBe(2000);
    });

    test('July 2026 stays 400 / 2,000', () => {
        expect(calculateEOBI({ year: 2026, month: 7 }).employeeShare).toBe(400);
        expect(eobiRatesForPeriod({ year: 2026, month: 7 }).minWage).toBe(40000);
    });

    test('August 2026 uses 430 / 2,150', () => {
        expect(calculateEOBI({ year: 2026, month: 8 }).employeeShare).toBe(430);
        expect(calculateEOBI({ year: 2026, month: 8 }).employerShare).toBe(2150);
    });

    test('legacy numeric salary argument is ignored', () => {
        expect(calculateEOBI(95000).employeeShare).toBe(400);
    });
});

describe('monthly payroll tax excludes bonus', () => {
    test('Yasir-style sheet: bonus out of WHT base → 6,000', () => {
        expect(calculatePayrollSheetMonthlyIncomeTax(376723, 59910, 0, 166813, 0)).toBe(6000);
    });

    test('computePrSheetRow defaults to tax-without-bonus', () => {
        const withFlag = computePrSheetRow({
            newSalary: 90000,
            presentDays: 31,
            expectedDays: 31,
            modelA: true,
            bonusDisbursement: 7000,
            excludeBonusFromWht: true,
            year: 2026,
            month: 8,
        }, { standard_month_days: 31 });
        const defaulted = computePrSheetRow({
            newSalary: 90000,
            presentDays: 31,
            expectedDays: 31,
            modelA: true,
            bonusDisbursement: 7000,
            year: 2026,
            month: 8,
        }, { standard_month_days: 31 });
        expect(defaulted.wht).toBe(withFlag.wht);
        expect(defaulted.eobiEmployee).toBe(430);
        expect(defaulted.wht).toBeLessThan(
            computePrSheetRow({
                newSalary: 90000,
                presentDays: 31,
                expectedDays: 31,
                modelA: true,
                bonusDisbursement: 7000,
                excludeBonusFromWht: false,
                year: 2026,
                month: 8,
            }, { standard_month_days: 31 }).wht,
        );
    });
});
