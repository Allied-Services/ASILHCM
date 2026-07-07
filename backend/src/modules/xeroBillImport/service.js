'use strict';

const { parseConfigValue } = require('../../core/jsonConfig');
const { classifyXeroBill } = require('./classifier');
const {
    DEFAULT_XERO_SITE_ACCOUNTS,
    DEFAULT_HBL_EXPORT_COLUMNS,
    DEFAULT_XERO_CLEARING_ACCOUNTS,
} = require('./config');

async function ensureConfigDefaults(pool) {
    const defaults = [
        ['xero_site_accounts', DEFAULT_XERO_SITE_ACCOUNTS],
        ['hbl_export_columns', DEFAULT_HBL_EXPORT_COLUMNS],
        ['xero_clearing_accounts', DEFAULT_XERO_CLEARING_ACCOUNTS],
        ['client_income_tax_wht_pct', 6],
    ];
    for (const [key, value] of defaults) {
        await pool.query(
            `INSERT INTO system_config (key, value) VALUES ($1, $2::jsonb)
             ON CONFLICT (key) DO NOTHING`,
            [key, JSON.stringify(value)]
        );
    }
}

async function getConfigMap(pool, key, fallback) {
    const { rows } = await pool.query(`SELECT value FROM system_config WHERE key = $1`, [key]);
    if (!rows.length) return fallback;
    return parseConfigValue(rows[0].value) ?? fallback;
}

function xeroDateToIso(d) {
    if (!d) return null;
    const m = String(d).match(/\/Date\((\d+)/);
    if (m) return new Date(parseInt(m[1], 10)).toISOString().slice(0, 10);
    return String(d).slice(0, 10);
}

function mapXeroBillToRow(invoice, classification) {
    const total = parseFloat(invoice.Total || 0);
    const subtotal = parseFloat(invoice.SubTotal || total);
    const tax = parseFloat(invoice.TotalTax || 0);
    const date = xeroDateToIso(invoice.Date) || new Date().toISOString().slice(0, 10);
    const d = new Date(date);
    return {
        id: `XERO-${invoice.InvoiceID}`,
        type: 'ACCPAY',
        vendor: invoice.Contact?.Name || 'Unknown',
        xero_contact_name: invoice.Contact?.Name || null,
        date,
        client: 'Wafi Energy',
        site: classification.site,
        bill_type: classification.billType,
        tracking_category: classification.trackingCategory,
        purpose: invoice.Reference || null,
        invoice_no: invoice.InvoiceNumber || null,
        amount: subtotal,
        gst: tax,
        total,
        status: classification.importStatus === 'Needs Review' ? 'Needs Review' : 'Approved',
        billable: true,
        period_month: d.getMonth() + 1,
        period_year: d.getFullYear(),
        xero_invoice_id: invoice.InvoiceID,
        import_status: classification.importStatus,
        items: (invoice.LineItems || []).map(li => ({
            desc: li.Description,
            qty: li.Quantity || 1,
            unit: li.UnitAmount || 0,
            total: li.LineAmount || 0,
            account_code: li.AccountCode,
        })),
    };
}

async function syncXeroBills(pool, getXeroAccessToken, { modifiedSince } = {}) {
    await ensureConfigDefaults(pool);
    const siteAccounts = await getConfigMap(pool, 'xero_site_accounts', DEFAULT_XERO_SITE_ACCOUNTS);
    const { accessToken, tenantId } = await getXeroAccessToken();

    let url = 'https://api.xero.com/api.xro/2.0/Invoices?where=Type=="ACCPAY"';
    if (modifiedSince) {
        url += `&If-Modified-Since=${encodeURIComponent(modifiedSince)}`;
    }

    const resp = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-Tenant-Id': tenantId,
            Accept: 'application/json',
        },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.Message || `Xero sync failed: ${resp.status}`);

    const invoices = data.Invoices || [];
    let imported = 0;
    let skipped = 0;
    let review = 0;

    for (const invoice of invoices) {
        const { rows: existing } = await pool.query(
            `SELECT id, excluded_from_sync FROM bills WHERE xero_invoice_id = $1`,
            [invoice.InvoiceID]
        );
        if (existing.length && existing[0].excluded_from_sync) {
            skipped += 1;
            continue;
        }
        if (existing.length) {
            skipped += 1;
            continue;
        }

        const classification = classifyXeroBill(invoice, siteAccounts);
        if (!classification.owned) {
            if (classification.importStatus === 'Needs Review') {
                const row = mapXeroBillToRow(invoice, classification);
                await pool.query(
                    `INSERT INTO bills (
                        id, type, vendor, xero_contact_name, date, client, site, bill_type,
                        tracking_category, purpose, invoice_no, amount, gst, total, status,
                        billable, period_month, period_year, xero_invoice_id, import_status,
                        items, xero_synced_at
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW()
                    ) ON CONFLICT (id) DO NOTHING`,
                    [
                        row.id, row.type, row.vendor, row.xero_contact_name, row.date, row.client,
                        row.site, row.bill_type, row.tracking_category, row.purpose, row.invoice_no,
                        row.amount, row.gst, row.total, row.status, row.billable, row.period_month,
                        row.period_year, row.xero_invoice_id, row.import_status, JSON.stringify(row.items),
                    ]
                );
                review += 1;
            } else {
                skipped += 1;
            }
            continue;
        }

        const row = mapXeroBillToRow(invoice, classification);
        await pool.query(
            `INSERT INTO bills (
                id, type, vendor, xero_contact_name, date, client, site, bill_type,
                tracking_category, purpose, invoice_no, amount, gst, total, status,
                billable, period_month, period_year, xero_invoice_id, import_status,
                items, xero_synced_at
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW()
            ) ON CONFLICT (id) DO UPDATE SET
                vendor = EXCLUDED.vendor,
                site = COALESCE(EXCLUDED.site, bills.site),
                tracking_category = EXCLUDED.tracking_category,
                amount = EXCLUDED.amount,
                gst = EXCLUDED.gst,
                total = EXCLUDED.total,
                import_status = EXCLUDED.import_status,
                xero_synced_at = NOW(),
                updated_at = NOW()`,
            [
                row.id, row.type, row.vendor, row.xero_contact_name, row.date, row.client,
                row.site, row.bill_type, row.tracking_category, row.purpose, row.invoice_no,
                row.amount, row.gst, row.total, row.status, row.billable, row.period_month,
                row.period_year, row.xero_invoice_id, row.import_status, JSON.stringify(row.items),
            ]
        );
        imported += 1;
        if (classification.importStatus === 'Needs Review') review += 1;
    }

    return { fetched: invoices.length, imported, skipped, review };
}

