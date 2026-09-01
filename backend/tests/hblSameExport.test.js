'use strict';

const XLSX = require('xlsx');
const {
    HBL_SAME_HEADERS,
    isHblSameBank,
    exportPhone,
    exportEmail,
    txnRefNo,
    buildHblSameCheckerRow,
    buildHblSameCheckerXlsx,
} = require('../src/payroll/hblSameExport');

describe('hblSameExport checker Excel', () => {
    test('isHblSameBank is HBL only, not Al Habib or Metro', () => {
        expect(isHblSameBank('HBL')).toBe(true);
        expect(isHblSameBank('Habib Bank')).toBe(true);
        expect(isHblSameBank('Habib Bank Limited')).toBe(true);
        expect(isHblSameBank('Bank Al Habib')).toBe(false);
        expect(isHblSameBank('Bank Al-Habib')).toBe(false);
        expect(isHblSameBank('Habib Metro')).toBe(false);
        expect(isHblSameBank('Habib Metroploittan')).toBe(false);
    });

    test('phones become 03XXXXXXXXX', () => {
        expect(exportPhone('0303-3519952')).toBe('03033519952');
        expect(exportPhone('923083074122')).toBe('03083074122');
        expect(exportPhone('3083074122')).toBe('03083074122');
        expect(exportPhone('0515505605')).toBe('0515505605');
    });

    test('emails drop N/A and keep real addresses', () => {
        expect(exportEmail('N/A')).toBe('');
        expect(exportEmail('  masihshahzad572@gmail.com\t')).toBe('masihshahzad572@gmail.com');
        expect(exportEmail('')).toBe('');
    });

    test('TXNREFNO matches HBL customer reference', () => {
        expect(txnRefNo('ASILFM/SPL/22/23', 'Aug', '26')).toBe('ASILFM/SPL/22/23 - Aug-26');
    });

    test('xlsx sheet is data with checker headers and text account numbers', () => {
        const row = buildHblSameCheckerRow({
            id: 'ASILFM/SPL/22/23',
            name: 'Amjad Shaikh',
            primary_contact: '0303-3519952',
            email: 'N/A',
            bank_account: '05627900214003',
            account_title: 'Amjad Shaikh',
        }, 44932, 'Aug', '26');
        expect(row.TXNREFNO).toBe('ASILFM/SPL/22/23 - Aug-26');
        expect(row.BENECELL).toBe('03033519952');
        expect(row.BENEEMAIL).toBe('');
        expect(row.BENEACNO).toBe('05627900214003');
        expect(row.TITLESTATUS).toBe('');

        const buf = buildHblSameCheckerXlsx([row]);
        const wb = XLSX.read(buf, { type: 'buffer', raw: true });
        expect(wb.SheetNames).toEqual(['data']);
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets.data, { header: 1, raw: true });
        expect(aoa[0]).toEqual(HBL_SAME_HEADERS);
        expect(String(aoa[1][5])).toBe('05627900214003');
        expect(aoa[1][4]).toBe(44932);
    });
});
