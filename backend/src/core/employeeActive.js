'use strict';

/**
 * Canonical employee active flag — matches payroll / attendance backend filters.
 * DB stores 'Yes' | 'No'; imports may arrive as YES, true, etc.
 * Last working day on or before as-of date makes the person inactive even if
 * the stored flag is still Yes.
 */

function normalizeActiveValue(v) {
    if (v == null || String(v).trim() === '') return 'Yes';
    const s = String(v).trim();
    const lower = s.toLowerCase();
    if (['no', 'false', '0', 'inactive'].includes(lower)) return 'No';
    if (['yes', 'true', '1', 'active'].includes(lower)) return 'Yes';
    return s;
}

function isEmployeeActive(v) {
    if (v == null || String(v).trim() === '') return true;
    return !['no', 'false', '0', 'inactive'].includes(String(v).trim().toLowerCase());
}

function toDay(d) {
    if (!d) return '';
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    const s = String(d).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

function todayYmd(asOf = new Date()) {
    if (asOf instanceof Date && !Number.isNaN(asOf.getTime())) return asOf.toISOString().slice(0, 10);
    return toDay(asOf) || new Date().toISOString().slice(0, 10);
}

function isEmployeeCurrentlyActive(emp, asOf = new Date()) {
    if (!emp) return false;
    if (!isEmployeeActive(emp.active)) return false;
    const lwd = toDay(emp.last_working_day || emp.lastWorkingDay);
    if (!lwd) return true;
    return lwd >= todayYmd(asOf);
}

/**
 * Persist Inactive when LWD is today or earlier.
 * Clearing LWD does not auto-reactivate.
 */
function applyLastWorkingDayToActive(active, lastWorkingDay, asOf = new Date()) {
    const lwd = toDay(lastWorkingDay);
    if (!lwd) return active;
    if (lwd <= todayYmd(asOf)) return 'No';
    return active;
}

function derivedActiveStatusLabel(emp, asOf = new Date()) {
    return isEmployeeCurrentlyActive(emp, asOf) ? 'Active' : 'Inactive';
}

/** SQL fragment: employee row counts as active (text active + optional LWD floor). */
function activeEmployeeSqlClause(alias = 'e', { lwdFloorSql } = {}) {
    const a = alias;
    const lwd = lwdFloorSql
        ? `AND (${a}.last_working_day IS NULL OR ${a}.last_working_day >= ${lwdFloorSql})`
        : '';
    return `(
        LOWER(TRIM(${a}.active::text)) NOT IN ('no','false','0','inactive')
        AND (
            ${a}.active IS NULL
            OR LOWER(TRIM(${a}.active::text)) IN ('yes','true','1','active','')
            OR ${a}.active::text = 'Yes'
        )
        ${lwd}
    )`;
}

/** Directory Active: flag yes AND not already left. */
function currentlyActiveSqlClause(alias = 'e') {
    const a = alias;
    return `(
        ${activeEmployeeSqlClause(a)}
        AND (${a}.last_working_day IS NULL OR ${a}.last_working_day >= CURRENT_DATE)
    )`;
}

/** Directory Inactive: flag no OR last working day already passed. */
function currentlyInactiveSqlClause(alias = 'e') {
    const a = alias;
    return `(
        LOWER(TRIM(${a}.active::text)) IN ('no','false','0','inactive')
        OR (${a}.last_working_day IS NOT NULL AND ${a}.last_working_day < CURRENT_DATE)
    )`;
}

module.exports = {
    normalizeActiveValue,
    isEmployeeActive,
    isEmployeeCurrentlyActive,
    applyLastWorkingDayToActive,
    derivedActiveStatusLabel,
    activeEmployeeSqlClause,
    currentlyActiveSqlClause,
    currentlyInactiveSqlClause,
    toDay,
};
