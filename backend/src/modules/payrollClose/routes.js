'use strict';

const {
    listClosePacks,
    getClosePackDetail,
    settlePayable,
    reopenPayrollRun,
    finalizeInvoice,
    reopenInvoice,
} = require('./service');
const { requireUnlockCodeBody } = require('../../core/unlockCode');

function registerPayrollCloseRoutes(app, deps) {
    const { pool, requireAuth, requireRole, logAudit } = deps;
    const apRoles = requireRole('ap_team', 'finance_manager', 'superadmin');
    const financeRoles = requireRole('finance_manager', 'finance_approver', 'superadmin');
    const arRoles = requireRole('ar_team', 'finance_manager', 'finance_approver', 'superadmin');

    app.get('/api/ap/close-packs', requireAuth, apRoles, async (req, res) => {
        try {
            const packs = await listClosePacks(pool, {
                year: req.query.year ? parseInt(req.query.year, 10) : null,
                month: req.query.month ? parseInt(req.query.month, 10) : null,
                contractId: req.query.contractId || null,
            });
            res.json({ packs });
        } catch (err) {
            console.error('[GET /api/ap/close-packs]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/ap/close-packs/:id', requireAuth, apRoles, async (req, res) => {
        try {
            const pack = await getClosePackDetail(pool, parseInt(req.params.id, 10));
            if (!pack) return res.status(404).json({ error: 'Not found' });
            res.json(pack);
        } catch (err) {
            console.error('[GET /api/ap/close-packs/:id]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/ap/close-packs/:id/payables/:type/settle', requireAuth, apRoles, async (req, res) => {
        try {
            const packId = parseInt(req.params.id, 10);
            const payableType = String(req.params.type || '').toLowerCase();
            const { payment_date, reference_no, bank_id, bank_name } = req.body || {};

            const result = await settlePayable(pool, {
                packId,
                payableType,
                paymentDate: payment_date,
                referenceNo: reference_no,
                bankId: bank_id,
                bankName: bank_name,
                actor: req.user?.email,
            });

            if (!result.ok) {
                const status = result.code === 'PACK_NOT_FOUND' || result.code === 'PAYABLE_NOT_FOUND'
                    ? 404
                    : result.code === 'ALREADY_PAID' ? 409 : 422;
                return res.status(status).json(result);
            }

            if (logAudit) logAudit(req, 'SETTLE_PAYABLE', 'payroll_close_pack', String(packId));
            res.json(result);
        } catch (err) {
            console.error('[POST /api/ap/close-packs/:id/payables/:type/settle]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/payroll-runs/:id/reopen', requireAuth, financeRoles, async (req, res) => {
        try {
            if (!requireUnlockCodeBody(req, res)) return;
            const runId = parseInt(req.params.id, 10);
            const result = await reopenPayrollRun(pool, {
                runId,
                actor: req.user?.email,
                snapshot: { reopened_from: 'locked' },
            });
            if (!result.ok) {
                const status = result.code === 'RUN_NOT_FOUND' ? 404 : 409;
                return res.status(status).json(result);
            }
            if (logAudit) logAudit(req, 'payroll_run_reopen', 'payroll_run', String(runId));
            res.json(result);
        } catch (err) {
            console.error('[POST /api/payroll-runs/:id/reopen]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/client-invoices/:id/finalize', requireAuth, arRoles, async (req, res) => {
        try {
            const result = await finalizeInvoice(pool, {
                invoiceId: req.params.id,
                actor: req.user?.email,
            });
            if (!result.ok) {
                const status = result.code === 'NOT_FOUND' ? 404 : 409;
                return res.status(status).json(result);
            }
            if (logAudit) logAudit(req, 'invoice_finalize', 'client_invoice', String(req.params.id));
            res.json(result);
        } catch (err) {
            console.error('[POST /api/client-invoices/:id/finalize]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/client-invoices/:id/reopen', requireAuth, financeRoles, async (req, res) => {
        try {
            if (!requireUnlockCodeBody(req, res)) return;
            const result = await reopenInvoice(pool, {
                invoiceId: req.params.id,
                actor: req.user?.email,
            });
            if (!result.ok) {
                const status = result.code === 'NOT_FOUND' ? 404 : 409;
                return res.status(status).json(result);
            }
            if (logAudit) logAudit(req, 'invoice_reopen', 'client_invoice', String(req.params.id));
            res.json(result);
        } catch (err) {
            console.error('[POST /api/client-invoices/:id/reopen]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

module.exports = { registerPayrollCloseRoutes };
