'use strict';

/** Roles that can already open Monthly Report / export without custom rights. */
const EXPORT_ROLES = [
    'hr_manager',
    'finance_manager',
    'finance_approver',
    'superadmin',
    'admin',
    'operations',
    'payroll_initiator',
];

const HUB_READ_ROLES = EXPORT_ROLES.slice();

function parsePermissions(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return null; }
    }
    return typeof raw === 'object' ? raw : null;
}

function attendanceSubPerms(user) {
    const perms = parsePermissions(user && user.permissions);
    if (!perms) return [];
    const m = perms.attendance;
    if (!m) return [];
    if (m === true) return ['view'];
    if (m.access === false) return [];
    if (Array.isArray(m.subPerms)) return m.subPerms.map(String);
    if (Array.isArray(m.sub_perms)) return m.sub_perms.map(String);
    if (Array.isArray(m)) return m.map(String);
    if (m.access) return ['view'];
    return [];
}

function canAccessAttendance(user, action, fallbackRoles) {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    const roles = fallbackRoles || (action === 'export' || action === 'view' ? EXPORT_ROLES : EXPORT_ROLES);
    if (roles.includes(user.role)) return true;
    const sub = attendanceSubPerms(user);
    if ((action === 'export' || action === 'view') && sub.length) return true;
    return sub.includes(action);
}

function requireAttendanceAccess(pool, action, fallbackRoles) {
    const { handleRouteError } = require('../../core/validate');
    const roles = fallbackRoles || EXPORT_ROLES;
    return async (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (canAccessAttendance(req.user, action, roles)) return next();
        try {
            const result = await pool.query(
                'SELECT role, permissions FROM hcm_users WHERE LOWER(email)=LOWER($1)',
                [req.user.email]
            );
            const db = result && result.rows && result.rows[0];
            if (db && canAccessAttendance({ role: db.role, permissions: db.permissions }, action, roles)) {
                return next();
            }
            return res.status(403).json({
                error: 'Forbidden: insufficient role',
                required: roles,
                got: req.user.role,
            });
        } catch (err) {
            handleRouteError(res, 'attendance.auth', err);
        }
    };
}

module.exports = {
    EXPORT_ROLES,
    HUB_READ_ROLES,
    attendanceSubPerms,
    canAccessAttendance,
    requireAttendanceAccess,
};
