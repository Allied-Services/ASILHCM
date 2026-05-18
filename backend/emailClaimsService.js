/**
 * emailClaimsService.js — ASIL HCM Email Claims Listener (v4 — XLSX)
 *
 * v4 Changes:
 * - XLSX only: uses SheetJS to convert Excel → plain text, sent to GPT-4o as text
 * - Date filter: only emails received AFTER 1 April 2026
 * - Sender filter: only @wafi-energy.com
 * - Subject filter: Claim/Claims/OT/Overtime/Expense/Reimbursement/Medical/OPD
 * - READ-ONLY IMAP (no mark-as-seen)
 * - DB hash dedup
 */

'use strict';

const Imap          = require('imap');
const { simpleParser } = require('mailparser');
const XLSX          = require('xlsx');

// ── Config ────────────────────────────────────────────────────────────────────
const ALLOWED_SENDER_DOMAIN = (process.env.CLAIMS_SENDER_DOMAIN || 'wafi-energy.com').toLowerCase();
const CUTOFF_DATE = new Date('2026-04-01T00:00:00Z'); // Only emails received after this date

const CLAIM_KEYWORDS = ['claim', 'overtime', ' ot ', 'ot-', 'expense', 'reimbursement', 'reimburse', 'medical', 'opd'];

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

// ── Filters ───────────────────────────────────────────────────────────────────
function isClaimSubject(subject = '') {
    const s = ' ' + subject.toLowerCase() + ' ';
    return CLAIM_KEYWORDS.some(kw => s.includes(kw));
}

function isAllowedSender(fromText = '') {
    return fromText.toLowerCase().includes('@' + ALLOWED_SENDER_DOMAIN);
}

function isAfterCutoff(date) {
    if (!date) return false;
    return new Date(date) >= CUTOFF_DATE;
}

// ── XLSX → text extraction ────────────────────────────────────────────────────
function xlsxToText(buffer) {
    try {
        const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
        const lines = [];

        for (const sheetName of workbook.SheetNames) {
            lines.push(`=== Sheet: ${sheetName} ===`);
            const sheet = workbook.Sheets[sheetName];
            // Convert to array of arrays (rows)
            const rows = XLSX.utils.sheet_to_json(sheet, {
                header: 1,
                defval: '',
                blankrows: false,
                raw: false,   // format dates as strings
            });
            for (const row of rows) {
                const rowStr = row.map(cell => String(cell || '').trim()).join('\t');
                if (rowStr.replace(/\t/g, '').trim()) lines.push(rowStr); // skip blank rows
            }
            lines.push('');
        }
        return lines.join('\n');
    } catch (e) {
        console.error('[Claims] XLSX parse error:', e.message);
        return null;
    }
}

// ── GPT-4o text extraction from Excel content ─────────────────────────────────
async function parseXlsxViaAI(sheetText, filename) {
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY || OPENAI_KEY.startsWith('sk-dummy')) {
        console.log('[Claims] No valid OpenAI key — skipping AI parse');
        return null;
    }

    // Limit to first 6000 chars to stay within token limits
    const excerpt = sheetText.slice(0, 6000);

    const prompt = `You are extracting structured data from an ASIL HCM Excel claim form.
The file is: "${filename}"
This is either an Expense Claim Form (ER3) or an Overtime (OT) Claim Form (TR3) from Allied Services International (ASIL).

Here is the raw tab-separated content extracted from the Excel file:

${excerpt}

Extract the following and return ONLY valid JSON (no markdown, no explanation):

{
  "form_type": "EXPENSE" or "OT" or "OPD" or "ALLOWANCE" or "UNKNOWN",
  "employee_code": "e.g. ASIL/SPL/-129/21 or ASIL/RO/SP-009",
  "employee_name": "Full name of the employee",
  "department": "Department",
  "location": "Work location / site",
  "line_manager_name": "Direct line manager full name",
  "line_manager_email": "line.manager@wafi-energy.com",
  "claim_month": "YYYY-MM-01",
  "total_expense_pkr": 0.00,
  "ot_hours_single": 0,
  "ot_hours_double": 0,
  "ot_hours_triple": 0
}

Rules:
- claim_month: find "FOR MONTH OF" or "Month:" header — return first day of that month as YYYY-MM-01
- employee_code: look for "Employee Code", "Emp Code", "Staff No" — format is like ASIL/XXX/YYY or similar
- OT form (TR3): sum all hours by rate type (Single=1X, Double=2X, Triple=3X)
- Expense form (ER3): sum all expense amounts for total_expense_pkr
- Return null for any field you cannot confidently determine. Do NOT guess.`;

    try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 600,
                temperature: 0,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!resp.ok) {
            const errBody = await resp.text();
            console.error(`[Claims] OpenAI error ${resp.status}:`, errBody.slice(0, 300));
            return null;
        }

        const data = await resp.json();
        const rawContent = data.choices?.[0]?.message?.content || '{}';
        console.log(`[Claims] GPT response for ${filename}:`, rawContent.slice(0, 500));

        const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);

    } catch (e) {
        console.error(`[Claims] AI parse exception for ${filename}:`, e.message);
        return null;
    }
}

