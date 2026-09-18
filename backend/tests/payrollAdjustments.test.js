'use strict';

const {
    parsePayrollAdjustments,
    hasPayrollAdjustments,
    applyAdjustmentMode,
    replaceAdjustmentDelta,
    isPayrollAdjustmentType,
    looksLikeFixedValueEmployee,
} = require('../src/modules/claims/payrollAdjustments');

describe('payrollAdjustments', () => {
    test('parsePayrollAdjustments reads form and CSV aliases', () => {
        expect(parsePayrollAdjustments({
            arrearsAmount: 4500,
            deductionAmount: 800,
            specialAllowanceAmount: '1500.4',
        })).toEqual({ arrears: 4500, deduction: 800, specialAllowance: 1500.4 });
        expect(parsePayrollAdjustments({
            Arrears: '0',
            deduction: '',
        })).toEqual({ arrears: 0, deduction: 0, specialAllowance: 0 });
    });

    test('hasPayrollAdjustments is false for zeros', () => {
        expect(hasPayrollAdjustments({ arrears: 0, deduction: 0, specialAllowance: 0 })).toBe(false);
        expect(hasPayrollAdjustments({ arrears: 1, deduction: 0, specialAllowance: 0 })).toBe(true);
    });

    test('applyAdjustmentMode add / replace / remove', () => {
        expect(applyAdjustmentMode(1000, 500, 'add')).toBe(1500);
        expect(applyAdjustmentMode(1000, 500, 'replace')).toBe(500);
        expect(applyAdjustmentMode(1000, 400, 'remove')).toBe(600);
        expect(applyAdjustmentMode(100, 400, 'remove')).toBe(0);
    });

    test('replaceAdjustmentDelta is idempotent on re-commit', () => {
        expect(replaceAdjustmentDelta(0, 0, 2000)).toBe(2000);
        expect(replaceAdjustmentDelta(2000, 2000, 2000)).toBe(2000);
        expect(replaceAdjustmentDelta(2000, 2000, 3000)).toBe(3000);
        expect(replaceAdjustmentDelta(5000, 2000, 2000)).toBe(5000);
    });

    test('isPayrollAdjustmentType', () => {
        expect(isPayrollAdjustmentType('ARREARS')).toBe(true);
        expect(isPayrollAdjustmentType('deduction')).toBe(true);
        expect(isPayrollAdjustmentType('SPECIAL_ALLOWANCE')).toBe(true);
        expect(isPayrollAdjustmentType('EXPENSE')).toBe(false);
    });

    test('looksLikeFixedValueEmployee reads stored contract config only', () => {
        expect(looksLikeFixedValueEmployee({ id: 'ASIL/PSO-040/25' })).toBe(false);
        expect(looksLikeFixedValueEmployee({ contract_id: 'CTR-PSO-NORTH-ZONE' })).toBe(false);
        expect(looksLikeFixedValueEmployee({ commercial_type: 'fixed_value' })).toBe(true);
        expect(looksLikeFixedValueEmployee({ billing_model: 'service_order_deduction' })).toBe(true);
        expect(looksLikeFixedValueEmployee({ service_type: 'Fixed Value' })).toBe(true);
        expect(looksLikeFixedValueEmployee({ id: 'ASIL/SPL-400/21' })).toBe(false);
    });
});
