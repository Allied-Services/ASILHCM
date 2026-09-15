'use strict';

/**
 * One-time pay (arrears) belongs to a single payroll month.
 * Attendance ingest and month-to-month override clones must not carry last
 * month's arrears forward. Recurring fields (other deduction, OT) are left alone.
 */

function previousPeriod(month, year) {
    const m = Number(month);
    const y = Number(year);
    if (!m || !y) return null;
    if (m <= 1) return { month: 12, year: y - 1 };
    return { month: m - 1, year: y };
}

function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function isCarriedForwardArrears(currentOv, previousOv) {
    if (!currentOv || !previousOv) return false;
    const current = money(currentOv.arrears);
    const previous = money(previousOv.arrears);
    return current > 0 && current === previous;
}

function stripCarriedForwardArrears(currentOv, previousOv) {
    if (!isCarriedForwardArrears(currentOv, previousOv)) return currentOv;
    return { ...currentOv, arrears: 0 };
}

async function clearCarriedForwardArrears(pool, { employeeIds, month, year }) {
    const ids = (employeeIds || []).filter(Boolean);
    const prev = previousPeriod(month, year);
    if (!pool || !ids.length || !prev) return { cleared: 0 };
    const { rowCount } = await pool.query(
        `UPDATE monthly_attendance_overrides AS cur
         SET arrears = 0, updated_at = NOW()
         FROM monthly_attendance_overrides AS prev
         WHERE cur.employee_id = prev.employee_id
           AND cur.employee_id = ANY($1::text[])
           AND cur.period_month = $2 AND cur.period_year = $3
           AND prev.period_month = $4 AND prev.period_year = $5
           AND COALESCE(cur.arrears, 0) > 0
           AND cur.arrears = prev.arrears`,
        [ids, month, year, prev.month, prev.year]
    );
    return { cleared: rowCount || 0 };
}

module.exports = {
    previousPeriod,
    isCarriedForwardArrears,
    stripCarriedForwardArrears,
    clearCarriedForwardArrears,
};
