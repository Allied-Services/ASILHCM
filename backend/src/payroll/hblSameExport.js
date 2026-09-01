'use strict';

/**
 * Payroll Sheet HBL → HBL export.
 * Column order and sheet name match HBL Checker File Summary (Excel, not CSV):
 * TXNREFNO, BENEFNAME, BENECELL, BENEEMAIL, TRANS_AMT, BENEACNO, BENEACCTITLE, TITLESTATUS
 */

const XLSX = require('xlsx');
const { firstValidPkMobile, normalisePhone } = require('../../lib/sms');

/** True HBL / Habib Bank Limited only — not Bank Al Habib or Habib Metro. */
function isHblSameBank(bankName) {
    const compact = String(bankName || '').toLowerCase().replace(/[\s.\-_/]/g, '');
    if (!compact) return false;
    if (compact.includes('alhabib') || compact.includes('bankalhabib')) return false;
    if (compact.includes('habibmetro') || compact.includes('metropolitan')) return false;
    if (compact.includes('hbl')) return true;
    if (compact.includes('habibbank') || compact === 'habib') return true;
    return false;
}

const HBL_SAME_HEADERS = [
    'TXNREFNO',
    'BENEFNAME',
    'BENECELL',
    'BENEEMAIL',
    'TRANS_AMT',
    'BENEACNO',
    'BENEACCTITLE',
    'TITLESTATUS',
];

function exportPhone(raw) {
    const mobile = firstValidPkMobile(raw);
    if (mobile) return mobile;
    return normalisePhone(raw);
}

function exportEmail(raw) {
    const email = String(raw || '').replace(/[\t\r]/g, '').trim();
    if (!email) return '';
    const lower = email.toLowerCase();
    if (lower === 'n/a' || lower === 'na' || lower === 'none' || !email.includes('@')) return '';
    return email;
}

function txnRefNo(employeeId, monthAbbr, yr2) {
    return `${employeeId} - ${monthAbbr}-${yr2}`;
}

function buildHblSameCheckerRow(emp, netPay, monthAbbr, yr2) {
    return {
        TXNREFNO: txnRefNo(emp.id, monthAbbr, yr2),
        BENEFNAME: emp.name || '',
        BENECELL: exportPhone(emp.primary_contact || emp.primaryContact || ''),
        BENEEMAIL: exportEmail(emp.email),
        TRANS_AMT: Math.round(parseFloat(netPay) || 0),
        BENEACNO: String(emp.bank_account || emp.bankAccount || '').replace(/\s+/g, ''),
        BENEACCTITLE: emp.account_title || emp.accountTitle || emp.name || '',
        TITLESTATUS: '',
    };
}

function buildHblSameCheckerXlsx(rows) {
    const aoa = [
        HBL_SAME_HEADERS,
        ...rows.map((r) => HBL_SAME_HEADERS.map((h) => r[h] ?? '')),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const textCols = [0, 1, 2, 3, 5, 6, 7];
    for (let R = 1; R < aoa.length; R++) {
        for (const C of textCols) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[addr];
            if (!cell) continue;
            cell.t = 's';
            cell.v = String(cell.v ?? '');
            cell.z = '@';
        }
        const amtAddr = XLSX.utils.encode_cell({ r: R, c: 4 });
        if (ws[amtAddr]) {
            ws[amtAddr].t = 'n';
            ws[amtAddr].v = Number(ws[amtAddr].v) || 0;
        }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'data');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    HBL_SAME_HEADERS,
    isHblSameBank,
    exportPhone,
    exportEmail,
    txnRefNo,
    buildHblSameCheckerRow,
    buildHblSameCheckerXlsx,
};
