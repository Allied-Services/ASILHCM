'use strict';

/**
 * Payroll Sheet "Full Payroll" check file.
 * Includes calculated rows whether or not the month is locked, as an Excel
 * table (filter arrows, freeze, number formats) so operators can review
 * the sheet before lock. Bank files stay locked-only.
 */

const ExcelJS = require('exceljs');

const TEXT_HEADERS = new Set([
    'Status',
    'Month',
    'Employee ID',
    'Name',
    'CNIC',
    'Contract',
    'Location',
    'Province',
    'EOSB Scheme',
]);

const QTY_HEADERS = new Set([
    'Paid Days',
    'OT @2X Hrs',
    'OT @3X Hrs',
]);

const WIDTHS = {
    Status: 12,
    Month: 16,
    'Employee ID': 22,
    Name: 28,
    CNIC: 20,
    Contract: 32,
    Location: 22,
    Province: 16,
    'EOSB Scheme': 18,
    'Paid Days': 12,
    'OT @2X Hrs': 13,
    'OT @3X Hrs': 13,
    'Net Pay to Employee': 20,
    'Total Invoice Amount': 20,
    'Total Employer Cost': 20,
    'Overhead (Fixed per Contract)': 28,
    'Bonus Accrual (Monthly)': 22,
    'PF Employer Contribution': 24,
    'PF Employee Deduction': 22,
    'Income Tax (WHT)': 16,
    'Bonus Disbursement': 20,
};

/** Saved payroll rows in the current filter, locked or still draft. */
function employeesForPayrollCheck(filteredEmps, payByEmployeeId) {
    const pay = payByEmployeeId || {};
    return (filteredEmps || []).filter((emp) => emp && emp.id && pay[emp.id]);
}

function isMoneyHeader(name) {
    return !TEXT_HEADERS.has(name) && !QTY_HEADERS.has(name);
}

function cellValue(header, raw) {
    if (TEXT_HEADERS.has(header)) return raw == null ? '' : String(raw);
    const n = Number(raw);
    if (raw == null || raw === '' || Number.isNaN(n)) return 0;
    return n;
}

function scopeLine(rows, { monthLabel, scope }) {
    const locked = rows.filter((r) => r.Status === 'Locked').length;
    const draft = rows.length - locked;
    const where = scope && String(scope).trim() ? String(scope).trim() : 'All clients';
    return `${monthLabel || ''} · ${where} · ${rows.length} people · ${locked} locked, ${draft} draft · Use the filter arrows · Draft rows are for checking, not for the bank`;
}

/**
 * @param {Array<Record<string, unknown>>} rows flat export rows; first row's keys are the columns
 * @param {{ monthLabel?: string, scope?: string }} meta
 * @returns {Promise<Buffer>}
 */
async function buildPayrollCheckXlsx(rows, meta = {}) {
    if (!rows || !rows.length) {
        throw new Error('buildPayrollCheckXlsx requires at least one row');
    }
    const headers = Object.keys(rows[0]);
    const colCount = headers.length;
    const headerRow = 4;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ASIL HCM';
    wb.created = new Date();
    wb.title = `Payroll check ${meta.monthLabel || ''}`.trim();

    const ws = wb.addWorksheet('Payroll', {
        views: [{
            state: 'frozen',
            xSplit: 4,
            ySplit: headerRow,
            topLeftCell: 'E5',
            activeCell: 'A5',
            showGridLines: false,
        }],
        pageSetup: {
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            paperSize: 9,
            horizontalCentered: false,
        },
        headerFooter: {
            oddFooter: '&LASIL HCM payroll check&CPage &P of &N&RNot a bank file',
        },
        properties: { tabColor: { argb: 'FF1D4ED8' } },
    });
    ws.pageSetup.printTitlesRow = '4:4';
    ws.autoFilter = undefined;

    ws.mergeCells(1, 1, 1, colCount);
    const title = ws.getCell(1, 1);
    title.value = `ASIL HCM — Payroll check — ${meta.monthLabel || ''}`.trim();
    title.font = { bold: true, size: 16, color: { argb: 'FF0F172A' }, name: 'Calibri' };
    title.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, colCount);
    const sub = ws.getCell(2, 1);
    sub.value = scopeLine(rows, meta);
    sub.font = { size: 11, color: { argb: 'FF334155' }, name: 'Calibri' };
    sub.alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(2).height = 32;

    ws.getRow(3).height = 8;

    const tableRows = rows.map((row) => headers.map((h) => cellValue(h, row[h])));
    const columns = headers.map((name, i) => {
        const col = { name, filterButton: true };
        if (i === 0) col.totalsRowLabel = 'Total';
        else if (isMoneyHeader(name) || QTY_HEADERS.has(name)) col.totalsRowFunction = 'sum';
        return col;
    });

    ws.addTable({
        name: 'PayrollCheck',
        ref: 'A4',
        headerRow: true,
        totalsRow: true,
        style: {
            theme: 'TableStyleMedium2',
            showRowStripes: true,
        },
        columns,
        rows: tableRows,
    });

    headers.forEach((name, i) => {
        const col = ws.getColumn(i + 1);
        col.width = WIDTHS[name] || (isMoneyHeader(name) ? 16 : 14);
        const fmt = QTY_HEADERS.has(name) ? '#,##0.00' : (isMoneyHeader(name) ? '#,##0' : '@');
        const first = headerRow + 1;
        const last = headerRow + rows.length;
        for (let r = first; r <= last; r++) {
            const cell = ws.getCell(r, i + 1);
            cell.numFmt = fmt;
            if (TEXT_HEADERS.has(name)) {
                cell.alignment = { vertical: 'middle', horizontal: 'left' };
            } else {
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            }
        }
        const totalCell = ws.getCell(last + 1, i + 1);
        if (isMoneyHeader(name)) totalCell.numFmt = '#,##0';
        else if (QTY_HEADERS.has(name)) totalCell.numFmt = '#,##0.00';
    });

    const header = ws.getRow(headerRow);
    header.height = 32;
    header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };

    ws.eachRow((row) => {
        row.eachCell((cell) => {
            if (!cell.font || !cell.font.name) {
                cell.font = { ...(cell.font || {}), name: 'Calibri', size: cell.font?.size || 11 };
            }
        });
    });

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
}

module.exports = {
    employeesForPayrollCheck,
    buildPayrollCheckXlsx,
};
