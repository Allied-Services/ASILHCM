'use strict';

/** MD Mandate §5 — manual payment status changes restricted to MD / Finance Manager. */
const MANUAL_PAYMENT_STATUS_ACTORS = new Set([
    'shezad.mumtaz@asil.com.pk',
    'asif.awan@asil.com.pk',
]);

const PAYMENT_STATUS_NOTIFY_EMAILS = [
    'asif.awan@asil.com.pk',
    'shezad.mumtaz@asil.com.pk',
    'huzaifa.rafaqat@asil.com.pk',
    'laiba.mughal@asil.com.pk',
];

function canManuallySetPaymentStatus(email) {
    if (!email) return false;
    return MANUAL_PAYMENT_STATUS_ACTORS.has(String(email).trim().toLowerCase());
}

/**
 * Queue a payment-status change for the end-of-day summary email.
 * Persists to payment_status_change_log when the table exists; otherwise no-ops safely.
 */
async function recordPaymentStatusChange(pool, { invoiceId, invoiceNumber, fromStatus, toStatus, changedBy }) {
    try {
        await pool.query(
            `INSERT INTO payment_status_change_log
                (invoice_id, invoice_number, from_status, to_status, changed_by, changed_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [invoiceId, invoiceNumber || null, fromStatus || null, toStatus, changedBy]
        );
    } catch (err) {
        // Table may not exist yet in older envs — log and continue
        if (err.code !== '42P01') throw err;
        console.warn('[paymentStatusGuard] payment_status_change_log missing — change not persisted');
    }
}

async function sendEndOfDayPaymentStatusSummary(pool, sendAppEmail) {
    let rows = [];
    try {
        const result = await pool.query(
            `SELECT * FROM payment_status_change_log
             WHERE summarized_at IS NULL AND changed_at::date = CURRENT_DATE
             ORDER BY changed_at`
        );
        rows = result.rows;
    } catch (err) {
        if (err.code === '42P01') return { ok: true, sent: false, reason: 'no_table' };
        throw err;
    }
    if (!rows.length) return { ok: true, sent: false, reason: 'no_changes' };

    const lines = rows.map(r =>
        `<li><b>${r.invoice_number || r.invoice_id}</b>: ${r.from_status || '—'} → <b>${r.to_status}</b> by ${r.changed_by} at ${r.changed_at}</li>`
    ).join('');
    const html = `<p>End-of-day payment status changes (${rows.length}):</p><ul>${lines}</ul>`;

    if (typeof sendAppEmail === 'function') {
        await sendAppEmail({
            to: PAYMENT_STATUS_NOTIFY_EMAILS,
            subject: `[HCM] Payment status changes — ${new Date().toISOString().slice(0, 10)}`,
            html,
        });
    }

    await pool.query(
        `UPDATE payment_status_change_log SET summarized_at = NOW()
         WHERE id = ANY($1::int[])`,
        [rows.map(r => r.id)]
    );
    return { ok: true, sent: true, count: rows.length };
}

module.exports = {
    canManuallySetPaymentStatus,
    MANUAL_PAYMENT_STATUS_ACTORS,
    PAYMENT_STATUS_NOTIFY_EMAILS,
    recordPaymentStatusChange,
    sendEndOfDayPaymentStatusSummary,
};
