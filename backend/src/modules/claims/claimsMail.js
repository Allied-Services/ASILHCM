'use strict';

const crypto = require('crypto');

const DEFAULT_MONITOR_CC = 'claims@asil.com.pk';
const DEFAULT_MONITOR_CC_UNTIL = '2026-11-15';
const DEFAULT_REPLY_TO = 'ops-support@asil.com.pk';

function getSampleEmail() {
    const v = process.env.CLAIMS_SAMPLE_EMAIL || process.env.CLAIMS_TEST_EMAIL;
    if (!v || !String(v).includes('@')) {
        throw new Error('FATAL: CLAIMS_SAMPLE_EMAIL env var is not set (required for SAMPLE-mode sends).');
    }
    return String(v).trim().toLowerCase();
}

function normalizeEmailList(v) {
    if (v == null || v === '') return [];
    const arr = Array.isArray(v) ? v : String(v).split(/[,;]/);
    return [...new Set(arr.map((s) => String(s || '').trim().toLowerCase()).filter((s) => s.includes('@')))];
}

/** Ops inbox copy while the August claims rollout is being proven. Empty CLAIMS_MONITOR_CC disables. */
function getClaimsMonitorCc(now = new Date()) {
    if (process.env.CLAIMS_MONITOR_CC === '') return [];
    const untilRaw = process.env.CLAIMS_MONITOR_CC_UNTIL || DEFAULT_MONITOR_CC_UNTIL;
    if (untilRaw) {
        const until = new Date(`${untilRaw}T23:59:59+05:00`);
        if (!Number.isNaN(until.getTime()) && now > until) return [];
    }
    const raw = process.env.CLAIMS_MONITOR_CC;
    const list = raw && String(raw).includes('@') ? raw : DEFAULT_MONITOR_CC;
    return normalizeEmailList(list);
}

function mergeClaimsMonitorCc(opts = {}, now = new Date()) {
    const monitor = getClaimsMonitorCc(now);
    const to = normalizeEmailList(opts.to);
    const existing = normalizeEmailList(opts.cc);
    const cc = [...new Set([...existing, ...monitor])].filter((e) => !to.includes(e));
    return cc;
}

function withClaimsMonitorCc(sendAppEmail) {
    if (typeof sendAppEmail !== 'function') return sendAppEmail;
    return async function sendWithMonitorCc(opts) {
        const cc = mergeClaimsMonitorCc(opts);
        return sendAppEmail(cc.length ? { ...opts, cc } : opts);
    };
}

/** Reply-To for Focal / Employee / LM responses. Empty CLAIMS_REPLY_TO disables. */
function getClaimsReplyTo() {
    if (process.env.CLAIMS_REPLY_TO === '') return null;
    const raw = process.env.CLAIMS_REPLY_TO || DEFAULT_REPLY_TO;
    const v = String(raw).trim().toLowerCase();
    return v.includes('@') ? v : DEFAULT_REPLY_TO;
}

function withClaimsReplyTo(sendAppEmail) {
    if (typeof sendAppEmail !== 'function') return sendAppEmail;
    return async function sendWithReplyTo(opts) {
        const replyTo = getClaimsReplyTo();
        return sendAppEmail(replyTo ? { ...opts, reply_to: replyTo } : opts);
    };
}

/** Monitor CC + Reply-To for all portal-claims outbound mail. */
function withClaimsPortalMail(sendAppEmail) {
    return withClaimsReplyTo(withClaimsMonitorCc(sendAppEmail));
}

function linkSecret() {
    return process.env.CLAIMS_LINK_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET || 'asil-portal-claims';
}

