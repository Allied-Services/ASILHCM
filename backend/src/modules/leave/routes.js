'use strict';

const { handleRouteError } = require('../../core/validate');
const { getLeavePolicy, upsertLeavePolicy } = require('./service');

// Per-employee balance + usage already lives on the existing, long-running
// endpoints in server.js (GET/POST /api/employees/:id/leave-balance/:year,
// GET/POST /api/employees/:id/leaves) which read/write the pre-existing
// employee_leave_balances / employee_leaves tables (see phase2Service.js).
// This module only adds the genuinely new piece: a contract-level override
// for the government-mandated CL/ML/EL defaults. server.js's leave-balance
// route calls getLeavePolicy() from this module's service so both paths
// agree on the same entitlement for a given contract.
function registerLeaveRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;

    app.get('/api/leave/policy/:contractId', requireAuth, async (req, res) => {
        try {
            const policy = await getLeavePolicy(pool, req.params.contractId);
            res.json(policy);
        } catch (err) {
            handleRouteError(res, 'leave.getPolicy', err);
        }
    });

    app.put('/api/leave/policy/:contractId', requireAuth, requireRole('superadmin', 'operations', 'payroll_initiator'), async (req, res) => {
        try {
            const { cl, ml, el } = req.body || {};
            const row = await upsertLeavePolicy(pool, req.params.contractId, { cl, ml, el });
            res.json({ cl: row.cl_days, ml: row.ml_days, el: row.el_days });
        } catch (err) {
            handleRouteError(res, 'leave.upsertPolicy', err);
        }
    });
}

module.exports = { registerLeaveRoutes };
