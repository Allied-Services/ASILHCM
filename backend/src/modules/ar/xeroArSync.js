'use strict';

/**
 * Pull ACCREC (AR) invoices from Xero and upsert into client_invoices.
 * Xero is the single source of truth — matching rows are overwritten.
 */

function xeroDateToIso(d) {
    if (!d) return null;
    const m = String(d).match(/\/Date\((\d+)/);
    if (m) return new Date(parseInt(m[1], 10)).toISOString().slice(0, 10);
    return String(d).slice(0, 10);
}

function mapXeroStatus(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'PAID') return 'Paid';
    if (s === 'VOIDED' || s === 'DELETED') return 'Voided';
    if (s === 'AUTHORISED' || s === 'SUBMITTED') return 'Raised';
    if (s === 'DRAFT') return 'Draft';
    return status || 'Raised';
}

function mapXeroArInvoice(invoice) {
    const total = parseFloat(invoice.Total || 0);
    const subtotal = parseFloat(invoice.SubTotal || total);
    const tax = parseFloat(invoice.TotalTax || 0);
    const date = xeroDateToIso(invoice.Date);
    const due = xeroDateToIso(invoice.DueDate);
    const d = date ? new Date(date) : new Date();
    const amountDue = parseFloat(invoice.AmountDue != null ? invoice.AmountDue : total);
    const amountPaid = parseFloat(invoice.AmountPaid || 0);
    let status = mapXeroStatus(invoice.Status);
    if (amountDue <= 0.01 && amountPaid > 0 && status !== 'Voided') status = 'Paid';

    return {
        invoice_number: invoice.InvoiceNumber || `XERO-${invoice.InvoiceID}`,
        client: invoice.Contact?.Name || 'Unknown',
        contract: invoice.Reference || null,
        period_month: d.getMonth() + 1,
        period_year: d.getFullYear(),
        due_date: due,
        line_items: (invoice.LineItems || []).map(li => ({
            description: li.Description,
            qty: li.Quantity || 1,
            unit_amount: li.UnitAmount || 0,
            amount: li.LineAmount || 0,
            account_code: li.AccountCode,
        })),
        subtotal,
        service_charges: 0,
        sales_tax: tax,
        wht: 0,
        grand_total: total,
        notes: `source=xero_ar_sync; xero_status=${invoice.Status}; ref=${invoice.Reference || ''}`,
        status,
        xero_invoice_id: invoice.InvoiceID,
        xero_url: invoice.InvoiceID
            ? `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${invoice.InvoiceID}`
            : null,
        payment_received_at: status === 'Paid' ? (xeroDateToIso(invoice.FullyPaidOnDate) || date) : null,
    };
}

async function fetchAllXeroArInvoices(getXeroAccessToken, { pageSizeHint } = {}) {
    const { accessToken, tenantId } = await getXeroAccessToken();
    const all = [];
    let page = 1;
    const maxPages = 200;
    while (page <= maxPages) {
        const url = `https://api.xero.com/api.xro/2.0/Invoices?where=Type=="ACCREC"&page=${page}`;
        const resp = await fetch(url, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-Tenant-Id': tenantId,
                Accept: 'application/json',
            },
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(data.Message || data.Detail || `Xero AR sync failed: HTTP ${resp.status}`);
        }
        const batch = data.Invoices || [];
        all.push(...batch);
        if (batch.length < 100) break; // Xero page size is 100
        page += 1;
        if (pageSizeHint && all.length >= pageSizeHint) break;
    }
    return all;
}

