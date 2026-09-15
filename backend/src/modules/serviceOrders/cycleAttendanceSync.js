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

        const so = findServiceOrderForEmployee(orders, emp);
        if (!so) {
            summary.errors.push({
                employeeId: emp.id,
                reason: 'no_matching_site',
                site: emp.site,
            });
            continue;
        }
        const lines = Array.isArray(so.lines) ? so.lines : [];
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
        if (amount <= 0) continue;
        insertRows.push({
            serviceOrderId: so.id,
            lineId: match.line.id,
            employeeId: emp.id,
            absentDays,
            amount,
        });
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

module.exports = {
    CYCLE_AND_FV_ATTENDANCE_SOURCES,
    findServiceOrderForEmployee,
    syncSoDeductionsFromCycleRows,
};
