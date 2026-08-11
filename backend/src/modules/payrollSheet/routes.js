'use strict';

const { calculatePayrollSheet } = require('./service');

function registerPayrollSheetRoutes(app, deps) {
    const { pool, requireAuth, requireRole, logAudit } = deps;
    const calcRoles = requireRole(
        'finance_proposer',
        'payroll_initiator',
        'finance_manager',
        'finance_approver',
        'superadmin',
    );

    app.post('/api/payroll/:year/:month/calculate', requireAuth, calcRoles, async (req, res) => {
        try {
            const year = parseInt(req.params.year, 10);
            const month = parseInt(req.params.month, 10);
            const body = req.body || {};
            const result = await calculatePayrollSheet(pool, year, month, {
                client: body.client || undefined,
                contractId: body.contractId || body.contract_id || undefined,
                employeeIds: Array.isArray(body.employeeIds) ? body.employeeIds : undefined,
                // Default sheet_inputs — recompute from current sheet (idempotent).
                // canonical only when UI explicitly pulls approved claims.
                sourceMode: body.sourceMode === 'canonical' ? 'canonical' : 'sheet_inputs',
                dryRun: !!body.dryRun,
                allowArchive: !!body.allowArchive,
            }, req.user || {});

            if (typeof logAudit === 'function' && !body.dryRun) {
                logAudit(req, 'PAYROLL_CALCULATE', 'payroll_period', `${year}-${month}`);
            }
            res.json(result);
        } catch (err) {
            console.error('[POST /api/payroll/:year/:month/calculate]', err);
            if (err.status === 403 || err.code === 'PAYROLL_LOCKED') {
                return res.status(403).json({ error: err.message || 'Payroll locked', code: 'PAYROLL_LOCKED' });
            }
            if (err.status === 409 || err.code === 'CUTOVER_BLOCKED') {
                return res.status(409).json({ error: err.message || 'Cutover blocked', code: err.code });
            }
            if (err.status === 400) {
                return res.status(400).json({ error: err.message || 'Bad request', code: err.code });
            }
            return res.status(500).json({ error: 'Internal server error' });
        }
    });
}

module.exports = { registerPayrollSheetRoutes };
