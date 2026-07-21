'use strict';

const { handleRouteError } = require('../../core/validate');
const {
    computeStatutoryForMonth,
    upsertStatutoryLedger,
    getStatutoryLedger,
    generateFilingPreview,
    getInvoiceChallanStatus,
    attachInvoiceChallan,
} = require('./service');
const { validateAction } = require('../constraints/service');

function registerComplianceRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;

    app.get('/api/compliance/ledger', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'payroll_initiator'), async (req, res) => {
        try {
            const rows = await getStatutoryLedger(pool, {
                month: req.query.month ? parseInt(req.query.month, 10) : undefined,
                year: req.query.year ? parseInt(req.query.year, 10) : undefined,
            });
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'compliance.ledger', err);
        }
    });

    app.post('/api/compliance/compute', requireAuth, requireRole('superadmin', 'finance_manager', 'payroll_initiator'), async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const computed = await computeStatutoryForMonth(pool, month, year);
            const ledger = await upsertStatutoryLedger(pool, month, year, computed);
            res.json({ ...computed, ledger });
        } catch (err) {
            handleRouteError(res, 'compliance.compute', err);
        }
    });

    app.post('/api/compliance/filing-preview', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            const month = parseInt(req.body.month, 10);
            const year = parseInt(req.body.year, 10);
            const result = await generateFilingPreview(pool, month, year);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'compliance.filingPreview', err);
        }
    });

    app.get('/api/compliance/invoice/:id/challans', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team'), async (req, res) => {
        try {
            const status = await getInvoiceChallanStatus(pool, req.params.id);
            res.json(status);
        } catch (err) {
            handleRouteError(res, 'compliance.invoiceChallans', err);
        }
    });

    app.post('/api/compliance/invoice/:id/attachments', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team'), async (req, res) => {
        try {
            const attachment = await attachInvoiceChallan(pool, req.params.id, req.body.attachment_type);
            const challanStatus = await getInvoiceChallanStatus(pool, req.params.id);
            res.json({ attachment, challanStatus });
        } catch (err) {
            handleRouteError(res, 'compliance.invoiceAttachment', err);
        }
    });

    app.post('/api/compliance/invoice/:id/validate', requireAuth, requireRole('superadmin', 'finance_manager', 'ar_team'), async (req, res) => {
        try {
            const challanStatus = await getInvoiceChallanStatus(pool, req.params.id);
            const { rows } = await pool.query(`SELECT contract_id FROM client_invoices WHERE id = $1`, [req.params.id]);
            const result = await validateAction(pool, 'invoice_generate', {
                contractId: rows[0]?.contract_id,
                missingChallans: challanStatus.missing,
            });
            res.json({ ...result, challanStatus });
        } catch (err) {
            handleRouteError(res, 'compliance.validateInvoice', err);
        }
    });
}

module.exports = { registerComplianceRoutes };
