'use strict';

/**
 * Payroll Sheet HBL → Other Banks (IBFT) export.
 * Column order and sheet name match "Other Bank File for Portal" Excel (not CSV).
 */

const XLSX = require('xlsx');
const { exportPhone, exportEmail, txnRefNo, isHblSameBank } = require('./hblSameExport');

const HBL_OTHER_HEADERS = [
    'Beneficiary Name',
    'Beneficiary Account Number',
    'Transaction Amount',
    'Customer Reference No',
    'Bank Code',
    'Beneficary Contact No',
    'Beneficiary Email Address',
    'Pupose of Payment',
    'Reference  3',
    'Invoice Number',
    'Account Title',
];

const IBAN_TO_CODE = {
    MUCB: '062',
    SCBL: '038',
    MPBL: '064',
    FAYS: '060',
    ABPA: '014',
    MEZN: '089',
    ALFH: '053',
    SAMB: '028',
    UNIL: '086',
    MCIB: '097',
    BAHL: '023',
    ASCM: '017',
    JSBL: '018',
    BKIP: '021',
};

const CODE_TO_NAME = {
    '062': 'MCB',
    '038': 'Standard Chartered',
    '064': 'Habib Metro',
    '060': 'Faysal Bank',
    '014': 'Allied Bank',
    '089': 'Meezan Bank',
    '053': 'Bank Alfalah',
    '028': 'Samba Bank',
    '086': 'UBL',
    '097': 'MCB Islamic',
    '023': 'Bank Al Habib',
    '017': 'Askari Bank',
    '018': 'JS Bank',
    '021': 'BankIslami',
};

const IBAN_TO_NAME = {
    MUCB: 'MCB',
    SCBL: 'Standard Chartered',
    MPBL: 'Habib Metro',
    FAYS: 'Faysal Bank',
    ABPA: 'Allied Bank',
    MEZN: 'Meezan Bank',
    ALFH: 'Bank Alfalah',
    SAMB: 'Samba Bank',
    UNIL: 'UBL',
    MCIB: 'MCB Islamic',
    BAHL: 'Bank Al Habib',
    ASCM: 'Askari Bank',
    JSBL: 'JS Bank',
    BKIP: 'BankIslami',
};

const NAME_TO_CODE = {
    mcb: '062',
    standardchartered: '038',
    scb: '038',
    habibmetro: '064',
    habibmetropolitan: '064',
    faysal: '060',
    faysalbank: '060',
    alliedbank: '014',
    abl: '014',
    meezanbank: '089',
    meezan: '089',
    bankalfalah: '053',
    alfalah: '053',
    sambabank: '028',
    samba: '028',
    ubl: '086',
    unitedbank: '086',
    mcbislamic: '097',
    bankalhabib: '023',
    alhabib: '023',
    askari: '017',
    askaribank: '017',
    jsbank: '018',
    js: '018',
    bankislami: '021',
};

function ibanBank(account) {
    const a = String(account || '').replace(/\s+/g, '').toUpperCase();
    if (a.startsWith('PK') && a.length >= 8) return a.slice(4, 8);
    return '';
}

function compactName(bankName) {
    return String(bankName || '').toLowerCase().replace(/\(\d{3}\)\s*$/, '').replace(/[\s.\-_/]/g, '');
}

function storedBankCode(bankName) {
    const m = String(bankName || '').match(/\((\d{3})\)\s*$/);
    return m ? m[1] : '';
}

function resolveBankCode(emp) {
    const stored = storedBankCode(emp.bank_name || emp.bankName);
    if (stored) return stored;
    const fromIban = IBAN_TO_CODE[ibanBank(emp.bank_account || emp.bankAccount)];
    if (fromIban) return fromIban;
    return NAME_TO_CODE[compactName(emp.bank_name || emp.bankName)] || '';
}

function bankNameForFileRow({ bankCode, account, ibanOverride }) {
    const pref = ibanOverride || ibanBank(account);
    const code = String(bankCode || '').padStart(3, '0');
    const fromIban = IBAN_TO_NAME[pref];
    const fromCode = CODE_TO_NAME[code];
    const name = fromIban || fromCode || 'Other Bank';
    const defaultCode = IBAN_TO_CODE[pref] || '';
    if (code && defaultCode && code !== defaultCode) return `${name} (${code})`;
    return name;
}

function buildHblOtherRow(emp, netPay, monthAbbr, yr2) {
    return {
        'Beneficiary Name': emp.name || '',
        'Beneficiary Account Number': String(emp.bank_account || emp.bankAccount || '').replace(/\s+/g, ''),
        'Transaction Amount': Math.round(parseFloat(netPay) || 0),
        'Customer Reference No': txnRefNo(emp.id, monthAbbr, yr2),
        'Bank Code': resolveBankCode(emp),
        'Beneficary Contact No': exportPhone(emp.primary_contact || emp.primaryContact || ''),
        'Beneficiary Email Address': exportEmail(emp.email),
        'Pupose of Payment': '012',
        'Reference  3': '',
        'Invoice Number': '',
        'Account Title': emp.account_title || emp.accountTitle || emp.name || '',
    };
}

function buildHblOtherXlsx(rows) {
    const aoa = [
        HBL_OTHER_HEADERS,
        ...rows.map((r) => HBL_OTHER_HEADERS.map((h) => r[h] ?? '')),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const textCols = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10];
    for (let R = 1; R < aoa.length; R++) {
        for (const C of textCols) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[addr];
            if (!cell) continue;
            cell.t = 's';
            cell.v = String(cell.v ?? '');
            cell.z = '@';
        }
        const amtAddr = XLSX.utils.encode_cell({ r: R, c: 2 });
        if (ws[amtAddr]) {
            ws[amtAddr].t = 'n';
            ws[amtAddr].v = Number(ws[amtAddr].v) || 0;
        }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Interbank Funds Transfer');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    HBL_OTHER_HEADERS,
    IBAN_TO_CODE,
    CODE_TO_NAME,
    ibanBank,
    resolveBankCode,
    bankNameForFileRow,
    buildHblOtherRow,
    buildHblOtherXlsx,
    isHblSameBank,
};
