/**
 * emailClaimsService.js — ASIL HCM Email Claims Listener (v5)
 *
 * v5 Changes:
 * - Body parsing: when no XLSX attachment, GPT parses email body text
 * - Fixed subject filter: OT/ot matches anywhere in subject, added IPD/TR3/ER3/allowance
 * - Employee name fallback: fuzzy ILIKE match if code-based lookup fails
 * - Synopsis: AI generates 1–2 sentence summary stored in claims_inbox.synopsis
 * - Status: NO_CONTENT (body has no claim data), BODY_PARSED (body had data)
 */

'use strict';

const Imap          = require('imap');
const { simpleParser } = require('mailparser');
const XLSX          = require('xlsx');

// ── Config ─────────────────────────────────────────────────────────────────────
const ALLOWED_SENDER_DOMAIN = (process.env.CLAIMS_SENDER_DOMAIN || 'wafi-energy.com').toLowerCase();
const CUTOFF_DATE = new Date('2026-04-01T00:00:00Z');

// Broader keyword list — matches anywhere in subject (no space-padding needed)
const CLAIM_KEYWORDS = [
    'claim', 'overtime', ' ot', 'ot ', 'ot-', 'tr3', 'er3',
    'expense', 'reimburs', 'medical', 'opd', 'ipd', 'allowance',
];

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

// ── Filters ────────────────────────────────────────────────────────────────────
function isClaimSubject(subject = '') {
    const s = subject.toLowerCase();
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
            const rows = XLSX.utils.sheet_to_json(sheet, {
                header: 1, defval: '', blankrows: false, raw: false,
            });
            for (const row of rows) {
                const rowStr = row.map(cell => String(cell || '').trim()).join('\t');
                if (rowStr.replace(/\t/g, '').trim()) lines.push(rowStr);
            }
            lines.push('');
        }
        return lines.join('\n');
    } catch (e) {
        console.error('[Claims] XLSX parse error:', e.message);
        return null;
    }
}

// ── Shared GPT extraction prompt ──────────────────────────────────────────────
function buildExtractionPrompt(content, filename, isBody = false) {
    const sourceDesc = isBody
        ? 'This is the email body text (plain text or HTML-stripped) of a claim submission email.'
        : `This is raw tab-separated content extracted from the Excel file: "${filename}"`;

    return `You are extracting structured data from an ASIL HCM claim submission.
${sourceDesc}
This may be an Expense Claim (ER3), Overtime Claim (TR3), OPD/IPD Claim, or Expense Reimbursement from Allied Services International (ASIL) for WAFI Energy employees.

Content:
${content.slice(0, 5000)}

Extract the following and return ONLY valid JSON (no markdown, no explanation):
{
  "form_type": "EXPENSE" or "OT" or "OPD" or "IPD" or "ALLOWANCE" or "UNKNOWN",
  "employee_code": "e.g. ASIL/SPL/320/21 — null if not found",
  "employee_name": "Full name — null if not found",
  "department": "Department — null if not found",
  "location": "Work location / site — null if not found",
  "line_manager_name": "Line manager full name — null if not found",
  "line_manager_email": "manager@wafi-energy.com — null if not found",
  "claim_month": "YYYY-MM-01 (first day of claim month) — null if not determinable",
  "total_expense_pkr": 0.00,
  "ot_hours_single": 0,
  "ot_hours_double": 0,
  "ot_hours_triple": 0,
  "synopsis": "1–2 sentence plain-English summary of what this claim is about",
  "has_claim_data": true or false
}

Rules:
- claim_month: find "FOR MONTH OF", "Month:", date ranges like "April to May 2026" → return YYYY-MM-01
- employee_code: look for ASIL/XXX/YYY format anywhere in the text
- OT form: ot_hours_double = 2X rate hours, ot_hours_triple = 3X rate hours
- Expense/OPD/IPD: sum all amounts for total_expense_pkr
- has_claim_data: true only if you found at least employee name/code AND some numeric claim value OR a recognizable claim type
- synopsis: brief factual description e.g. "OT claim for Shayan Butt — 33.75 hours at 2X rate for April 2026"
- Return null for any field you cannot determine. Do NOT guess.`;
}

