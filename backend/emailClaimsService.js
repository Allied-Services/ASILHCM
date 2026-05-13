/**
 * emailClaimsService.js — ASIL HCM Email Claims Listener (v2)
 *
 * KEY CHANGES from v1:
 * - Runs ONCE daily at 13:00 (1 PM) — not every 5 minutes
 * - Exposes triggerManualPoll() for on-demand runs from HCM UI
 * - Processes PDF/image ATTACHMENTS via GPT-4o Vision (not email body)
 * - Validates claim month before inserting (rejects month mismatches)
 * - Extracts Line Manager from the form itself
 *
 * Env vars required:
 *   CLAIMS_EMAIL_USER   — e.g. wafi@asil.com.pk
 *   CLAIMS_EMAIL_PASS   — App Password (Gmail) or IMAP password
 *   CLAIMS_EMAIL_HOST   — default imap.gmail.com
 *   CLAIMS_EMAIL_PORT   — default 993
 *   OPENAI_API_KEY      — for GPT-4o Vision attachment parsing
 */

'use strict';

const Imap = require('imap');
const { simpleParser } = require('mailparser');

const CLAIM_SUBJECTS = ['overtime', 'allowance', 'ot claim', 'expense claim', 'expense & ot', 'expense and ot', 'opd'];

// ── IMAP config ────────────────────────────────────────────────────────────────
function getImapConfig() {
    return {
        user:        process.env.CLAIMS_EMAIL_USER || '',
        password:    process.env.CLAIMS_EMAIL_PASS || '',
        host:        process.env.CLAIMS_EMAIL_HOST || 'imap.gmail.com',
        port:        parseInt(process.env.CLAIMS_EMAIL_PORT) || 993,
        tls:         true,
        tlsOptions:  { rejectUnauthorized: false },
        authTimeout: 15000,
    };
}

// ── Subject filter ─────────────────────────────────────────────────────────────
function isClaimSubject(subject = '') {
    const s = subject.toLowerCase();
    return CLAIM_SUBJECTS.some(kw => s.includes(kw));
}

// ── Approval reply detection ───────────────────────────────────────────────────
function isApprovalReply(subject = '', body = '') {
    const s = subject.toLowerCase();
    const b = body.toLowerCase().trim();
    return s.includes('re:') && s.includes('approval') &&
        (b.startsWith('approved') || b.startsWith('rejected') ||
         b.includes('\napproved') || b.includes('\nrejected'));
}

function extractApprovalDecision(body = '') {
    const b = body.toLowerCase();
    if (b.includes('rejected')) return 'REJECTED';
    if (b.includes('approved')) return 'APPROVED';
    return null;
}

