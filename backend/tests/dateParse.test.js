'use strict';

const {
    parseDateOrNull,
    parseDobOrNull,
    parseExpiryOrNull,
    expandYear,
} = require('../src/core/dateParse');
const { toDateOrNull } = require('../src/modules/employees/masterRoster');

describe('dateParse', () => {
    test('expiry 16-Aug-32 → 2032-08-16', () => {
        expect(parseExpiryOrNull('16-Aug-32')).toBe('2032-08-16');
        expect(toDateOrNull('16-Aug-32', 'cnic_expiry')).toBe('2032-08-16');
    });

    test('DOB 15-Mar-93 → 1993-03-15', () => {
        expect(parseDobOrNull('15-Mar-93')).toBe('1993-03-15');
        expect(toDateOrNull('15-Mar-93', 'dob')).toBe('1993-03-15');
    });

    test('DOB with YY>30 maps to 1900s', () => {
        expect(expandYear(45, 'dob')).toBe(1945);
        expect(parseDobOrNull('01-Jan-45')).toBe('1945-01-01');
    });

    test('N/A and blank → null', () => {
        expect(parseDateOrNull('N/A')).toBeNull();
        expect(parseDateOrNull('')).toBeNull();
        expect(toDateOrNull('n/a', 'cnic_expiry')).toBeNull();
    });

    test('ISO passthrough', () => {
        expect(parseDateOrNull('2032-08-16')).toBe('2032-08-16');
    });

    test('gate_pass_expiry uses expiry rule', () => {
        expect(toDateOrNull('01-Dec-30', 'gate_pass_expiry')).toBe('2030-12-01');
    });
});
