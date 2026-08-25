'use strict';

const {
    isWafi3pRow,
    mapContactRow,
    compareContactRow,
} = require('../src/modules/employees/wafiContactUpdate');

describe('wafi 3P contact mapping', () => {
    test('Wafi BPO is 3P; FM contracts are not', () => {
        expect(isWafi3pRow({
            'CLIENT NAME': 'Wafi Energy Pakistan Pvt Ltd',
            'Contract Name': 'Wafi BPO',
        })).toBe(true);
        expect(isWafi3pRow({
            'CLIENT NAME': 'Wafi Energy Pakistan Pvt Ltd',
            'Contract Name': 'Facility Management',
        })).toBe(false);
        expect(isWafi3pRow({
            'ASIL Employee Code': 'ASIL/SPL-174/21',
            'Primary Contact': '0321-1476170',
        })).toBe(true);
        expect(isWafi3pRow({
            'ASIL Employee Code': 'ASILFM/SPL/22/23',
            'Primary Contact': '0300-0000000',
        })).toBe(false);
    });

    test('stores personal email and focal; skips dash phones as leave-as-is', () => {
        const mapped = mapContactRow({
            'ASIL Employee Code': 'ASIL/SPL-220/21',
            'Primary Contact': '0333-2293348',
            'Emergency Contact': '-',
            'Personal Email Address': 'hussandad@gmail.com',
            'Official Email Address': 'Akhtar.Ali@wafi-energy.com',
            'Line Manager(Wafi) Name': 'N/A',
            'Line Manager(Wafi) Email': 'N/A',
            'Focal/ Supervisor Email': 'Akhtar.Ali@wafi-energy.com',
        });
        expect(mapped.email).toBe('hussandad@gmail.com');
        expect(mapped.primary_contact).toBe('0333-2293348');
        expect(mapped.emergency_contact).toBeUndefined();
        expect(mapped.line_manager_name).toBe(null);
        expect(mapped.line_manager_email).toBe(null);
        expect(mapped.claim_authority).toBe('Akhtar.Ali@wafi-energy.com');
        expect(mapped.supervisor_email).toBe(null);
    });

    test('clears employee email when official is the focal inbox', () => {
        const mapped = mapContactRow({
            'ASIL Employee Code': 'ASIL/SPL-180/21',
            'Primary Contact': '0306-6680457',
            'Emergency Contact': '03227271862',
            'Personal Email Address': '-',
            'Official Email Address': 'Akhtar.Ali@wafi-energy.com',
            'Line Manager(Wafi) Name': '-',
            'Line Manager(Wafi) Email': '-',
            'Focal/ Supervisor Email': 'Akhtar.Ali@wafi-energy.com',
        });
        expect(mapped.email).toBe(null);
        expect(mapped.claim_authority).toBe('Akhtar.Ali@wafi-energy.com');
        expect(mapped.line_manager_email).toBe(null);
    });

    test('skips emergency when it is the same number as primary', () => {
        const mapped = mapContactRow({
            'ASIL Employee Code': 'ASIL/SPL-174/21',
            'Primary Contact': '0321-1476170',
            'Emergency Contact': '03211476170',
        });
        expect(mapped.primary_contact).toBe('0321-1476170');
        expect(mapped.emergency_contact).toBeUndefined();
    });

    test('compareContactRow reports email clear and phone update', () => {
        const deltas = compareContactRow(
            {
                id: 'ASIL/SPL-1',
                email: 'Akhtar.Ali@wafi-energy.com',
                primary_contact: '0300-0000000',
                claim_authority: null,
            },
            {
                id: 'ASIL/SPL-1',
                email: null,
                primary_contact: '0333-2293348',
                claim_authority: 'Akhtar.Ali@wafi-energy.com',
            }
        );
        expect(deltas.map((d) => d.field).sort()).toEqual([
            'claim_authority',
            'email',
            'primary_contact',
        ]);
    });
});
