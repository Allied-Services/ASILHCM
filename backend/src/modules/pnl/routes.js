'use strict';

const { handleRouteError } = require('../../core/validate');
const { listContractPnl, allocateFromLockedPayroll, getWeeklyCashflow } = require('./service');
const { computePrSheetRow } = require('../../payroll/prSheetEngine');
const { getPolicy } = require('../constraints/service');

function registerPnlRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;

    app.get('/api/pnl/contracts', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'operations'), async (req, res) => {
        try {
            const rows = await listContractPnl(pool, {
                year: req.query.year ? parseInt(req.query.year, 10) : undefined,
                month: req.query.month ? parseInt(req.query.month, 10) : undefined,
            });
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'pnl.list', err);
        }
    });

    app.post('/api/pnl/refresh', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const result = await allocateFromLockedPayroll(pool, month, year);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'pnl.refresh', err);
        }
    });

    app.get('/api/cashflow/weekly', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            const weeks = req.query.weeks ? parseInt(req.query.weeks, 10) : 8;
            const buckets = await getWeeklyCashflow(pool, weeks);
            res.json(buckets);
        } catch (err) {
            handleRouteError(res, 'cashflow.weekly', err);
        }
    });

    app.post('/api/payroll/pr-preview', requireAuth, requireRole('superadmin', 'payroll_initiator', 'finance_manager'), async (req, res) => {
        try {
            const { contractId, projectId, employeeInput } = req.body;
            const policy = contractId ? await getPolicy(pool, contractId, projectId) : {};
            const result = computePrSheetRow(employeeInput || {}, policy || {});
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'payroll.prPreview', err);
        }
    });
}

module.exports = { registerPnlRoutes };
