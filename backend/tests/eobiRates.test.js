'use strict';

const {
    calculateEOBI,
    eobiRatesForPeriod,
    eobiRatesFromMinWage,
    calculatePayrollSheetMonthlyIncomeTax,
} = require('../taxEngine');
const { computePrSheetRow } = require('../src/payroll/prSheetEngine');

describe('contract-aware EOBI', () => {
    test('no period keeps the Rs. 40,000 default', () => {
        expect(calculateEOBI().employeeShare).toBe(400);
        expect(calculateEOBI().employerShare).toBe(2000);
    });

    test('July 2026 stays 400 / 2,000 without a contract wage', () => {
        expect(calculateEOBI({ year: 2026, month: 7 }).employeeShare).toBe(400);
        expect(eobiRatesForPeriod({ year: 2026, month: 7 }).minWage).toBe(40000);
    });

    test('August 2026 stays 400 / 2,000 without a contract wage', () => {
        expect(calculateEOBI({ year: 2026, month: 8 }).employeeShare).toBe(400);
        expect(calculateEOBI({ year: 2026, month: 8 }).employerShare).toBe(2000);
    });

    test('Sindh min wage 43,000 → 430 / 2,150', () => {
        expect(calculateEOBI({ eobiMinWage: 43000 }).employeeShare).toBe(430);
        expect(calculateEOBI({ eobiMinWage: 43000 }).employerShare).toBe(2150);
        expect(eobiRatesFromMinWage(43000).minWage).toBe(43000);
    });

    test('Punjab / KPK min wage 40,000 → 400 / 2,000', () => {
        expect(calculateEOBI({ eobiMinWage: 40000 }).employeeShare).toBe(400);
        expect(calculateEOBI({ eobi_min_wage: 40000 }).employerShare).toBe(2000);
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
        expect(defaulted.eobiEmployee).toBe(400);
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

    test('computePrSheetRow uses policy.eobi_min_wage', () => {
        const sindh = computePrSheetRow({
            newSalary: 90000,
            presentDays: 31,
            expectedDays: 31,
            modelA: true,
            year: 2026,
            month: 8,
        }, { standard_month_days: 31, eobi_min_wage: 43000 });
        expect(sindh.eobiEmployee).toBe(430);
        expect(sindh.eobiEmployer).toBe(2150);

        const punjab = computePrSheetRow({
            newSalary: 90000,
            presentDays: 31,
            expectedDays: 31,
            modelA: true,
            year: 2026,
            month: 8,
        }, { standard_month_days: 31, eobi_min_wage: 40000 });
        expect(punjab.eobiEmployee).toBe(400);
        expect(punjab.eobiEmployer).toBe(2000);
    });

    test('employee override keeps contract employer share', () => {
        const row = computePrSheetRow({
            newSalary: 90000,
            presentDays: 31,
            expectedDays: 31,
            modelA: true,
            eobiEmployee: 0,
            year: 2026,
            month: 8,
        }, { eobi_min_wage: 43000 });
        expect(row.eobiEmployee).toBe(0);
        expect(row.eobiEmployer).toBe(2150);
    });
});
