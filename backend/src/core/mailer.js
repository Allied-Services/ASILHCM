'use strict';

const { Resend } = require('resend');
const { gateEmailPayload } = require('./communications');

let resendClient;
const EMAIL_FROM = () => process.env.SMTP_FROM || 'ASIL HR <hr@asil.com.pk>';

function getResend() {
    if (!process.env.RESEND_API_KEY) return null;
    if (!resendClient) {
        resendClient = new Resend(process.env.RESEND_API_KEY);
    }
    return resendClient;
}

function coerceAttachmentContent(content) {
    if (Buffer.isBuffer(content)) return content;
    if (typeof content === 'string') {
        // Payslip service historically passed base64; detect & decode.
        const compact = content.replace(/\s+/g, '');
        if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length % 4 === 0 && compact.length > 64) {
            return Buffer.from(compact, 'base64');
        }
        return Buffer.from(content);
    }
    return Buffer.from(content || '');
}

async function sendAppEmail({ to, subject, html, from, cc, bcc, reply_to, attachments }) {
    const gated = gateEmailPayload({ to, subject, html, from, cc, bcc, reply_to, attachments });
    if (gated.skip) {
        console.warn('[mailer.sendAppEmail] skipped', gated.reason, gated.mode);
        return { skipped: true, reason: gated.reason, mode: gated.mode };
    }
    const recipients = (Array.isArray(gated.payload.to) ? gated.payload.to : [gated.payload.to]).filter(Boolean);
    const resend = getResend();
    if (!resend || !recipients.length) {
        return { skipped: true, reason: 'missing_key_or_recipients' };
    }
    const ccList = (Array.isArray(gated.payload.cc) ? gated.payload.cc : gated.payload.cc ? [gated.payload.cc] : []).filter(Boolean);
    const bccList = (Array.isArray(gated.payload.bcc) ? gated.payload.bcc : gated.payload.bcc ? [gated.payload.bcc] : []).filter(Boolean);
    const replyTo = gated.payload.reply_to && String(gated.payload.reply_to).includes('@') ? String(gated.payload.reply_to).trim() : null;
    try {
        const payload = {
            from: gated.payload.from || EMAIL_FROM(),
            to: recipients,
            subject: gated.payload.subject,
            html: gated.payload.html,
        };
        if (ccList.length) payload.cc = ccList;
        if (bccList.length) payload.bcc = bccList;
        if (replyTo) payload.reply_to = replyTo;
        if (attachments?.length) {
            payload.attachments = attachments.map((a) => ({
                filename: a.filename,
                content: coerceAttachmentContent(a.content),
            }));
        }
        const result = await resend.emails.send(payload);
        if (result?.error) {
            console.error('[mailer.sendAppEmail]', result.error);
            throw new Error('Email send failed');
        }
        return { ok: true, result };
    } catch (err) {
        console.error('[mailer.sendAppEmail]', err);
        throw err;
    }
}

module.exports = { sendAppEmail, EMAIL_FROM };