async function getReviewQueue(pool) {
    const { rows } = await pool.query(
        `SELECT * FROM bills
         WHERE status = 'Needs Review' OR import_status = 'Needs Review'
         ORDER BY created_at DESC
         LIMIT 200`
    );
    return rows;
}

async function resolveReview(pool, billId, { category, site, client, bill_type, exclude, reviewed_by }) {
    const { rows } = await pool.query(`SELECT * FROM bills WHERE id = $1`, [billId]);
    if (!rows.length) throw new Error('Bill not found');
    if (exclude) {
        await pool.query(
            `UPDATE bills SET excluded_from_sync = TRUE, status = 'Excluded', import_status = 'Excluded', updated_at = NOW()
             WHERE id = $1`,
            [billId]
        );
        return { ok: true, excluded: true };
    }
    await pool.query(
        `UPDATE bills SET
            tracking_category = COALESCE($2, tracking_category),
            site = COALESCE($3, site),
            client = COALESCE($4, client),
            bill_type = COALESCE($5, bill_type),
            status = 'Approved',
            import_status = 'Imported',
            updated_at = NOW()
         WHERE id = $1`,
        [billId, category || null, site || null, client || null, bill_type || null]
    );
    return { ok: true, billId, reviewed_by };
}

async function pushXeroBillPayment(getXeroAccessToken, bill, { amount, date, reference }) {
    if (!bill.xero_invoice_id) return { pushed: false, reason: 'no_xero_invoice_id' };
    const { accessToken, tenantId } = await getXeroAccessToken();
    const payAmount = amount ?? parseFloat(bill.total || bill.amount || 0);
    const payload = {
        Payments: [{
            Invoice: { InvoiceID: bill.xero_invoice_id },
            Account: { Code: '090' },
            Date: date || new Date().toISOString().slice(0, 10),
            Amount: payAmount,
            Reference: reference || bill.id,
        }],
    };
    const resp = await fetch('https://api.xero.com/api.xro/2.0/Payments', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-Tenant-Id': tenantId,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.Message || `Xero payment failed: ${resp.status}`);
    return { pushed: true, paymentId: data.Payments?.[0]?.PaymentID };
}

module.exports = {
    ensureConfigDefaults,
    getConfigMap,
    syncXeroBills,
    getReviewQueue,
    resolveReview,
    pushXeroBillPayment,
    mapXeroBillToRow,
};
