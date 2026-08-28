'use strict';

const { calculatePayrollSheet, loadPayrollClaimCompare } = require('./service');
const { requirePayrollSheet } = require('./access');

function registerPayrollSheetRoutes(app, deps) {
    const { pool, requireAuth, logAudit } = deps;
    const calcRoles = requirePayrollSheet(pool, 'edit');

    app.get('/api/payroll/:year/:month/claim-compare', requireAuth, async (req, res) => {
        try {
            const year = parseInt(req.params.year, 10);
            const month = parseInt(req.params.month, 10);
            if (!year || !month || month < 1 || month > 12) {
                return res.status(400).json({ error: 'Invalid year/month' });
            }
            const result = await loadPayrollClaimCompare(pool, year, month);
            res.json(result);
        } catch (err) {
            console.error('[GET /api/payroll/:year/:month/claim-compare]', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

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
