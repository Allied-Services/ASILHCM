'use strict';

const { getRulebook } = require('./rulebook');
const { getPolicy } = require('../constraints/service');
const { isSoBillingModel } = require('../serviceOrders/sitesMeta');

function n(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
}

async function assertCostPlusInvoiceAllowed(pool, contractId) {
    const book = await getRulebook(pool, contractId);
    if (book.commercial_type === 'fixed_value' || isSoBillingModel(book.billing_model)) {
        const err = new Error('Use Fixed Value service-order invoicing for this contract');
        err.status = 409;
        err.code = 'USE_SO_INVOICE';
        throw err;
    }
    return book;
}

async function assertSoInvoiceAllowed(pool, contractId) {
    const book = await getRulebook(pool, contractId);
    if (book.commercial_type === 'cost_plus') {
        const err = new Error('Use cost-plus payroll invoice for this contract');
        err.status = 409;
        err.code = 'USE_COST_PLUS_INVOICE';
        throw err;
    }
    return book;
}

async function generateCostPlusInvoiceFromSheet(pool, { contractId, year, month, generatedBy }) {
    const book = await assertCostPlusInvoiceAllowed(pool, contractId);
    const { rows: sheet } = await pool.query(
        `SELECT pt.*, e.name, e.designation
         FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE e.contract_id::text = $1 AND pt.year = $2 AND pt.month = $3 AND pt.locked = TRUE`,
        [contractId, year, month]
    );
    if (!sheet.length) {
        const err = new Error('Lock the Payroll Sheet for this contract before invoicing');
        err.status = 409;
        err.code = 'SHEET_NOT_LOCKED';
        throw err;
    }

    const policy = await getPolicy(pool, contractId);
    const feePct = Number(book.service_charge_pct != null ? book.service_charge_pct : policy?.service_charge_pct) || 0;
    const overhead = Number(book.overhead_per_employee || 0);
    let payrollCost = 0;
    for (const r of sheet) {
        const snap = r.computed_json && typeof r.computed_json === 'object' ? r.computed_json : null;
        const cost = snap
            ? Number(snap.totalPayrollCost || snap.gross || r.gross || 0)
            : Number(r.gross || 0);
        payrollCost += cost + overhead;
    }
    payrollCost = n(payrollCost);
    const fee = n(payrollCost * (feePct > 1 ? feePct / 100 : feePct));
    const subtotal = n(payrollCost + fee);
    const stRate = book.sales_tax_exempt ? 0 : Number(book.sales_tax_rate || 0.16);
    const salesTax = n(subtotal * stRate);
    const grand = n(subtotal + salesTax);

    const { rows: existing } = await pool.query(
        `SELECT id, status FROM client_invoices
         WHERE contract_id = $1 AND period_year = $2 AND period_month = $3
         ORDER BY id DESC LIMIT 1`,
        [contractId, year, month]
    );
    if (existing[0] && ['Finalized', 'Raised', 'Sent', 'Paid'].includes(existing[0].status)) {
        const err = new Error('Invoice already finalized for this period');
        err.status = 409;
        err.code = 'INVOICE_LOCKED';
        throw err;
    }

    const notes = JSON.stringify({
        source_kind: 'payroll_sheet',
        commercial_type: 'cost_plus',
        payroll_cost: payrollCost,
        overhead_per_employee: overhead,
        service_charge_pct: feePct,
        service_charges: fee,
        headcount: sheet.length,
        generated_by: generatedBy || null,
    });

    if (existing[0]) {
        const { rows } = await pool.query(
            `UPDATE client_invoices SET
                subtotal = $2, sales_tax = $3, grand_total = $4, notes = $5, updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [existing[0].id, subtotal, salesTax, grand, notes]
        );
        return { invoice: rows[0], created: false };
    }

    const invNo = await nextCostPlusInvoiceNumber(pool, year, month);
    const { rows } = await pool.query(
        `INSERT INTO client_invoices
            (invoice_number, client, contract, contract_id, period_month, period_year,
             subtotal, sales_tax, grand_total, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Draft',$11)
         RETURNING *`,
        [
            invNo,
            book.client_name || book.client_id || 'TEST',
            book.contract_name || contractId,
            contractId,
            month,
            year,
            payrollCost,
            salesTax,
            grand,
            notes,
            generatedBy || null,
        ]
    );
    return { invoice: rows[0], created: true };
}

async function nextCostPlusInvoiceNumber(pool, year, month) {
    const monthAbbr = new Date(2000, parseInt(month, 10) - 1, 1)
        .toLocaleString('en-US', { month: 'short' })
        .toUpperCase();
    const prefix = `INV-${monthAbbr}${String(year).slice(-2)}`;
    const { rows } = await pool.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '(\\d+)$') AS INT)), 0) AS max_seq
         FROM client_invoices WHERE invoice_number LIKE $1`,
        [`${prefix}-%`]
    );
    return `${prefix}-${String(Number(rows[0]?.max_seq || 0) + 1).padStart(4, '0')}`;
}

module.exports = {
    assertCostPlusInvoiceAllowed,
    assertSoInvoiceAllowed,
    generateCostPlusInvoiceFromSheet,
};
