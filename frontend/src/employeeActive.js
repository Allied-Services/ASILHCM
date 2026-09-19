/** Canonical employee active flag — mirrors backend/src/core/employeeActive.js */

export function normalizeActiveValue(v) {
    if (v == null || String(v).trim() === '') return 'Yes';
    const s = String(v).trim();
    const lower = s.toLowerCase();
    if (['no', 'false', '0', 'inactive'].includes(lower)) return 'No';
    if (['yes', 'true', '1', 'active'].includes(lower)) return 'Yes';
    return s;
}

export function isEmployeeActive(v) {
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

export function isEmployeeCurrentlyActive(emp, asOf = new Date()) {
    if (!emp) return false;
    if (!isEmployeeActive(emp.active)) return false;
    const lwd = toDay(emp.lastWorkingDay || emp.last_working_day);
    if (!lwd) return true;
    return lwd >= todayYmd(asOf);
}

export function applyLastWorkingDayToActive(active, lastWorkingDay, asOf = new Date()) {
    const lwd = toDay(lastWorkingDay);
    if (!lwd) return active;
    if (lwd <= todayYmd(asOf)) return 'No';
    return active;
}

export function activeStatusLabel(v) {
    return isEmployeeActive(v) ? 'Active' : 'Inactive';
}

export function derivedActiveStatusLabel(emp, asOf = new Date()) {
    return isEmployeeCurrentlyActive(emp, asOf) ? 'Active' : 'Inactive';
}
