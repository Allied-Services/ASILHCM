'use strict';

const { handleRouteError } = require('../../core/validate');
const {
    getPOBalance,
    validateInvoiceAgainstPO,
    runDunningCheck,
    logXeroSync,
    getInvoiceSchedules,
} = require('./service');

function registerArRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail } = deps;

    app.get('/api/ar/po-balance/:poId', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team', 'finance_proposer'), async (req, res) => {
        try {
            res.json(await getPOBalance(pool, parseInt(req.params.poId, 10)));
        } catch (err) {
            handleRouteError(res, 'ar.poBalance', err);
        }
    });

    app.post('/api/ar/validate-po', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team'), async (req, res) => {
        try {
            const result = await validateInvoiceAgainstPO(pool, req.body);
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'ar.validatePo', err);
        }
    });

    app.post('/api/ar/run-dunning', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            res.json(await runDunningCheck(pool, sendAppEmail));
        } catch (err) {
            handleRouteError(res, 'ar.dunning', err);
        }
    });

    app.get('/api/ar/invoice-schedules', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team'), async (req, res) => {
        try {
            res.json(await getInvoiceSchedules(pool, req.query));
        } catch (err) {
            handleRouteError(res, 'ar.schedules', err);
        }
    });

    app.post('/api/ar/xero-sync-log', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            res.json(await logXeroSync(pool, req.body));
        } catch (err) {
            handleRouteError(res, 'ar.xeroLog', err);
        }
    });
}

module.exports = { registerArRoutes };
