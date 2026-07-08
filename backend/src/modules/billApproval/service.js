'use strict';

const crypto = require('crypto');
const { parseConfigValue } = require('../../core/jsonConfig');
const { hashToken } = require('../../intake/autoAck');
const { DEFAULT_XERO_SITE_ACCOUNTS } = require('../xeroBillImport/config');

const DEFAULT_BILL_APPROVAL_RULES = {
    threshold_pkr: 100000,
    step2_under: { name: 'Asif Awan', email: 'asif.awan@asil.com.pk' },
    step2_over_equal: { name: 'Shezad Mumtaz', email: 'shezad.mumtaz@asil.com.pk' },
    focal_token_ttl_days: 14,
    site_rules: [
        {
            site: 'Bhakkar',
            account_code: 'FM-106',
            focal_submitters: [
                { email: 'muhammad.anees@wafi-energy.com', name: 'Muhammad Anees' },
                { email: 'laiba.mughal@asil.com.pk', name: 'Laiba Mughal' },
            ],
            step1_approvers: [{ email: 'fayyaz.f.ahmed@wafi-energy.com', name: 'Fayyaz Ahmed' }],
        },
    ],
};

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function billAmountPkr(bill) {
    return parseFloat(bill?.total ?? bill?.amount ?? 0) || 0;
}

function siteAccountCodeForSite(siteName) {
    if (!siteName) return null;
    const target = String(siteName).trim().toLowerCase();
    for (const [code, label] of Object.entries(DEFAULT_XERO_SITE_ACCOUNTS)) {
        if (String(label).trim().toLowerCase() === target) return code;
    }
    return null;
}

function findSiteRule(rules, bill) {
    const site = String(bill?.site || '').trim().toLowerCase();
    return (rules.site_rules || []).find(r => String(r.site || '').trim().toLowerCase() === site) || null;
}

function pickThresholdApprover(amountPkr, rules) {
    const threshold = Number(rules?.threshold_pkr ?? 100000);
    if (amountPkr < threshold) return rules.step2_under;
    return rules.step2_over_equal;
}

function canUserSubmitBill(userEmail, bill, rules) {
    const email = normalizeEmail(userEmail);
    if (!email) return { ok: false, reason: 'missing_user_email' };
    const siteRule = findSiteRule(rules, bill);
    if (!siteRule) return { ok: false, reason: 'no_site_rule' };
    const allowed = (siteRule.focal_submitters || []).some(s => normalizeEmail(s.email) === email);
    if (!allowed) return { ok: false, reason: 'not_focal_for_site' };
    const accountCode = siteRule.account_code || siteAccountCodeForSite(bill.site);
    const billCode = siteAccountCodeForSite(bill.site);
    if (accountCode && billCode && accountCode !== billCode) {
        return { ok: false, reason: 'site_account_mismatch' };
    }
    return { ok: true, accountCode: accountCode || billCode };
}

function resolveStep1Approvers(bill, rules) {
    const siteRule = findSiteRule(rules, bill);
    if (siteRule?.step1_approvers?.length) return siteRule.step1_approvers;
    return rules.default_step1_approvers || [];
}

function isStepComplete(steps, stepNumber) {
    const rows = steps.filter(s => s.step_number === stepNumber);
    if (!rows.length) return false;
    return rows.every(s => s.status === 'approved');
}

function hasStepRejection(steps, stepNumber) {
    return steps.some(s => s.step_number === stepNumber && s.status === 'rejected');
}

async function loadBillApprovalRules(pool) {
    const { rows } = await pool.query("SELECT value FROM system_config WHERE key = 'bill_approval_rules'");
    if (!rows.length) return { ...DEFAULT_BILL_APPROVAL_RULES };
    return { ...DEFAULT_BILL_APPROVAL_RULES, ...parseConfigValue(rows[0].value) };
}

async function isBillApprovalDryRun(pool) {
    if (process.env.BILL_APPROVAL_DRY_RUN === 'false') return false;
    if (process.env.BILL_APPROVAL_DRY_RUN === 'true') return true;
    const { rows } = await pool.query("SELECT value FROM system_config WHERE key = 'BILL_APPROVAL_DRY_RUN'");
    if (!rows.length) return true;
    const val = parseConfigValue(rows[0].value);
    if (val === false || val === 'false') return false;
    return true;
}

