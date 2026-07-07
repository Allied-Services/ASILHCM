'use strict';

const { parseConfigValue } = require('../../core/jsonConfig');
const { generateInvoiceNumber } = require('../payrollrun/service');

async function getBillableCandidates(pool, { client, sites, period_month, period_year }) {
    const params = [client, period_month, period_year];
    let siteClause = '';
    if (sites?.length) {
        params.push(sites);
        siteClause = ` AND b.site = ANY($${params.length}::text[])`;
    }
    const { rows } = await pool.query(
        `SELECT b.*
         FROM bills b
         WHERE b.billable = TRUE
           AND b.client = $1
           AND b.period_month = $2
           AND b.period_year = $3
           AND b.invoiced_in IS NULL
           AND b.status IN ('Posted', 'Approved', 'Paid')
           AND COALESCE(b.excluded_from_sync, FALSE) = FALSE
           ${siteClause}
         ORDER BY b.site, b.vendor, b.id`,
        params
    );
    return rows;
}

async function createInvoiceFromBillable(pool, { client, sites, period_month, period_year, bill_ids, created_by }) {
    let bills;
    if (bill_ids?.length) {
        const { rows } = await pool.query(
            `SELECT * FROM bills WHERE id = ANY($1::text[]) AND invoiced_in IS NULL AND billable = TRUE`,
            [bill_ids]
        );
        bills = rows;
    } else {
        bills = await getBillableCandidates(pool, { client, sites, period_month, period_year });
    }
    if (!bills.length) throw new Error('No billable bills found for the selected criteria');

    const subtotal = bills.reduce((s, b) => s + parseFloat(b.amount || b.total || 0), 0);
    const salesTax = bills.reduce((s, b) => s + parseFloat(b.gst || 0), 0);
    const grandTotal = subtotal + salesTax;
    const invoiceNumber = await generateInvoiceNumber(pool, period_year, period_month);
    const lineItems = bills.map(b => ({
        bill_id: b.id,
        description: `${b.site || ''} — ${b.vendor || b.purpose || b.bill_type || 'Expense'}`.trim(),
        qty: 1,
        amount: parseFloat(b.amount || b.total || 0),
        unit_amount: parseFloat(b.amount || b.total || 0),
        account_code: '200',
    }));
    const siteLabel = [...new Set(bills.map(b => b.site).filter(Boolean))].join(', ');

    const { rows } = await pool.query(
        `INSERT INTO client_invoices
            (invoice_number, client, contract, period_month, period_year, line_items,
             subtotal, sales_tax, grand_total, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Draft',$11)
         RETURNING *`,
        [
            invoiceNumber,
            client,
            bills[0].contract || null,
            period_month,
            period_year,
            JSON.stringify(lineItems),
            subtotal,
            salesTax,
            grandTotal,
            siteLabel ? `Billable expenses — ${siteLabel}` : 'Billable expenses',
            created_by || null,
        ]
    );
    const invoice = rows[0];
    await pool.query(
        `UPDATE bills SET invoiced_in = $1, updated_at = NOW() WHERE id = ANY($2::text[])`,
        [String(invoice.id), bills.map(b => b.id)]
    );
    return { invoice, billsLinked: bills.length };
}

async function linkBillableExpensesToXero(getXeroAccessToken, targetInvoiceId, sourceBillXeroIds) {
    if (!sourceBillXeroIds?.length) return { linked: 0 };
    const { accessToken, tenantId } = await getXeroAccessToken();
    const linkedTransactions = sourceBillXeroIds.map(sourceId => ({
        SourceTransactionID: sourceId,
        TargetTransactionID: targetInvoiceId,
    }));
    const resp = await fetch('https://api.xero.com/api.xro/2.0/LinkedTransactions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-Tenant-Id': tenantId,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ LinkedTransactions: linkedTransactions }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.Message || `LinkedTransactions failed: ${resp.status}`);
    return { linked: linkedTransactions.length, data };
}

module.exports = {
    getBillableCandidates,
    createInvoiceFromBillable,
    linkBillableExpensesToXero,
};
