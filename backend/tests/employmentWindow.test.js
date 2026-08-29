'use strict';

const { paidDaysFromEmploymentWindow, toYmd } = require('../src/payroll/prSheetEngine');

describe('paidDaysFromEmploymentWindow', () => {
    test('Shayan LWD 8 Aug 2026 → 8 days', () => {
        expect(paidDaysFromEmploymentWindow(2026, 8, '2023-08-21', '2026-08-08')).toBe(8);
    });

    test('Mehrooz LWD 13 Aug 2026 → 13 days', () => {
        expect(paidDaysFromEmploymentWindow(2026, 8, '2022-01-01', '2026-08-13')).toBe(13);
    });

    test('Shahzad DOJ 17 Aug 2026 → 15 days', () => {
        expect(paidDaysFromEmploymentWindow(2026, 8, '2026-08-17', null)).toBe(15);
    });

    test('full August with no LWD → 31 days', () => {
        expect(paidDaysFromEmploymentWindow(2026, 8, '2021-08-01', null)).toBe(31);
    });

    test('left in July → 0 August days', () => {
        expect(paidDaysFromEmploymentWindow(2026, 8, '2021-08-01', '2026-07-12')).toBe(0);
    });

    test('repairs 0026-08-03 join dates to 2026-08-03', () => {
        expect(toYmd('0026-08-03')).toBe('2026-08-03');
        expect(paidDaysFromEmploymentWindow(2026, 8, '0026-08-03', null)).toBe(29);
    });
});
