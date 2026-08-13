'use strict';

/**
 * P4 — month-level Payroll vs AP vs paid reconciliation (read-only).
 *
 * Money figures:
 *   sheetTotal  = SUM(ROUND(net)) for every payroll_transactions row
 *   lockedTotal = SUM(COALESCE(locked_net, ROUND(net))) for locked rows
 *   apTotal     = SUM(payment_batches.total_amount) where batch_type='PAYROLL'
 *   paidTotal   = SUM(payment_ledger.amount) SALARY/Paid on those batches
 *
 * When every locked row has locked_net = ROUND(net), sheetTotal − lockedTotal
 * equals the sum of unlocked[].net.
 */

function toNumber(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

function toList(v) {
    if (Array.isArray(v)) return v;
    if (v == null) return [];
    if (typeof v === 'string') {
        try {
            const parsed = JSON.parse(v);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function parsePeriod(year, month) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
        const err = new Error('Invalid year or month');
        err.status = 400;
        err.code = 'INVALID_PERIOD';
        throw err;
    }
    return { y, m };
}

const RECONCILIATION_SQL = `
WITH month_rows AS (
    SELECT
        pt.employee_id,
        e.name,
        pt.net,
        ROUND(pt.net) AS rounded_net,
        COALESCE(pt.locked_net, ROUND(pt.net)) AS frozen_net,
        pt.locked,
        pt.client AS frozen_client,
        pt.contract_name AS frozen_contract,
        e.id IS NULL AS is_orphan,
        e.doj,
        e.last_working_day AS lwd,
        CASE
            WHEN e.last_working_day IS NOT NULL
                 AND e.last_working_day < make_date($1, $2, 1) THEN TRUE
            WHEN e.doj IS NOT NULL
                 AND e.doj > (make_date($1, $2, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date THEN TRUE
            ELSE FALSE
        END AS excluded_by_dates
    FROM payroll_transactions pt
    LEFT JOIN employees e ON e.id = pt.employee_id
    WHERE pt.year = $1 AND pt.month = $2
),
paid AS (
    SELECT
        pl.employee_id,
        MAX(pl.employee_name) AS name,
        SUM(pl.amount) AS amount
    FROM payment_ledger pl
    INNER JOIN payment_batches pb ON pb.id = pl.batch_id
    WHERE pb.batch_type = 'PAYROLL'
      AND pb.year = $1 AND pb.month = $2
      AND pl.payment_type = 'SALARY'
      AND pl.status = 'Paid'
    GROUP BY pl.employee_id
)
SELECT
    COALESCE((SELECT SUM(rounded_net) FROM month_rows), 0) AS sheet_total,
    COALESCE((SELECT SUM(frozen_net) FROM month_rows WHERE locked = TRUE), 0) AS locked_total,
    COALESCE((
        SELECT SUM(pb.total_amount)
        FROM payment_batches pb
        WHERE pb.batch_type = 'PAYROLL' AND pb.year = $1 AND pb.month = $2
    ), 0) AS ap_total,
    COALESCE((SELECT SUM(amount) FROM paid), 0) AS paid_total,
    COALESCE((
        SELECT json_agg(json_build_object('id', employee_id, 'name', name, 'net', rounded_net) ORDER BY employee_id)
        FROM month_rows
        WHERE locked IS NOT TRUE
    ), '[]'::json) AS unlocked,
    COALESCE((
        SELECT json_agg(json_build_object('employee_id', employee_id, 'net', rounded_net) ORDER BY employee_id)
        FROM month_rows
        WHERE locked = TRUE AND is_orphan = TRUE
    ), '[]'::json) AS orphans,
    COALESCE((
        SELECT json_agg(json_build_object('id', employee_id, 'name', name) ORDER BY employee_id)
        FROM month_rows
        WHERE locked = TRUE
          AND (TRIM(COALESCE(frozen_client, '')) = '' OR TRIM(COALESCE(frozen_contract, '')) = '')
    ), '[]'::json) AS blank_scope,
    COALESCE((
        SELECT json_agg(json_build_object(
            'id', employee_id,
            'name', name,
            'doj', to_char(doj, 'YYYY-MM-DD'),
            'lwd', to_char(lwd, 'YYYY-MM-DD')
        ) ORDER BY employee_id)
        FROM month_rows
        WHERE excluded_by_dates = TRUE
    ), '[]'::json) AS excluded_by_dates,
    COALESCE((
        SELECT json_agg(json_build_object('id', mr.employee_id, 'name', mr.name) ORDER BY mr.employee_id)
        FROM month_rows mr
        WHERE mr.locked = TRUE
          AND NOT EXISTS (SELECT 1 FROM paid p WHERE p.employee_id = mr.employee_id)
    ), '[]'::json) AS locked_not_paid,
    COALESCE((
        SELECT json_agg(json_build_object('id', p.employee_id, 'name', p.name) ORDER BY p.employee_id)
        FROM paid p
        WHERE NOT EXISTS (
            SELECT 1 FROM month_rows mr
            WHERE mr.employee_id = p.employee_id AND mr.locked = TRUE
        )
    ), '[]'::json) AS paid_not_locked
`;

function mapMoneyList(rows, idKey = 'id') {
    return toList(rows).map((r) => {
        const out = { [idKey]: r[idKey] || r.id || r.employee_id };
        if (Object.prototype.hasOwnProperty.call(r, 'name')) out.name = r.name || null;
        if (Object.prototype.hasOwnProperty.call(r, 'net')) out.net = toNumber(r.net);
        if (Object.prototype.hasOwnProperty.call(r, 'doj')) out.doj = r.doj || null;
        if (Object.prototype.hasOwnProperty.call(r, 'lwd')) out.lwd = r.lwd || null;
        return out;
    });
}

async function getPayrollReconciliation(pool, year, month) {
    const { y, m } = parsePeriod(year, month);
    const { rows } = await pool.query(RECONCILIATION_SQL, [y, m]);
    const row = rows[0] || {};
    return {
        year: y,
        month: m,
        sheetTotal: toNumber(row.sheet_total),
        lockedTotal: toNumber(row.locked_total),
        apTotal: toNumber(row.ap_total),
        paidTotal: toNumber(row.paid_total),
        unlocked: mapMoneyList(row.unlocked).map((r) => ({ id: r.id, name: r.name, net: r.net })),
        orphans: mapMoneyList(row.orphans, 'employee_id').map((r) => ({
            employee_id: r.employee_id,
            net: r.net,
        })),
        blankScope: mapMoneyList(row.blank_scope).map((r) => ({ id: r.id, name: r.name })),
        excludedByDates: mapMoneyList(row.excluded_by_dates).map((r) => ({
            id: r.id,
            name: r.name,
            doj: r.doj,
            lwd: r.lwd,
        })),
        lockedNotPaid: mapMoneyList(row.locked_not_paid).map((r) => ({ id: r.id, name: r.name })),
        paidNotLocked: mapMoneyList(row.paid_not_locked).map((r) => ({ id: r.id, name: r.name })),
    };
}

module.exports = { getPayrollReconciliation, RECONCILIATION_SQL, parsePeriod };
