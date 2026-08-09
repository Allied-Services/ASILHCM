'use strict';

const crypto = require('crypto');

function getSampleEmail() {
    const v = process.env.CLAIMS_SAMPLE_EMAIL || process.env.CLAIMS_TEST_EMAIL;
    if (!v || !String(v).includes('@')) {
        throw new Error('FATAL: CLAIMS_SAMPLE_EMAIL env var is not set (required for SAMPLE-mode sends).');
    }
    return String(v).trim().toLowerCase();
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

module.exports = {
    getSampleEmail,
    stableFillerToken,
    hashToken,
    resolveOutboundEmail,
    sampleSubjectPrefix,
    sampleBodyBanner,
    isSamplePeriod,
    shouldSendRecordEmail,
    canInjectPayroll,
};
