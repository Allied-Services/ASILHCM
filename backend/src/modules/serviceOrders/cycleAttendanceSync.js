'use strict';

const { listServiceOrders } = require('./crud');
const { absenceDeductionAmount } = require('./sitesMeta');
const { findLineForDesignation } = require('./designationMatch');

/** Override sources that mean "this month's attendance is in". */
const CYCLE_AND_FV_ATTENDANCE_SOURCES = ['fv_conservancy_attendance', 'cycle_machine_file'];

function findServiceOrderForEmployee(orders, emp) {
    if (!Array.isArray(orders) || !orders.length) return null;
    if (orders.length === 1) return orders[0];
    const site = String(emp?.site || '').trim().toUpperCase();
    const loc = String(emp?.location || '').trim().toUpperCase();
    const exact = orders.find((o) => String(o.site_code || '').toUpperCase() === site);
    if (exact) return exact;
    return orders.find((o) => {
        const code = String(o.site_code || '').toUpperCase();
        return !!code && (site.includes(code) || loc.includes(code));
    }) || null;
}

/**
 * Rebuild attendance_ledger shortage rows for the submitted employees on an
 * FV / Conservancy contract. Cost-plus contracts (no service orders) no-op.
 * Only touches employees in `rows` so a partial file does not wipe other sites.
 */
async function syncSoDeductionsFromCycleRows(pool, {
    contractId,
    month,
    year,
    actor,
    rows,
    monthDays = 30,
}) {
    const summary = {
        contractId,
        month,
        year,
        deductions: 0,
        cleared: 0,
        skipped: [],
        errors: [],
    };
    const employeeIds = [...new Set((rows || []).map((r) => r.employeeId).filter(Boolean))];
    if (!contractId || !employeeIds.length) return summary;

    const orders = await listServiceOrders(pool, { contractId });
    if (!orders.length) {
        summary.skipped.push({ reason: 'no_service_orders' });
        return summary;
    }

    const { rows: emps } = await pool.query(
        `SELECT id, designation, site, location
         FROM employees
         WHERE id = ANY($1::text[])`,
        [employeeIds]
    );
    const empById = new Map(emps.map((e) => [e.id, e]));

    await pool.query(
        `DELETE FROM so_deductions d
         USING service_orders so
         WHERE d.service_order_id = so.id
           AND so.contract_id = $1
           AND d.period_month = $2
           AND d.period_year = $3
           AND d.source = 'attendance_ledger'
           AND d.employee_id = ANY($4::text[])`,
        [contractId, month, year, employeeIds]
    );
    summary.cleared = employeeIds.length;

    const insertRows = [];
    for (const row of rows || []) {
        const emp = empById.get(row.employeeId);
        if (!emp) {
            summary.errors.push({ employeeId: row.employeeId, reason: 'employee_not_found' });
            continue;
        }
        const absentDays = Math.max(0, Number(row.absentDays) || 0);
        if (absentDays <= 0) continue;

        try {
            const so = findServiceOrderForEmployee(orders, emp);
            if (!so) {
                summary.errors.push({
                    employeeId: emp.id,
                    reason: 'no_matching_site',
                    site: emp.site,
                });
                continue;
            }
            const lines = Array.isArray(so.lines)
                ? so.lines
                : (typeof so.lines === 'string' ? JSON.parse(so.lines || '[]') : []);
            const match = findLineForDesignation(lines, emp.designation, { siteCode: so.site_code });
            if (!match) {
                summary.errors.push({
                    employeeId: emp.id,
                    reason: 'no_matching_line',
                    designation: emp.designation,
                    site: so.site_code,
                });
                continue;
            }
            const amount = absenceDeductionAmount(match.line.rate, match.roles, absentDays, monthDays);
            if (!Number.isFinite(amount) || amount <= 0) continue;
            insertRows.push({
                serviceOrderId: so.id,
                lineId: match.line.id,
                employeeId: emp.id,
                absentDays: Math.min(absentDays, 9999.99),
                amount,
            });
        } catch (err) {
            console.error('[cycleAttendanceSync] employee', emp.id, err);
            summary.errors.push({
                employeeId: emp.id,
                reason: 'match_failed',
                designation: emp.designation,
            });
        }
    }

    if (insertRows.length) {
        const values = [];
        const params = [];
        insertRows.forEach((r, i) => {
            const o = i * 8;
            values.push(
                `($${o + 1},$${o + 2},$${o + 3},$${o + 4},'absence',$${o + 5},$${o + 6},$${o + 7},'attendance_ledger',$${o + 8})`
            );
            params.push(
                r.serviceOrderId,
                r.lineId,
                month,
                year,
                r.employeeId,
                r.absentDays,
                r.amount,
                actor || null
            );
        });
        await pool.query(
            `INSERT INTO so_deductions
                (service_order_id, line_id, period_month, period_year, type,
                 employee_id, days_absent, amount, source, approved_by)
             VALUES ${values.join(',')}`,
            params
        );
        summary.deductions = insertRows.length;
    }

    return summary;
}

