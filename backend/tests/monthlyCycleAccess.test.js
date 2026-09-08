'use strict';

const {
    canAccessMonthlyCycle,
    requireMonthlyCycle,
    monthlyCycleSubPerms,
    EDIT_ROLES,
} = require('../src/modules/claims/monthlyCycleAccess');

describe('canAccessMonthlyCycle', () => {
    test('superadmin always passes', () => {
        expect(canAccessMonthlyCycle({ role: 'superadmin' }, 'edit')).toBe(true);
        expect(canAccessMonthlyCycle({ role: 'superadmin' }, 'view')).toBe(true);
    });

    test('finance/ops/payroll roles can edit without custom permissions', () => {
        expect(canAccessMonthlyCycle({ role: 'finance_manager' }, 'edit')).toBe(true);
        expect(canAccessMonthlyCycle({ role: 'operations' }, 'edit')).toBe(true);
        expect(canAccessMonthlyCycle({ role: 'payroll_initiator' }, 'edit')).toBe(true);
        expect(canAccessMonthlyCycle({ role: 'payroll' }, 'edit')).toBe(true);
    });

    test('operations_team without monthly_cycle.edit cannot assign people', () => {
        expect(canAccessMonthlyCycle({ role: 'operations_team' }, 'edit')).toBe(false);
        expect(canAccessMonthlyCycle({
            role: 'operations_team',
            permissions: { monthly_cycle: { access: true, subPerms: ['view'] } },
        }, 'edit')).toBe(false);
    });

    test('custom monthly_cycle.edit works without an ops/finance role (Sadia)', () => {
        const user = {
            role: 'operations_team',
            email: 'sadia.komal@asil.com.pk',
            permissions: { monthly_cycle: { access: true, subPerms: ['view', 'edit'] } },
        };
        expect(canAccessMonthlyCycle(user, 'edit')).toBe(true);
        expect(canAccessMonthlyCycle(user, 'view')).toBe(true);
        expect(monthlyCycleSubPerms(user)).toEqual(['view', 'edit']);
    });
});

describe('requireMonthlyCycle', () => {
    function mockRes() {
        const res = {};
        res.status = jest.fn(() => res);
        res.json = jest.fn(() => res);
        return res;
    }

    test('looks up hcm_users.permissions when JWT role is not in the edit list', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{
                    role: 'operations_team',
                    permissions: { monthly_cycle: { access: true, subPerms: ['view', 'edit'] } },
                }],
            }),
        };
        const mw = requireMonthlyCycle(pool, 'edit', EDIT_ROLES);
        const req = { user: { email: 'sadia.komal@asil.com.pk', role: 'operations_team' } };
        const res = mockRes();
        const next = jest.fn();
        await mw(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(pool.query).toHaveBeenCalledWith(
            'SELECT role, permissions FROM hcm_users WHERE LOWER(email)=LOWER($1)',
            ['sadia.komal@asil.com.pk']
        );
    });

    test('rejects operations_team with view-only monthly_cycle', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{
                    role: 'operations_team',
                    permissions: { monthly_cycle: { access: true, subPerms: ['view'] } },
                }],
            }),
        };
        const mw = requireMonthlyCycle(pool, 'edit', EDIT_ROLES);
        const req = { user: { email: 'sadia.komal@asil.com.pk', role: 'operations_team' } };
        const res = mockRes();
        const next = jest.fn();
        await mw(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