async function ensureBillApprovalConfig(pool) {
    await pool.query(
        "INSERT INTO system_config (key, value) VALUES ('bill_approval_rules', $1::jsonb) ON CONFLICT (key) DO NOTHING",
        [JSON.stringify(DEFAULT_BILL_APPROVAL_RULES)]
    );
    await pool.query(
        "INSERT INTO system_config (key, value) VALUES ('BILL_APPROVAL_DRY_RUN', 'true'::jsonb) ON CONFLICT (key) DO NOTHING"
    );
}

async function getApprovalStatus(pool, billId) {
    const { rows: bills } = await pool.query('SELECT * FROM bills WHERE id = $1', [billId]);
    if (!bills.length) return { ok: false, status: 404 };
    const { rows: steps } = await pool.query(
        `SELECT id, bill_id, step_number, approver_email, approver_name, status, comment, decided_at, created_at
         FROM bill_approval_steps WHERE bill_id = $1 ORDER BY step_number, id`,
        [billId]
    );
    return { ok: true, bill: bills[0], steps };
}

async function insertApprovalSteps(pool, billId, stepNumber, approvers) {
    const created = [];
    for (const approver of approvers) {
        const token = crypto.randomBytes(24).toString('hex');
        const { rows } = await pool.query(
            `INSERT INTO bill_approval_steps
             (bill_id, step_number, approver_email, approver_name, token_hash, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT (bill_id, step_number, approver_email) DO UPDATE
             SET token_hash = EXCLUDED.token_hash, status = 'pending', comment = NULL, decided_at = NULL
             RETURNING *`,
            [billId, stepNumber, normalizeEmail(approver.email), approver.name || null, hashToken(token)]
        );
        created.push({ step: rows[0], token });
    }
    return created;
}

async function sendApproverEmails(sendAppEmail, { bill, stepsWithTokens, dryRun }) {
    if (!sendAppEmail || dryRun) return { sent: 0, dryRun: true };
    let sent = 0;
    const base = process.env.APP_BASE_URL || process.env.BACKEND_URL || '';
    for (const { step, token } of stepsWithTokens) {
        if (!step?.approver_email) continue;
        if (/@wafi-energy\.com$/i.test(step.approver_email) && process.env.NODE_ENV === 'test') continue;
        const link = `${base}/api/bill-approval/focal-action?token=${token}&id=${step.id}`;
        await sendAppEmail({
            to: step.approver_email,
            subject: `Bill approval required — ${bill.id}`,
            html: `<p>Please approve bill <strong>${bill.invoice_no || bill.id}</strong> for site ${bill.site || ''}. <a href="${link}">Approve or reject</a></p>`,
        }).catch(() => {});
        sent += 1;
    }
    return { sent, dryRun: false };
}

async function openStep(pool, bill, stepNumber, approvers, sendAppEmail, dryRun) {
    const withTokens = await insertApprovalSteps(pool, bill.id, stepNumber, approvers);
    await sendApproverEmails(sendAppEmail, { bill, stepsWithTokens: withTokens, dryRun });
    return withTokens.map(w => w.step);
}