/** Service Order invoices always prorate on a 30-day month. */
const SO_MONTH_DAYS = 30;

/**
 * Turn locked Payroll Sheet paid_days into the row shape Collect already
 * uses. Absent days = 30 − paid_days (never negative). Cost-plus contracts
 * with no service orders stay a no-op inside syncSoDeductionsFromCycleRows.
 */
function rowsFromLockedPaidDays(sheetRows, monthDays = SO_MONTH_DAYS) {
    const days = Number(monthDays) || SO_MONTH_DAYS;
    const byContract = new Map();
    for (const r of sheetRows || []) {
        if (!r || r.employee_id == null || r.employee_id === '') continue;
        if (r.contract_id == null || r.contract_id === '') continue;
        if (r.paid_days == null || r.paid_days === '') continue;
        const paid = Number(r.paid_days);
        if (!Number.isFinite(paid)) continue;
        const cid = String(r.contract_id);
        if (!byContract.has(cid)) byContract.set(cid, []);
        byContract.get(cid).push({
            employeeId: String(r.employee_id),
            presentDays: paid,
            absentDays: Math.max(0, days - paid),
        });
    }
    return byContract;
}

/**
 * Rebuild attendance_ledger shortages from the locked Sheet, not the
 * machine file. Manual signed adjustments (source != attendance_ledger)
 * are left alone. Cost-plus / Wafi contracts no-op (no service orders).
 */
async function syncSoDeductionsFromLockedSheet(pool, {
    year,
    month,
    employeeIds,
    actor,
    monthDays = SO_MONTH_DAYS,
} = {}) {
    const summary = {
        contracts: 0,
        deductions: 0,
        cleared: 0,
        skipped: [],
        errors: [],
    };
    const ids = [...new Set((employeeIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return summary;

    const { rows } = await pool.query(
        `SELECT pt.employee_id, pt.paid_days, e.contract_id
         FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE pt.year = $1 AND pt.month = $2
           AND pt.locked = TRUE
           AND pt.employee_id = ANY($3::text[])`,
        [year, month, ids]
    );

    const byContract = rowsFromLockedPaidDays(rows, monthDays);
    for (const [contractId, contractRows] of byContract) {
        try {
            const part = await syncSoDeductionsFromCycleRows(pool, {
                contractId,
                month,
                year,
                actor,
                rows: contractRows,
                monthDays,
            });
            summary.contracts += 1;
            summary.deductions += Number(part.deductions) || 0;
            summary.cleared += Number(part.cleared) || 0;
            if (part.errors?.length) summary.errors.push(...part.errors);
            if (part.skipped?.length) summary.skipped.push(...part.skipped);
        } catch (err) {
            console.error('[lock-sheet so_sync]', contractId, err);
            summary.errors.push({ contractId, reason: 'sync_failed' });
        }
    }
    return summary;
}

module.exports = {
    CYCLE_AND_FV_ATTENDANCE_SOURCES,
    SO_MONTH_DAYS,
    findServiceOrderForEmployee,
    rowsFromLockedPaidDays,
    syncSoDeductionsFromCycleRows,
    syncSoDeductionsFromLockedSheet,
};
