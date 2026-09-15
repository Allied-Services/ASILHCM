'use strict';

const {
    previousPeriod,
    isCarriedForwardArrears,
    stripCarriedForwardArrears,
    clearCarriedForwardArrears,
} = require('../src/payroll/oneTimePayCarryForward');

describe('oneTimePayCarryForward', () => {
    test('previousPeriod wraps January to December', () => {
        expect(previousPeriod(1, 2026)).toEqual({ month: 12, year: 2025 });
        expect(previousPeriod(8, 2026)).toEqual({ month: 7, year: 2026 });
    });

    test('same positive arrears as last month are treated as carry-forward', () => {
        expect(isCarriedForwardArrears(
            { arrears: '15161.00' },
            { arrears: 15161 },
        )).toBe(true);
        expect(isCarriedForwardArrears(
            { arrears: 3200 },
            { arrears: 0 },
        )).toBe(false);
        expect(isCarriedForwardArrears(
            { arrears: 0 },
            { arrears: 4548 },
        )).toBe(false);
    });

    test('strip zeros only the carried amount', () => {
        const stripped = stripCarriedForwardArrears(
            { arrears: 4548, other_deduction: 1290 },
            { arrears: 4548, other_deduction: 1290 },
        );
        expect(stripped.arrears).toBe(0);
        expect(stripped.other_deduction).toBe(1290);
    });

    test('clearCarriedForwardArrears updates only matching prior-month amounts', async () => {
        const calls = [];
        const pool = {
            query: async (sql, params) => {
                calls.push({ sql, params });
                return { rowCount: 2 };
            },
        };
        const result = await clearCarriedForwardArrears(pool, {
            employeeIds: ['A', 'B'],
            month: 8,
            year: 2026,
        });
        expect(result.cleared).toBe(2);
        expect(calls[0].params).toEqual([['A', 'B'], 8, 2026, 7, 2026]);
        expect(calls[0].sql).toMatch(/cur\.arrears = prev\.arrears/);
    });
});
