'use strict';

const { handleRouteError } = require('../../core/validate');
const { enqueueJob } = require('../../core/jobs');
const {
    getXeroBillsSyncLast,
    getReviewQueue,
    resolveReview,
    pushXeroBillPayment,
} = require('./service');
const { buildHblWorkbook, getHblColumns } = require('./hblExport');
const { getBillableCandidates, createInvoiceFromBillable } = require('./billableInvoice');

function registerXeroBillImportRoutes(app, deps) {
    const { pool, requireAuth, requireRole, getXeroAccessToken } = deps;

    app.post('/api/xero/bills/sync', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            if (!getXeroAccessToken) return res.status(500).json({ error: 'Xero not configured' });
            const jobId = await enqueueJob('xero.bills.sync', req.body || {});
            if (!jobId) return res.status(503).json({ error: 'Job queue unavailable' });
            res.status(202).json({ queued: true, jobId });
        } catch (err) {
            handleRouteError(res, 'xero.sync', err);
        }
    });

    app.get('/api/xero/bills/sync-status', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'ap_team'), async (req, res) => {
        try {
            const last = await getXeroBillsSyncLast(pool);
            res.json(last || {});
        } catch (err) {
            handleRouteError(res, 'xero.syncStatus', err);
        }
    });

    app.get('/api/xero/bills/review-queue', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'ap_team'), async (req, res) => {
        try {
            res.json({ bills: await getReviewQueue(pool) });
        } catch (err) {
            handleRouteError(res, 'xero.reviewQueue', err);
        }
    });

    app.patch('/api/xero/bills/:id/review', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            res.json(await resolveReview(pool, req.params.id, { ...req.body, reviewed_by: req.user?.email }));
        } catch (err) {
            handleRouteError(res, 'xero.reviewResolve', err);
        }
    });

    app.post('/api/ap/bills/hbl-export', requireAuth, requireRole('ap_team', 'finance_manager', 'superadmin'), async (req, res) => {
        try {
            const { bill_ids = [], variant = 'hbl_same', period_label = 'BL-' } = req.body || {};
            if (!bill_ids.length) return res.status(400).json({ error: 'bill_ids required' });
            const { rows: bills } = await pool.query(
                `SELECT * FROM bills WHERE id = ANY($1::text[]) AND status IN ('Approved','Posted')`,
                [bill_ids]
            );
            if (!bills.length) return res.status(404).json({ error: 'No approved bills found' });
            const columns = await getHblColumns(pool, variant);
            const buffer = buildHblWorkbook(bills, variant, columns, period_label);
            const filename = variant === 'hbl_other' ? 'HBL_to_Other.xlsx' : 'HBL_to_HBL.xlsx';
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(buffer);
        } catch (err) {
            handleRouteError(res, 'ap.hblExport', err);
        }
    });

    app.post('/api/ap/bills/:id/mark-paid-xero', requireAuth, requireRole('ap_team', 'finance_manager', 'superadmin'), async (req, res) => {
        try {
            if (!getXeroAccessToken) return res.status(500).json({ error: 'Xero not configured' });
            const { rows } = await pool.query(`SELECT * FROM bills WHERE id = $1`, [req.params.id]);
            if (!rows.length) return res.status(404).json({ error: 'Bill not found' });
            const result = await pushXeroBillPayment(getXeroAccessToken, rows[0], req.body || {});
            await pool.query(
                `UPDATE bills SET status = 'Posted', paid_at = NOW(), paid_by = $2, updated_at = NOW() WHERE id = $1`,
                [req.params.id, req.user?.email]
            );
            res.json({ ok: true, ...result });
        } catch (err) {
            handleRouteError(res, 'ap.markPaidXero', err);
        }
    });

    app.get('/api/client-invoices/billable-candidates', requireAuth, requireRole('ar_team', 'finance_manager', 'finance_approver', 'finance_proposer', 'superadmin'), async (req, res) => {
        try {
            const client = req.query.client;
            const period_month = parseInt(req.query.period_month, 10);
            const period_year = parseInt(req.query.period_year, 10);
            const sites = req.query.sites ? String(req.query.sites).split(',').filter(Boolean) : [];
            if (!client || !period_month || !period_year) {
                return res.status(400).json({ error: 'client, period_month, period_year required' });
            }
            const bills = await getBillableCandidates(pool, { client, sites, period_month, period_year });
            res.json({ bills });
        } catch (err) {
            handleRouteError(res, 'ar.billableCandidates', err);
        }
    });

    app.post('/api/client-invoices/from-billable', requireAuth, requireRole('ar_team', 'finance_manager', 'finance_approver', 'finance_proposer', 'superadmin'), async (req, res) => {
        try {
            const result = await createInvoiceFromBillable(pool, {
                ...req.body,
                created_by: req.user?.email,
            });
            res.status(201).json(result);
        } catch (err) {
            handleRouteError(res, 'ar.fromBillable', err);
        }
    });
}

module.exports = { registerXeroBillImportRoutes };
