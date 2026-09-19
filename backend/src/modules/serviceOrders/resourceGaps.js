'use strict';

const { listServiceOrders } = require('./crud');
const { absenceDeductionAmount } = require('./sitesMeta');
const { designationsMatch, normalizeDesignation } = require('./designationMatch');
const { toDay } = require('../../core/employeeActive');

function lineRoles(line) {
    if (Array.isArray(line?.roles)) return line.roles;
    if (typeof line?.roles === 'string') {
        try { return JSON.parse(line.roles || '[]'); } catch { return []; }
    }
    return [];
}

function isManpower(line) {
    return !!(line?.is_manpower_dependent || line.isManpowerDependent);
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function calendarDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

function sameSite(a, b) {
    return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}

function monthBounds(year, month) {
    const last = calendarDaysInMonth(year, month);
    return {
        start: `${year}-${pad2(month)}-01`,
        end: `${year}-${pad2(month)}-${pad2(last)}`,
        last,
    };
}

/** Billing-month days the person covered this role slot (30-day SO month). */
function employedDaysInBillingMonth(emp, year, month, monthDays = 30) {
    const { start, end } = monthBounds(year, month);
    const join = toDay(emp.doj || emp.date_of_joining || emp.joining_date);
    const lwd = toDay(emp.last_working_day || emp.lastWorkingDay);
    if (join && join > end) return 0;
    if (lwd && lwd < start) return 0;

    let startDay = 1;
    if (join && join >= start && join <= end) {
        startDay = Number(join.slice(8, 10));
    }
    let endDay = Number(monthDays) || 30;
    if (lwd && lwd >= start && lwd <= end) {
        endDay = Math.min(endDay, Number(lwd.slice(8, 10)));
    }
    return Math.max(0, endDay - startDay + 1);
}

function vacancyDaysForRole(role, employees, year, month, monthDays = 30) {
    const slots = Number(role.count) || 0;
    if (slots <= 0) return 0;
    const required = slots * (Number(monthDays) || 30);
    const covering = employees
        .map((emp) => employedDaysInBillingMonth(emp, year, month, monthDays))
        .filter((n) => n > 0)
        .sort((a, b) => b - a)
        .slice(0, slots);
    const covered = covering.reduce((n, d) => n + d, 0);
    return Math.max(0, required - covered);
}

async function ensureDeductionNoteColumn(pool) {
    await pool.query('ALTER TABLE so_deductions ADD COLUMN IF NOT EXISTS note TEXT');
}

/**
 * Rebuild resource_gap rows for unfilled SO role slots.
 * Named attendance absences stay on source=attendance_ledger.
 */
async function reconcileResourceGaps(pool, {
    contractId,
    month,
    year,
    actor,
    monthDays = 30,
} = {}) {
    const summary = { contractId, month, year, gaps: 0, cleared: 0 };
    if (!contractId) return summary;

    const orders = await listServiceOrders(pool, { contractId });
    if (!orders.length) return summary;

    await ensureDeductionNoteColumn(pool);
    await pool.query(
        `DELETE FROM so_deductions d
         USING service_orders so
         WHERE d.service_order_id = so.id
           AND so.contract_id = $1
           AND d.period_month = $2
           AND d.period_year = $3
           AND d.source = 'resource_gap'`,
        [contractId, month, year]
    );
    summary.cleared = 1;

    const { rows: roster } = await pool.query(
        `SELECT id, name, designation, site, location, doj, last_working_day, active
         FROM employees
         WHERE contract_id = $1`,
        [contractId]
    );

    const insertRows = [];
    for (const so of orders) {
        const site = so.site_code || so.siteCode || '';
        for (const line of so.lines || []) {
            if (!isManpower(line)) continue;
            for (const role of lineRoles(line)) {
                const designation = role.designation || role.role || '';
                if (!normalizeDesignation(designation)) continue;
                const matches = roster.filter((emp) => (
                    designationsMatch(emp.designation, designation)
                    && (!site || sameSite(emp.site, site) || String(emp.location || '').toUpperCase().includes(String(site).toUpperCase()))
                ));
                const days = vacancyDaysForRole(role, matches, year, month, monthDays);
                if (days <= 0) continue;
                const amount = absenceDeductionAmount(line.rate, lineRoles(line), days, monthDays, role);
                if (!Number.isFinite(amount) || amount <= 0) continue;
                insertRows.push({
                    serviceOrderId: so.id,
                    lineId: line.id,
                    days,
                    amount,
                    note: `Missing Resource / ${designation}`,
                });
            }
        }
    }

    if (insertRows.length) {
        const values = [];
        const params = [];
        insertRows.forEach((r, i) => {
            const o = i * 8;
            values.push(
                `($${o + 1},$${o + 2},$${o + 3},$${o + 4},'resource_gap',NULL,$${o + 5},$${o + 6},'resource_gap',$${o + 7},$${o + 8})`
            );
            params.push(
                r.serviceOrderId,
                r.lineId,
                month,
                year,
                r.days,
                r.amount,
                actor || null,
                r.note
            );
        });
        await pool.query(
            `INSERT INTO so_deductions
                (service_order_id, line_id, period_month, period_year, type,
                 employee_id, days_absent, amount, source, approved_by, note)
             VALUES ${values.join(',')}`,
            params
        );
        summary.gaps = insertRows.length;
    }

    return summary;
}

module.exports = {
    employedDaysInBillingMonth,
    vacancyDaysForRole,
    reconcileResourceGaps,
};
