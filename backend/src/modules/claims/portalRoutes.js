'use strict';

const path = require('path');
const { handleRouteError } = require('../../core/validate');
const portal = require('./portalService');

function hasManualOverridePerm(user) {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    if (['finance_manager', 'finance_approver'].includes(user.role)) return true;
    let perms = user.permissions;
    if (typeof perms === 'string') {
        try { perms = JSON.parse(perms); } catch { perms = null; }
    }
    if (perms && typeof perms === 'object') {
        const m = perms.claims_portal || perms.payroll || {};
        if (Array.isArray(m) && m.includes('claims_manual_override')) return true;
        if (m.claims_manual_override) return true;
    }
    return false;
}

function registerPortalClaimsRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail } = deps;

    // ── Public filler ─────────────────────────────────────────────────────────
    app.get('/api/portal-claims/fill/:token', async (req, res) => {
        try {
            const result = await portal.openFillerSession(pool, req.params.token);
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.fillGet', err);
        }
    });

    app.post('/api/portal-claims/fill/:token/save', async (req, res) => {
        try {
            const { employeeId, items, confirmNoClaims } = req.body || {};
            if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
            const result = await portal.saveSubmissionItems(pool, {
                token: req.params.token,
                employeeId,
                items,
                confirmNoClaims: !!confirmNoClaims,
            });
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            if (result.notifyApprover && result.periodId) {
                await portal.ensureApproverPacks(pool, result.periodId, sendAppEmail, { forceEmail: true }).catch(() => {});
            }
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.fillSave', err);
        }
    });

    app.post('/api/portal-claims/fill/:token/attachment', async (req, res) => {
        try {
            const { employeeId, filename, mimeType, contentBase64, category } = req.body || {};
            if (!employeeId || !filename || !contentBase64) {
                return res.status(400).json({ error: 'employeeId, filename, contentBase64 required' });
            }
            const result = await portal.addAttachment(pool, {
                token: req.params.token, employeeId, filename, mimeType, contentBase64,
                category: category || 'other',
            });
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.attachment', err);
        }
    });

    app.post('/api/portal-claims/fill/:token/import-excel', async (req, res) => {
        try {
            const { contentBase64, filename } = req.body || {};
            if (!contentBase64) return res.status(400).json({ error: 'contentBase64 required' });
            const result = await portal.importExcelWorkbook(pool, {
                token: req.params.token,
                contentBase64,
                filename,
            });
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error, parseErrors: result.parseErrors });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.importExcel', err);
        }
    });

    app.get('/api/portal-claims/template.xlsx', (req, res) => {
        const p = portal.getMasterClaimsTemplatePath();
        if (!p) return res.status(404).json({ error: 'Template file not found on server' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=ASIL_Consolidated_Master_Claims_Template.xlsx');
        res.sendFile(path.resolve(p));
    });

    // ── Public approver ───────────────────────────────────────────────────────
    app.get('/api/portal-claims/approve/:token', async (req, res) => {
        try {
            const result = await portal.openApproverSession(pool, req.params.token);
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.approveGet', err);
        }
    });

    app.post('/api/portal-claims/approve/:token/decide', async (req, res) => {
        try {
            const { submissionId, decision, comment } = req.body || {};
            if (!submissionId || !['approved', 'rejected'].includes(decision)) {
                return res.status(400).json({ error: 'submissionId and decision (approved|rejected) required' });
            }
            const result = await portal.approverDecide(pool, {
                token: req.params.token,
                submissionId: parseInt(submissionId, 10),
                decision,
                comment,
                sendAppEmail,
            });
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.decide', err);
        }
    });

    app.get('/api/portal-claims/attachments/:id', async (req, res) => {
        try {
            const att = await portal.getAttachmentContent(pool, parseInt(req.params.id, 10));
            if (!att) return res.status(404).json({ error: 'Not found' });
            // Token query optional for public approver links
            res.json({
                id: att.id,
                filename: att.filename,
                mime_type: att.mime_type,
                content_base64: att.content_base64,
                retain_until: att.retain_until,
            });
        } catch (err) {
            handleRouteError(res, 'portalClaims.attGet', err);
        }
    });

    // ── ASIL admin ────────────────────────────────────────────────────────────
    app.get('/api/portal-claims/eligible', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'hr_manager', 'operations'), async (req, res) => {
        try {
            res.json({ employees: await portal.listEligibleEmployees(pool) });
        } catch (err) {
            handleRouteError(res, 'portalClaims.eligible', err);
        }
    });

    app.post('/api/portal-claims/campaign', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            const now = new Date();
            const campaignMonth = parseInt(req.body?.month || now.getMonth() + 1, 10);
            const campaignYear = parseInt(req.body?.year || now.getFullYear(), 10);
            const dryRun = !!req.body?.dryRun;
            const onlyEmails = Array.isArray(req.body?.onlyEmails) ? req.body.onlyEmails : null;
            const result = await portal.createCampaign(pool, {
                campaignMonth, campaignYear, sendAppEmail, dryRun, onlyEmails,
            });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.campaign', err);
        }
    });

    app.post('/api/portal-claims/notify-approvers', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            let periodId = parseInt(req.body?.periodId, 10);
            const month = parseInt(req.body?.month, 10);
            const year = parseInt(req.body?.year, 10);
            if (!periodId && month && year) {
                const period = await portal.findPeriodForUi(pool, month, year);
                periodId = period?.id;
            }
            if (!periodId) return res.status(400).json({ error: 'periodId or month+year required' });
            const packs = await portal.ensureApproverPacks(pool, periodId, sendAppEmail, { forceEmail: true });
            res.json({ packs, periodId, notifyMode: portal.APPROVER_NOTIFY_MODE });
        } catch (err) {
            handleRouteError(res, 'portalClaims.notifyApprovers', err);
        }
    });

    app.get('/api/portal-claims/admin/list', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'payroll_initiator', 'payroll'), async (req, res) => {
        try {
            const rows = await portal.listClaimsForAdmin(pool, req.query);
            res.json({ claims: rows });
        } catch (err) {
            handleRouteError(res, 'portalClaims.adminList', err);
        }
    });

    app.get('/api/portal-claims/admin/tieout', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            const month = parseInt(req.query.month, 10);
            const year = parseInt(req.query.year, 10);
            if (!month || !year) return res.status(400).json({ error: 'month and year required' });
            res.json(await portal.exportClaimsPayrollTieout(pool, month, year));
        } catch (err) {
            handleRouteError(res, 'portalClaims.tieout', err);
        }
    });

    app.post('/api/portal-claims/admin/resend/:batchId', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            const result = await portal.resendFillerInvite(pool, parseInt(req.params.batchId, 10), sendAppEmail);
            if (!result.ok) return res.status(404).json(result);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.resend', err);
        }
    });

    app.post('/api/portal-claims/admin/auto-close', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            res.json(await portal.autoCloseNoClaims(pool));
        } catch (err) {
            handleRouteError(res, 'portalClaims.autoClose', err);
        }
    });

    app.post('/api/portal-claims/admin/reminders', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            res.json(await portal.sendReminders(pool, sendAppEmail));
        } catch (err) {
            handleRouteError(res, 'portalClaims.reminders', err);
        }
    });

    app.post('/api/portal-claims/admin/reset-sample', requireAuth, requireRole('superadmin'), async (req, res) => {
        try {
            const result = await portal.resetPortalClaimsSample(pool);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.resetSample', err);
        }
    });

    // ── Manual ADD OT / CLAIMS ────────────────────────────────────────────────
    app.post('/api/portal-claims/manual-override', requireAuth, async (req, res) => {
        try {
            if (!hasManualOverridePerm(req.user)) {
                return res.status(403).json({ error: 'Missing permission: claims_manual_override' });
            }
            const body = req.body || {};
            const result = await portal.applyManualOverride(pool, {
                employeeId: body.employeeId,
                month: parseInt(body.month, 10),
                year: parseInt(body.year, 10),
                ot1Hours: body.ot1Hours,
                ot2Hours: body.ot2Hours,
                ot3Hours: body.ot3Hours,
                expenseAmount: body.expenseAmount,
                medicalAmount: body.medicalAmount,
                mode: body.mode || 'add',
                reason: body.reason,
                createdBy: req.user?.email || req.user?.username || 'user',
                dryRun: !!body.dryRun,
                isSuperadmin: req.user?.role === 'superadmin',
            });
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            if (!body.dryRun) {
                await portal.notifyManualOverride(sendAppEmail, {
                    employeeId: body.employeeId,
                    month: parseInt(body.month, 10),
                    year: parseInt(body.year, 10),
                    ot1Hours: body.ot1Hours,
                    ot2Hours: body.ot2Hours,
                    ot3Hours: body.ot3Hours,
                    expenseAmount: body.expenseAmount,
                    medicalAmount: body.medicalAmount,
                    mode: body.mode || 'add',
                    reason: body.reason,
                    createdBy: req.user?.email || req.user?.username || 'user',
                    before: result.before,
                    after: result.after,
                    warning: result.warning,
                });
            }
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.manualOverride', err);
        }
    });

    app.post('/api/portal-claims/manual-override/import', requireAuth, async (req, res) => {
        try {
            if (!hasManualOverridePerm(req.user)) {
                return res.status(403).json({ error: 'Missing permission: claims_manual_override' });
            }
            const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
            const dryRun = !!req.body?.dryRun;
            const results = [];
            for (const row of rows) {
                const mode = String(row.mode || row['Replace Existing?'] || 'add').toLowerCase();
                const normalizedMode = mode === 'y' || mode === 'yes' || mode === 'replace' ? 'replace'
                    : mode === 'remove' ? 'remove' : 'add';
                const r = await portal.applyManualOverride(pool, {
                    employeeId: row.employeeId || row['ASIL Employee Code'],
                    month: parseInt(row.month || row['Period Month'], 10),
                    year: parseInt(row.year || row['Period Year'], 10),
                    ot1Hours: row.ot1Hours ?? row['OT 1X Hours'],
                    ot2Hours: row.ot2Hours ?? row['OT 2X Hours'],
                    ot3Hours: row.ot3Hours ?? row['OT 3X Hours'],
                    expenseAmount: row.expenseAmount ?? row['Expense Amount'],
                    medicalAmount: row.medicalAmount ?? row['Medical Amount'],
                    mode: normalizedMode,
                    reason: row.reason || row.Reason,
                    createdBy: req.user?.email || 'import',
                    dryRun,
                    isSuperadmin: req.user?.role === 'superadmin',
                });
                results.push(r);
            }
            res.json({ dryRun, results });
        } catch (err) {
            handleRouteError(res, 'portalClaims.manualImport', err);
        }
    });

    // Public CSV template (no secrets) — avoids Unauthorized when opened in a new tab without JWT
    app.get('/api/portal-claims/manual-override/template', (req, res) => {
        const csv = [
            'ASIL Employee Code,Period Month,Period Year,OT 1X Hours,OT 2X Hours,OT 3X Hours,Expense Amount,Medical Amount,Reason,Replace Existing?',
            'ASIL/SPL-001,7,2026,0,4,0,0,0,Client WhatsApp late OT,N',
        ].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=ADD_OT_CLAIMS_template.csv');
        res.send(csv);
    });
}

module.exports = { registerPortalClaimsRoutes, hasManualOverridePerm };
