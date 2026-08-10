'use strict';

const {
    calculateJuly2026WafiMonthlyIncomeTax,
    calculateMonthlyIncomeTax,
} = require('../taxEngine');

describe('July 2026 Wafi BPO WHT parity', () => {
    test('SPL-208 — bonus excluded from WHT base → zero tax', () => {
        expect(calculateJuly2026WafiMonthlyIncomeTax(90100, 41214, 0, 0, 0)).toBe(0);
    });

    test('SPL-91 — bonus and reimbursement excluded → 780 tax', () => {
        expect(calculateJuly2026WafiMonthlyIncomeTax(205988, 83442, 0, 20000, 0)).toBe(780);
    });

    test('SPL-19 — high earner, bonus excluded from annualization', () => {
        expect(calculateJuly2026WafiMonthlyIncomeTax(480000, 210000, 0, 0, 0)).toBe(29833);
    });

    test('full gross annualization over-taxes vs July rule', () => {
        const inflated = Math.round(calculateMonthlyIncomeTax(205988, 0, 20000, 0));
        expect(inflated).toBeGreaterThan(10000);
        expect(calculateJuly2026WafiMonthlyIncomeTax(205988, 83442, 0, 20000, 0)).toBe(780);
    });
});
