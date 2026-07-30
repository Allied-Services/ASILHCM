'use strict';

const { Resend } = require('resend');

let resendClient;
const EMAIL_FROM = () => process.env.SMTP_FROM || 'ASIL HR <hr@asil.com.pk>';

function getResend() {
    if (!process.env.RESEND_API_KEY) return null;
    if (!resendClient) {
        resendClient = new Resend(process.env.RESEND_API_KEY);
    }
    return resendClient;
}

async function sendAppEmail({ to, subject, html, from }) {
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    const resend = getResend();
    if (!resend || !recipients.length) {
        return { skipped: true, reason: 'missing_key_or_recipients' };
    }
    try {
        const result = await resend.emails.send({
            from: from || EMAIL_FROM(),
            to: recipients,
            subject,
            html,
        });
        return { ok: true, result };
    } catch (err) {
        console.error('[mailer.sendAppEmail]', err);
        throw err;
    }
}

module.exports = { sendAppEmail, EMAIL_FROM };
