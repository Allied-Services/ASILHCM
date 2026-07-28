'use strict';

const { getPolicy } = require('../constraints/service');
const { provinceSalesTaxRate } = require('../../core/regionTax');
const { parseConfigValue } = require('../../core/jsonConfig');
const { getServiceOrder } = require('./crud');
const { siteProvince } = require('./sitesMeta');
const { renderInvoiceHtml } = require('./invoiceHtml');

const ST_WITHHOLDING_RATE = 0.20;

function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

async function listDeductions(pool, serviceOrderId, month, year) {
    const { rows } = await pool.query(
        `SELECT d.*, e.name AS employee_name, e.designation AS employee_designation
         FROM so_deductions d
         LEFT JOIN employees e ON e.id = d.employee_id
         WHERE d.service_order_id = $1 AND d.period_month = $2 AND d.period_year = $3
         ORDER BY d.id`,
        [serviceOrderId, month, year]
    );
    return rows;
}

async function addManualDeduction(pool, payload, actor) {
    const {
        service_order_id,
        period_month,
        period_year,
        type = 'manual',
        employee_id,
        days_absent,
        amount,
        line_id,
        note,
    } = payload;
    if (!service_order_id || !period_month || !period_year || amount == null) {
        const err = new Error('service_order_id, period_month, period_year, and amount are required');
        err.status = 400;
        throw err;
    }
    const { rows } = await pool.query(
        `INSERT INTO so_deductions
         (service_order_id, line_id, period_month, period_year, type, employee_id, days_absent, amount, source, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9)
         RETURNING *`,
        [
            service_order_id,
            line_id || null,
            period_month,
            period_year,
            type,
            employee_id || null,
            days_absent != null ? Number(days_absent) : null,
            round2(amount),
            actor || null,
        ]
    );
    return rows[0];
}

async function resolveTaxRate(pool, so, contract) {
    const meta = typeof so.meta === 'string' ? JSON.parse(so.meta || '{}') : (so.meta || {});
    if (meta.taxRate != null) return Number(meta.taxRate);
    const policy = await getPolicy(pool, contract.id);
    if (policy?.sales_tax_exempt) return 0;
    if (policy?.sales_tax_rate != null) return Number(policy.sales_tax_rate);
    const province = siteProvince(so.site_code) || contract.region_province;
    const { rows: taxCfg } = await pool.query(`SELECT value FROM system_config WHERE key = 'region_tax'`);
    const regionRatesRaw = taxCfg.length ? parseConfigValue(taxCfg[0].value) : [];
    return provinceSalesTaxRate(province, Array.isArray(regionRatesRaw) ? regionRatesRaw : []);
}

async function computeSoInvoice(pool, { serviceOrderId, month, year }) {
    const so = await getServiceOrder(pool, serviceOrderId);
    if (!so) {
        const err = new Error('Service order not found');
        err.status = 404;
        throw err;
    }

    const { rows: contractRows } = await pool.query(
        `SELECT c.*, cl.name AS client_name, cl.ntn, cl.strn
         FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE c.id = $1`,
        [so.contract_id]
    );
    const contract = contractRows[0];
    if (!contract) {
        const err = new Error('Contract not found');
        err.status = 404;
        throw err;
    }

    const policy = await getPolicy(pool, contract.id);
    const whtPct = Number(policy?.income_tax_wht_pct ?? contract.financials?.wht_pct ?? 15) / 100;

    const lines = so.lines || [];
    const grossLines = lines.map(l => {
        const qty = l.quantity != null ? Number(l.quantity) : 1;
        const rate = Number(l.rate || 0);
        return {
            lineId: l.id,
            description: l.name,
            quantity: qty,
            rate,
            amount: round2(rate * qty),
            isManpowerDependent: l.is_manpower_dependent,
            roles: l.roles || [],
        };
    });
    const gross = round2(grossLines.reduce((s, l) => s + l.amount, 0));

    const deductions = await listDeductions(pool, serviceOrderId, month, year);
    const totalDeductions = round2(deductions.reduce((s, d) => s + Number(d.amount || 0), 0));
    const netTaxable = round2(Math.max(0, gross - totalDeductions));

    const taxRate = await resolveTaxRate(pool, so, contract);
    const provincialSt = round2(netTaxable * taxRate);
    const grandTotal = round2(netTaxable + provincialSt);
    const incomeWht = round2(netTaxable * whtPct);
    const stWithholding = round2(provincialSt * ST_WITHHOLDING_RATE);
    const netReceivable = round2(grandTotal - incomeWht - stWithholding);

    return {
        serviceOrderId,
        siteCode: so.site_code,
        siteName: so.name,
        contractId: contract.id,
        contractName: contract.contract_name,
        clientName: contract.client_name,
        province: siteProvince(so.site_code),
        periodMonth: month,
        periodYear: year,
        lineItems: grossLines,
        deductions,
        gross,
        totalDeductions,
        netTaxable,
        taxRate,
        provincialSt,
        salesTax: provincialSt,
        subtotal: netTaxable,
        grandTotal,
        incomeWht,
        wht: incomeWht,
        stWithholding,
        netReceivable,
        whtPct,
        receivableNote: 'Income WHT and ST withholding are receivable-only — not deducted from stamped grand.',
    };
}

