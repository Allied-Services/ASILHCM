'use strict';

const { canAccessPayrollSheet, payrollSubPerms } = require('../src/modules/payrollSheet/access');

describe('canAccessPayrollSheet', () => {
    test('superadmin always passes', () => {
        expect(canAccessPayrollSheet({ role: 'superadmin' }, 'edit')).toBe(true);
    });

    test('payroll roles can edit without custom permissions', () => {
        expect(canAccessPayrollSheet({ role: 'finance_proposer' }, 'edit')).toBe(true);
        expect(canAccessPayrollSheet({ role: 'payroll_initiator' }, 'edit')).toBe(true);
        expect(canAccessPayrollSheet({ role: 'payroll' }, 'edit')).toBe(true);
        expect(canAccessPayrollSheet({ role: 'finance_manager' }, 'edit')).toBe(true);
        expect(canAccessPayrollSheet({ role: 'finance_approver' }, 'edit')).toBe(true);
    });

    test('operations cannot edit without payroll.edit permission', () => {
        expect(canAccessPayrollSheet({ role: 'operations' }, 'edit')).toBe(false);
        expect(canAccessPayrollSheet({
            role: 'operations',
            permissions: { payroll: { access: true, subPerms: ['view'] } },
        }, 'edit')).toBe(false);
    });

    test('custom payroll.edit works without a payroll role', () => {
        const user = {
            role: 'operations',
            email: 'sadia.komal@asil.com.pk',
            permissions: { payroll: { access: true, subPerms: ['view', 'edit', 'lock', 'export'] } },
        };
        expect(canAccessPayrollSheet(user, 'edit')).toBe(true);
        expect(canAccessPayrollSheet(user, 'lock')).toBe(true);
        expect(payrollSubPerms(user)).toEqual(['view', 'edit', 'lock', 'export']);
    });
});
