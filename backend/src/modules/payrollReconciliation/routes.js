'use strict';

const { handleRouteError } = require('../../core/validate');
const { getPayrollReconciliation } = require('./service');

function registerPayrollReconciliationRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;
    const reconRoles = requireRole(
        'finance_manager',
        'finance_approver',
        'payroll_initiator',
        'ap_team',
        'superadmin',
    );

    app.get(
        '/api/payroll/:year/:month/reconciliation',
        requireAuth,
        reconRoles,
        async (req, res) => {
            try {
                const { year, month } = req.params;
                const y = parseInt(year, 10);
                const m = parseInt(month, 10);
                if (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12) {
                    return res.status(400).json({ error: 'Invalid year or month', code: 'INVALID_PERIOD' });
                }
                const result = await getPayrollReconciliation(pool, y, m);
                res.json(result);
            } catch (err) {
                handleRouteError(res, 'GET /api/payroll/:year/:month/reconciliation', err);
            }
        },
    );
}

module.exports = { registerPayrollReconciliationRoutes };
