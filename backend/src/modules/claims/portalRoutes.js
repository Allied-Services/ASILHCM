'use strict';

const path = require('path');
const { handleRouteError } = require('../../core/validate');
const portal = require('./portalService');
const { withClaimsMonitorCc, getClaimsMonitorCc } = require('./claimsMail');

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
    const { pool, requireAuth, requireRole } = deps;
    const sendAppEmail = withClaimsMonitorCc(deps.sendAppEmail);

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
            const { employeeId, items, confirmNoClaims, asDraft } = req.body || {};
            if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
            const result = await portal.saveSubmissionItems(pool, {
                token: req.params.token,
                employeeId,
                items,
                confirmNoClaims: !!confirmNoClaims,
                asDraft: !!asDraft,
            });
            if (!result.ok) {
                return res.status(result.status || 400).json({
                    error: result.error,
                    errors: result.errors || undefined,
                });
            }
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

    app.post('/api/portal-claims/fill/:token/batch-submit', async (req, res) => {
        try {
            const result = await portal.batchSubmitAll(pool, { token: req.params.token, sendAppEmail });
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.batchSubmit', err);
        }
    });

    app.post('/api/portal-claims/fill/:token/batch-attachment', async (req, res) => {
        try {
            const { filename, mimeType, contentBase64, category } = req.body || {};
            const result = await portal.addBatchAttachment(pool, {
                token: req.params.token, filename, mimeType, contentBase64, category,
            });
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.batchAttachment', err);
        }
    });

    app.get('/api/portal-claims/template.xlsx', (req, res) => {
        const p = portal.getMasterClaimsTemplatePath();
        if (!p) return res.status(404).json({ error: 'Template file not found on server' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=ASIL_Consolidated_Master_Claims_Template.xlsx');
        res.sendFile(path.resolve(p));
    });

    app.get('/api/portal-claims/fill/:token/template.xlsx', async (req, res) => {
        try {
            const result = await portal.buildPersonalizedTemplateForToken(pool, req.params.token);
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename=${result.filename || 'ASIL_Claims_Your_Team.xlsx'}`);
            res.send(result.buffer);
        } catch (err) {
            handleRouteError(res, 'portalClaims.personalTemplate', err);
        }
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
            const claimMonth = parseInt(req.body?.claimMonth || req.body?.month || now.getMonth(), 10);
            const claimYear = parseInt(req.body?.claimYear || req.body?.year || now.getFullYear(), 10);
            const dryRun = !!req.body?.dryRun;
            const onlyEmails = Array.isArray(req.body?.onlyEmails) ? req.body.onlyEmails : null;
            const onlyEmployeeIds = Array.isArray(req.body?.onlyEmployeeIds) ? req.body.onlyEmployeeIds : null;
            const campaignMode = String(req.body?.campaignMode || 'sample').toLowerCase() === 'actual' ? 'actual' : 'sample';
            const testPackFour = !!req.body?.testPackFour;

            if (campaignMode === 'actual' && process.env.CLAIMS_ALLOW_ACTUAL_SEND !== 'true') {
                return res.status(403).json({
                    error: 'ACTUAL campaigns are blocked until MD sign-off. Use campaignMode "sample" for testing.',
                });
            }
            if (!dryRun && campaignMode === 'sample' && !process.env.CLAIMS_SAMPLE_EMAIL) {
                return res.status(500).json({ error: 'CLAIMS_SAMPLE_EMAIL is not configured on this server.' });
            }

            const result = await portal.createCampaign(pool, {
                claimMonth, claimYear, sendAppEmail, dryRun, onlyEmails, onlyEmployeeIds, campaignMode, testPackFour,
            });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.campaign', err);
        }
    });

    app.post('/api/portal-claims/campaign/preview', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            const now = new Date();
            const claimMonth = parseInt(req.body?.claimMonth || req.body?.month || now.getMonth(), 10);
            const claimYear = parseInt(req.body?.claimYear || req.body?.year || now.getFullYear(), 10);
            const onlyEmails = Array.isArray(req.body?.onlyEmails) ? req.body.onlyEmails : null;
            const onlyEmployeeIds = Array.isArray(req.body?.onlyEmployeeIds) ? req.body.onlyEmployeeIds : null;
            const campaignMode = String(req.body?.campaignMode || 'sample').toLowerCase() === 'actual' ? 'actual' : 'sample';
            const testPackFour = !!req.body?.testPackFour;
            const sampleEmail = process.env.CLAIMS_SAMPLE_EMAIL || process.env.CLAIMS_TEST_EMAIL || '';
            const result = await portal.createCampaign(pool, {
                claimMonth, claimYear, sendAppEmail: null, dryRun: true, preview: true,
                onlyEmails, onlyEmployeeIds, campaignMode, testPackFour,
            });
            res.json({
                period: result.period,
                campaignMode: result.campaignMode,
                summary: result.summary || { recipientCount: 0, employeeCount: 0, byProfile: {} },
                recipients: result.recipients || [],
                employees: result.employees || [],
                skipped: result.skipped || [],
                gates: {
                    actualSendAllowed: process.env.CLAIMS_ALLOW_ACTUAL_SEND === 'true',
                    sampleEmailConfigured: String(sampleEmail).includes('@'),
                    sampleEmail: String(sampleEmail).includes('@') ? String(sampleEmail).trim().toLowerCase() : null,
                    monitorCc: getClaimsMonitorCc(),
                },
            });
        } catch (err) {
            handleRouteError(res, 'portalClaims.campaignPreview', err);
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

    app.get('/api/portal-claims/admin/response', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'payroll_initiator', 'payroll'), async (req, res) => {
        try {
            const result = await portal.getResponseBoard(pool, {
                workMonth: req.query.workMonth || req.query.month,
                workYear: req.query.workYear || req.query.year,
                payMonth: req.query.payMonth,
                payYear: req.query.payYear,
                client: req.query.client || '',
                contract: req.query.contract || '',
                location: req.query.location || '',
                dept: req.query.dept || '',
            });
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.response', err);
        }
    });

    app.post('/api/portal-claims/admin/import-if-empty', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            const employeeId = String(req.body?.employeeId || '').trim();
            const workMonth = parseInt(req.body?.workMonth, 10);
            const workYear = parseInt(req.body?.workYear, 10);
            if (!employeeId || !workMonth || !workYear) {
                return res.status(400).json({ error: 'employeeId, workMonth, workYear required' });
            }
            const result = await portal.importIfSheetEmpty(pool, { employeeId, workMonth, workYear });
            if (!result.ok) return res.status(result.status || 400).json(result);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'portalClaims.importIfEmpty', err);
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

    app.post('/api/portal-claims/admin/flush-sample', requireAuth, requireRole('superadmin'), async (req, res) => {
        try {
            const claimMonth = parseInt(req.body?.claimMonth, 10) || null;
            const claimYear = parseInt(req.body?.claimYear, 10) || null;
            const client = req.body?.client || 'wafi';
            res.json(await portal.flushPortalClaimsSample(pool, { claimMonth, claimYear, clientPattern: client }));
        } catch (err) {
            handleRouteError(res, 'portalClaims.flushSample', err);
        }
    });

    app.get('/api/portal-claims/eligibility-rules', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            res.json({ rules: await portal.listEligibilityRules(pool) });
        } catch (err) {
            handleRouteError(res, 'portalClaims.eligibilityRules', err);
        }
    });

    app.put('/api/portal-claims/eligibility-rules', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            const id = await portal.upsertEligibilityRule(pool, req.body || {}, req.user?.email);
            res.json({ ok: true, id });
        } catch (err) {
            handleRouteError(res, 'portalClaims.eligibilityRulesPut', err);
        }
    });

    app.get('/api/portal-claims/eligibility-rules/:id/preview', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            res.json(await portal.previewEligibilityRule(pool, parseInt(req.params.id, 10)));
        } catch (err) {
            handleRouteError(res, 'portalClaims.eligibilityPreview', err);
        }
    });

    app.get('/api/portal-claims/employee/:employeeId/category', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'operations', 'payroll_initiator'), async (req, res) => {
        try {
            const cat = await portal.getClaimsCategoryForEmployee(pool, req.params.employeeId);
            if (!cat) return res.status(404).json({ error: 'Employee not found' });
            res.json(cat);
        } catch (err) {
            handleRouteError(res, 'portalClaims.employeeCategory', err);
        }
    });

    app.get('/api/claims/policy/:contractId', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'operations', 'payroll_initiator'), async (req, res) => {
        try {
            const policy = await portal.getClaimsPolicy(pool, req.params.contractId);
            res.json(policy);
        } catch (err) {
            handleRouteError(res, 'claims.policyGet', err);
        }
    });

    app.put('/api/claims/policy/:contractId', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            const row = await portal.upsertClaimsPolicy(pool, req.params.contractId, req.body || {});
            res.json({
                claims_pay_timing: row.claims_pay_timing,
                submit_deadline_day: row.submit_deadline_day,
                approve_deadline_day: row.approve_deadline_day,
            });
        } catch (err) {
            if (err.status === 400) return res.status(400).json({ error: err.message });
            handleRouteError(res, 'claims.policyPut', err);
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
