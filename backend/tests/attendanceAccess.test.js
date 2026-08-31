'use strict';

const {
    canAccessAttendance,
    requireAttendanceAccess,
    EXPORT_ROLES,
} = require('../src/modules/attendance/attendanceAccess');

describe('canAccessAttendance', () => {
    test('superadmin can export regardless of permissions', () => {
        expect(canAccessAttendance({ role: 'superadmin' }, 'export')).toBe(true);
    });

    test('payroll_initiator can export from role alone (Monthly Report is already visible)', () => {
        expect(canAccessAttendance({ role: 'payroll_initiator' }, 'export')).toBe(true);
        expect(canAccessAttendance({ role: 'finance_approver' }, 'export')).toBe(true);
        expect(canAccessAttendance({ role: 'operations' }, 'export')).toBe(true);
    });

    test('Full attendance user rights allow export without a finance/ops role', () => {
        const user = {
            role: 'operations_team',
            permissions: {
                attendance: {
                    access: true,
                    subPerms: ['view', 'mark_attendance', 'approve_leave', 'team_setup'],
                },
            },
        };
        expect(canAccessAttendance(user, 'export')).toBe(true);
        expect(canAccessAttendance(user, 'view')).toBe(true);
    });

    test('Grant access (view only) is enough to download CSV', () => {
        const user = {
            role: 'pending',
            permissions: { attendance: { access: true, subPerms: ['view'] } },
        };
        expect(canAccessAttendance(user, 'export')).toBe(true);
    });

    test('operations_team without attendance rights cannot export', () => {
        expect(canAccessAttendance({ role: 'operations_team' }, 'export')).toBe(false);
        expect(canAccessAttendance({
            role: 'operations_team',
            permissions: { payroll: { access: true, subPerms: ['view'] } },
        }, 'export')).toBe(false);
    });
});

describe('requireAttendanceAccess', () => {
    function mockRes() {
        const res = {};
        res.status = jest.fn(() => res);
        res.json = jest.fn(() => res);
        return res;
    }

    test('looks up hcm_users.permissions when JWT role is not in the export list', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{
                    role: 'operations_team',
                    permissions: { attendance: { access: true, subPerms: ['view', 'mark_attendance'] } },
                }],
            }),
        };
        const mw = requireAttendanceAccess(pool, 'export', EXPORT_ROLES);
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

    test('rejects a role-only user with no attendance grant', async () => {
        const pool = {
            query: jest.fn().mockResolvedValue({
                rows: [{ role: 'operations_team', permissions: null }],
            }),
        };
        const mw = requireAttendanceAccess(pool, 'export', EXPORT_ROLES);
        const req = { user: { email: 'other@asil.com.pk', role: 'operations_team' } };
        const res = mockRes();
        const next = jest.fn();
        await mw(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
