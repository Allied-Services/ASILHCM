'use strict';

async function getArAging(pool) {
    const { rows } = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE days_overdue < 0) AS current_count,
            COALESCE(SUM(grand_total) FILTER (WHERE days_overdue < 0), 0) AS current_amount,
            COUNT(*) FILTER (WHERE days_overdue >= 0 AND days_overdue <= 30) AS days_0_30_count,
            COALESCE(SUM(grand_total) FILTER (WHERE days_overdue >= 0 AND days_overdue <= 30), 0) AS days_0_30_amount,
            COUNT(*) FILTER (WHERE days_overdue >= 31 AND days_overdue <= 60) AS days_31_60_count,
            COALESCE(SUM(grand_total) FILTER (WHERE days_overdue >= 31 AND days_overdue <= 60), 0) AS days_31_60_amount,
            COUNT(*) FILTER (WHERE days_overdue >= 61 AND days_overdue <= 90) AS days_61_90_count,
            COALESCE(SUM(grand_total) FILTER (WHERE days_overdue >= 61 AND days_overdue <= 90), 0) AS days_61_90_amount,
            COUNT(*) FILTER (WHERE days_overdue > 90) AS days_90_plus_count,
            COALESCE(SUM(grand_total) FILTER (WHERE days_overdue > 90), 0) AS days_90_plus_amount
        FROM (
            SELECT grand_total, (CURRENT_DATE - due_date::date) AS days_overdue
            FROM client_invoices
            WHERE payment_received_at IS NULL AND status NOT IN ('Paid', 'Void', 'Voided') AND due_date IS NOT NULL
        ) aging
    `);
    const r = rows[0] || {};
    const n = (k) => Number(r[k] || 0);
    return {
        buckets: [
            { label: 'current', count: n('current_count'), amount: n('current_amount') },
            { label: '0-30', count: n('days_0_30_count'), amount: n('days_0_30_amount') },
            { label: '31-60', count: n('days_31_60_count'), amount: n('days_31_60_amount') },
            { label: '61-90', count: n('days_61_90_count'), amount: n('days_61_90_amount') },
            { label: '90+', count: n('days_90_plus_count'), amount: n('days_90_plus_amount') },
        ],
        total_outstanding: n('current_amount') + n('days_0_30_amount') + n('days_31_60_amount') + n('days_61_90_amount') + n('days_90_plus_amount'),
    };
}

module.exports = { getArAging };