'use strict';

const { parseConfigValue } = require('../../core/jsonConfig');
const { DEFAULT_XERO_CLEARING_ACCOUNTS } = require('../xeroBillImport/config');

function round2(n) {
    return Math.round((parseFloat(n) || 0) * 100) / 100;
}

function computeReceiptSplit(invoice, incomeTaxWhtPct = 6) {
    const subtotal = parseFloat(invoice.subtotal) || 0;
    const salesTax = parseFloat(invoice.sales_tax) || 0;
    const grandTotal = parseFloat(invoice.grand_total) || subtotal + salesTax;
    const rate = parseFloat(incomeTaxWhtPct) || 6;
    const income_tax_wht = round2(subtotal * rate / 100);
    const sales_tax_withheld_by_client = round2(salesTax * 0.2);
    const sales_tax_self_paid = round2(salesTax * 0.8);
    const cash_received = round2(grandTotal - income_tax_wht - sales_tax_withheld_by_client);
    return {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        subtotal,
        sales_tax: salesTax,
        grand_total: grandTotal,
        income_tax_wht,
        sales_tax_withheld_by_client,
        sales_tax_self_paid,
        cash_received,
        income_tax_wht_pct: rate,
    };
}

async function resolveIncomeTaxWhtPct(pool, contractId) {
    if (contractId) {
        const { rows } = await pool.query(
            `SELECT income_tax_wht_pct FROM contract_policies
             WHERE contract_id = $1 AND income_tax_wht_pct IS NOT NULL
             ORDER BY effective_from DESC NULLS LAST LIMIT 1`,
            [contractId]
        );
        if (rows[0]?.income_tax_wht_pct != null) {
            return parseFloat(rows[0].income_tax_wht_pct);
        }
    }
    const { rows: cfg } = await pool.query(`SELECT value FROM system_config WHERE key = 'client_income_tax_wht_pct'`);
    if (cfg.length) {
        const v = parseConfigValue(cfg[0].value);
        if (v != null) return parseFloat(v);
    }
    return 6;
}

async function previewReceiptSplit(pool, { invoice_ids = [] }) {
    if (!invoice_ids.length) {
        const err = new Error('invoice_ids required');
        err.status = 400;
        throw err;
    }
    const { rows: invoices } = await pool.query(
        `SELECT * FROM client_invoices WHERE id = ANY($1::int[])`,
        [invoice_ids.map(id => parseInt(id, 10))]
    );
    const lines = [];
    for (const inv of invoices) {
        const pct = await resolveIncomeTaxWhtPct(pool, inv.contract_id);
        lines.push(computeReceiptSplit(inv, pct));
    }
    const totals = lines.reduce((acc, l) => {
        acc.cash_received += l.cash_received;
        acc.income_tax_wht += l.income_tax_wht;
        acc.sales_tax_withheld_by_client += l.sales_tax_withheld_by_client;
        acc.sales_tax_self_paid += l.sales_tax_self_paid;
        return acc;
    }, { cash_received: 0, income_tax_wht: 0, sales_tax_withheld_by_client: 0, sales_tax_self_paid: 0 });
    return { lines, totals };
}

async function writeComplianceLedger(pool, receiptId, lines) {
    for (const line of lines) {
        if (line.income_tax_wht > 0) {
            await pool.query(
                `INSERT INTO statutory_ledger (period_month, period_year, authority, employee_share, employer_share, taxable_base)
                 VALUES (
                    EXTRACT(MONTH FROM NOW())::int,
                    EXTRACT(YEAR FROM NOW())::int,
                    'INCOME_TAX_WHT_RECEIVABLE',
                    $1, 0, $2
                 )`,
                [line.income_tax_wht, line.subtotal]
            );
        }
        if (line.sales_tax_withheld_by_client > 0) {
            await pool.query(
                `INSERT INTO statutory_ledger (period_month, period_year, authority, employee_share, employer_share, taxable_base)
                 VALUES (
                    EXTRACT(MONTH FROM NOW())::int,
                    EXTRACT(YEAR FROM NOW())::int,
                    'SALES_TAX_WITHHELD',
                    $1, 0, $2
                 )`,
                [line.sales_tax_withheld_by_client, line.sales_tax]
            );
        }
    }
    return { receiptId, entries: lines.length };
}