// ── Month validation ───────────────────────────────────────────────────────────
function isMonthValid(claimMonthStr) {
    if (!claimMonthStr) return false;
    const claim = new Date(claimMonthStr);
    if (isNaN(claim)) return false;
    // Accept April 2026 onwards (aligns with cutoff)
    const minMonth = new Date('2026-04-01');
    const maxMonth = new Date(); maxMonth.setDate(1); // start of current month
    maxMonth.setMonth(maxMonth.getMonth() + 1); // up to next month
    return claim >= minMonth && claim < maxMonth;
}

// ── Message hash for dedup ────────────────────────────────────────────────────
function buildHash(msgId, fromAddr, subject, date) {
    return `${msgId || ''}|${fromAddr || ''}|${subject || ''}|${date ? new Date(date).toISOString().slice(0, 10) : ''}`;
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

    console.log(`[Claims] → Processing: "${subject}" from ${fromAddr} dated ${date}`);

    // ── Duplicate check ──────────────────────────────────────────────────────
    const dup = await pool.query('SELECT id FROM claims_inbox WHERE message_hash=$1 LIMIT 1', [hash]);
    if (dup.rows.length) {
        console.log('[Claims]   Duplicate, skipping');
        return [{ type: 'duplicate', from, subject }];
    }

    // ── Find XLSX attachments ────────────────────────────────────────────────
    const XLSX_TYPES = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
        'application/vnd.ms-excel',                                           // .xls
        'application/octet-stream',                                           // generic binary (often xlsx)
    ];
    const xlsxAtts = (parsed.attachments || []).filter(a => {
        if (!a.content || a.content.length === 0) return false;
        const fn = (a.filename || '').toLowerCase();
        const isXlsxMime = XLSX_TYPES.includes(a.contentType);
        const isXlsxExt  = fn.endsWith('.xlsx') || fn.endsWith('.xls');
        return isXlsxMime || isXlsxExt;
    });

    console.log(`[Claims]   Total attachments: ${(parsed.attachments || []).length}, XLSX: ${xlsxAtts.length}`);
    if (parsed.attachments?.length) {
        parsed.attachments.forEach(a => console.log(`[Claims]     Att: ${a.filename} | type: ${a.contentType} | size: ${a.content?.length}`));
    }

    if (!xlsxAtts.length) {
        await pool.query(`
            INSERT INTO claims_inbox
              (received_at,sender_email,subject,message_id,message_hash,raw_body,status)
            VALUES ($1,$2,$3,$4,$5,$6,'NO_ATTACHMENT')
            ON CONFLICT (message_hash) DO NOTHING
        `, [date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000)]);
        console.log('[Claims]   No XLSX attachments — logged as NO_ATTACHMENT');
        return [{ type: 'no_attachment', from, subject }];
    }

    const results = [];

    for (const att of xlsxAtts) {
        const filename = att.filename || 'attachment.xlsx';
        console.log(`[Claims]   Parsing XLSX: ${filename} (${att.content.length} bytes)`);

        // Step 1: Extract text from Excel
        const sheetText = xlsxToText(att.content);
        if (!sheetText) {
            console.warn(`[Claims]   Could not extract text from ${filename}`);
            results.push({ type: 'parse_failed', from, subject, file: filename });
            continue;
        }
        console.log(`[Claims]   Sheet text preview: ${sheetText.slice(0, 300).replace(/\n/g, ' | ')}`);

        // Step 2: GPT extracts structured data from the text
        const aiData = await parseXlsxViaAI(sheetText, filename);
        if (!aiData) {
            console.warn(`[Claims]   AI returned null for ${filename}`);
            await pool.query(`
                INSERT INTO claims_inbox
                  (received_at,sender_email,subject,message_id,message_hash,raw_body,attachment_filename,status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,'UNMATCHED')
                ON CONFLICT (message_hash) DO NOTHING
            `, [date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000), filename]);
            results.push({ type: 'parse_failed', from, subject, file: filename });
            continue;
        }

        // ── Month validation ─────────────────────────────────────────────────
        if (!isMonthValid(aiData.claim_month)) {
            console.warn(`[Claims]   Invalid/out-of-range month: ${aiData.claim_month}`);
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
            const empRow = await pool.query(
                `SELECT id FROM employees
                 WHERE LOWER(REPLACE(REPLACE(REPLACE(id,' ',''),'-',''),'/','')) =
                       LOWER(REPLACE(REPLACE(REPLACE($1,' ',''),'-',''),'/',''))
                 LIMIT 1`,
                [aiData.employee_code]
            );
            if (empRow.rows.length) {
                empId = empRow.rows[0].id;
                status = 'PENDING';
                console.log(`[Claims]   ✅ Matched employee: ${empId}`);
            } else {
                console.warn(`[Claims]   ⚠ No match for employee code: "${aiData.employee_code}"`);
            }
        } else {
            console.warn('[Claims]   No employee_code extracted from form');
        }

        // ── Auto-update line manager ─────────────────────────────────────────
        if (empId && (aiData.line_manager_name || aiData.line_manager_email)) {
            await pool.query(
                `UPDATE employees SET
                    line_manager_name  = COALESCE(NULLIF($1,''), line_manager_name),
                    line_manager_email = COALESCE(NULLIF($2,''), line_manager_email)
                 WHERE id = $3`,
                [aiData.line_manager_name || null, aiData.line_manager_email || null, empId]
            );
        }

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
            JSON.stringify(aiData), empId, aiData.claim_month, aiData.form_type,
            otHours1x, otHours2x, otHours3x, claimAmount,
            aiData.line_manager_name || null, aiData.line_manager_email || null,
            filename, status
        ]);

        console.log(`[Claims]   ✅ Saved: ${filename} | emp=${empId} | ${aiData.form_type} | ${status}`);
        results.push({ type: 'claim', from, subject, status, empId, claimType: aiData.form_type, file: filename });
    }

    return results;
}

