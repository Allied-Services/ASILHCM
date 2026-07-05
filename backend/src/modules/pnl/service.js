'use strict';

const { formatDate, addDays, startOfWeek, addWeeks } = require('../../core/dates');

async function refreshPnlViews(pool) {
    await pool.query(`
        CREATE OR REPLACE VIEW v_contract_pnl_monthly AS
        SELECT
            c.id AS contract_id,
            c.contract_name,
            c.client_id,
            ca.period_year,
            ca.period_month,
            COALESCE(SUM(ca.amount), 0) AS total_cost,
            COALESCE(inv.revenue, 0) AS total_revenue,
            COALESCE(inv.revenue, 0) - COALESCE(SUM(ca.amount), 0) AS margin_abs,
            CASE WHEN COALESCE(inv.revenue, 0) > 0
                THEN ROUND(((COALESCE(inv.revenue, 0) - COALESCE(SUM(ca.amount), 0)) / inv.revenue) * 100, 2)
                ELSE NULL END AS margin_pct
        FROM contracts c
        LEFT JOIN cost_allocations ca ON ca.contract_id = c.id
        LEFT JOIN (
            SELECT contract_id, period_year, period_month, SUM(grand_total) AS revenue
            FROM client_invoices
            WHERE status IS DISTINCT FROM 'Void'
            GROUP BY contract_id, period_year, period_month
        ) inv ON inv.contract_id = c.id
            AND inv.period_year = ca.period_year
            AND inv.period_month = ca.period_month
        GROUP BY c.id, c.contract_name, c.client_id, ca.period_year, ca.period_month, inv.revenue
    `);
}

async function listContractPnl(pool, { year, month } = {}) {
    await refreshPnlViews(pool);
    let sql = `SELECT * FROM v_contract_pnl_monthly WHERE 1=1`;
    const params = [];
    if (year) { params.push(year); sql += ` AND period_year = $${params.length}`; }
    if (month) { params.push(month); sql += ` AND period_month = $${params.length}`; }
    sql += ' ORDER BY contract_name, period_year DESC, period_month DESC';
    const { rows } = await pool.query(sql, params);
    return rows;
}

async function allocateFromLockedPayroll(pool, periodMonth, periodYear) {
    const { rows } = await pool.query(
        `SELECT pt.*, e.contract_id, e.project_id, e.province
         FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE pt.locked = true AND pt.month = $1 AND pt.year = $2`,
        [periodMonth, periodYear]
    );

    let inserted = 0;
    for (const row of rows) {
        if (!row.contract_id) continue;
        const amount = Number(row.total_invoice || row.gross || 0);
        await pool.query(
            `INSERT INTO cost_allocations (source_type, source_id, contract_id, project_id, period_month, period_year, amount, created_by)
             VALUES ('payroll', $1, $2, $3, $4, $5, $6, 'system')
             ON CONFLICT DO NOTHING`,
            [`${row.employee_id}-${periodYear}-${periodMonth}`, row.contract_id, row.project_id, periodMonth, periodYear, amount]
        ).catch(async () => {
            const exists = await pool.query(
                `SELECT 1 FROM cost_allocations WHERE source_type='payroll' AND source_id=$1 LIMIT 1`,
                [`${row.employee_id}-${periodYear}-${periodMonth}`]
            );
            if (!exists.rows.length) {
                await pool.query(
                    `INSERT INTO cost_allocations (source_type, source_id, contract_id, project_id, period_month, period_year, amount, created_by)
                     VALUES ('payroll', $1, $2, $3, $4, $5, $6, 'system')`,
                    [`${row.employee_id}-${periodYear}-${periodMonth}`, row.contract_id, row.project_id, periodMonth, periodYear, amount]
                );
                inserted += 1;
            }
        });
        inserted += 1;
    }
    return { processed: rows.length, inserted };
}

async function getWeeklyCashflow(pool, weeks = 8) {
    const start = startOfWeek();
    const buckets = [];

    for (let i = 0; i < weeks; i++) {
        const ws = addWeeks(start, i);
        const we = addDays(ws, 6);
        const inflows = await pool.query(
            `SELECT COALESCE(SUM(grand_total), 0) AS total
             FROM client_invoices
             WHERE due_date >= $1::date AND due_date <= $2::date
               AND payment_received_at IS NULL
               AND status IS DISTINCT FROM 'Void'`,
            [formatDate(ws), formatDate(we)]
        ).catch(() => ({ rows: [{ total: 0 }] }));

        const outflows = await pool.query(
            `SELECT COALESCE(SUM(total_amount), 0) AS total FROM payment_batches
             WHERE status IN ('pending', 'confirmed')
               AND created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
            [ws.toISOString(), addDays(we, 1).toISOString()]
        ).catch(() => ({ rows: [{ total: 0 }] }));

        const inflow = Number(inflows.rows[0]?.total || 0);
        const outflow = Number(outflows.rows[0]?.total || 0);
        buckets.push({
            weekStart: formatDate(ws),
            weekEnd: formatDate(we),
            expectedInflows: inflow,
            committedOutflows: outflow,
            netPosition: inflow - outflow,
        });
    }

    await pool.query(
        `INSERT INTO cashflow_snapshots (week_start, expected_inflows, committed_outflows, net_position, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [buckets[0]?.weekStart, buckets[0]?.expectedInflows, buckets[0]?.committedOutflows, buckets[0]?.netPosition, JSON.stringify(buckets)]
    ).catch(() => {});

    return buckets;
}

module.exports = { refreshPnlViews, listContractPnl, allocateFromLockedPayroll, getWeeklyCashflow };