async function submitBillForApproval(pool, { billId, submittedBy, sendAppEmail }) {
    await ensureBillApprovalConfig(pool);
    const rules = await loadBillApprovalRules(pool);
    const dryRun = await isBillApprovalDryRun(pool);

    const { rows: bills } = await pool.query('SELECT * FROM bills WHERE id = $1', [billId]);
    if (!bills.length) return { ok: false, status: 404, error: 'bill_not_found' };
    const bill = bills[0];
    const status = bill.approval_status || 'draft';
    if (!['draft', 'rejected'].includes(status)) {
        return { ok: false, status: 409, error: 'approval_already_in_progress' };
    }

    const gate = canUserSubmitBill(submittedBy, bill, rules);
    if (!gate.ok) return { ok: false, status: 403, error: gate.reason };

    const step1Approvers = resolveStep1Approvers(bill, rules);
    if (!step1Approvers.length) return { ok: false, status: 400, error: 'no_step1_approvers' };

    await pool.query(
        `UPDATE bills SET approval_status = 'pending_step1', approval_submitted_by = $2,
         approval_submitted_at = NOW(), approval_focal_account = $3, approval_completed_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [billId, normalizeEmail(submittedBy), gate.accountCode || null]
    );

    await pool.query('DELETE FROM bill_approval_steps WHERE bill_id = $1', [billId]);
    const steps = await openStep(pool, bill, 1, step1Approvers, sendAppEmail, dryRun);
    return {
        ok: true,
        billId,
        approval_status: 'pending_step1',
        steps: steps.map(s => ({ id: s.id, approver_email: s.approver_email })),
        dryRun,
    };
}

async function verifyApproverToken(pool, stepId, token) {
    const rules = await loadBillApprovalRules(pool);
    const ttlDays = Number(rules.focal_token_ttl_days || 14);
    const { rows } = await pool.query(
        `SELECT s.*, b.invoice_no, b.site, b.total, b.amount, b.vendor
         FROM bill_approval_steps s JOIN bills b ON b.id = s.bill_id WHERE s.id = $1`,
        [stepId]
    );
    if (!rows.length) return { ok: false, status: 404 };
    const step = rows[0];
    if (step.token_hash !== hashToken(token)) return { ok: false, status: 403 };
    const createdAt = step.created_at ? new Date(step.created_at) : null;
    if (createdAt && (Date.now() - createdAt.getTime()) > ttlDays * 24 * 60 * 60 * 1000) {
        return { ok: false, status: 403, expired: true };
    }
    if (step.status !== 'pending') return { ok: false, status: 409, already: true, step };
    return { ok: true, step };
}

async function maybeAdvanceApproval(pool, billId, sendAppEmail) {
    const rules = await loadBillApprovalRules(pool);
    const dryRun = await isBillApprovalDryRun(pool);
    const status = await getApprovalStatus(pool, billId);
    if (!status.ok) return status;
    const { bill, steps } = status;

    if (hasStepRejection(steps, 1) || hasStepRejection(steps, 2)) {
        await pool.query("UPDATE bills SET approval_status = 'rejected', updated_at = NOW() WHERE id = $1", [billId]);
        return { ok: true, approval_status: 'rejected' };
    }

    if (bill.approval_status === 'pending_step1' && isStepComplete(steps, 1)) {
        const amount = billAmountPkr(bill);
        const approver = pickThresholdApprover(amount, rules);
        if (!approver?.email) return { ok: false, status: 500, error: 'no_step2_approver' };
        await pool.query("UPDATE bills SET approval_status = 'pending_step2', updated_at = NOW() WHERE id = $1", [billId]);
        await openStep(pool, bill, 2, [approver], sendAppEmail, dryRun);
        return { ok: true, approval_status: 'pending_step2' };
    }

    if (bill.approval_status === 'pending_step2' && isStepComplete(steps, 2)) {
        await pool.query(
            `UPDATE bills SET approval_status = 'approved', status = 'Approved',
             approval_completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [billId]
        );
        return { ok: true, approval_status: 'approved' };
    }

    return { ok: true, approval_status: bill.approval_status };
}

async function processApproverDecision(pool, { stepId, token, decision, comment, sendAppEmail }) {
    const check = await verifyApproverToken(pool, stepId, token);
    if (!check.ok) return check;
    const step = check.step;
    const nextStatus = decision === 'approved' ? 'approved' : 'rejected';
    await pool.query(
        'UPDATE bill_approval_steps SET status = $2, comment = $3, decided_at = NOW() WHERE id = $1',
        [stepId, nextStatus, comment || null]
    );
    const advance = await maybeAdvanceApproval(pool, step.bill_id, sendAppEmail);
    return { ok: true, decision: nextStatus, advance };
}

module.exports = {
    DEFAULT_BILL_APPROVAL_RULES,
    normalizeEmail,
    billAmountPkr,
    findSiteRule,
    pickThresholdApprover,
    canUserSubmitBill,
    resolveStep1Approvers,
    isStepComplete,
    hasStepRejection,
    loadBillApprovalRules,
    isBillApprovalDryRun,
    ensureBillApprovalConfig,
    getApprovalStatus,
    submitBillForApproval,
    verifyApproverToken,
    processApproverDecision,
    maybeAdvanceApproval,
};