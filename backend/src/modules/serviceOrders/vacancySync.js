'use strict';

const { employeeActiveInPeriod } = require('../records/machineFile');
const { designationsMatch } = require('./designationMatch');
const {
    absenceDeductionAmount,
    isLineManpower,
    isRoleManpower,
    lineRoles,
} = require('./sitesMeta');
const { enrichLinesWithSeedRoleRates } = require('./seedRoleRates');

function employeeBelongsToSite(emp, so) {
    const site = String(emp?.site || '').trim().toUpperCase();
    const loc = String(emp?.location || '').trim().toUpperCase();
    const code = String(so?.site_code || so?.siteCode || '').trim().toUpperCase();
    const name = String(so?.name || '').trim().toUpperCase();
    if (code && site === code) return true;
    if (code && (site.includes(code) || loc.includes(code))) return true;
    if (name && (loc.includes(name) || site.includes(name))) return true;
    return false;
}

const VACANCY_SOURCES = ['vacancy', 'vacancy_roster'];
const SO_MONTH_DAYS = 30;

function manpowerRoles(line) {
    return lineRoles(line).filter((role) => {
        if (!isRoleManpower(role, line)) return false;
        const count = Number(role.count) || 0;
        const name = String(role.designation || role.role || '').trim();
        return count > 0 && !!name;
    });
}

function displayRoleName(role) {
    return String(role.designation || role.role || 'Resource').trim() || 'Resource';
}

/**
 * Compare SO manpower counts to people employed at the site this month.
 * Unfilled slots → unnamed missing service (full month at the role rate).
 * Named people who were employed but not on the attendance file → named
 * full-month shortage. Named people already on attendance_ledger are left
 * to that path (e.g. 15 days absent at the same role rate).
 */
function planVacancies({
    lines,
    employees = [],
    overridesByEmployeeId = new Map(),
    existingAbsenceEmployeeIds = new Set(),
    monthDays = SO_MONTH_DAYS,
    year,
    month,
} = {}) {
    const inPeriod = (employees || []).filter((e) => employeeActiveInPeriod(e, year, month));
    const used = new Set();
    const deductions = [];

    for (const line of lines || []) {
        if (!isLineManpower(line) && !manpowerRoles(line).length) continue;
        for (const role of manpowerRoles(line)) {
            const required = Number(role.count) || 0;
            const matches = inPeriod.filter((emp) => (
                !used.has(emp.id)
                && designationsMatch(emp.designation, role.designation || role.role)
            ));
            const assigned = matches.slice(0, required);
            assigned.forEach((emp) => used.add(emp.id));
            const unfilled = Math.max(0, required - assigned.length);

            for (const emp of assigned) {
                if (existingAbsenceEmployeeIds.has(emp.id)) continue;
                const ov = overridesByEmployeeId.get(emp.id);
                const absentDays = ov
                    ? Math.max(0, Number(ov.absent_days ?? ov.absentDays) || 0)
                    : monthDays;
                if (absentDays <= 0) continue;
                const amount = absenceDeductionAmount(line.rate, lineRoles(line), absentDays, monthDays, role);
                if (!(amount > 0)) continue;
                deductions.push({
                    type: 'absence',
                    source: 'vacancy_roster',
                    lineId: line.id,
                    employeeId: emp.id,
                    daysAbsent: Math.min(absentDays, 9999.99),
                    amount,
                    note: null,
                    designation: displayRoleName(role),
                });
            }

            for (let i = 0; i < unfilled; i += 1) {
                const amount = absenceDeductionAmount(line.rate, lineRoles(line), monthDays, monthDays, role);
                if (!(amount > 0)) continue;
                deductions.push({
                    type: 'vacancy',
                    source: 'vacancy',
                    lineId: line.id,
                    employeeId: null,
                    daysAbsent: monthDays,
                    amount,
                    note: `Missing service: ${displayRoleName(role)} — 1 resource unfilled`,
                    designation: displayRoleName(role),
                });
            }
        }
    }
    return deductions;
}

