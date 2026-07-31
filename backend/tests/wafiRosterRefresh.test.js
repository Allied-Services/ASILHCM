'use strict';

const { isNamedEmail } = require('../src/modules/wafiClaims/approvalService');

describe('wafiRosterRefresh routing fields', () => {
    test('isNamedEmail rejects N/A', () => {
        expect(isNamedEmail('N/A')).toBe(false);
        expect(isNamedEmail('user@wafi.com')).toBe(true);
    });
});

describe('wafi roster delta flags', () => {
    const { compareRow } = require('../src/modules/employees/wafiRosterRefresh');

    test('salary delta flagged HIGH_DELTA above 5%', () => {
        const { deltas } = compareRow(
            { id: 'ASIL-1', salary: 100000 },
            { id: 'ASIL-1', salary: 110000 }
        );
        expect(deltas.some(d => d.field === 'salary' && d.flag === 'HIGH_DELTA')).toBe(true);
    });
});
