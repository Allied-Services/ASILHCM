'use strict';

/**
 * Employee vs focal vs personal mailboxes.
 *
 * Payslips: employee address (personal is OK) AND focal.
 * Portal claims: never gather on a personal mailbox — focal, or a work/official address.
 */

const SADIA_SETUP_EMAIL = 'sadia.komal@asil.com.pk';

const PERSONAL_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'gmail.com.pk',
    'yahoo.com',
    'yahoo.co.uk',
    'ymail.com',
    'hotmail.com',
    'outlook.com',
    'live.com',
    'msn.com',
    'icloud.com',
    'me.com',
    'aol.com',
    'mail.com',
    'protonmail.com',
    'proton.me',
    'pm.me',
]);

function tidyEmail(raw) {
    return String(raw == null ? '' : raw)
        .replace(/[\t\r\n]+/g, ' ')
        .replace(/^['"]+|['"]+$/g, '')
        .trim()
        .replace(/\s+/g, '');
}

function isUsableEmail(raw) {
    const email = tidyEmail(raw);
    if (!email || !email.includes('@')) return '';
    if (/^(n\/?a|none|null|nil|-)$/i.test(email)) return '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
    return email;
}

function emailDomain(raw) {
    const e = isUsableEmail(raw);
    if (!e) return '';
    return e.split('@').pop().toLowerCase();
}

function isPersonalEmail(raw) {
    const d = emailDomain(raw);
    if (!d) return false;
    if (d === 'gmail.com' || d.startsWith('gmail.') || d.endsWith('.gmail.com')) return true;
    return PERSONAL_DOMAINS.has(d);
}

function isWorkEmail(raw) {
    const e = isUsableEmail(raw);
    return e && !isPersonalEmail(e) ? e : '';
}

function domainMatches(domain, root) {
    const d = String(domain || '').toLowerCase();
    const r = String(root || '').toLowerCase();
    return d === r || d.endsWith(`.${r}`);
}

/** Portal Claims employee filler: Wafi work mailbox or asil.com.pk only. */
function isClaimsWorkMailbox(raw) {
    const e = isUsableEmail(raw);
    if (!e) return '';
    const d = emailDomain(e);
    if (domainMatches(d, 'wafi-energy.com') || domainMatches(d, 'asil.com.pk')) return e;
    return '';
}

function emailsEqual(a, b) {
    const x = isUsableEmail(a).toLowerCase();
    const y = isUsableEmail(b).toLowerCase();
    return !!x && !!y && x === y;
}

function uniqueEmails(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list || []) {
        const e = isUsableEmail(raw);
        if (!e) continue;
        const key = e.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(e);
    }
    return out;
}

function resolveFocalEmail(emp) {
    const auth = String(emp?.claim_authority ?? emp?.claimAuthority ?? '').trim();
    if (!auth || /^self$/i.test(auth) || /^n\/?a$/i.test(auth)) return '';
    return isUsableEmail(auth);
}

function blankOptionalText(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s || /^(n\/?a|none|null|nil|-|—|–)$/i.test(s)) return null;
    return s;
}

function bodyHasField(e, camel, snake) {
    if (!e || typeof e !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(e, camel)
        || Object.prototype.hasOwnProperty.call(e, snake);
}

function bodyHasClaimAuthority(e) {
    return bodyHasField(e, 'claimAuthority', 'claim_authority');
}
function routingFieldsFromBody(e = {}) {
    return {
        claim_authority: isUsableEmail(e.claimAuthority ?? e.claim_authority) || null,
        line_manager_name: blankOptionalText(e.lineManagerName ?? e.line_manager_name),
        line_manager_email: isUsableEmail(e.lineManagerEmail ?? e.line_manager_email) || null,
        claims_reviewer_email: isUsableEmail(e.claimsReviewerEmail ?? e.claims_reviewer_email) || null,
    };
}

/** Map DB row → employee JSON for Employee Information / Profile. */
function routingFieldsFromRow(r = {}) {
    const focal = r.claim_authority || null;
    const lmName = r.line_manager_name || null;
    const lmEmail = r.line_manager_email || null;
    const reviewerEmail = r.claims_reviewer_email || null;
    return {
        claimAuthority: focal,
        claim_authority: focal,
        lineManagerName: lmName,
        line_manager_name: lmName,
        lineManagerEmail: lmEmail,
        line_manager_email: lmEmail,
        claimsReviewerEmail: reviewerEmail,
        claims_reviewer_email: reviewerEmail,
    };
}

function resolveEmployeeOwnEmail(emp) {
    return isUsableEmail(emp?.email);
}

/**
 * Payslip To: employee (personal allowed) and focal.
 * If the employee has no email, focal only.
 */
function resolvePayslipRecipients(emp, destEmailOverride) {
    const override = isUsableEmail(destEmailOverride);
    if (override) return [override];
    return uniqueEmails([
        resolveEmployeeOwnEmail(emp),
        resolveFocalEmail(emp),
    ]);
}

/** Employee-initiated claims filler — Wafi or asil.com.pk only, never Gmail/Yahoo/etc. */
function resolveClaimsEmployeeFillerEmail(emp) {
    return isClaimsWorkMailbox(emp?.email);
}

function hasPayslipEmailChannel(emp) {
    return resolvePayslipRecipients(emp).length > 0;
}

module.exports = {
    PERSONAL_DOMAINS,
    SADIA_SETUP_EMAIL,
    isUsableEmail,
    isPersonalEmail,
    isWorkEmail,
    isClaimsWorkMailbox,
    emailDomain,
    emailsEqual,
    uniqueEmails,
    resolveFocalEmail,
    resolveEmployeeOwnEmail,
    resolvePayslipRecipients,
    resolveClaimsEmployeeFillerEmail,
    hasPayslipEmailChannel,
    blankOptionalText,
    routingFieldsFromBody,
    routingFieldsFromRow,
    bodyHasClaimAuthority,
};