function stableFillerToken(periodId, email) {
    return crypto.createHmac('sha256', linkSecret())
        .update(`filler:${periodId}:${String(email || '').toLowerCase()}`)
        .digest('hex');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * SAMPLE mode redirects all outbound claims emails to MD test inbox.
 */
function resolveOutboundEmail(period, intendedEmail, { roleLabel } = {}) {
    const mode = String(period?.campaign_mode || 'actual').toLowerCase();
    if (mode === 'sample') {
        return {
            to: getSampleEmail(),
            originalTo: intendedEmail,
            sample: true,
            roleLabel: roleLabel || 'test',
        };
    }
    return { to: intendedEmail, originalTo: intendedEmail, sample: false, roleLabel: null };
}

function sampleSubjectPrefix(period, roleLabel) {
    if (String(period?.campaign_mode || '').toLowerCase() !== 'sample') return '';
    return `[SAMPLE · ${roleLabel || 'test'}] `;
}

function sampleBodyBanner(period, intendedEmail, roleLabel) {
    if (String(period?.campaign_mode || '').toLowerCase() !== 'sample') return '';
    return `<p style="margin:0 0 14px;padding:12px 14px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;color:#92400e;font-size:14px">
      <strong>TEST MODE</strong> — You are playing the role: <strong>${roleLabel || 'test'}</strong>.
      In production this email would go to <strong>${String(intendedEmail || '').replace(/</g, '&lt;')}</strong>.
    </p>`;
}

function isSamplePeriod(period) {
    return String(period?.campaign_mode || '').toLowerCase() === 'sample';
}

/** Always send the submitter record; SAMPLE still redirects via resolveOutboundEmail. */
function shouldSendRecordEmail(_period) {
    return true;
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function submitterRoleLabel(profile) {
    const p = String(profile || '');
    if (p === 'lm_only') return 'Line Manager';
    if (p === 'employee_then_lm' || p === 'employee_then_asil' || p === 'employee_only') return 'Employee';
    if (p === 'focal_then_lm' || p === 'focal_only') return 'Focal';
    return 'Submitter';
}

function formatRecordHours(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function formatRecordPkr(n) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    const [intPart, dec] = v.toFixed(2).split('.');
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return dec === '00' ? `PKR ${withCommas}` : `PKR ${withCommas}.${dec}`;
}

function formatRecordDate(raw) {
    const s = String(raw || '').trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    return s || '—';
}

function otFactorLabel(item) {
    const f = Number(item && item.ot_multiplier_factor);
    if (f >= 3) return '3X';
    if (f >= 2) return '2X';
    if (f >= 1) return '1X';
    const label = String((item && item.ot_multiplier) || '').toLowerCase();
    if (label.includes('triple') || label === '3x') return '3X';
    if (label.includes('double') || label === '2x') return '2X';
    if (label.includes('single') || label === '1x') return '1X';
    return '';
}

function summarizeSubmitItems(items) {
    let ot1 = 0;
    let ot2 = 0;
    let ot3 = 0;
    let expense = 0;
    let medical = 0;
    for (const item of items || []) {
        const type = String(item.claim_type || '').toUpperCase();
        if (type === 'OT') {
            const hours = Number(item.ot_hours) || 0;
            const rate = otFactorLabel(item);
            if (rate === '3X') ot3 += hours;
            else if (rate === '2X') ot2 += hours;
            else ot1 += hours;
        } else if (type === 'EXPENSE') {
            expense += Number(item.amount) || 0;
        } else if (type === 'MEDICAL') {
            medical += Number(item.amount) || 0;
        }
    }
    return { ot1, ot2, ot3, expense, medical };
}

function claimLineDetail(item) {
    const type = String(item.claim_type || '').toUpperCase();
    const bits = [];
    if (type === 'OT') {
        bits.push(`${formatRecordHours(item.ot_hours)}h`);
        const rate = otFactorLabel(item);
        if (rate) bits.push(rate);
        if (item.time_from && item.time_to) bits.push(`${item.time_from}–${item.time_to}`);
        if (item.nature || item.description) bits.push(item.nature || item.description);
    } else {
        bits.push(formatRecordPkr(item.amount));
        if (type === 'EXPENSE' && item.expense_type) bits.push(item.expense_type);
        if (type === 'MEDICAL' && item.patient_name) bits.push(item.patient_name);
        if (item.description) bits.push(item.description);
    }
    return bits.filter(Boolean).join(' · ');
}

function buildSubmitRecordLineRows(submissions, items) {
    const rows = [];
    for (const sub of submissions || []) {
        const empItems = (items || []).filter((i) => i.submission_id === sub.id);
        empItems.sort((a, b) => String(a.claim_date || '').localeCompare(String(b.claim_date || '')));
        for (const item of empItems) {
            rows.push({
                employeeName: sub.employee_name || sub.employee_id || 'Employee',
                employeeId: sub.employee_id || '',
                claimType: String(item.claim_type || '').toUpperCase(),
                claimDate: formatRecordDate(item.claim_date),
                detail: claimLineDetail(item),
            });
        }
    }
    return rows;
}

function buildSubmitRecordEmailHtml({ period, batch, submissions, items }) {
    const totals = summarizeSubmitItems(items);
    const role = submitterRoleLabel(batch && batch.routing_profile);
    const month = `${period.claim_month}/${period.claim_year}`;
    const dest = String(batch && batch.routing_profile) === 'focal_only'
        || String(batch && batch.routing_profile) === 'lm_only'
        || String(batch && batch.routing_profile) === 'employee_only'
        ? 'This submit is final — no further approval.'
        : `Submitted to: ${escapeHtml((submissions && submissions[0] && submissions[0].approver_email) || 'Line Manager')}`;
    const summaryBits = [
        `OT 2X: <strong>${formatRecordHours(totals.ot2)} hrs</strong>`,
        `OT 3X: <strong>${formatRecordHours(totals.ot3)} hrs</strong>`,
    ];
    if (totals.ot1 > 0) summaryBits.unshift(`OT 1X: <strong>${formatRecordHours(totals.ot1)} hrs</strong>`);
    summaryBits.push(`Expense: <strong>${formatRecordPkr(totals.expense)}</strong>`);
    summaryBits.push(`Medical: <strong>${formatRecordPkr(totals.medical)}</strong>`);

    const lineRows = buildSubmitRecordLineRows(submissions, items);
    const lineHtml = lineRows.length
        ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-top:16px">
<tr style="color:#64748b;border-bottom:1px solid #e2e8f0">
<th align="left" style="padding:8px 6px 8px 0">Employee</th>
<th align="left" style="padding:8px 6px">Type</th>
<th align="left" style="padding:8px 6px">Date</th>
<th align="left" style="padding:8px 0 8px 6px">What you entered</th>
</tr>
${lineRows.map((r) => `<tr style="border-bottom:1px solid #f1f5f9;color:#334155">
<td style="padding:8px 6px 8px 0;vertical-align:top">${escapeHtml(r.employeeName)}</td>
<td style="padding:8px 6px;vertical-align:top">${escapeHtml(r.claimType)}</td>
<td style="padding:8px 6px;vertical-align:top">${escapeHtml(r.claimDate)}</td>
<td style="padding:8px 0 8px 6px;vertical-align:top">${escapeHtml(r.detail)}</td>
</tr>`).join('')}
</table>`
        : '<p style="color:#64748b">No claim lines were recorded.</p>';

    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px">
<div style="max-width:640px;margin:auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
<h2 style="margin:0 0 8px;color:#0f172a">Claims submission confirmation</h2>
<p style="margin:0 0 12px;color:#334155">Claim month <strong>${escapeHtml(month)}</strong> — submitted by you as <strong>${escapeHtml(role)}</strong>.</p>
<p style="margin:0 0 8px;color:#0f172a">${summaryBits.join(' · ')}</p>
<p style="margin:0 0 4px;color:#475569">${dest}</p>
${lineHtml}
<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">ASIL HCM — keep this for your records. It lists what you submitted just now.</p>
</div></body></html>`;
}

function buildSubmitRecordMail({ period, batch, submissions, items }) {
    const roleLabel = `${submitterRoleLabel(batch && batch.routing_profile)} record`;
    const mail = resolveOutboundEmail(period, batch && batch.filler_email, { roleLabel });
    const html = wrapClaimsHtmlFooter(buildSubmitRecordEmailHtml({ period, batch, submissions, items }));
    return {
        to: mail.to,
        originalTo: mail.originalTo,
        sample: mail.sample,
        subject: `${sampleSubjectPrefix(period, 'record')}ASIL Claims submitted — ${period.claim_month}/${period.claim_year}`,
        html: sampleBodyBanner(period, batch && batch.filler_email, roleLabel) + html,
    };
}

function canInjectPayroll(period) {
    return !isSamplePeriod(period);
}

function opsSupportFooterHtml() {
    const replyTo = getClaimsReplyTo() || DEFAULT_REPLY_TO;
    return `<p style="margin:18px 0 0;font-size:13px;color:#475569;line-height:1.5">
      Questions or corrections? Reply to this email — <strong>${replyTo}</strong> will receive it.
    </p>`;
}

function appendOpsSupportFooter(html) {
    const footer = opsSupportFooterHtml();
    if (!html || typeof html !== 'string') return footer;
    if (html.includes('</body>')) {
        return html.replace('</body>', `${footer}</body>`);
    }
    return html + footer;
}

function wrapClaimsHtmlFooter(html) {
    return appendOpsSupportFooter(html);
}

module.exports = {
    getSampleEmail,
    getClaimsMonitorCc,
    getClaimsReplyTo,
    mergeClaimsMonitorCc,
    withClaimsMonitorCc,
    withClaimsReplyTo,
    withClaimsPortalMail,
    DEFAULT_MONITOR_CC,
    DEFAULT_MONITOR_CC_UNTIL,
    DEFAULT_REPLY_TO,
    stableFillerToken,
    hashToken,
    resolveOutboundEmail,
    sampleSubjectPrefix,
    sampleBodyBanner,
    isSamplePeriod,
    shouldSendRecordEmail,
    canInjectPayroll,
    opsSupportFooterHtml,
    appendOpsSupportFooter,
    wrapClaimsHtmlFooter,
    escapeHtml,
    submitterRoleLabel,
    summarizeSubmitItems,
    buildSubmitRecordEmailHtml,
    buildSubmitRecordMail,
};
