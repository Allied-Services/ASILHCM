'use strict';

const EDIT_ROLES = [
    'finance_proposer',
    'payroll_initiator',
    'payroll',
    'finance_manager',
    'finance_approver',
];

function parsePermissions(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return null; }
    }
    return typeof raw === 'object' ? raw : null;
}

function payrollSubPerms(user) {
    const perms = parsePermissions(user && user.permissions);
    if (!perms) return [];
    const m = perms.payroll;
    if (!m) return [];
    if (m.access === false) return [];
    if (Array.isArray(m.subPerms)) return m.subPerms.map(String);
    if (Array.isArray(m.sub_perms)) return m.sub_perms.map(String);
    if (Array.isArray(m)) return m.map(String);
    if (m.access) return ['view'];
    return [];
}

function canAccessPayrollSheet(user, action, fallbackRoles) {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    const roles = fallbackRoles || EDIT_ROLES;
    if (roles.includes(user.role)) return true;
    const sub = payrollSubPerms(user);
    if (action === 'view' && sub.length) return true;
    return sub.includes(action);
}

function requirePayrollSheet(pool, action, fallbackRoles) {
    const { handleRouteError } = require('../../core/validate');
    const roles = fallbackRoles || EDIT_ROLES;
    return async (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (canAccessPayrollSheet(req.user, action, roles)) return next();
        try {
            const result = await pool.query(
                'SELECT role, permissions FROM hcm_users WHERE LOWER(email)=LOWER($1)',
                [req.user.email]
            );
            const db = result && result.rows && result.rows[0];
            if (db && canAccessPayrollSheet({ role: db.role, permissions: db.permissions }, action, roles)) {
                return next();
            }
            return res.status(403).json({
                error: 'Forbidden: insufficient role',
                required: roles,
                got: req.user.role,
            });
        } catch (err) {
            handleRouteError(res, 'payrollSheet.auth', err);
        }
    };
}

module.exports = {
    EDIT_ROLES,
    payrollSubPerms,
    canAccessPayrollSheet,
    requirePayrollSheet,
};