async function pushReceiptToXero(getXeroAccessToken, pool, receipt, lines) {
    const { accessToken, tenantId } = await getXeroAccessToken();
    const { rows: cfg } = await pool.query(`SELECT value FROM system_config WHERE key = 'xero_clearing_accounts'`);
    const clearing = cfg.length ? parseConfigValue(cfg[0].value) : DEFAULT_XERO_CLEARING_ACCOUNTS;

    const batchPayments = [];
    for (const line of lines) {
        if (line.cash_received <= 0 || !line.xero_invoice_id) continue;
        batchPayments.push({
            Date: receipt.receipt_date,
            Amount: line.cash_received,
            Reference: receipt.bank_ref || receipt.id,
            Invoice: { InvoiceID: line.xero_invoice_id },
            Account: { Code: '090' },
        });
    }

    let batchResult = null;
    if (batchPayments.length) {
        const resp = await fetch('https://api.xero.com/api.xro/2.0/BatchPayments', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-Tenant-Id': tenantId,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({ BatchPayments: [{ Date: receipt.receipt_date, Reference: receipt.bank_ref, Payments: batchPayments }] }),
        });
        batchResult = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(batchResult.Message || `BatchPayment failed: ${resp.status}`);
    }

    const whtPayments = [];
    for (const line of lines) {
        if (line.income_tax_wht > 0 && line.xero_invoice_id) {
            whtPayments.push({
                Invoice: { InvoiceID: line.xero_invoice_id },
                Account: { Code: clearing.incomeTaxWht || '626' },
                Date: receipt.receipt_date,
                Amount: line.income_tax_wht,
                Reference: `WHT-${receipt.bank_ref || receipt.id}`,
            });
        }
        if (line.sales_tax_withheld_by_client > 0 && line.xero_invoice_id) {
            whtPayments.push({
                Invoice: { InvoiceID: line.xero_invoice_id },
                Account: { Code: clearing.salesTaxWithheld || '627' },
                Date: receipt.receipt_date,
                Amount: line.sales_tax_withheld_by_client,
                Reference: `STW-${receipt.bank_ref || receipt.id}`,
            });
        }
    }

    let whtResult = null;
    if (whtPayments.length) {
        const resp = await fetch('https://api.xero.com/api.xro/2.0/Payments', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-Tenant-Id': tenantId,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({ Payments: whtPayments }),
        });
        whtResult = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(whtResult.Message || `WHT payments failed: ${resp.status}`);
    }

    return { batchResult, whtResult, payments: batchPayments.length, whtAllocations: whtPayments.length };
}

