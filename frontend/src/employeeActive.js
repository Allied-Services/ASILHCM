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

export function activeStatusLabel(v) {
    return isEmployeeActive(v) ? 'Active' : 'Inactive';
}