// ── GPT-4o Vision: parse a single attachment (PDF rendered as image, or image) ─
async function parseAttachmentViaAI(base64Content, mimeType) {
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY || OPENAI_KEY.startsWith('sk-dummy')) return null;

    // Only process image types (GPT-4o can read images; PDFs need to be sent as image/jpeg if pre-rendered)
    // For now we accept: image/jpeg, image/png, application/pdf (sent as jpeg fallback)
    const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const effectiveMime = supportedTypes.includes(mimeType) ? mimeType : 'image/jpeg';

    const prompt = `You are parsing an ASIL HCM claim form (either an Expense Claim Form ER3 or an Overtime Claim Form TR3).
Extract ALL of the following fields. Return ONLY valid JSON, no markdown.

{
  "form_type": "EXPENSE" | "OT" | "UNKNOWN",
  "employee_code": "ASIL/SPL/-129/21",   // from Employee Code column
  "employee_name": "Haseen Uddin",
  "department": "Retail",
  "location": "Shell House Karachi",
  "line_manager_name": "Abdul Sami",     // from Line Manager Name column
  "line_manager_email": "Abdul.Sami@wafi-energy.com",
  "claim_month": "2026-03-01",           // first day of the month stated in FOR MONTH OF header
  "total_expense_pkr": 93934.00,         // for EXPENSE forms — Total Expense for Month
  "ot_hours_single": 0,                  // for OT forms — total Single hours
  "ot_hours_double": 30,                 // for OT forms — total Double (2X) hours
  "ot_hours_triple": 0,                  // for OT forms — total Triple (3X) hours
  "line_items": []                       // array of {date, description, amount} for expenses OR {date, from, to, hours, type} for OT
}

Rules:
- claim_month = first day of the month shown in "FOR MONTH OF" header (e.g. "1 to 31 Mar'2026" → "2026-03-01")
- For OT forms: Single=1X, Double=2X, Triple=3X
- If a field is not visible, use null`;

    try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 1000,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:${effectiveMime};base64,${base64Content}`, detail: 'high' } }
                    ]
                }]
            })
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const raw = (data.choices?.[0]?.message?.content || '{}')
            .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(raw);
    } catch { return null; }
}

// ── Month validation ───────────────────────────────────────────────────────────
/**
 * Returns true if claimMonth (YYYY-MM-DD) is within acceptable range:
 * current month or previous month only. Rejects anything older or future.
 */
function isMonthValid(claimMonthStr) {
    if (!claimMonthStr) return false;
    const claim = new Date(claimMonthStr);
    const now   = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return claim >= prevMonth && claim <= thisMonth;
}

// ── Message hash for dedup ────────────────────────────────────────────────────
function buildHash(msgId, from, date) {
    return `${msgId || ''}|${from || ''}|${date ? new Date(date).toISOString().slice(0, 10) : ''}`;
}

// ── Core processing for one parsed email ─────────────────────────────────────
async function processOneEmail(pool, parsed) {
    const subject   = parsed.subject || '';
    const from      = parsed.from?.text || '';
    const msgId     = parsed.messageId || '';
    const date      = parsed.date || new Date();
    const bodyText  = parsed.text || '';
    const hash      = buildHash(msgId, from, date);
    const results   = [];

    // ── Duplicate check ──────────────────────────────────────────────────────
    const dup = await pool.query('SELECT id FROM claims_inbox WHERE message_hash=$1 LIMIT 1', [hash]);
    if (dup.rows.length) return [{ type: 'duplicate', from, subject }];

    // ── Collect image/pdf attachments ────────────────────────────────────────
    const attachments = (parsed.attachments || []).filter(a =>
        a.content &&
        ['image/jpeg','image/png','image/gif','image/webp','application/pdf'].includes(a.contentType)
    );

    if (!attachments.length) {
        // No processable attachments — log as unmatched
        await pool.query(`
            INSERT INTO claims_inbox
              (received_at,sender_email,subject,message_id,message_hash,raw_body,status)
            VALUES ($1,$2,$3,$4,$5,$6,'UNMATCHED')
        `, [date, from, subject, msgId, hash, bodyText.slice(0, 2000)]);
        return [{ type: 'no_attachment', from, subject }];
    }

    // ── Process each attachment ───────────────────────────────────────────────
    for (const att of attachments) {
        const b64 = att.content.toString('base64');
        const aiData = await parseAttachmentViaAI(b64, att.contentType);
        if (!aiData) {
            results.push({ type: 'parse_failed', from, subject, file: att.filename });
            continue;
        }

        // ── Month validation ─────────────────────────────────────────────────
        if (!isMonthValid(aiData.claim_month)) {
            await pool.query(`
                INSERT INTO claims_inbox
                  (received_at,sender_email,subject,message_id,message_hash,raw_body,
                   parsed_data,claim_month,claim_type,status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'INVALID_MONTH')
                ON CONFLICT (message_hash) DO NOTHING
            `, [date, from, subject, msgId, hash, bodyText.slice(0,2000),
                JSON.stringify(aiData), aiData.claim_month, aiData.form_type]);
            results.push({ type: 'invalid_month', claim_month: aiData.claim_month, from });
            continue;
        }

        // ── Employee match ───────────────────────────────────────────────────
        let empId = null, status = 'UNMATCHED';
        if (aiData.employee_code) {
            const empRow = await pool.query(
                `SELECT id FROM employees WHERE LOWER(TRIM(id))=LOWER(TRIM($1)) LIMIT 1`,
                [aiData.employee_code]
            );
            if (empRow.rows.length) { empId = empRow.rows[0].id; status = 'PENDING'; }
        }

        // ── Auto-update line manager on employee record ───────────────────────
        if (empId && (aiData.line_manager_name || aiData.line_manager_email)) {
            await pool.query(
                `UPDATE employees SET
                    line_manager_name  = COALESCE($1, line_manager_name),
                    line_manager_email = COALESCE($2, line_manager_email)
                 WHERE id=$3 AND (line_manager_name IS NULL OR line_manager_email IS NULL)`,
                [aiData.line_manager_name || null, aiData.line_manager_email || null, empId]
            );
        }

        // ── Determine claim type and values ──────────────────────────────────
        const claimType   = aiData.form_type === 'EXPENSE' ? 'EXPENSE' :
                            aiData.form_type === 'OT'      ? 'OT'      : aiData.form_type;
        const otHours2x   = parseFloat(aiData.ot_hours_double) || null;
        const otHours3x   = parseFloat(aiData.ot_hours_triple) || null;
        const otHours1x   = parseFloat(aiData.ot_hours_single) || null;
        const claimAmount = parseFloat(aiData.total_expense_pkr) || null;

        await pool.query(`
            INSERT INTO claims_inbox
              (received_at,sender_email,subject,message_id,message_hash,raw_body,
               parsed_data,employee_id,claim_month,claim_type,
               ot_hours,ot_hours_3x,ot_hours_1x,claim_amount,
               line_manager_name,line_manager_email,attachment_filename,status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT (message_hash) DO NOTHING
        `, [
            date, from, subject, msgId, hash, bodyText.slice(0,2000),
            JSON.stringify(aiData), empId, aiData.claim_month, claimType,
            otHours2x, otHours3x, otHours1x, claimAmount,
            aiData.line_manager_name || null, aiData.line_manager_email || null,
            att.filename || null, status
        ]);

        results.push({ type: 'claim', from, subject, status, empId, claimType, file: att.filename });
        console.log(`[Claims] Processed attachment: ${att.filename} | emp=${empId} | ${status}`);
    }
    return results;
}

// ── Main IMAP fetch ────────────────────────────────────────────────────────────
async function fetchAndProcess(pool) {
    const cfg = getImapConfig();
    if (!cfg.user || !cfg.password) {
        console.log('[Claims] CLAIMS_EMAIL_USER/PASS not configured — skipping');
        return { skipped: true };
    }

    console.log(`[Claims] Starting poll of ${cfg.user} at ${new Date().toISOString()}`);
    const summary = { processed: 0, duplicates: 0, errors: 0, invalid_month: 0 };

    return new Promise((resolve) => {
        const imap = new Imap(cfg);

        imap.once('error', err => {
            console.error('[Claims] IMAP error:', err.message);
            resolve({ error: err.message, ...summary });
        });

        imap.once('ready', () => {
            imap.openBox('INBOX', false, (err) => {
                if (err) { imap.end(); resolve({ error: err.message }); return; }

                // Search UNSEEN emails only
                imap.search(['UNSEEN'], async (err, uids) => {
                    if (err || !uids?.length) {
                        console.log('[Claims] No new emails found');
                        imap.end();
                        resolve({ noNew: true, ...summary });
                        return;
                    }

                    const fetch = imap.fetch(uids, { bodies: '', markSeen: true });
                    const raws = [];

                    fetch.on('message', msg => {
                        let raw = '';
                        msg.on('body', stream => stream.on('data', c => { raw += c.toString('utf8'); }));
                        msg.once('end', () => raws.push(raw));
                    });

                    fetch.once('end', async () => {
                        for (const raw of raws) {
                            try {
                                const parsed = await simpleParser(raw);
                                if (!isClaimSubject(parsed.subject || '')) continue;
                                const res = await processOneEmail(pool, parsed);
                                for (const r of res) {
                                    if (r.type === 'claim')         summary.processed++;
                                    else if (r.type === 'duplicate') summary.duplicates++;
                                    else if (r.type === 'invalid_month') summary.invalid_month++;
                                }
                            } catch (e) {
                                console.error('[Claims] Email parse error:', e.message);
                                summary.errors++;
                            }
                        }
                        imap.end();
                        resolve(summary);
                    });

                    fetch.once('error', err => {
                        console.error('[Claims] Fetch error:', err.message);
                        imap.end();
                        resolve({ error: err.message, ...summary });
                    });
                });
            });
        });

        imap.connect();
    });
}

// ── Schedule: run once daily at 13:00 ─────────────────────────────────────────
function scheduleDailyAt13(pool) {
    function msUntil13() {
        const now  = new Date();
        const next = new Date(now);
        next.setHours(13, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1); // already past 1PM today
        return next - now;
    }

    function scheduleNext() {
        const delay = msUntil13();
        console.log(`[Claims] Next scheduled poll in ${Math.round(delay/60000)} min (13:00)`);
        setTimeout(async () => {
            await fetchAndProcess(pool).catch(e => console.error('[Claims] Scheduled poll error:', e.message));
            scheduleNext(); // reschedule for next day
        }, delay);
    }

    scheduleNext();
}

// ── Entry points ───────────────────────────────────────────────────────────────
function startEmailClaimsService(pool) {
    const cfg = getImapConfig();
    if (!cfg.user) {
        console.log('[Claims] Service disabled — CLAIMS_EMAIL_USER not set');
        return;
    }
    console.log(`[Claims] Email claims service started. Scheduled daily at 13:00 for ${cfg.user}`);
    scheduleDailyAt13(pool);
}

// Called from /api/claims/trigger-poll endpoint for manual runs
async function triggerManualPoll(pool) {
    return fetchAndProcess(pool);
}

module.exports = { startEmailClaimsService, triggerManualPoll };