async function postReceipt(pool, getXeroAccessToken, body, postedBy) {
    const { client, receipt_date, bank_ref, lines = [], push_to_xero = true } = body;
    if (!client || !receipt_date || !lines.length) {
        throw new Error('client, receipt_date, and lines required');
    }

    const invoiceIds = lines.map(l => parseInt(l.invoice_id, 10));
    const { rows: invoices } = await pool.query(
        `SELECT * FROM client_invoices WHERE id = ANY($1::int[])`,
        [invoiceIds]
    );
    const invMap = Object.fromEntries(invoices.map(i => [i.id, i]));

    const normalized = lines.map(l => {
        const inv = invMap[l.invoice_id];
        if (!inv) throw new Error(`Invoice ${l.invoice_id} not found`);
        return {
            invoice_id: inv.id,
            invoice_number: inv.invoice_number,
            xero_invoice_id: inv.xero_invoice_id,
            subtotal: parseFloat(inv.subtotal) || 0,
            sales_tax: parseFloat(inv.sales_tax) || 0,
            grand_total: parseFloat(inv.grand_total) || 0,
            cash_received: round2(l.cash_received),
            income_tax_wht: round2(l.income_tax_wht),
            sales_tax_withheld_by_client: round2(l.sales_tax_withheld_by_client),
            sales_tax_self_paid: round2(l.sales_tax_self_paid ?? (parseFloat(inv.sales_tax) || 0) * 0.8),
        };
    });

    const totals = normalized.reduce((acc, l) => {
        acc.cash_received += l.cash_received;
        acc.income_tax_wht += l.income_tax_wht;
        acc.sales_tax_withheld_by_client += l.sales_tax_withheld_by_client;
        acc.sales_tax_self_paid += l.sales_tax_self_paid;
        return acc;
    }, { cash_received: 0, income_tax_wht: 0, sales_tax_withheld_by_client: 0, sales_tax_self_paid: 0 });

    const { rows: receiptRows } = await pool.query(
        `INSERT INTO invoice_receipts
            (client, receipt_date, bank_ref, total_cash, total_income_tax_wht, total_sales_tax_withheld, total_sales_tax_self_paid, posted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
            client,
            receipt_date,
            bank_ref || null,
            totals.cash_received,
            totals.income_tax_wht,
            totals.sales_tax_withheld_by_client,
            totals.sales_tax_self_paid,
            postedBy || null,
        ]
    );
    const receipt = receiptRows[0];

    for (const line of normalized) {
        await pool.query(
            `INSERT INTO invoice_receipt_lines
                (receipt_id, invoice_id, cash_received, income_tax_wht, sales_tax_withheld_by_client, sales_tax_self_paid)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
                receipt.id,
                line.invoice_id,
                line.cash_received,
                line.income_tax_wht,
                line.sales_tax_withheld_by_client,
                line.sales_tax_self_paid,
            ]
        );
        await pool.query(
            `UPDATE client_invoices SET payment_received_at = $2, status = 'Paid', updated_at = NOW() WHERE id = $1`,
            [line.invoice_id, receipt_date]
        );
    }

    await writeComplianceLedger(pool, receipt.id, normalized);

    let xero = null;
    if (push_to_xero && getXeroAccessToken) {
        xero = await pushReceiptToXero(getXeroAccessToken, pool, receipt, normalized);
    }

    return { ok: true, receipt, lines: normalized.length, xero };
}


async function deleteReceiptById(pool, receiptId) {
    const id = parseInt(receiptId, 10);
    if (!id) {
        const err = new Error('Invalid receipt id');
        err.status = 400;
        throw err;
    }
    const { rowCount: lineCount } = await pool.query(
        'DELETE FROM invoice_receipt_lines WHERE receipt_id = $1',
        [id]
    );
    const { rowCount: headerCount } = await pool.query(
        'DELETE FROM invoice_receipts WHERE id = $1',
        [id]
    );
    if (!headerCount) {
        const err = new Error('Receipt not found');
        err.status = 404;
        throw err;
    }
    return { ok: true, id, linesDeleted: lineCount };
}

async function purgeTestReceipts(pool) {
    const { rowCount: lineCount } = await pool.query(
        "DELETE FROM invoice_receipt_lines WHERE receipt_id IN (SELECT id FROM invoice_receipts WHERE client LIKE 'TEST-%')"
    );
    const { rowCount: headerCount } = await pool.query(
        "DELETE FROM invoice_receipts WHERE client LIKE 'TEST-%'"
    );
    return { ok: true, receiptsDeleted: headerCount, linesDeleted: lineCount };
}

async function listReceipts(pool, { client } = {}) {
    let sql = `SELECT r.*, COUNT(l.id)::int AS line_count
               FROM invoice_receipts r
               LEFT JOIN invoice_receipt_lines l ON l.receipt_id = r.id`;
    const params = [];
    if (client) {
        params.push(client);
        sql += ` WHERE r.client = $1`;
    }
    sql += ` GROUP BY r.id ORDER BY r.receipt_date DESC, r.id DESC LIMIT 100`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

module.exports = {
    computeReceiptSplit,
    resolveIncomeTaxWhtPct,
    previewReceiptSplit,
    postReceipt,
    listReceipts,
    deleteReceiptById,
    purgeTestReceipts,
    writeComplianceLedger,
    pushReceiptToXero,
};
