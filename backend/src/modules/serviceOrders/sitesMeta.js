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

/** dailyRate = (line.rate / roleCount) / 30 ; amount = dailyRate × absentDays */
function absenceDeductionAmount(lineRate, roles, absentDays, monthDays = 30) {
    const count = roleCount(roles) || 1;
    const daily = (Number(lineRate) / count) / (Number(monthDays) || 30);
    return Math.round(daily * Number(absentDays || 0) * 100) / 100;
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
    absenceDeductionAmount,
};
