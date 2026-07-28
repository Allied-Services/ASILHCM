'use strict';

const SITE_PROVINCES = {
    MORGAH: 'Punjab',
    CHAKPIRANA: 'Punjab',
    SIHALA: 'Punjab',
    FAQIRABAD: 'KPK',
    JUGLOT: 'GB',
    CHITRAL: 'KPK',
    TARUJABBA: 'KPK',
    SERAINOURANG: 'KPK',
    KOHAT: 'KPK',
    KUNDIAN: 'Punjab',
    DGM_OPS: 'Punjab',
    PR_FUELING: 'Punjab',
};

/** Staging-safe employee id prefix — never reuse production ASIL-* ids. */
const EMP_ID_PREFIX = 'ASIL-PSO-NZ-';
const PSO_CONTRACT_ID = 'CTR-PSO-NORTH-ZONE';
const PSO_CONTRACT_NAME = 'PSO North Zone Operations';
const PSO_SERVICE_TYPE = 'Fixed Value / Conservancy';
const CONTRACT_START = '2026-03-01';
const CONTRACT_END = '2027-02-28';
const SO_BILLING_MODELS = new Set(['service_order_deduction', 'fixed_value']);

function isSoBillingModel(model) {
    return SO_BILLING_MODELS.has(String(model || '').toLowerCase());
}

function siteProvince(siteCode) {
    return SITE_PROVINCES[siteCode] || 'Punjab';
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
    CONTRACT_START,
    CONTRACT_END,
    SO_BILLING_MODELS,
    isSoBillingModel,
    siteProvince,
    roleCount,
    absenceDeductionAmount,
};
