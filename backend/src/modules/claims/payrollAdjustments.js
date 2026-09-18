'use strict';

const PAYROLL_ADJUSTMENT_TYPES = ['ARREARS', 'DEDUCTION', 'SPECIAL_ALLOWANCE'];

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function roundMoney(v) {
    return Math.round(num(v) * 100) / 100;
}

function parsePayrollAdjustments(input = {}) {
    return {
        arrears: roundMoney(input.arrearsAmount ?? input.arrears ?? 0),
        deduction: roundMoney(input.deductionAmount ?? input.otherDeduction ?? input.deduction ?? 0),
        specialAllowance: roundMoney(
            input.specialAllowanceAmount ?? input.specialAllowance ?? input.special_allowance ?? 0
        ),
    };
}

function hasPayrollAdjustments(adj = {}) {
    return num(adj.arrears) > 0 || num(adj.deduction) > 0 || num(adj.specialAllowance) > 0;
}

function applyAdjustmentMode(before, add, mode) {
    const b = num(before);
    const a = num(add);
    if (mode === 'replace') return roundMoney(a);
    if (mode === 'remove') return roundMoney(Math.max(0, b - a));
    return roundMoney(b + a);
}

/** Replace a previous portal adjustment with the new form amount (idempotent re-commit). */
function replaceAdjustmentDelta(sheetVal, previousPortalVal, nextPortalVal) {
    return roundMoney(Math.max(0, num(sheetVal) - num(previousPortalVal) + num(nextPortalVal)));
}

function isPayrollAdjustmentType(type) {
    return PAYROLL_ADJUSTMENT_TYPES.includes(String(type || '').toUpperCase());
}

/** Fixed Value / Conservancy — stored contract config only. Never infer from an employee code. */
function isFixedValueFromConfig(emp = {}) {
    const commercial = String(emp.commercial_type || emp.commercialType || '').toLowerCase();
    if (commercial === 'fixed_value') return true;
    const billing = String(emp.billing_model || emp.billingModel || '').toLowerCase();
    if (billing === 'service_order_deduction' || billing === 'fixed_value') return true;
    const serviceType = String(emp.service_type || emp.serviceType || '');
    return /fixed value/i.test(serviceType) || /conservancy/i.test(serviceType);
}

function looksLikeFixedValueEmployee(emp = {}) {
    return isFixedValueFromConfig(emp);
}

module.exports = {
    PAYROLL_ADJUSTMENT_TYPES,
    num,
    roundMoney,
    parsePayrollAdjustments,
    hasPayrollAdjustments,
    applyAdjustmentMode,
    replaceAdjustmentDelta,
    isPayrollAdjustmentType,
    isFixedValueFromConfig,
    looksLikeFixedValueEmployee,
};