async function upsertClientInvoiceFromXero(pool, mapped) {
    const { rows: byXero } = await pool.query(
        `SELECT id FROM client_invoices WHERE xero_invoice_id = $1 LIMIT 1`,
        [mapped.xero_invoice_id]
    );
    let existingId = byXero[0]?.id || null;
    if (!existingId && mapped.invoice_number) {
        const { rows: byNo } = await pool.query(
            `SELECT id FROM client_invoices WHERE invoice_number = $1 LIMIT 1`,
            [mapped.invoice_number]
        );
        existingId = byNo[0]?.id || null;
    }

    if (existingId) {
        const { rows } = await pool.query(
            `UPDATE client_invoices SET
                invoice_number = $2,
                client = $3,
                contract = COALESCE($4, contract),
                period_month = $5,
                period_year = $6,
                due_date = $7,
                line_items = $8::jsonb,
                subtotal = $9,
                service_charges = $10,
                sales_tax = $11,
                wht = $12,
                grand_total = $13,
                notes = $14,
                status = $15,
                xero_invoice_id = $16,
                xero_url = $17,
                payment_received_at = COALESCE($18::timestamptz, payment_received_at),
                updated_at = NOW()
             WHERE id = $1
             RETURNING id, invoice_number, status, grand_total`,
            [
                existingId,
                mapped.invoice_number,
                mapped.client,
                mapped.contract,
                mapped.period_month,
                mapped.period_year,
                mapped.due_date,
                JSON.stringify(mapped.line_items),
                mapped.subtotal,
                mapped.service_charges,
                mapped.sales_tax,
                mapped.wht,
                mapped.grand_total,
                mapped.notes,
                mapped.status,
                mapped.xero_invoice_id,
                mapped.xero_url,
                mapped.payment_received_at,
            ]
        );
        return { action: 'updated', row: rows[0] };
    }

    const { rows } = await pool.query(
        `INSERT INTO client_invoices
         (invoice_number, client, contract, period_month, period_year, due_date,
          line_items, subtotal, service_charges, sales_tax, wht, grand_total,
          notes, status, xero_invoice_id, xero_url, created_by, payment_received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,'xero_ar_sync',$17)
         RETURNING id, invoice_number, status, grand_total`,
        [
            mapped.invoice_number,
            mapped.client,
            mapped.contract,
            mapped.period_month,
            mapped.period_year,
            mapped.due_date,
            JSON.stringify(mapped.line_items),
            mapped.subtotal,
            mapped.service_charges,
            mapped.sales_tax,
            mapped.wht,
            mapped.grand_total,
            mapped.notes,
            mapped.status,
            mapped.xero_invoice_id,
            mapped.xero_url,
            mapped.payment_received_at,
        ]
    );
    return { action: 'inserted', row: rows[0] };
}

async function syncXeroArInvoices(pool, getXeroAccessToken, opts = {}) {
    if (!getXeroAccessToken) throw new Error('Xero not configured');
    const invoices = await fetchAllXeroArInvoices(getXeroAccessToken, opts);
    let inserted = 0;
    let updated = 0;
    const errors = [];

    for (const inv of invoices) {
        try {
            const mapped = mapXeroArInvoice(inv);
            const result = await upsertClientInvoiceFromXero(pool, mapped);
            if (result.action === 'inserted') inserted += 1;
            else updated += 1;
        } catch (err) {
            errors.push({
                invoice_number: inv.InvoiceNumber,
                xero_id: inv.InvoiceID,
                error: err.message,
            });
        }
    }

    try {
        await pool.query(
            `INSERT INTO xero_sync_log (direction, entity, xero_id, status, detail)
             VALUES ('pull', 'ACCREC', NULL, $1, $2::jsonb)`,
            [
                errors.length ? 'partial' : 'ok',
                JSON.stringify({ fetched: invoices.length, inserted, updated, errors: errors.length }),
            ]
        );
    } catch (_) { /* log table optional */ }

    return { ok: true, fetched: invoices.length, inserted, updated, errors };
}

async function runXeroArSyncJob(pool, getXeroAccessToken, data = {}) {
    return syncXeroArInvoices(pool, getXeroAccessToken, data || {});
}

module.exports = {
    xeroDateToIso,
    mapXeroStatus,
    mapXeroArInvoice,
    fetchAllXeroArInvoices,
    upsertClientInvoiceFromXero,
    syncXeroArInvoices,
    runXeroArSyncJob,
};
