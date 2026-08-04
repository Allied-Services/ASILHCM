'use strict';

/**
 * Canonical employee active flag — matches payroll / attendance backend filters.
 * DB stores 'Yes' | 'No'; imports may arrive as YES, true, etc.
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

module.exports = {
    normalizeActiveValue,
    isEmployeeActive,
    activeEmployeeSqlClause,
};
