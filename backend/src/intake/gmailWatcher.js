'use strict';

const { google } = require('googleapis');
const { matchInboxRules } = require('./classifier');
const { sendAutoAck } = require('./autoAck');
const { storeAttachment } = require('./attachmentStore');

const GMAIL_USER = process.env.GMAIL_USER || process.env.INTAKE_EMAIL_USER || 'ops-support@asil.com.pk';
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || '';

function createGmailClient() {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return null;
    const auth = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, 'urn:ietf:wg:oauth:2.0:oob');
    auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
    return google.gmail({ version: 'v1', auth });
}

function extractEmailBody(payload) {
    let text = '';
    function walk(part) {
        if (!part) return;
        if (part.mimeType === 'text/plain' && part.body?.data) {
            text += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        if (part.parts) part.parts.forEach(walk);
    }
    walk(payload);
    return text.replace(/\s+/g, ' ').trim().slice(0, 8000);
}

function parseFromHeader(fromHeader) {
    const senderMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s<>]+@[^\s<>]+)/);
    return senderMatch ? senderMatch[1].toLowerCase() : (fromHeader || '').toLowerCase();
}

async function loadInboxRules(pool) {
    try {
        const { rows } = await pool.query('SELECT * FROM inbox_rules WHERE active = true');
        return rows;
    } catch {
        return [];
    }
}

async function collectAttachments(gmail, pool, msgId, payload) {
    const refs = [];
    async function walk(part) {
        if (!part) return;
        if (part.filename && part.body?.attachmentId) {
            try {
                const { data: attData } = await gmail.users.messages.attachments.get({
                    userId: 'me', messageId: msgId, id: part.body.attachmentId,
                });
                const buffer = Buffer.from(attData.data, 'base64');
                const fileId = await storeAttachment(pool, {
                    filename: part.filename,
                    contentType: part.mimeType,
                    buffer,
                });
                if (fileId) refs.push({ fileId, filename: part.filename, contentType: part.mimeType });
            } catch (e) {
                console.warn('[intake gmail] attachment download failed:', e.message);
            }
        }
        if (part.parts) {
            for (const p of part.parts) await walk(p);
        }
    }
    await walk(payload);
    return refs;
}

async function persistGmailMessage(pool, { mailbox, msgId, from, subject, date, text, classification, attachments }) {
    const { rows } = await pool.query(
        `INSERT INTO intake_messages
         (channel, mailbox, message_uid, from_address, subject, received_at, body_text, attachments, classification, status)
         VALUES ('gmail', $1, $2, $3, $4, $5, $6, $7, $8, 'new')
         ON CONFLICT (mailbox, message_uid) WHERE message_uid IS NOT NULL DO NOTHING
         RETURNING *`,
        [mailbox, msgId, from, subject, date, text, JSON.stringify(attachments), classification]
    );
    return rows[0] || null;
}

async function pollIntakeGmail(pool, deps = {}) {
    const gmail = createGmailClient();
    if (!gmail) {
        return { skipped: true, reason: 'no_gmail_oauth', hint: 'Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN' };
    }

    const dbRules = await loadInboxRules(pool);
    const mailbox = GMAIL_USER;
    // Exclude Wafi Claims traffic — same OAuth inbox, separate processor
    const q = 'is:unread newer_than:7d in:inbox -from:@wafi-energy.com -label:Claims/Processed-Successfully -label:Claims/Pending-Review';
    let processed = 0;

    const { data: listData } = await gmail.users.messages.list({ userId: 'me', q, maxResults: 30 });
    const messages = listData.messages || [];

    for (const stub of messages) {
        const msgId = stub.id;
        let fullMsg;
        try {
            const { data } = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
            fullMsg = data;
        } catch (e) {
            console.warn('[intake gmail] fetch failed:', msgId, e.message);
            continue;
        }

        const headers = {};
        for (const h of (fullMsg.payload?.headers || [])) headers[h.name.toLowerCase()] = h.value;
        const subject = headers.subject || '';
        const from = parseFromHeader(headers.from || '');
        const receivedAt = fullMsg.internalDate ? new Date(parseInt(fullMsg.internalDate, 10)) : new Date();
        const bodyText = extractEmailBody(fullMsg.payload);
        const classificationMeta = matchInboxRules(from, subject, dbRules);

        const attachmentRefs = await collectAttachments(gmail, pool, msgId, fullMsg.payload);

        const saved = await persistGmailMessage(pool, {
            mailbox,
            msgId,
            from,
            subject,
            date: receivedAt,
            text: bodyText,
            classification: classificationMeta.classification,
            attachments: attachmentRefs,
        });

        if (saved) {
            saved.sla_hours = classificationMeta.slaHours;
            if (deps.sendAppEmail) {
                await sendAutoAck(pool, deps.sendAppEmail, saved);
            }
            processed += 1;
            try {
                await gmail.users.messages.modify({
                    userId: 'me',
                    id: msgId,
                    requestBody: { removeLabelIds: ['UNREAD'] },
                });
            } catch {
                /* non-fatal */
            }
        }
    }

    return { processed, channel: 'gmail', mailbox, polled: messages.length };
}

module.exports = { pollIntakeGmail, createGmailClient, isGmailIntakeConfigured: () => !!(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN) };
