'use strict';

const XLSX = require('xlsx');
const { parseConfigValue } = require('../../core/jsonConfig');
const { DEFAULT_HBL_EXPORT_COLUMNS } = require('./config');

function padRef(prefix, index) {
    return `${prefix}${String(index + 1).padStart(4, '0')}`;
}

function buildHblRow(bill, variant, periodLabel, index) {
    const amount = Math.round(parseFloat(bill.total || bill.amount || 0));
    const ref = padRef(periodLabel || 'BL-', index);
    const vendor = bill.vendor || bill.xero_contact_name || '';
    const account = bill.vendor_bank_account || '';
    const invoiceNo = bill.invoice_no || bill.id || '';

    if (variant === 'hbl_other') {
        return {
            'Beneficiary Name': vendor,
            'Beneficiary Account Number': account,
            'Transaction Amount': amount,
            'Customer Reference No': ref,
            'Bank Code': bill.vendor_bank_code || '',
            'Beneficary Contact No': bill.vendor_contact || '',
            'Beneficiary Email Address': bill.vendor_email || '',
            'Pupose of Payment': '012',
            'Reference # 3': invoiceNo,
            'Invoice Number': invoiceNo,
            'Account Title': bill.vendor_bank_name || vendor,
        };
    }

    return {
        'Beneficiary\u00a0Name': vendor,
        'Beneficiary Account Number': account,
        'Transaction Amount': amount,
        'Customer Reference Number': ref,
        'Contact Number': bill.vendor_contact || '',
        'Beneficiary Email Address': bill.vendor_email || '',
        'Purpose of Payment': '012',
        'Inovice Number': invoiceNo,
        'Account Title': bill.vendor_bank_name || vendor,
    };
}

async function getHblColumns(pool, variant) {
    const { rows } = await pool.query(`SELECT value FROM system_config WHERE key = 'hbl_export_columns'`);
    if (rows.length) {
        const cfg = parseConfigValue(rows[0].value);
        if (cfg?.[variant]?.length) return cfg[variant];
    }
    return DEFAULT_HBL_EXPORT_COLUMNS[variant] || DEFAULT_HBL_EXPORT_COLUMNS.hbl_same;
}

function buildHblWorkbook(bills, variant, columns, periodLabel) {
    const rows = bills.map((b, i) => {
        const row = buildHblRow(b, variant, periodLabel, i);
        const ordered = {};
        for (const col of columns) ordered[col] = row[col] ?? '';
        return ordered;
    });
    const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payments');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    buildHblRow,
    buildHblWorkbook,
    getHblColumns,
    padRef,
};