// ── GPT extraction (shared for XLSX and body) ─────────────────────────────────
async function parseViaAI(content, filename, isBody = false) {
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY || OPENAI_KEY.startsWith('sk-dummy')) {
        console.log('[Claims] No valid OpenAI key — skipping AI parse');
        return null;
    }

    const prompt = buildExtractionPrompt(content, filename, isBody);

    try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 700,
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
        console.log(`[Claims] GPT response (${isBody ? 'body' : filename}):`, rawContent.slice(0, 400));

        const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        console.error(`[Claims] AI parse exception:`, e.message);
        return null;
    }
}

// ── Month validation ────────────────────────────────────────────────────────────
function isMonthValid(claimMonthStr) {
    if (!claimMonthStr) return false;
    const claim = new Date(claimMonthStr);
    if (isNaN(claim)) return false;
    const minMonth = new Date('2026-04-01');
    const maxMonth = new Date();
    maxMonth.setDate(1);
    maxMonth.setMonth(maxMonth.getMonth() + 1);
    return claim >= minMonth && claim < maxMonth;
}

// ── Message hash for dedup ─────────────────────────────────────────────────────
function buildHash(msgId, fromAddr, subject, date) {
    return `${msgId || ''}|${fromAddr || ''}|${subject || ''}|${date ? new Date(date).toISOString().slice(0, 10) : ''}`;
}

// ── Employee lookup: code first, then name fallback ────────────────────────────
async function findEmployee(pool, employeeCode, employeeName) {
    // 1. Exact code match (normalized: remove spaces, dashes, slashes)
    if (employeeCode) {
        const codeRow = await pool.query(
            `SELECT id, name FROM employees
             WHERE LOWER(REPLACE(REPLACE(REPLACE(id,' ',''),'-',''),'/','')) =
                   LOWER(REPLACE(REPLACE(REPLACE($1,' ',''),'-',''),'/',''))
             LIMIT 1`,
            [employeeCode]
        );
        if (codeRow.rows.length) {
            return { id: codeRow.rows[0].id, name: codeRow.rows[0].name, remark: null };
        }
    }

    // 2. Name-based fuzzy match
    if (employeeName && employeeName.trim().length > 3) {
        const nameParts = employeeName.trim().split(/\s+/);
        // Try full name first, then first+last
        const nameRow = await pool.query(
            `SELECT id, name FROM employees
             WHERE LOWER(name) ILIKE $1 OR LOWER(name) ILIKE $2
             LIMIT 1`,
            [`%${employeeName.toLowerCase()}%`, `%${nameParts.slice(-1)[0].toLowerCase()}%`]
        );
        if (nameRow.rows.length) {
            return {
                id: nameRow.rows[0].id,
                name: nameRow.rows[0].name,
                remark: `Matched by name "${employeeName}" → found "${nameRow.rows[0].name}". Verify employee code.`
            };
        }
    }

    return { id: null, name: null, remark: employeeCode ? `No match for code "${employeeCode}"` : 'No employee code or name found' };
}

