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

function shouldSendRecordEmail(period) {
    return !isSamplePeriod(period);
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
};
