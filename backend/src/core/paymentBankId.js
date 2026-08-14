'use strict';

/**
 * payment_batches.bank_id is INTEGER (banks.id).
 * The AP Confirm Payment modal sends slugs ('hbl' / 'nbp'), which Postgres
 * rejects as 22P02 if written into that column.
 */
function coercePaymentBatchBankId(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
}

async function resolvePaymentBatchBankId(pool, raw, bankName) {
    const coerced = coercePaymentBatchBankId(raw);
    if (coerced != null) return coerced;
    if (!pool) return null;

    const slug = String(raw || '').trim().toLowerCase();
    try {
        if (slug === 'hbl') {
            const { rows } = await pool.query(
                `SELECT id FROM banks
                 WHERE is_hbl = TRUE AND COALESCE(is_active, TRUE) = TRUE
                 ORDER BY id ASC LIMIT 1`
            );
            if (rows[0]) return rows[0].id;
        }
        if (slug === 'nbp' || /national bank of pakistan/i.test(String(bankName || ''))) {
            const { rows } = await pool.query(
                `SELECT id FROM banks
                 WHERE (short_name = 'NBP' OR name ILIKE '%National Bank of Pakistan%')
                   AND COALESCE(is_active, TRUE) = TRUE
                 ORDER BY id ASC LIMIT 1`
            );
            if (rows[0]) return rows[0].id;
        }
    } catch (err) {
        console.error('[resolvePaymentBatchBankId]', err);
    }
    return null;
}

module.exports = { coercePaymentBatchBankId, resolvePaymentBatchBankId };