// ── Main IMAP fetch ────────────────────────────────────────────────────────────
// Processes each email inline as it streams in — never holds all 1000+ emails
// in memory at once. A concurrency gate limits parallel async processing to 3.
async function fetchAndProcess(pool) {
    const cfg = getImapConfig();
    if (!cfg.user || !cfg.password) {
        console.log('[Claims] CLAIMS_EMAIL_USER/PASS not configured — skipping');
        return { skipped: true };
    }

    console.log(`[Claims] ═══ Poll starting: ${cfg.user} | Cutoff: ${CUTOFF_DATE.toDateString()} | Domain: @${ALLOWED_SENDER_DOMAIN} ═══`);
    const summary = { processed: 0, duplicates: 0, skippedSender: 0, skippedSubject: 0, skippedDate: 0, errors: 0, invalid_month: 0 };

    return new Promise((resolve) => {
        const imap = new Imap(cfg);

        imap.once('error', err => {
            console.error('[Claims] IMAP error:', err.message);
            resolve({ error: err.message, ...summary });
        });

        imap.once('ready', () => {
            // READ-ONLY — emails will NOT be marked as read
            imap.openBox('INBOX', true, (err) => {
                if (err) { imap.end(); resolve({ error: err.message }); return; }

                // Search emails since 31 March 2026 (IMAP date is inclusive)
                imap.search([['SINCE', 'March 31, 2026']], async (err, uids) => {
                    if (err || !uids?.length) {
                        console.log('[Claims] No emails found since April 2026');
                        imap.end();
                        resolve({ noNew: true, ...summary });
                        return;
                    }

                    console.log(`[Claims] ${uids.length} emails found since March 31 2026`);

                    // ── Stream-and-process: handle each message inline, never buffering all at once ──
                    const pending = []; // tracks in-flight promises
                    const CONCURRENCY = 3; // max parallel emails being parsed/processed at once

                    const fetcher = imap.fetch(uids, { bodies: '', markSeen: false });

                    fetcher.on('message', msg => {
                        // Collect raw bytes for this single message only
                        let raw = '';
                        msg.on('body', stream => stream.on('data', c => { raw += c.toString('binary'); }));

                        msg.once('end', () => {
                            if (!raw) return;

                            // Throttle: if already at concurrency limit, wait for oldest to finish
                            const task = (async () => {
                                while (pending.filter(p => p.running).length >= CONCURRENCY) {
                                    await new Promise(r => setTimeout(r, 50));
                                }
                                const slot = { running: true };
                                pending.push(slot);
                                try {
                                    const parsed = await simpleParser(Buffer.from(raw, 'binary'));
                                    raw = ''; // release raw bytes immediately after parse

                                    const fromAddr = parsed.from?.value?.[0]?.address || '';
                                    const subject  = parsed.subject || '';
                                    const emailDate = parsed.date || new Date();

                                    // ── FILTER 1: Date ──────────────────────────────────────
                                    if (!isAfterCutoff(emailDate)) { summary.skippedDate++; return; }
                                    // ── FILTER 2: Sender domain ─────────────────────────────
                                    if (!isAllowedSender(fromAddr)) { summary.skippedSender++; return; }
                                    // ── FILTER 3: Subject keywords ───────────────────────────
                                    if (!isClaimSubject(subject)) { summary.skippedSubject++; return; }

                                    console.log(`[Claims] ✉ Qualifying: "${subject}" | ${fromAddr}`);
                                    const res = await processOneEmail(pool, parsed);
                                    for (const r of res) {
                                        if      (r.type === 'claim')         summary.processed++;
                                        else if (r.type === 'duplicate')     summary.duplicates++;
                                        else if (r.type === 'invalid_month') summary.invalid_month++;
                                    }
                                } catch (e) {
                                    console.error('[Claims] Email parse error:', e.message);
                                    summary.errors++;
                                } finally {
                                    slot.running = false;
                                }
                            })();

                            pending.push(task);
                        });
                    });

                    fetcher.once('end', async () => {
                        // Wait for all in-flight processing tasks to complete
                        await Promise.allSettled(pending.filter(p => p instanceof Promise));
                        console.log('[Claims] ═══ Poll complete ═══', JSON.stringify(summary));
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

// ── Schedule: once daily at 13:00 ─────────────────────────────────────────────
function scheduleDailyAt13(pool) {
    function msUntil13() {
        const now = new Date(), next = new Date(now);
        next.setHours(13, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next - now;
    }
    function scheduleNext() {
        const delay = msUntil13();
        console.log(`[Claims] Next scheduled poll in ${Math.round(delay / 60000)} min (13:00)`);
        setTimeout(async () => {
            await fetchAndProcess(pool).catch(e => console.error('[Claims] Scheduled error:', e.message));
            scheduleNext();
        }, delay);
    }
    scheduleNext();
}

// ── Entry points ───────────────────────────────────────────────────────────────
function startEmailClaimsService(pool) {
    const cfg = getImapConfig();
    if (!cfg.user) { console.log('[Claims] Disabled — CLAIMS_EMAIL_USER not set'); return; }
    console.log(`[Claims] Service started for ${cfg.user} | @${ALLOWED_SENDER_DOMAIN} | after ${CUTOFF_DATE.toDateString()}`);
    scheduleDailyAt13(pool);
}

async function triggerManualPoll(pool) {
    return fetchAndProcess(pool);
}

module.exports = { startEmailClaimsService, triggerManualPoll };
