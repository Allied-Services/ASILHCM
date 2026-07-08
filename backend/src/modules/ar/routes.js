'use strict';

const { handleRouteError } = require('../../core/validate');
const {
    getPOBalance,
    validateInvoiceAgainstPO,
    runDunningCheck,
    logXeroSync,
    getInvoiceSchedules,
    getDunningLog,
} = require('./service');
const { previewReceiptSplit, postReceipt, listReceipts, deleteReceiptById, purgeTestReceipts } = require('./receipts');

function registerArRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail, getXeroAccessToken } = deps;

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

    app.get('/api/ar/dunning-log', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team'), async (req, res) => {
        try {
            res.json(await getDunningLog(pool));
        } catch (err) {
            handleRouteError(res, 'ar.dunningLog', err);
        }
    });

    app.post('/api/ar/xero-sync-log', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            res.json(await logXeroSync(pool, req.body));
        } catch (err) {
            handleRouteError(res, 'ar.xeroLog', err);
        }
    });

    app.post('/api/ar/receipts/preview-split', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team'), async (req, res) => {
        try {
            res.json(await previewReceiptSplit(pool, req.body));
        } catch (err) {
            handleRouteError(res, 'ar.receiptPreview', err);
        }
    });

    app.post('/api/ar/receipts', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team'), async (req, res) => {
        try {
            if (!getXeroAccessToken) return res.status(500).json({ error: 'Xero not configured' });
            res.json(await postReceipt(pool, getXeroAccessToken, req.body, req.user.email));
        } catch (err) {
            handleRouteError(res, 'ar.receiptPost', err);
        }
    });

    app.get('/api/ar/receipts', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team'), async (req, res) => {
        try {
            res.json({ receipts: await listReceipts(pool, req.query) });
        } catch (err) {
            handleRouteError(res, 'ar.receiptList', err);
        }
    });

    app.delete('/api/ar/receipts/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
        try {
            res.json(await deleteReceiptById(pool, req.params.id));
        } catch (err) {
            handleRouteError(res, 'ar.receiptDelete', err);
        }
    });

    app.delete('/api/admin/purge-test-receipts', requireAuth, requireRole('superadmin'), async (req, res) => {
        try {
            res.json(await purgeTestReceipts(pool));
        } catch (err) {
            handleRouteError(res, 'ar.purgeTestReceipts', err);
        }
    });
}

module.exports = { registerArRoutes };