// ── Core processing for one parsed email ──────────────────────────────────────
async function processOneEmail(pool, parsed) {
    const subject  = parsed.subject || '';
    const from     = parsed.from?.text || '';
    const fromAddr = parsed.from?.value?.[0]?.address || from;
    const msgId    = parsed.messageId || '';
    const date     = parsed.date || new Date();

    // Get clean body text — strip HTML tags
    let bodyText = parsed.text || '';
    if (!bodyText && parsed.html) {
        bodyText = parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const hash = buildHash(msgId, fromAddr, subject, date);

    console.log(`[Claims] → Processing: "${subject}" from ${fromAddr} dated ${date}`);

    // ── Duplicate check ────────────────────────────────────────────────────────
    const dup = await pool.query('SELECT id FROM claims_inbox WHERE message_hash=$1 LIMIT 1', [hash]);
    if (dup.rows.length) {
        console.log('[Claims]   Duplicate, skipping');
        return [{ type: 'duplicate', from, subject }];
    }

    // ── Find XLSX attachments ──────────────────────────────────────────────────
    const XLSX_TYPES = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/octet-stream',
    ];
    const xlsxAtts = (parsed.attachments || []).filter(a => {
        if (!a.content || a.content.length === 0) return false;
        const fn = (a.filename || '').toLowerCase();
        return XLSX_TYPES.includes(a.contentType) || fn.endsWith('.xlsx') || fn.endsWith('.xls');
    });

    console.log(`[Claims]   Attachments: ${(parsed.attachments || []).length} total, ${xlsxAtts.length} XLSX`);

    // ── PATH A: Process XLSX attachment(s) ─────────────────────────────────────
    if (xlsxAtts.length > 0) {
        const results = [];
        for (const att of xlsxAtts) {
            const filename = att.filename || 'attachment.xlsx';
            console.log(`[Claims]   Parsing XLSX: ${filename} (${att.content.length} bytes)`);

            const sheetText = xlsxToText(att.content);
            if (!sheetText) {
                results.push({ type: 'parse_failed', from, subject, file: filename });
                continue;
            }

            const aiData = await parseViaAI(sheetText, filename, false);
            if (!aiData) {
                await pool.query(`
                    INSERT INTO claims_inbox
                      (received_at,sender_email,subject,message_id,message_hash,raw_body,attachment_filename,status)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,'UNMATCHED')
                    ON CONFLICT (message_hash) DO NOTHING
                `, [date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000), filename]);
                results.push({ type: 'parse_failed', from, subject, file: filename });
                continue;
            }

            await saveClaimRow(pool, {
                date, fromAddr, subject, msgId, hash,
                bodyText, filename, aiData, isBodyParsed: false
            });

            results.push({ type: 'claim', from, subject, claimType: aiData.form_type, file: filename });
        }
        return results;
    }

    // ── PATH B: No attachment — parse email body ────────────────────────────────
    console.log('[Claims]   No XLSX — attempting body parse...');

    if (!bodyText || bodyText.trim().length < 50) {
        await pool.query(`
            INSERT INTO claims_inbox
              (received_at,sender_email,subject,message_id,message_hash,raw_body,status,synopsis)
            VALUES ($1,$2,$3,$4,$5,$6,'NO_CONTENT','Email body is empty or too short to parse.')
            ON CONFLICT (message_hash) DO NOTHING
        `, [date, fromAddr, subject, msgId, hash, bodyText.slice(0, 500)]);
        console.log('[Claims]   Body too short — NO_CONTENT');
        return [{ type: 'no_content', from, subject }];
    }

    const aiData = await parseViaAI(bodyText, subject, true);

    if (!aiData || !aiData.has_claim_data) {
        const synopsis = aiData?.synopsis || 'No recognizable claim data found in email body.';
        await pool.query(`
            INSERT INTO claims_inbox
              (received_at,sender_email,subject,message_id,message_hash,raw_body,status,synopsis,body_parsed)
            VALUES ($1,$2,$3,$4,$5,$6,'NO_CONTENT',$7,TRUE)
            ON CONFLICT (message_hash) DO NOTHING
        `, [date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000), synopsis]);
        console.log(`[Claims]   Body parsed but no claim data — NO_CONTENT: ${synopsis}`);
        return [{ type: 'no_content', from, subject }];
    }

    // Body has claim data — save as BODY_PARSED
    await saveClaimRow(pool, {
        date, fromAddr, subject, msgId, hash,
        bodyText, filename: null, aiData, isBodyParsed: true,
        overrideStatus: 'BODY_PARSED'
    });

    console.log(`[Claims]   Body parsed successfully — ${aiData.form_type}`);
    return [{ type: 'body_claim', from, subject, claimType: aiData.form_type }];
}

