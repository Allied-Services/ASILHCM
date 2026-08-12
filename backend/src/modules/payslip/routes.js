'use strict';

const {
    getPayslipReadiness,
    getStoredDocument,
    sendPayslips,
    createSupportCase,
    resolveSupportCase,
} = require('./service');
const { resolveAccessToken } = require('./tokenStore');
const { runJulyPayslipTestDelivery } = require('./testRun');

const jwt = require('jsonwebtoken');

function requirePayslipOrStaffAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
        if (payload.portal) {
            req.user = payload;
            req.isPortal = true;
            return next();
        }
        req.user = payload;
        next();
    } catch {
        return res.status(401).json({ error: 'Token expired' });
    }
}

function notPaidMessage(err) {
    const n = Array.isArray(err?.detail?.unpaid) ? err.detail.unpaid.length : 0;
    if (n === 1) return '1 selected employee is not yet marked paid in Accounts Payable';
    if (n > 1) return `${n} selected employees are not yet marked paid in Accounts Payable`;
    return 'Selected employees are not yet marked paid in Accounts Payable';
}

function handleRouteError(res, tag, err) {
    const code = err.code || err.message;
    const map = {
        CONFIRM_REQUIRED: [400, 'Confirmation required'],
        SELECTION_REQUIRED: [400, 'Select employees to send, or confirm send to all locked'],
        NOT_ALL_LOCKED: [409, 'All selected payroll rows must be locked before sending payslips'],
        ALREADY_SENT: [409, 'Payslips already sent for this month. Use force resend if needed.'],
        MISSING_CNIC: [422, 'Employee CNIC required to generate payslip PDF'],
        PDF_GENERATION_UNAVAILABLE: [503, 'PDF generation unavailable on this server'],
    };
    if (code === 'NOT_PAID') {
        const body = { error: notPaidMessage(err), code };
        if (err.detail) body.detail = err.detail;
        return res.status(409).json(body);
    }
    if (map[code]) {
        const [status, message] = map[code];
        const body = { error: message, code };
        if (err.detail) body.detail = err.detail;
        return res.status(status).json(body);
    }
    console.error(`[${tag}]`, err);
    return res.status(500).json({ error: 'Internal server error' });
}

function registerPayslipRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail, sendJazzSMS } = deps;
    const mailDeps = { sendAppEmail, sendJazzSMS };

    app.get('/api/payroll/:year/:month/payslip-readiness', requireAuth, requireRole('finance_manager', 'finance_approver', 'payroll_initiator', 'superadmin'), async (req, res) => {
        try {
            const { year, month } = req.params;
            const { employeeIds = [] } = req.query;
            const ids = employeeIds ? String(employeeIds).split(',').filter(Boolean) : [];
            res.json(await getPayslipReadiness(pool, year, month, ids));
        } catch (err) {
            handleRouteError(res, 'payslip-readiness', err);
        }
    });

    app.post('/api/payroll/:year/:month/send-payslips', requireAuth, requireRole('finance_manager', 'finance_approver', 'payroll_initiator', 'superadmin'), async (req, res) => {
        try {
            const { year, month } = req.params;
            const { employeeIds = [], confirm = false, forceResend = false, sendAll = false } = req.body || {};
            const result = await sendPayslips(pool, mailDeps, {
                year,
                month,
                employeeIds,
                confirm: !!confirm,
                forceResend: !!forceResend,
                sendAll: !!sendAll,
                actorEmail: req.user?.email,
            });
            if (deps.logAudit) deps.logAudit(req, 'SEND_PAYSLIPS', 'payroll_month', `${year}-${month}`);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'send-payslips', err);
        }
    });

    /** Internal QA: 5 sample July payslips → override email + SMS (before candidate rollout). */
    app.post('/api/payslip/test-run', requireAuth, requireRole('superadmin'), async (req, res) => {
        try {
            const destEmail = String(req.body?.email || 'shezad.mumtaz@asil.com.pk').trim();
            const destPhone = String(req.body?.phone || '03008275688').trim();
            const dryRun = !!req.body?.dryRun;
            if (!destEmail.includes('@')) return res.status(400).json({ error: 'Valid email required' });
            const result = await runJulyPayslipTestDelivery(mailDeps, {
                destEmail,
                destPhone,
                dryRun,
            });
            if (deps.logAudit) deps.logAudit(req, 'PAYSLIP_TEST_RUN', 'payslip', destEmail);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'payslip-test-run', err);
        }
    });

    app.get('/api/payslip/link/:token/meta', async (req, res) => {
        try {
            const row = await resolveAccessToken(pool, req.params.token);
            if (!row) return res.status(404).json({ error: 'Link expired or invalid' });
            res.json({
                employeeId: row.employee_id,
                year: row.year,
                month: row.month,
                expiresAt: row.expires_at,
                trial: true,
            });
        } catch (err) {
            handleRouteError(res, 'payslip-link-meta', err);
        }
    });

    app.get('/api/payslip/link/:token', async (req, res) => {
        try {
            const row = await resolveAccessToken(pool, req.params.token);
            if (!row) return res.status(404).json({ error: 'Link expired or invalid' });
            const monthName = new Date(2000, parseInt(row.month, 10) - 1, 1).toLocaleString('en-PK', { month: 'long' });
            const filename = `PaySlip_${row.employee_id}_${monthName}_${row.year}.pdf`;
            res.setHeader('Content-Type', 'application/pdf');
            // inline so mobile SMS links open the PDF directly
            res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
            res.send(row.pdf_bytes);
        } catch (err) {
            handleRouteError(res, 'payslip-link', err);
        }
    });

    app.get('/api/payslip/:employeeId/:month/:year/download', requirePayslipOrStaffAuth, async (req, res) => {
        try {
            const employeeId = decodeURIComponent(req.params.employeeId);
            const { month, year } = req.params;
            if (req.isPortal && String(req.user.employeeId) !== String(employeeId)) {
                return res.status(403).json({ error: 'You can only download your own payslip' });
            }
            const doc = await getStoredDocument(pool, employeeId, parseInt(year, 10), parseInt(month, 10));
            if (!doc) return res.status(404).json({ error: 'Payslip not yet available. Contact HR.' });
            const monthName = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString('en-PK', { month: 'long' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="PaySlip_${employeeId}_${monthName}_${year}.pdf"`);
            res.send(doc.pdf_bytes);
        } catch (err) {
            handleRouteError(res, 'payslip-download', err);
        }
    });

    app.post('/api/payslip/support-case', async (req, res) => {
        try {
            const auth = req.headers.authorization;
            let employeeId = req.body?.employeeId;
            let actorEmail = null;
            if (auth?.startsWith('Bearer ')) {
                try {
                    const jwt = require('jsonwebtoken');
                    const payload = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
                    if (payload.portal) {
                        employeeId = payload.employeeId;
                    } else {
                        actorEmail = payload.email;
                    }
                } catch { /* public token path */ }
            }
            if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
            const row = await createSupportCase(pool, mailDeps, {
                employeeId,
                year: req.body?.year,
                month: req.body?.month,
                description: req.body?.description || '',
                channel: req.body?.channel || 'portal',
                actorEmail,
            });
            res.status(201).json({ ok: true, case: row });
        } catch (err) {
            handleRouteError(res, 'payslip-support-create', err);
        }
    });

    app.get('/api/payslip/support-cases', requireAuth, requireRole('finance_manager', 'superadmin', 'operations'), async (req, res) => {
        try {
            const status = req.query.status || 'open';
            const { rows } = await pool.query(
                `SELECT c.*, e.name AS employee_name FROM payslip_support_cases c
                 LEFT JOIN employees e ON e.id = c.employee_id
                 WHERE ($1 = 'all' OR c.status = $1)
                 ORDER BY c.created_at DESC LIMIT 200`,
                [status]
            );
            res.json({ cases: rows });
        } catch (err) {
            handleRouteError(res, 'payslip-support-list', err);
        }
    });

    app.patch('/api/payslip/support-cases/:id/resolve', requireAuth, requireRole('finance_manager', 'superadmin', 'operations'), async (req, res) => {
        try {
            const row = await resolveSupportCase(pool, mailDeps, parseInt(req.params.id, 10), {
                resolutionNote: req.body?.resolutionNote || '',
                resolvedBy: req.user?.email,
            });
            if (!row) return res.status(404).json({ error: 'Case not found' });
            res.json({ ok: true, case: row });
        } catch (err) {
            handleRouteError(res, 'payslip-support-resolve', err);
        }
    });
}

module.exports = { registerPayslipRoutes };
