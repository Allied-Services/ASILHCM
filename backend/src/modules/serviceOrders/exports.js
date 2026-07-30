'use strict';

const ExcelJS = require('exceljs');
const { getPayrollRuns } = require('../payrollrun/service');
const { computeInvoicesAllSites } = require('./bulkOps');
const { listServiceOrders } = require('./crud');

function styleHeader(row) {
    row.font = { bold: true, color: { argb: 'FFE8EEF7' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2332' } };
    row.alignment = { vertical: 'middle' };
}

function money(n) {
    return n == null || Number.isNaN(Number(n)) ? null : Math.round(Number(n) * 100) / 100;
}

async function buildPayrollWorkbook(pool, { contractId, month, year }) {
    const data = await getPayrollRuns(pool, { contractId, month, year });
    const rows = data.rows || [];
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ASIL HCM';
    wb.created = new Date();

    const detail = wb.addWorksheet('Payroll Detail');
    detail.columns = [
        { header: 'Staff code', key: 'id', width: 18 },
        { header: 'Name', key: 'name', width: 28 },
        { header: 'Site', key: 'site', width: 14 },
        { header: 'Designation', key: 'desig', width: 28 },
        { header: 'Present', key: 'present', width: 10 },
        { header: 'Absent', key: 'absent', width: 10 },
        { header: 'Basic', key: 'basic', width: 12 },
        { header: 'Wages earned', key: 'wages', width: 14 },
        { header: 'EOBI EE', key: 'eobi', width: 10 },
        { header: 'SESSI ER', key: 'sessi', width: 10 },
        { header: 'Tax', key: 'tax', width: 10 },
        { header: 'Life ins.', key: 'life', width: 10 },
        { header: 'Gross', key: 'gross', width: 12 },
        { header: 'Net', key: 'net', width: 12 },
        { header: 'Source', key: 'source', width: 16 },
    ];
    styleHeader(detail.getRow(1));

    const bySite = new Map();
    for (const r of rows) {
        const c = r.computed || {};
        const present = r.inputs?.present_days ?? r.paid_days;
        const absent = r.inputs?.absent_days ?? r.computed?.modelA?.absentDays;
        detail.addRow({
            id: r.employee_id,
            name: r.employee_name,
            site: r.site || r.location || '',
            desig: r.designation || '',
            present: present != null ? Number(present) : null,
            absent: absent != null ? Number(absent) : null,
            basic: money(r.basic_salary ?? c.newSalary),
            wages: money(c.salaryForDays),
            eobi: money(c.eobiEmployee),
            sessi: money(c.sessiEmployer),
            tax: money(c.wht),
            life: money(c.lifeInsurance),
            gross: money(c.gross),
            net: money(c.netPay),
            source: r.source || r.inputs?.source || '',
        });
        const site = String(r.site || 'UNKNOWN').toUpperCase();
        if (!bySite.has(site)) {
            bySite.set(site, {
                site, headcount: 0, wages: 0, eobi: 0, sessi: 0, tax: 0, life: 0, net: 0, gross: 0,
            });
        }
        const s = bySite.get(site);
        s.headcount += 1;
        s.wages += Number(c.salaryForDays || 0);
        s.eobi += Number(c.eobiEmployee || 0);
        s.sessi += Number(c.sessiEmployer || 0);
        s.tax += Number(c.wht || 0);
        s.life += Number(c.lifeInsurance || 0);
        s.net += Number(c.netPay || 0);
        s.gross += Number(c.gross || 0);
    }

    const summary = wb.addWorksheet('By Site');
    summary.columns = [
        { header: 'Site', key: 'site', width: 16 },
        { header: 'Headcount', key: 'headcount', width: 12 },
        { header: 'Wages', key: 'wages', width: 14 },
        { header: 'EOBI EE', key: 'eobi', width: 12 },
        { header: 'SESSI ER', key: 'sessi', width: 12 },
        { header: 'Tax', key: 'tax', width: 12 },
        { header: 'Life ins.', key: 'life', width: 12 },
        { header: 'Gross', key: 'gross', width: 14 },
        { header: 'Net', key: 'net', width: 14 },
    ];
    styleHeader(summary.getRow(1));
    const siteRows = [...bySite.values()].sort((a, b) => a.site.localeCompare(b.site));
    for (const s of siteRows) {
        summary.addRow({
            ...s,
            wages: money(s.wages),
            eobi: money(s.eobi),
            sessi: money(s.sessi),
            tax: money(s.tax),
            life: money(s.life),
            gross: money(s.gross),
            net: money(s.net),
        });
    }
    const tot = siteRows.reduce((a, s) => {
        a.headcount += s.headcount;
        a.wages += s.wages; a.eobi += s.eobi; a.sessi += s.sessi;
        a.tax += s.tax; a.life += s.life; a.gross += s.gross; a.net += s.net;
        return a;
    }, { headcount: 0, wages: 0, eobi: 0, sessi: 0, tax: 0, life: 0, gross: 0, net: 0 });
    const totRow = summary.addRow({
        site: 'CONTRACT TOTAL',
        headcount: tot.headcount,
        wages: money(tot.wages),
        eobi: money(tot.eobi),
        sessi: money(tot.sessi),
        tax: money(tot.tax),
        life: money(tot.life),
        gross: money(tot.gross),
        net: money(tot.net),
    });
    totRow.font = { bold: true };

    const bank = wb.addWorksheet('Bank file (format TBD)');
    bank.columns = [
        { header: 'Employee ID', key: 'id', width: 18 },
        { header: 'Employee Name', key: 'name', width: 28 },
        { header: 'Bank Name', key: 'bank', width: 18 },
        { header: 'Account Title', key: 'title', width: 28 },
        { header: 'Account Number', key: 'acct', width: 22 },
        { header: 'IBAN', key: 'iban', width: 28 },
        { header: 'Net Pay', key: 'net', width: 14 },
        { header: 'Payment Ref', key: 'ref', width: 22 },
    ];
    styleHeader(bank.getRow(1));
    bank.getCell('A2').value = 'Bank file format TBD — columns prepared for future bank/Xero payment pack.';
    bank.mergeCells('A2:H2');
    for (const r of rows) {
        const c = r.computed || {};
        bank.addRow({
            id: r.employee_id,
            name: r.employee_name,
            bank: r.bank_name || '',
            title: r.account_title || r.employee_name || '',
            acct: r.account_number || '',
            iban: r.iban || '',
            net: money(c.netPay),
            ref: `PAY-${year}${String(month).padStart(2, '0')}-${r.employee_id}`,
        });
    }

    const meta = wb.addWorksheet('Run Meta');
    meta.addRow(['Contract', contractId]);
    meta.addRow(['Period', `${month}/${year}`]);
    meta.addRow(['Run ID', data.run?.id || '']);
    meta.addRow(['Status', data.run?.status || '']);
    meta.addRow(['Headcount', rows.length]);
    meta.addRow(['Generated', new Date().toISOString()]);

    return wb;
}

async function buildInvoiceWorkbook(pool, { contractId, month, year }) {
    const pack = await computeInvoicesAllSites(pool, { contractId, month, year });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ASIL HCM';

    const summary = wb.addWorksheet('Invoice Register');
    summary.columns = [
        { header: 'Site', key: 'site', width: 16 },
        { header: 'Site name', key: 'name', width: 28 },
        { header: 'Province', key: 'province', width: 12 },
        { header: 'Gross', key: 'gross', width: 14 },
        { header: 'Shortage (absences)', key: 'shortage', width: 18 },
        { header: 'Net taxable', key: 'net', width: 14 },
        { header: 'ST rate', key: 'rate', width: 10 },
        { header: 'Provincial ST', key: 'st', width: 14 },
        { header: 'Stamped grand', key: 'grand', width: 14 },
        { header: 'Income WHT (receivable)', key: 'wht', width: 18 },
        { header: 'ST WHT 20% (receivable)', key: 'stw', width: 18 },
        { header: 'Net receivable', key: 'recv', width: 14 },
    ];
    styleHeader(summary.getRow(1));
    for (const s of pack.sites) {
        summary.addRow({
            site: s.siteCode,
            name: s.siteName,
            province: s.province || '',
            gross: money(s.gross),
            shortage: money(s.totalDeductions),
            net: money(s.netTaxable),
            rate: s.taxRate,
            st: money(s.provincialSt),
            grand: money(s.grandTotal),
            wht: money(s.incomeWht),
            stw: money(s.stWithholding),
            recv: money(s.netReceivable),
        });
    }
    const t = pack.totals;
    const totRow = summary.addRow({
        site: 'ALL SITES',
        name: 'Contract total',
        province: '',
        gross: money(t.gross),
        shortage: money(t.shortage),
        net: money(t.gross - t.shortage),
        rate: '',
        st: money(t.salesTax),
        grand: money(t.grandTotal),
        wht: '',
        stw: '',
        recv: money(t.netReceivable),
    });
    totRow.font = { bold: true };

    const note = wb.addWorksheet('Methodology');
    note.getColumn(1).width = 100;
    note.addRow(['Fixed Value / Conservancy invoice methodology (aligned to Wafi portal + Conservancy Pro)']);
    note.addRow(['1. Gross = sum of service-order monthly line rates (qty=1 per period).']);
    note.addRow(['2. Shortage = Σ (resourceRate/30 × days_absent) from attendance ledger.']);
    note.addRow(['3. Net taxable = gross − shortage.']);
    note.addRow(['4. Provincial ST = net taxable × province rate (Punjab 16%, Sindh/KPK/Balochistan 15%).']);
    note.addRow(['5. Stamped grand = net taxable + provincial ST.']);
    note.addRow(['6. Income WHT and 20% ST withholding are receivable-only — NOT deducted from stamped grand.']);

    return wb;
}

async function workbookToBuffer(wb) {
    return wb.xlsx.writeBuffer();
}

module.exports = {
    buildPayrollWorkbook,
    buildInvoiceWorkbook,
    workbookToBuffer,
    listServiceOrders,
};
