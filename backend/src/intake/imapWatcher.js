'use strict';

let ImapFlow;
try {
    ImapFlow = require('imapflow').ImapFlow;
} catch {
    ImapFlow = null;
}
const { simpleParser } = require('mailparser');
const { matchInboxRules } = require('./classifier');
const { sendAutoAck } = require('./autoAck');
const { storeAttachment } = require('./attachmentStore');

function getIntakeConfig() {
    return {
        host: process.env.INTAKE_IMAP_HOST || process.env.CLAIMS_EMAIL_HOST || 'imap.gmail.com',
        port: parseInt(process.env.INTAKE_IMAP_PORT || '993', 10),
        secure: process.env.INTAKE_IMAP_SECURE !== 'false',
        user: process.env.INTAKE_EMAIL_USER || process.env.CLAIMS_EMAIL_USER,
        pass: process.env.INTAKE_EMAIL_PASS || process.env.CLAIMS_EMAIL_PASS,
        mailbox: process.env.INTAKE_MAILBOX || 'INBOX',
    };
}

async function loadInboxRules(pool) {
    try {
        const { rows } = await pool.query('SELECT * FROM inbox_rules WHERE active = true');
        return rows;
    } catch {
        return [];
    }
}

async function persistMessage(pool, msg, classificationMeta, attachments) {
    const { rows } = await pool.query(
        `INSERT INTO intake_messages
         (channel, mailbox, message_uid, from_address, subject, received_at, body_text, attachments, classification, status)
         VALUES ('imap', $1, $2, $3, $4, $5, $6, $7, $8, 'new')
         ON CONFLICT (mailbox, message_uid) WHERE message_uid IS NOT NULL DO NOTHING
         RETURNING *`,
        [
            msg.mailbox,
            msg.uid,
            msg.from,
            msg.subject,
            msg.date,
            msg.text,
            JSON.stringify(attachments),
            classificationMeta.classification,
        ]
    );
    return rows[0] || null;
}

async function pollIntakeMailbox(pool, deps = {}) {
    const { pollIntakeGmail, isGmailIntakeConfigured } = require('./gmailWatcher');
    if (isGmailIntakeConfigured()) {
        try {
            const gmailResult = await pollIntakeGmail(pool, deps);
            if (!gmailResult.skipped) {
                console.log(`[intake] Gmail poll: ${gmailResult.processed} new message(s) from ${gmailResult.mailbox}`);
                return gmailResult;
            }
        } catch (err) {
            console.error('[intake] Gmail poll failed, trying IMAP fallback:', err.message);
        }
    }

    const cfg = getIntakeConfig();
    if (!cfg.user || !cfg.pass) {
        console.log('[intake] Disabled — set GMAIL OAuth (preferred) or INTAKE_EMAIL_USER/PASS');
        return {
            skipped: true,
            reason: isGmailIntakeConfigured() ? 'gmail_failed_no_imap_fallback' : 'no_credentials',
            hint: 'Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN',
        };
    }
    if (!ImapFlow) {
        console.warn('[intake] imapflow not installed — poll skipped');
        return { skipped: true, reason: 'no_imapflow' };
    }

    const dbRules = await loadInboxRules(pool);
    const client = new ImapFlow({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
        logger: false,
    });

    let processed = 0;
    await client.connect();
    try {
        const lock = await client.getMailboxLock(cfg.mailbox);
        try {
            const since = new Date();
            since.setDate(since.getDate() - 7);
            for await (const msg of client.fetch({ seen: false, since }, { envelope: true, source: true, uid: true })) {
                const parsed = await simpleParser(msg.source);
                const from = parsed.from?.value?.[0]?.address || '';
                const subject = parsed.subject || '';
                const classificationMeta = matchInboxRules(from, subject, dbRules);

                const attachmentRefs = [];
                for (const att of parsed.attachments || []) {
                    const fileId = await storeAttachment(pool, {
                        filename: att.filename,
                        contentType: att.contentType,
                        buffer: att.content,
                    });
                    if (fileId) attachmentRefs.push({ fileId, filename: att.filename, contentType: att.contentType });
                }

                const saved = await persistMessage(pool, {
                    mailbox: cfg.mailbox,
                    uid: String(msg.uid),
                    from,
                    subject,
                    date: parsed.date || new Date(),
                    text: parsed.text || parsed.textAsHtml || '',
                }, classificationMeta, attachmentRefs);

                if (saved) {
                    saved.sla_hours = classificationMeta.slaHours;
                    if (deps.sendAppEmail) {
                        await sendAutoAck(pool, deps.sendAppEmail, saved);
                    }
                    processed += 1;
                }
            }
        } finally {
            lock.release();
        }
    } finally {
        await client.logout();
    }

    return { processed, channel: 'imap' };
}

module.exports = { pollIntakeMailbox, getIntakeConfig };
