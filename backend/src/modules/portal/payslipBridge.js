'use strict';

/** Run statuses where employees may view payslips (matches payrollrun/routes.js). */
const WORLD_B_VISIBLE_STATUSES = ['locked', 'invoiced', 'paid'];

function parseJsonField(val, fallback) {
    if (val == null) return fallback;
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return fallback; }
    }
    return val;
}

function periodKey(month, year) {
    return `${year}-${Number(month)}`;
}

function mapWorldARowToSummary(p) {
    return {
        month: Number(p.month),
        year: Number(p.year),
        gross: parseFloat(p.gross) || 0,
        net: parseFloat(p.net) || 0,
        wht: parseFloat(p.wht) || 0,
        eobi: parseFloat(p.eobi_ee) || 0,
        advance: parseFloat(p.adv) || 0,
        status: p.status,
        source: 'world_a',
    };
}

function mapWorldBRowToSummary(row) {
    const computed = parseJsonField(row.computed, {});
    const inputs = parseJsonField(row.inputs, {});
    return {
        month: Number(row.period_month),
        year: Number(row.period_year),
        gross: parseFloat(computed.gross) || 0,
        net: parseFloat(computed.netPay) || 0,
        wht: parseFloat(computed.wht) || 0,
        eobi: parseFloat(computed.eobiEmployee) || 400,
        advance: parseFloat(inputs.advanceDeduction) || 0,
        status: row.run_status || 'locked',
        source: 'world_b',
        runId: row.run_id,
    };
}

/** Merge World A + World B summaries; World B wins for the same month/year. */
function mergePayslipSummaries(worldARows, worldBRows) {
    const byPeriod = new Map();
    for (const p of worldARows) {
        byPeriod.set(periodKey(p.month, p.year), p);
    }
    for (const p of worldBRows) {
        byPeriod.set(periodKey(p.month, p.year), p);
    }
    return Array.from(byPeriod.values())
        .sort((a, b) => (b.year - a.year) || (b.month - a.month))
        .slice(0, 24);
}

async function fetchWorldBPayslipSummaries(pool, employeeId, limit = 24) {
    const { rows } = await pool.query(
        `SELECT prr.computed, prr.inputs, pr.period_month, pr.period_year,
                pr.status AS run_status, pr.id AS run_id
         FROM payroll_run_rows prr
         JOIN payroll_runs pr ON pr.id = prr.run_id
         WHERE prr.employee_id = $1
           AND pr.status = ANY($2::text[])
         ORDER BY pr.period_year DESC, pr.period_month DESC
         LIMIT $3`,
        [employeeId, WORLD_B_VISIBLE_STATUSES, limit]
    );
    return rows.map(mapWorldBRowToSummary);
}

async function fetchWorldBPayslipDetail(pool, employeeId, month, year) {
    const { rows } = await pool.query(
        `SELECT prr.paid_days, prr.working_days, prr.computed,
                pr.period_month, pr.period_year
         FROM payroll_run_rows prr
         JOIN payroll_runs pr ON pr.id = prr.run_id
         WHERE prr.employee_id = $1
           AND pr.period_month = $2
           AND pr.period_year = $3
           AND pr.status = ANY($4::text[])
         ORDER BY pr.computed_at DESC NULLS LAST
         LIMIT 1`,
        [employeeId, Number(month), Number(year), WORLD_B_VISIBLE_STATUSES]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return {
        computed: parseJsonField(row.computed, {}),
        month: row.period_month,
        year: row.period_year,
        paidDays: row.paid_days,
        workingDays: row.working_days,
    };
}

module.exports = {
    WORLD_B_VISIBLE_STATUSES,
    mapWorldARowToSummary,
    mapWorldBRowToSummary,
    mergePayslipSummaries,
    fetchWorldBPayslipSummaries,
    fetchWorldBPayslipDetail,
};