async function generateInvoiceNumber(pool, year, month) {
    const monthAbbr = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yr2 = String(year).slice(-2);
    const prefix = `INV-${monthAbbr}${yr2}`;
    const { rows } = await pool.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '(\\d+)$') AS INT)), 0) AS max_seq
         FROM client_invoices WHERE invoice_number LIKE $1`,
        [`${prefix}-%`]
    );
    const seq = Number(rows[0]?.max_seq || 0) + 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
}

async function persistSoInvoice(pool, { serviceOrderId, month, year, generatedBy, poNumber }) {
    const computed = await computeSoInvoice(pool, { serviceOrderId, month, year });
    const policy = await getPolicy(pool, computed.contractId);
    const creditDays = Number(policy?.credit_days) || Number(computed.creditDays) || 30;
    const invNo = await generateInvoiceNumber(pool, year, month);

    const lineItems = computed.lineItems.map(l => ({
        description: `${l.description} — ${month}/${year}`,
        amount: l.amount,
        quantity: l.quantity,
        rate: l.rate,
    }));

    const notesObj = {
        source: 'fixed_value_service_order',
        service_order_id: serviceOrderId,
        site_code: computed.siteCode,
        gross: computed.gross,
        total_deductions: computed.totalDeductions,
        income_wht: computed.incomeWht,
        st_withholding: computed.stWithholding,
        net_receivable: computed.netReceivable,
        receivable_note: computed.receivableNote,
        tax_rate: computed.taxRate,
    };

    const { rows } = await pool.query(
        `INSERT INTO client_invoices
         (invoice_number, client, contract, contract_id, period_month, period_year,
          line_items, subtotal, service_charges, sales_tax, wht, grand_total, notes, status, created_by, due_date, po_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12,'Draft',$13,(CURRENT_DATE + ($14 || ' days')::interval)::date,$15)
         RETURNING *`,
        [
            invNo,
            computed.clientName,
            computed.contractName,
            computed.contractId,
            month,
            year,
            JSON.stringify(lineItems),
            computed.netTaxable,
            computed.provincialSt,
            computed.incomeWht,
            computed.grandTotal,
            JSON.stringify(notesObj),
            generatedBy,
            String(creditDays),
            poNumber || null,
        ]
    );

    const invoice = rows[0];
    return { invoice, computed };
}

async function listRegistry(pool, { contractId, month, year, siteCode } = {}) {
    const params = [];
    const where = [`(ci.notes::text LIKE '%fixed_value_service_order%' OR ci.notes::text LIKE '%service_order_id%')`];
    if (contractId) {
        params.push(contractId);
        where.push(`ci.contract_id = $${params.length}`);
    }
    if (month) {
        params.push(month);
        where.push(`ci.period_month = $${params.length}`);
    }
    if (year) {
        params.push(year);
        where.push(`ci.period_year = $${params.length}`);
    }
    if (siteCode) {
        params.push(`%"site_code":"${siteCode}"%`);
        where.push(`ci.notes ILIKE $${params.length}`);
    }
    const { rows } = await pool.query(
        `SELECT ci.* FROM client_invoices ci
         WHERE ${where.join(' AND ')}
         ORDER BY ci.period_year DESC, ci.period_month DESC, ci.id DESC`,
        params
    );
    return rows;
}

function printInvoiceHtml(invoiceRow, format) {
    let notes = {};
    try {
        notes = typeof invoiceRow.notes === 'string' ? JSON.parse(invoiceRow.notes) : (invoiceRow.notes || {});
    } catch { notes = {}; }
    const payload = {
        invoiceNumber: invoiceRow.invoice_number,
        clientName: invoiceRow.client,
        contractName: invoiceRow.contract,
        siteCode: notes.site_code,
        siteName: notes.site_code,
        periodMonth: invoiceRow.period_month,
        periodYear: invoiceRow.period_year,
        lineItems: invoiceRow.line_items,
        netTaxable: invoiceRow.subtotal,
        provincialSt: invoiceRow.sales_tax,
        grandTotal: invoiceRow.grand_total,
        incomeWht: invoiceRow.wht,
        stWithholding: notes.st_withholding,
        netReceivable: notes.net_receivable,
        taxRate: notes.tax_rate,
        poNumber: invoiceRow.po_number,
    };
    return renderInvoiceHtml({ computed: payload }, { format });
}

module.exports = {
    ST_WITHHOLDING_RATE,
    listDeductions,
    addManualDeduction,
    computeSoInvoice,
    persistSoInvoice,
    listRegistry,
    printInvoiceHtml,
    resolveTaxRate,
};
