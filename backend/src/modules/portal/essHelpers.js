'use strict';

const DEFAULT_CHANGE_SETTINGS = {
    approver_emails: ['rabia.bhutto@asil.com.pk'],
    notify_on_submit: true,
    notify_employee_on_decision: true,
    photo_requires_approval: false,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
    return !!(email && EMAIL_RE.test(String(email).trim()));
}

function maskEmail(email) {
    const e = String(email || '').trim();
    const at = e.indexOf('@');
    if (at < 1) return '***';
    const user = e.slice(0, at);
    const domain = e.slice(at + 1);
    const shown = user.slice(0, Math.min(2, user.length));
    return `${shown}***@${domain}`;
}

function maskPhone(phone) {
    const p = String(phone || '').replace(/\D/g, '');
    if (p.length < 4) return '****';
    return `${p.slice(0, 4)}****${p.slice(-2)}`;
}

async function getPortalChangeSettings(pool) {
    try {
        const { rows } = await pool.query(
            `SELECT value FROM system_config WHERE key='portal_change_request_settings'`
        );
        if (!rows.length || !rows[0].value) return { ...DEFAULT_CHANGE_SETTINGS };
        const raw = rows[0].value;
        const val = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return {
            ...DEFAULT_CHANGE_SETTINGS,
            ...val,
            approver_emails: Array.isArray(val.approver_emails) && val.approver_emails.length
                ? val.approver_emails.map(e => String(e).trim().toLowerCase()).filter(Boolean)
                : DEFAULT_CHANGE_SETTINGS.approver_emails,
        };
    } catch {
        return { ...DEFAULT_CHANGE_SETTINGS };
    }
}

async function ensurePortalChangeSettings(pool) {
    await pool.query(`
        INSERT INTO system_config (key, value)
        VALUES ('portal_change_request_settings', $1::jsonb)
        ON CONFLICT (key) DO NOTHING
    `, [JSON.stringify(DEFAULT_CHANGE_SETTINGS)]).catch(() => {});
}

function canApproveChangeRequest(user, settings) {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    const emails = (settings?.approver_emails || []).map(e => String(e).toLowerCase());
    if (!emails.length) {
        return ['operations', 'operations_supervisor', 'payroll_initiator', 'hr_manager', 'admin'].includes(user.role);
    }
    return emails.includes(String(user.email || '').toLowerCase());
}

const CHANGE_QUEUE_ROLES = ['superadmin', 'operations', 'operations_supervisor', 'payroll_initiator', 'hr_manager', 'admin'];

module.exports = {
    DEFAULT_CHANGE_SETTINGS,
    isValidEmail,
    maskEmail,
    maskPhone,
    getPortalChangeSettings,
    ensurePortalChangeSettings,
    canApproveChangeRequest,
    CHANGE_QUEUE_ROLES,
};
