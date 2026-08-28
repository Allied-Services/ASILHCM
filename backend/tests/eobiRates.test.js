'use strict';

const { calculateEOBI, eobiRatesForPeriod, eobiAppliesAug2026Revision } = require('../taxEngine');
const { computePrSheetRow } = require('../src/payroll/prSheetEngine');

const POLICY = { ot_allowed: true, standard_month_days: 30, service_charge_pct: 0.18 };

describe('EOBI rate schedule', () => {
    test('no period keeps pre-Aug 2026 amounts (historical default)', () => {
        expect(calculateEOBI()).toEqual({ employeeShare: 400, employerShare: 2000 });
        expect(calculateEOBI(50000)).toEqual({ employeeShare: 400, employerShare: 2000 });
        expect(eobiRatesForPeriod(null).employeeShare).toBe(400);
    });

    test('July 2026 stays 400 / 2,000', () => {
        expect(eobiAppliesAug2026Revision(2026, 7)).toBe(false);
        expect(calculateEOBI({ year: 2026, month: 7 })).toEqual({
            employeeShare: 400,
            employerShare: 2000,
        });
        const row = computePrSheetRow({
            newSalary: 50000,
            paidDays: 31,
            workingDays: 31,
            month: 7,
            year: 2026,
        }, POLICY);
        expect(row.eobiEmployee).toBe(400);
        expect(row.eobiEmployer).toBe(2000);
        expect(row.netPay).toBe(row.gross - row.wht - 400);
    });

    test('August 2026 revises to 430 / 2,150', () => {
        expect(eobiAppliesAug2026Revision(2026, 8)).toBe(true);
        expect(calculateEOBI({ year: 2026, month: 8 })).toEqual({
            employeeShare: 430,
            employerShare: 2150,
        });
        expect(eobiRatesForPeriod({ year: 2026, month: 8 })).toEqual({
            employeeShare: 430,
            employerShare: 2150,
            minWage: 43000,
        });
        const row = computePrSheetRow({
            newSalary: 50000,
            paidDays: 31,
            workingDays: 31,
            month: 8,
            year: 2026,
        }, POLICY);
        expect(row.eobiEmployee).toBe(430);
        expect(row.eobiEmployer).toBe(2150);
        expect(row.netPay).toBe(row.gross - row.wht - 430);
    });

    test('September 2026 and later keep the Aug revision', () => {
        expect(calculateEOBI({ year: 2026, month: 9 }).employeeShare).toBe(430);
        expect(calculateEOBI({ year: 2027, month: 1 }).employerShare).toBe(2150);
    });

    test('employee override keeps period-aware employer share', () => {
        const row = computePrSheetRow({
            newSalary: 50000,
            paidDays: 31,
            workingDays: 31,
            month: 8,
            year: 2026,
            eobiEmployee: 0,
        }, POLICY);
        expect(row.eobiEmployee).toBe(0);
        expect(row.eobiEmployer).toBe(2150);
    });
});
