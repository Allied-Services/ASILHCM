'use strict';

const {
    normalizeActiveValue,
    isEmployeeActive,
} = require('../src/core/employeeActive');

describe('employeeActive', () => {
    test('normalizeActiveValue maps common import variants', () => {
        expect(normalizeActiveValue('YES')).toBe('Yes');
        expect(normalizeActiveValue('yes')).toBe('Yes');
        expect(normalizeActiveValue('Yes')).toBe('Yes');
        expect(normalizeActiveValue('true')).toBe('Yes');
        expect(normalizeActiveValue('1')).toBe('Yes');
        expect(normalizeActiveValue('active')).toBe('Yes');
        expect(normalizeActiveValue('NO')).toBe('No');
        expect(normalizeActiveValue('no')).toBe('No');
        expect(normalizeActiveValue('false')).toBe('No');
        expect(normalizeActiveValue(null)).toBe('Yes');
        expect(normalizeActiveValue('')).toBe('Yes');
    });

    test('isEmployeeActive matches backend payroll filter', () => {
        expect(isEmployeeActive('YES')).toBe(true);
        expect(isEmployeeActive('Yes')).toBe(true);
        expect(isEmployeeActive(null)).toBe(true);
        expect(isEmployeeActive('No')).toBe(false);
        expect(isEmployeeActive('NO')).toBe(false);
        expect(isEmployeeActive('inactive')).toBe(false);
    });
});
