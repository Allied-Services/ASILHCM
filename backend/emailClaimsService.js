/**
 * emailClaimsService.js — ASIL HCM Email Claims Listener (v3)
 *
 * FIXES in v3:
 * 1. Does NOT mark emails as read (markSeen: false) — user inbox preserved
 * 2. Filters FROM: only @wafi-energy.com senders processed
 * 3. Subject filter updated: Claims, Claim, Overtime, OT, Expense, Reimbursement, Medical, OPD
 * 4. Attachment handling fixed:
 *    - Images (jpg/png/gif/webp) → GPT-4o Vision
 *    - PDFs/Excel → base64 text sent as text prompt to GPT-4o (no vision needed)
 *    - ALL attachment types accepted (was previously dropping xlsx/pdf silently)
 * 5. Uses ALL email (not just UNSEEN) + DB hash dedup — more robust
 */

'use strict';

const Imap = require('imap');
const { simpleParser } = require('mailparser');

// ── Config ────────────────────────────────────────────────────────────────────
const ALLOWED_SENDER_DOMAIN = (process.env.CLAIMS_SENDER_DOMAIN || 'wafi-energy.com').toLowerCase();

// Subject must contain at least one of these keywords (case-insensitive)
const CLAIM_KEYWORDS = ['claim', 'claims', 'overtime', ' ot ', 'ot-', 'expense', 'reimbursement', 'reimburse', 'medical', 'opd'];

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

// ── Filter: subject must contain a claim keyword ───────────────────────────────
function isClaimSubject(subject = '') {
    const s = ' ' + subject.toLowerCase() + ' ';
    return CLAIM_KEYWORDS.some(kw => s.includes(kw));
}

// ── Filter: sender must be from allowed domain ────────────────────────────────
function isAllowedSender(fromText = '') {
    return fromText.toLowerCase().includes('@' + ALLOWED_SENDER_DOMAIN);
}

// ── GPT-4o: parse attachment ──────────────────────────────────────────────────
// For images: uses Vision API
// For all other types (PDF, Excel, etc.): sends base64 as text with clear instructions
async function parseAttachmentViaAI(content, mimeType, filename) {
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY || OPENAI_KEY.startsWith('sk-dummy')) return null;

    const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const isImage = IMAGE_TYPES.includes(mimeType);
    const b64 = content.toString('base64');

    const prompt = `You are parsing an ASIL HCM HR claim form. The file is named "${filename || 'attachment'}".
It is either an Expense Claim Form (ER3) or an Overtime Claim Form (TR3).

Extract ALL fields and return ONLY valid JSON (no markdown fences):

{
  "form_type": "EXPENSE" or "OT" or "OPD" or "UNKNOWN",
  "employee_code": "ASIL/SPL/-129/21",
  "employee_name": "Full Name",
  "department": "Retail",
  "location": "Shell House Karachi",
  "line_manager_name": "Abdul Sami",
  "line_manager_email": "Abdul.Sami@wafi-energy.com",
  "claim_month": "2026-03-01",
  "total_expense_pkr": 93934.00,
  "ot_hours_single": 0,
  "ot_hours_double": 30,
  "ot_hours_triple": 0
}

Rules:
- claim_month = first day of month from "FOR MONTH OF" header (e.g. "1 to 31 Mar'2026" → "2026-03-01")
- OT form: Single=1X rate, Double=2X rate, Triple=3X rate
- Return null for fields not present`;

    try {
        let messages;
        if (isImage) {
            // Vision mode
            messages = [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'high' } }
                ]
            }];
        } else {
            // Text mode — describe the file and let GPT extract from encoded content
            // For Excel/PDF, we pass the first portion of content as context
            const excerpt = b64.slice(0, 8000); // partial content hint
            messages = [{
                role: 'user',
                content: `${prompt}\n\nFile type: ${mimeType}\nFilename: ${filename}\nFile content (base64 excerpt): ${excerpt}\n\nNote: This may be an Excel or PDF file. Extract what you can from the filename and content patterns. If it's an OT Claim form (TR3), set form_type to "OT". If it's an Expense Claim (ER3), set form_type to "EXPENSE". Return best-effort JSON.`
            }];
        }

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o', max_tokens: 800, messages })
        });
        if (!resp.ok) {
            const errText = await resp.text();
            console.error('[Claims] OpenAI error:', resp.status, errText.slice(0, 200));
            return null;
        }
        const data = await resp.json();
        const raw = (data.choices?.[0]?.message?.content || '{}')
            .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(raw);
    } catch (e) {
        console.error('[Claims] AI parse error:', e.message);
        return null;
    }
}

// ── Month validation ───────────────────────────────────────────────────────────
// Accepts current month, previous month, or 2 months back (to handle late submissions)
function isMonthValid(claimMonthStr) {
    if (!claimMonthStr) return false;
    const claim = new Date(claimMonthStr);
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const nextMonth    = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return claim >= twoMonthsAgo && claim < nextMonth;
}

