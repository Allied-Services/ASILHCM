'use strict';

const {
    calculatePayrollSheetMonthlyIncomeTax,
    calculateJuly2026WafiMonthlyIncomeTax,
    calculateMonthlyIncomeTax,
} = require('../taxEngine');

describe('Payroll Sheet monthly WHT (bonus lump excluded)', () => {
    test('SPL-208 — bonus excluded from WHT base → zero tax', () => {
        expect(calculatePayrollSheetMonthlyIncomeTax(90100, 41214, 0, 0, 0)).toBe(0);
    });

    test('SPL-91 — bonus and reimbursement excluded → 780 tax', () => {
        expect(calculatePayrollSheetMonthlyIncomeTax(205988, 83442, 0, 20000, 0)).toBe(780);
    });

    test('SPL-19 — high earner, bonus excluded from annualization', () => {
        expect(calculatePayrollSheetMonthlyIncomeTax(480000, 210000, 0, 0, 0)).toBe(29833);
    });

    test('full gross annualization over-taxes vs payroll sheet rule', () => {
        const inflated = Math.round(calculateMonthlyIncomeTax(205988, 0, 20000, 0));
        expect(inflated).toBeGreaterThan(10000);
        expect(calculatePayrollSheetMonthlyIncomeTax(205988, 83442, 0, 20000, 0)).toBe(780);
    });

    test('legacy July alias matches durable function', () => {
        expect(calculateJuly2026WafiMonthlyIncomeTax(90100, 41214, 0, 0, 0))
            .toBe(calculatePayrollSheetMonthlyIncomeTax(90100, 41214, 0, 0, 0));
    });

    test('ASIL/PSO-056/25 — absence does not cut WHT below tax on contractual 55,000', () => {
        const prorated = Math.round(55000 * 30 / 31);
        expect(prorated).toBe(53226);
        expect(calculatePayrollSheetMonthlyIncomeTax(prorated, 0, 0, 0, 0)).toBe(32);
        expect(calculatePayrollSheetMonthlyIncomeTax(prorated, 0, 0, 0, 0, 55000)).toBe(50);
        expect(calculatePayrollSheetMonthlyIncomeTax(55000, 0, 0, 0, 0, 55000)).toBe(50);
    });
});
