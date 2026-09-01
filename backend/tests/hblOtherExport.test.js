'use strict';

const XLSX = require('xlsx');
const {
    HBL_OTHER_HEADERS,
    resolveBankCode,
    bankNameForFileRow,
    buildHblOtherRow,
    buildHblOtherXlsx,
} = require('../src/payroll/hblOtherExport');

describe('hblOtherExport IBFT Excel', () => {
    test('bank code comes from IBAN, with stored override', () => {
        expect(resolveBankCode({ bank_account: 'PK81MUCB0729601211002407', bank_name: 'MCB' })).toBe('062');
        expect(resolveBankCode({ bank_account: 'PK54MEZN0008070113450094', bank_name: 'Meezan Bank (038)' })).toBe('038');
        expect(resolveBankCode({ bank_account: '', bank_name: 'Allied Bank' })).toBe('014');
    });

    test('file bank name stays readable and flags code clashes', () => {
        expect(bankNameForFileRow({ bankCode: '062', account: 'PK81MUCB0729601211002407' })).toBe('MCB');
        expect(bankNameForFileRow({ bankCode: '038', account: 'PK54MEZN0008070113450094' })).toBe('Meezan Bank (038)');
        expect(bankNameForFileRow({ bankCode: '023', account: 'PK53BAHL0055008100634001' })).toBe('Bank Al Habib');
    });

    test('xlsx sheet and headers match the portal other-bank file', () => {
        const row = buildHblOtherRow({
            id: 'ASIL/SPL-205/21',
            name: 'Muhammad Usman',
            bank_account: 'PK81MUCB0729601211002407',
            bank_name: 'MCB',
            primary_contact: '0344-4052413',
            email: 'usmancheena76047@gmail.com',
            account_title: 'Muhammad Usman',
        }, 62689, 'Aug', '26');
        expect(row['Customer Reference No']).toBe('ASIL/SPL-205/21 - Aug-26');
        expect(row['Bank Code']).toBe('062');
        expect(row['Beneficary Contact No']).toBe('03444052413');
        expect(row['Pupose of Payment']).toBe('012');
        expect(row['Reference  3']).toBe('');

        const buf = buildHblOtherXlsx([row]);
        const wb = XLSX.read(buf, { type: 'buffer', raw: true });
        expect(wb.SheetNames).toEqual(['Interbank Funds Transfer']);
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets['Interbank Funds Transfer'], { header: 1, raw: true });
        expect(aoa[0]).toEqual(HBL_OTHER_HEADERS);
        expect(aoa[1][4]).toBe('062');
        expect(aoa[1][2]).toBe(62689);
    });
});
