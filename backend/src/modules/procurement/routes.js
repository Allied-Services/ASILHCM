'use strict';

const { handleRouteError } = require('../../core/validate');
const {
    listProcurementRequests,
    createProcurementRequest,
    getBudgetLines,
    createBudgetLine,
    updateBudgetLine,
    deactivateBudgetLine,
    getVerificationQueue,
    saveOcrVerification,
    matchBillToBudgetLine,
    canApproveBill,
} = require('./service');

function registerProcurementRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;

    app.get('/api/procurement/requests', requireAuth, requireRole('superadmin', 'procurement_proposer', 'procurement_approver', 'procurement_manager'), async (req, res) => {
        try {
            res.json(await listProcurementRequests(pool, req.query));
        } catch (err) {
            handleRouteError(res, 'procurement.requests', err);
        }
    });

    app.post('/api/procurement/requests', requireAuth, requireRole('superadmin', 'procurement_proposer', 'operations'), async (req, res) => {
        try {
            res.json(await createProcurementRequest(pool, req.body));
        } catch (err) {
            handleRouteError(res, 'procurement.create', err);
        }
    });

    app.get('/api/procurement/budget-lines/:contractId', requireAuth, async (req, res) => {
        try {
            res.json(await getBudgetLines(pool, req.params.contractId));
        } catch (err) {
            handleRouteError(res, 'procurement.budgetLines', err);
        }
    });

    app.post('/api/procurement/budget-lines', requireAuth, requireRole('superadmin', 'operations', 'procurement_manager', 'finance_approver'), async (req, res) => {
        try {
            res.status(201).json(await createBudgetLine(pool, req.body));
        } catch (err) {
            handleRouteError(res, 'procurement.budgetLineCreate', err);
        }
    });

    app.patch('/api/procurement/budget-lines/:id', requireAuth, requireRole('superadmin', 'operations', 'procurement_manager', 'finance_approver'), async (req, res) => {
        try {
            res.json(await updateBudgetLine(pool, req.params.id, req.body));
        } catch (err) {
            handleRouteError(res, 'procurement.budgetLineUpdate', err);
        }
    });

    app.delete('/api/procurement/budget-lines/:id', requireAuth, requireRole('superadmin', 'operations', 'procurement_manager', 'finance_approver'), async (req, res) => {
        try {
            res.json(await deactivateBudgetLine(pool, req.params.id));
        } catch (err) {
            handleRouteError(res, 'procurement.budgetLineDelete', err);
        }
    });

    app.get('/api/procurement/verification-queue', requireAuth, requireRole('superadmin', 'procurement_proposer', 'procurement_approver', 'procurement_manager'), async (req, res) => {
        try {
            res.json(await getVerificationQueue(pool));
        } catch (err) {
            handleRouteError(res, 'procurement.queue', err);
        }
    });

    app.post('/api/procurement/bills/:id/verify-ocr', requireAuth, requireRole('superadmin', 'procurement_proposer', 'procurement_approver', 'procurement_manager'), async (req, res) => {
        try {
            const result = await saveOcrVerification(pool, {
                billId: req.params.id,
                ocrJson: req.body.ocrJson,
                confidence: req.body.confidence,
                verifiedBy: req.user?.email,
                fileId: req.body.fileId,
            });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'procurement.verifyOcr', err);
        }
    });

    app.post('/api/procurement/bills/:id/match-budget', requireAuth, requireRole('superadmin', 'procurement_approver', 'procurement_manager'), async (req, res) => {
        try {
            const result = await matchBillToBudgetLine(pool, {
                billId: req.params.id,
                budgetLineId: req.body.budgetLineId,
                matchedBy: req.user?.email,
            });
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'procurement.matchBudget', err);
        }
    });

    app.get('/api/procurement/bills/:id/can-approve', requireAuth, requireRole('superadmin', 'procurement_approver', 'procurement_manager', 'finance_approver'), async (req, res) => {
        try {
            const result = await canApproveBill(pool, req.params.id, req.query.overrideReason);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'procurement.canApprove', err);
        }
    });
}

module.exports = { registerProcurementRoutes };
