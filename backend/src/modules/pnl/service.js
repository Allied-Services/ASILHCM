'use strict';

const { formatDate, addDays, startOfWeek, addWeeks } = require('../../core/dates');

async function refreshPnlViews(pool) {
    await pool.query(`
        CREATE OR REPLACE VIEW v_contract_pnl_monthly AS
        WITH costs AS (
            SELECT contract_id, period_year, period_month, SUM(amount) AS total_cost
            FROM cost_allocations
            GROUP BY contract_id, period_year, period_month
        ),
        revenue AS (
            SELECT contract_id, period_year, period_month, SUM(grand_total) AS total_revenue
            FROM client_invoices
            WHERE status IN ('Finalized', 'Raised', 'Sent', 'Paid')
            GROUP BY contract_id, period_year, period_month
        ),
        periods AS (
            SELECT contract_id, period_year, period_month FROM costs
            UNION
            SELECT contract_id, period_year, period_month FROM revenue
        )
        SELECT
            c.id AS contract_id,
            c.contract_name,
            c.client_id,
            p.period_year,
            p.period_month,
            COALESCE(costs.total_cost, 0) AS total_cost,
            COALESCE(revenue.total_revenue, 0) AS total_revenue,
            COALESCE(revenue.total_revenue, 0) - COALESCE(costs.total_cost, 0) AS margin_abs,
            CASE WHEN COALESCE(revenue.total_revenue, 0) > 0
                THEN ROUND(((COALESCE(revenue.total_revenue, 0) - COALESCE(costs.total_cost, 0)) / revenue.total_revenue) * 100, 2)
                ELSE NULL END AS margin_pct
        FROM periods p
        JOIN contracts c ON c.id = p.contract_id
        LEFT JOIN costs ON costs.contract_id = p.contract_id
            AND costs.period_year = p.period_year AND costs.period_month = p.period_month
        LEFT JOIN revenue ON revenue.contract_id = p.contract_id
            AND revenue.period_year = p.period_year AND revenue.period_month = p.period_month
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
        const inflowSql = i === 0
            ? `SELECT COALESCE(SUM(grand_total), 0) AS total
               FROM client_invoices
               WHERE payment_received_at IS NULL
                 AND status NOT IN ('Paid', 'Void', 'Voided')
                 AND (
                   (due_date >= $1::date AND due_date <= $2::date)
                   OR due_date < $1::date
                 )`
            : `SELECT COALESCE(SUM(grand_total), 0) AS total
               FROM client_invoices
               WHERE due_date >= $1::date AND due_date <= $2::date
                 AND payment_received_at IS NULL
                 AND status NOT IN ('Paid', 'Void', 'Voided')`;
        const inflows = await pool.query(
            inflowSql,
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
