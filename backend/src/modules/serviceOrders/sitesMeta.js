'use strict';

const SITE_PROVINCES = {
    MORGAH: 'Punjab',
    CHAKPIRANA: 'Punjab',
    SIHALA: 'Punjab',
    FAQIRABAD: 'KPK',
    JUGLOT: 'Gilgit Baltistan',
    CHITRAL: 'KPK',
    TARUJABBA: 'KPK',
    SERAINOURANG: 'KPK',
    KOHAT: 'KPK',
    KUNDIAN: 'Punjab',
    DGM_OPS: 'Punjab',
    PR_FUELING: 'Punjab',
    SS94: 'Punjab',
};

/** Staging-safe employee id prefix — never reuse production ASIL-* ids. */
const EMP_ID_PREFIX = 'ASIL-PSO-NZ-';
const PSO_CONTRACT_ID = 'CTR-PSO-NORTH-ZONE';
const PSO_CONTRACT_NAME = 'PSO North Zone Operations';
const PSO_SERVICE_TYPE = 'Fixed Value / Conservancy';
const CORO_CONTRACT_ID = 'CTR-PSO-CORO-MA';
const CORO_CONTRACT_NAME = 'CORO - Masood Anwari';
const CORO_SITE_CODE = 'SS94';
const CONTRACT_START = '2026-03-01';
const CONTRACT_END = '2027-02-28';
const SO_BILLING_MODELS = new Set(['service_order_deduction', 'fixed_value']);

function isSoBillingModel(model) {
    return SO_BILLING_MODELS.has(String(model || '').toLowerCase());
}

/**
 * Resolve province for tax / location.
 * Prefer: so.meta.province → locationProvince → contract.region_province → SITE_PROVINCES → Punjab.
 */
function siteProvince(siteCode, opts = {}) {
    const meta = opts.soMeta || opts.meta || {};
    if (meta.province) return meta.province;
    if (opts.locationProvince) return opts.locationProvince;
    if (opts.contract?.region_province) return opts.contract.region_province;
    if (SITE_PROVINCES[siteCode]) return SITE_PROVINCES[siteCode];
    return 'Punjab';
}

function roleCount(roles) {
    if (!Array.isArray(roles) || !roles.length) return 0;
    return roles.reduce((n, r) => n + (Number(r.count) || 0), 0);
}

function lineRoles(lineOrRoles) {
    if (Array.isArray(lineOrRoles)) return lineOrRoles;
    if (Array.isArray(lineOrRoles?.roles)) return lineOrRoles.roles;
    if (typeof lineOrRoles?.roles === 'string') {
        try { return JSON.parse(lineOrRoles.roles || '[]'); } catch { return []; }
    }
    return [];
}

function isLineManpower(line) {
    return !!(line?.is_manpower_dependent || line?.isManpowerDependent);
}

function isRoleManpower(role, line) {
    if (role && (role.is_manpower_dependent != null || role.isManpowerDependent != null)) {
        return !!(role.is_manpower_dependent || role.isManpowerDependent);
    }
    return isLineManpower(line);
}

function calendarDaysInMonth(month, year) {
    const m = Number(month);
    const y = Number(year);
    if (!y || !m || m < 1 || m > 12) return 0;
    return new Date(y, m, 0).getDate();
}

function explicitRoleRate(role) {
    const n = Number(role?.rate ?? role?.monthly_rate);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Monthly billed rate for one resource of this nested SO service.
 * 1) role.rate (per-resource unit, e.g. Sihala Sweeping 52,043)
 * 2) else the line is that one service → line.rate / count (Pesh Imam, CORO)
 * 3) else 0 — never split a kitchen-sink lump across every headcount
 */
function roleUnitRate(lineOrRate, roles, role = null) {
    if (role && explicitRoleRate(role)) return explicitRoleRate(role);
    const line = (lineOrRate && typeof lineOrRate === 'object' && !Array.isArray(lineOrRate))
        ? lineOrRate
        : { rate: lineOrRate, roles };
    const list = lineRoles(roles != null ? roles : line);
    const lineRate = Number(line.rate || lineOrRate || 0);
    if (list.length <= 1) {
        const count = (role && Number(role.count) > 0 ? Number(role.count) : roleCount(list)) || 1;
        return lineRate / count;
    }
    return 0;
}

function roleMonthlyRate(lineOrRate, roles, role = null) {
    return roleUnitRate(lineOrRate, roles, role);
}

/** dailyRate = unit / calendarDays ; amount = dailyRate × absentDays */
function absenceDeductionAmount(lineRate, roles, absentDays, monthDays = 30, role = null) {
    const monthly = roleUnitRate({ rate: lineRate, roles }, roles, role);
    if (!(monthly > 0)) return 0;
    const days = Number(monthDays) || 30;
    return Math.round((monthly / days) * Number(absentDays || 0) * 100) / 100;
}

module.exports = {
    SITE_PROVINCES,
    EMP_ID_PREFIX,
    PSO_CONTRACT_ID,
    PSO_CONTRACT_NAME,
    PSO_SERVICE_TYPE,
    CORO_CONTRACT_ID,
    CORO_CONTRACT_NAME,
    CORO_SITE_CODE,
    CONTRACT_START,
    CONTRACT_END,
    SO_BILLING_MODELS,
    isSoBillingModel,
    siteProvince,
    roleCount,
    lineRoles,
    isLineManpower,
    isRoleManpower,
    calendarDaysInMonth,
    explicitRoleRate,
    roleUnitRate,
    roleMonthlyRate,
    absenceDeductionAmount,
};