// ── Save a parsed claim row to DB ─────────────────────────────────────────────
async function saveClaimRow(pool, { date, fromAddr, subject, msgId, hash, bodyText, filename, aiData, isBodyParsed, overrideStatus }) {

    // Month validation
    if (aiData.claim_month && !isMonthValid(aiData.claim_month)) {
        console.warn(`[Claims]   Invalid/out-of-range month: ${aiData.claim_month}`);
        await pool.query(`
            INSERT INTO claims_inbox
              (received_at,sender_email,subject,message_id,message_hash,raw_body,
               parsed_data,claim_month,claim_type,attachment_filename,status,synopsis,body_parsed)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'INVALID_MONTH',$11,$12)
            ON CONFLICT (message_hash) DO NOTHING
        `, [date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000),
            JSON.stringify(aiData), aiData.claim_month, aiData.form_type, filename || null,
            aiData.synopsis || null, isBodyParsed || false]);
        return;
    }

    // Employee lookup
    const { id: empId, name: empName, remark: matchRemark } = await findEmployee(
        pool, aiData.employee_code, aiData.employee_name
    );

    let status = overrideStatus || (empId ? 'PENDING' : 'UNMATCHED');

    // Auto-update line manager on employee record
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
           parsed_data,employee_id,employee_name,claim_month,claim_type,
           ot_hours_1x,ot_hours_2x,ot_hours_3x,claim_amount,
           line_manager_name,line_manager_email,attachment_filename,
           status,synopsis,body_parsed,match_remark)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        ON CONFLICT (message_hash) DO NOTHING
    `, [
        date, fromAddr, subject, msgId, hash, bodyText.slice(0, 2000),
        JSON.stringify(aiData), empId, empName || aiData.employee_name,
        aiData.claim_month || null, aiData.form_type,
        otHours1x, otHours2x, otHours3x, claimAmount,
        aiData.line_manager_name || null, aiData.line_manager_email || null,
        filename || null,
        status,
        aiData.synopsis || null,
        isBodyParsed || false,
        matchRemark || null
    ]);

    console.log(`[Claims]   ✅ Saved: ${filename || 'body'} | emp=${empId || 'unmatched'} | ${aiData.form_type} | ${status}`);
}

// ── Main IMAP fetch ────────────────────────────────────────────────────────────
async function fetchAndProcess(pool) {
    const cfg = getImapConfig();
    if (!cfg.user || !cfg.password) {
        console.log('[Claims] CLAIMS_EMAIL_USER/PASS not configured — skipping');
        return { skipped: true };
    }

    console.log(`[Claims] ═══ Poll starting: ${cfg.user} | Cutoff: ${CUTOFF_DATE.toDateString()} | Domain: @${ALLOWED_SENDER_DOMAIN} ═══`);
    const summary = { processed: 0, bodyParsed: 0, duplicates: 0, skippedSender: 0, skippedSubject: 0, skippedDate: 0, noContent: 0, errors: 0 };

    return new Promise((resolve) => {
        const imap = new Imap(cfg);

        imap.once('error', err => {
            console.error('[Claims] IMAP error:', err.message);
            resolve({ error: err.message, ...summary });
        });

        imap.once('ready', () => {
            imap.openBox('INBOX', true, (err) => {
                if (err) { imap.end(); resolve({ error: err.message }); return; }

                imap.search([['SINCE', 'March 31, 2026']], async (err, uids) => {
                    if (err || !uids?.length) {
                        console.log('[Claims] No emails found since April 2026');
                        imap.end();
                        resolve({ noNew: true, ...summary });
                        return;
                    }

                    console.log(`[Claims] ${uids.length} emails found since March 31 2026`);

                    const pending = [];
                    const CONCURRENCY = 3;

                    const fetcher = imap.fetch(uids, { bodies: '', markSeen: false });

                    fetcher.on('message', msg => {
                        let raw = '';
                        msg.on('body', stream => stream.on('data', c => { raw += c.toString('binary'); }));

                        msg.once('end', () => {
                            if (!raw) return;

                            const task = (async () => {
                                while (pending.filter(p => p.running).length >= CONCURRENCY) {
                                    await new Promise(r => setTimeout(r, 50));
                                }
                                const slot = { running: true };
                                pending.push(slot);
                                try {
                                    const parsed = await simpleParser(Buffer.from(raw, 'binary'));
                                    raw = '';

                                    const fromAddr = parsed.from?.value?.[0]?.address || '';
                                    const subject  = parsed.subject || '';
                                    const emailDate = parsed.date || new Date();

                                    if (!isAfterCutoff(emailDate)) { summary.skippedDate++; return; }
                                    if (!isAllowedSender(fromAddr)) { summary.skippedSender++; return; }
                                    if (!isClaimSubject(subject))   { summary.skippedSubject++; return; }

                                    console.log(`[Claims] ✉ Qualifying: "${subject}" | ${fromAddr}`);
                                    const res = await processOneEmail(pool, parsed);
                                    for (const r of res) {
                                        if      (r.type === 'claim')      summary.processed++;
                                        else if (r.type === 'body_claim') summary.bodyParsed++;
                                        else if (r.type === 'duplicate')  summary.duplicates++;
                                        else if (r.type === 'no_content') summary.noContent++;
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

// ── Schedule: once daily at 13:00 ────────────────────────────────────────────
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

// ── Entry points ──────────────────────────────────────────────────────────────
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
