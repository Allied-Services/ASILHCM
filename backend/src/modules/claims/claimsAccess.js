'use strict';

const VIEW_ROLES = [
    'superadmin', 'finance_manager', 'finance_approver',
    'payroll_initiator', 'payroll',
    'operations_supervisor', 'operations', 'hr_manager',
];
const CAMPAIGN_ROLES = [
    'superadmin', 'finance_manager', 'finance_approver', 'operations_supervisor',
];

function parsePermissions(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return null; }
    }
    return typeof raw === 'object' ? raw : null;
}

function claimsPortalSubPerms(user) {
    const perms = parsePermissions(user && user.permissions);
    if (!perms) return [];
    const m = perms.claims_portal || perms.claimsPortal;
    if (!m) return [];
    if (m.access === false) return [];
    if (Array.isArray(m.subPerms)) return m.subPerms.map(String);
    if (Array.isArray(m.sub_perms)) return m.sub_perms.map(String);
    if (Array.isArray(m)) return m.map(String);
    if (m.access) return ['view'];
    return [];
}

function canAccessClaimsPortal(user, action, fallbackRoles) {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    const roles = fallbackRoles || (action === 'view' ? VIEW_ROLES : CAMPAIGN_ROLES);
    if (roles.includes(user.role)) return true;
    const sub = claimsPortalSubPerms(user);
    if (action === 'view' && sub.length) return true;
    return sub.includes(action);
}

function requireClaimsPortal(pool, action, fallbackRoles) {
    const { handleRouteError } = require('../../core/validate');
    const roles = fallbackRoles || (action === 'view' ? VIEW_ROLES : CAMPAIGN_ROLES);
    return async (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (canAccessClaimsPortal(req.user, action, roles)) return next();
        try {
            const { rows } = await pool.query(
                'SELECT role, permissions FROM hcm_users WHERE LOWER(email)=LOWER($1)',
                [req.user.email]
            );
            const db = rows[0];
            if (db && canAccessClaimsPortal({ role: db.role, permissions: db.permissions }, action, roles)) {
                return next();
            }
            return res.status(403).json({
                error: 'Forbidden: insufficient role',
                required: roles,
                got: req.user.role,
            });
        } catch (err) {
            handleRouteError(res, 'portalClaims.auth', err);
        }
    };
}

module.exports = {
    VIEW_ROLES,
    CAMPAIGN_ROLES,
    claimsPortalSubPerms,
    canAccessClaimsPortal,
    requireClaimsPortal,
};
