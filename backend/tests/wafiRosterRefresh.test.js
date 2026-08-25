'use strict';

const { isNamedEmail } = require('../src/modules/wafiClaims/approvalService');

describe('wafiRosterRefresh routing fields', () => {
    test('isNamedEmail rejects N/A', () => {
        expect(isNamedEmail('N/A')).toBe(false);
        expect(isNamedEmail('user@wafi.com')).toBe(true);
    });
});

describe('wafi roster email mapping', () => {
    const { resolveEmail, mapCsvRowToDb } = require('../src/modules/employees/wafiRosterRefresh');

    test('prefers personal email over official', () => {
        expect(resolveEmail({
            'Personal Email Address': 'emp@gmail.com',
            'Official Email Address': 'Akhtar.Ali@wafi-energy.com',
            'Focal/ Supervisor Email': 'Akhtar.Ali@wafi-energy.com',
        })).toBe('emp@gmail.com');
    });

    test('does not store official when it is the focal inbox', () => {
        expect(resolveEmail({
            'Personal Email Address': '-',
            'Official Email Address': 'Akhtar.Ali@wafi-energy.com',
            'Focal/ Supervisor Email': 'Akhtar.Ali@wafi-energy.com',
        })).toBe(null);
        const mapped = mapCsvRowToDb({
            'ASIL Employee Code': 'ASIL/SPL-1/21',
            'Personal Email Address': '-',
            'Official Email Address': 'Akhtar.Ali@wafi-energy.com',
            'Focal/ Supervisor Email': 'Akhtar.Ali@wafi-energy.com',
        });
        expect(mapped.email).toBe(null);
        expect(mapped.claim_authority).toBe('Akhtar.Ali@wafi-energy.com');
        expect(mapped.supervisor_email).toBe(null);
    });

    test('keeps a distinct official work mailbox', () => {
        expect(resolveEmail({
            'Personal Email Address': '',
            'Official Email Address': 'emp@wafi-energy.com',
            'Focal/ Supervisor Email': 'focal@wafi-energy.com',
        })).toBe('emp@wafi-energy.com');
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