// ── Message hash for dedup ────────────────────────────────────────────────────
function buildHash(msgId, from, subject, date) {
    return `${msgId || ''}|${from || ''}|${subject || ''}|${date ? new Date(date).toISOString().slice(0, 10) : ''}`;
}

// ── Core processing for one parsed email ──────────────────────────────────────
async function processOneEmail(pool, parsed) {
    const subject  = parsed.subject || '';
    const from     = parsed.from?.text || '';
    const fromAddr = parsed.from?.value?.[0]?.address || from;
    const msgId    = parsed.messageId || '';
    const date     = parsed.date || new Date();
    const bodyText = parsed.text || '';
    const hash     = buildHash(msgId, fromAddr, subject, date);
    const results  = [];

    console.log(`[Claims] Processing: "${subject}" from ${fromAddr}`);

    // ── Duplicate check ──────────────────────────────────────────────────────
    const dup = await pool.query('SELECT id FROM claims_inbox WHERE message_hash=$1 LIMIT 1', [hash]);
    if (dup.rows.length) {
        console.log('[Claims] Duplicate, skipping:', hash.slice(0, 60));
        return [{ type: 'duplicate', from, subject }];
    }

    // ── Collect ALL attachments (image + PDF + Excel + any binary) ───────────
    const attachments = (parsed.attachments || []).filter(a => a.content && a.content.length > 0);

    console.log(`[Claims] Attachments found: ${attachments.length} (${attachments.map(a => a.filename || a.contentType).join(', ')})`);

    if (!attachments.length) {
        // No attachments — log and skip (claim data must be in an attachment)
        await pool.query(`
            INSERT INTO claims_inbox
              (received_at,sender_email,subject,message_id,message_hash,raw_body,status)
            VALUES ($1,$2,$3,$4,$5,$6,'NO_ATTACHMENT')
            ON CONFLICT (message_hash) DO NOTHING
        `, [date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000)]);
        console.log('[Claims] No attachments in email — logged as NO_ATTACHMENT');
        return [{ type: 'no_attachment', from, subject }];
    }

    // ── Process each attachment ───────────────────────────────────────────────
    for (const att of attachments) {
        const filename = att.filename || 'attachment';
        console.log(`[Claims] Parsing attachment: ${filename} (${att.contentType}, ${att.content.length} bytes)`);

        const aiData = await parseAttachmentViaAI(att.content, att.contentType, filename);

        if (!aiData) {
            console.warn('[Claims] AI returned null for:', filename);
            // Still log the email so it shows in inbox as UNMATCHED
            await pool.query(`
                INSERT INTO claims_inbox
                  (received_at,sender_email,subject,message_id,message_hash,raw_body,
                   attachment_filename,status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,'UNMATCHED')
                ON CONFLICT (message_hash) DO NOTHING
            `, [date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000), filename]);
            results.push({ type: 'parse_failed', from, subject, file: filename });
            continue;
        }

        console.log('[Claims] AI extracted:', JSON.stringify({ ...aiData, line_items: undefined }));

        // ── Month validation ─────────────────────────────────────────────────
        if (!isMonthValid(aiData.claim_month)) {
            console.warn(`[Claims] Invalid month: ${aiData.claim_month} for ${filename}`);
            await pool.query(`
                INSERT INTO claims_inbox
                  (received_at,sender_email,subject,message_id,message_hash,raw_body,
                   parsed_data,claim_month,claim_type,attachment_filename,status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'INVALID_MONTH')
                ON CONFLICT (message_hash) DO NOTHING
            `, [date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000),
                JSON.stringify(aiData), aiData.claim_month, aiData.form_type, filename]);
            results.push({ type: 'invalid_month', claim_month: aiData.claim_month, from });
            continue;
        }

        // ── Employee match ───────────────────────────────────────────────────
        let empId = null, status = 'UNMATCHED';
        if (aiData.employee_code) {
            // Try exact match first, then fuzzy (strip spaces/dashes)
            const empRow = await pool.query(
                `SELECT id FROM employees
                 WHERE LOWER(REPLACE(REPLACE(id,' ',''),'-','')) =
                       LOWER(REPLACE(REPLACE($1,' ',''),'-',''))
                 LIMIT 1`,
                [aiData.employee_code]
            );
            if (empRow.rows.length) {
                empId = empRow.rows[0].id;
                status = 'PENDING';
                console.log(`[Claims] Matched employee: ${empId}`);
            } else {
                console.warn(`[Claims] No employee match for code: ${aiData.employee_code}`);
            }
        }

        // ── Auto-update line manager on employee record ──────────────────────
        if (empId && (aiData.line_manager_name || aiData.line_manager_email)) {
            await pool.query(
                `UPDATE employees SET
                    line_manager_name  = COALESCE(NULLIF($1,''), line_manager_name),
                    line_manager_email = COALESCE(NULLIF($2,''), line_manager_email)
                 WHERE id = $3`,
                [aiData.line_manager_name || null, aiData.line_manager_email || null, empId]
            );
        }

        // ── Map form type and values ─────────────────────────────────────────
        const claimType   = aiData.form_type || 'UNKNOWN';
        const otHours1x   = parseFloat(aiData.ot_hours_single) || null;
        const otHours2x   = parseFloat(aiData.ot_hours_double) || null;
        const otHours3x   = parseFloat(aiData.ot_hours_triple) || null;
        const claimAmount = parseFloat(aiData.total_expense_pkr) || null;

        await pool.query(`
            INSERT INTO claims_inbox
              (received_at,sender_email,subject,message_id,message_hash,raw_body,
               parsed_data,employee_id,claim_month,claim_type,
               ot_hours_1x,ot_hours_2x,ot_hours_3x,claim_amount,
               line_manager_name,line_manager_email,attachment_filename,status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT (message_hash) DO NOTHING
        `, [
            date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000),
            JSON.stringify(aiData), empId, aiData.claim_month, claimType,
            otHours1x, otHours2x, otHours3x, claimAmount,
            aiData.line_manager_name || null, aiData.line_manager_email || null,
            filename, status
        ]);

        results.push({ type: 'claim', from, subject, status, empId, claimType, file: filename });
        console.log(`[Claims] ✅ Saved: ${filename} | emp=${empId} | type=${claimType} | ${status}`);
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

    console.log(`[Claims] === Starting poll: ${cfg.user} at ${new Date().toLocaleString('en-PK')} ===`);
    console.log(`[Claims] Sender filter: @${ALLOWED_SENDER_DOMAIN}`);
    const summary = { processed: 0, duplicates: 0, skippedSender: 0, skippedSubject: 0, errors: 0, invalid_month: 0 };

    return new Promise((resolve) => {
        const imap = new Imap(cfg);

        imap.once('error', err => {
            console.error('[Claims] IMAP error:', err.message);
            resolve({ error: err.message, ...summary });
        });

        imap.once('ready', () => {
            // Open INBOX in READ-ONLY mode → emails will NOT be marked as read
            imap.openBox('INBOX', true, (err) => {
                if (err) { imap.end(); resolve({ error: err.message }); return; }

                // Search ALL emails (not just UNSEEN) — we use DB hash for dedup
                // This avoids the "mark as read" side effect entirely
                imap.search(['ALL'], async (err, uids) => {
                    if (err || !uids?.length) {
                        console.log('[Claims] Inbox is empty or search failed');
                        imap.end();
                        resolve({ noNew: true, ...summary });
                        return;
                    }

                    // Only fetch the most recent 50 emails to avoid overload
                    const recentUids = uids.slice(-50);
                    console.log(`[Claims] Found ${uids.length} total emails, checking latest ${recentUids.length}`);

                    // markSeen: false — critical: do NOT mark emails as read
                    const fetcher = imap.fetch(recentUids, { bodies: '', markSeen: false });
                    const raws = [];

                    fetcher.on('message', msg => {
                        let raw = '';
                        msg.on('body', stream => stream.on('data', c => { raw += c.toString('binary'); }));
                        msg.once('end', () => { if (raw) raws.push(raw); });
                    });

                    fetcher.once('end', async () => {
                        console.log(`[Claims] Fetched ${raws.length} raw messages`);

                        for (const raw of raws) {
                            try {
                                const parsed = await simpleParser(Buffer.from(raw, 'binary'));
                                const fromAddr = parsed.from?.value?.[0]?.address || '';
                                const subject  = parsed.subject || '';

                                // ── FILTER 1: Sender domain ──────────────────
                                if (!isAllowedSender(fromAddr)) {
                                    summary.skippedSender++;
                                    continue;
                                }

                                // ── FILTER 2: Subject keywords ───────────────
                                if (!isClaimSubject(subject)) {
                                    summary.skippedSubject++;
                                    continue;
                                }

                                console.log(`[Claims] Qualifying email: "${subject}" from ${fromAddr}`);

                                const res = await processOneEmail(pool, parsed);
                                for (const r of res) {
                                    if      (r.type === 'claim')         summary.processed++;
                                    else if (r.type === 'duplicate')     summary.duplicates++;
                                    else if (r.type === 'invalid_month') summary.invalid_month++;
                                }
                            } catch (e) {
                                console.error('[Claims] Email parse error:', e.message);
                                summary.errors++;
                            }
                        }

                        console.log(`[Claims] === Poll complete ===`, summary);
                        imap.end();
                        resolve(summary);
                    });

                    fetcher.once('error', err => {
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
        if (next <= now) next.setDate(next.getDate() + 1);
        return next - now;
    }
    function scheduleNext() {
        const delay = msUntil13();
        console.log(`[Claims] Next scheduled poll in ${Math.round(delay / 60000)} min (13:00 PKT)`);
        setTimeout(async () => {
            await fetchAndProcess(pool).catch(e => console.error('[Claims] Scheduled poll error:', e.message));
            scheduleNext();
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
    console.log(`[Claims] Service started for ${cfg.user} | Sender filter: @${ALLOWED_SENDER_DOMAIN}`);
    scheduleDailyAt13(pool);
}

async function triggerManualPoll(pool) {
    return fetchAndProcess(pool);
}

module.exports = { startEmailClaimsService, triggerManualPoll };