async function ensureDeductionNoteColumn(pool) {
    try {
        await pool.query('ALTER TABLE so_deductions ADD COLUMN IF NOT EXISTS note TEXT');
    } catch (err) {
        console.error('[vacancySync note-column]', err);
    }
}

async function syncVacanciesForServiceOrder(pool, {
    serviceOrder,
    month,
    year,
    actor,
    monthDays = SO_MONTH_DAYS,
} = {}) {
    const so = serviceOrder;
    if (!so?.id || !so.contract_id) {
        return { vacancies: 0, rosterAbsences: 0 };
    }
    const rawLines = Array.isArray(so.lines)
        ? so.lines
        : (typeof so.lines === 'string' ? JSON.parse(so.lines || '[]') : []);
    const lines = enrichLinesWithSeedRoleRates(so.site_code || so.siteCode, rawLines);

    const { rows: emps } = await pool.query(
        `SELECT id, name, designation, site, location, active, last_working_day, doj, contract_id
         FROM employees
         WHERE contract_id::text = $1`,
        [String(so.contract_id)]
    );
    const atSite = emps.filter((emp) => employeeBelongsToSite(emp, so));
    const leaverIds = emps
        .filter((emp) => !employeeActiveInPeriod(emp, year, month))
        .map((emp) => emp.id)
        .filter(Boolean);
    if (leaverIds.length) {
        await pool.query(
            `DELETE FROM so_deductions
             WHERE service_order_id = $1
               AND period_month = $2 AND period_year = $3
               AND source = 'attendance_ledger'
               AND employee_id = ANY($4::text[])`,
            [so.id, month, year, leaverIds]
        );
    }

    const ids = atSite.map((e) => e.id);
    const overridesByEmployeeId = new Map();
    if (ids.length) {
        const { rows: ovRows } = await pool.query(
            `SELECT employee_id, present_days, absent_days
             FROM monthly_attendance_overrides
             WHERE period_month = $1 AND period_year = $2
               AND employee_id = ANY($3::text[])`,
            [month, year, ids]
        );
        for (const row of ovRows) overridesByEmployeeId.set(row.employee_id, row);
    }

    const { rows: existingAbs } = await pool.query(
        `SELECT employee_id FROM so_deductions
         WHERE service_order_id = $1
           AND period_month = $2 AND period_year = $3
           AND source = 'attendance_ledger'
           AND employee_id IS NOT NULL`,
        [so.id, month, year]
    );
    const existingAbsenceEmployeeIds = new Set(existingAbs.map((r) => r.employee_id));

    const planned = planVacancies({
        lines,
        employees: atSite,
        overridesByEmployeeId,
        existingAbsenceEmployeeIds,
        monthDays,
        year,
        month,
    });

    await pool.query(
        `DELETE FROM so_deductions
         WHERE service_order_id = $1
           AND period_month = $2 AND period_year = $3
           AND source = ANY($4::text[])`,
        [so.id, month, year, VACANCY_SOURCES]
    );

    if (!planned.length) {
        return { vacancies: 0, rosterAbsences: 0 };
    }

    await ensureDeductionNoteColumn(pool);

    const values = [];
    const params = [];
    planned.forEach((r, i) => {
        const o = i * 10;
        values.push(
            `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10})`
        );
        params.push(
            so.id,
            r.lineId || null,
            month,
            year,
            r.type,
            r.employeeId,
            r.daysAbsent,
            r.amount,
            r.source,
            r.note
        );
    });
    await pool.query(
        `INSERT INTO so_deductions
            (service_order_id, line_id, period_month, period_year, type,
             employee_id, days_absent, amount, source, note)
         VALUES ${values.join(',')}`,
        params
    );
    void actor;

    return {
        vacancies: planned.filter((d) => d.source === 'vacancy').length,
        rosterAbsences: planned.filter((d) => d.source === 'vacancy_roster').length,
    };
}

module.exports = {
    VACANCY_SOURCES,
    SO_MONTH_DAYS,
    employeeBelongsToSite,
    manpowerRoles,
    planVacancies,
    syncVacanciesForServiceOrder,
};
