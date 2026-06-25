'use strict';

/**
 * wafiClaimsService.js — Wafi Claims Ingestion Engine (ASIL HCM) — Phase 1
 *
 * Status lifecycle:
 *   IRRELEVANT        → no Excel / empty / wrong file  (labelled Claims/Not-Relevant)
 *   WRONG_FORMAT      → Excel found, missing required tabs
 *   VALIDATION_FAILED → right tabs, but hard errors (bad codes, missing amounts)
 *   PENDING_REVIEW    → all valid, waiting for admin to verify
 *   VERIFIED          → admin verified, pushed to payroll, draft email created
 *   PROCESSED_SUCCESSFULLY → legacy / confirmed
 *   REVISED           → superseded by newer submission
 *   SKIPPED           → admin dismissed irrelevant email
 */

const { google }  = require('googleapis');
const XLSX        = require('xlsx');
const { Resend }  = require('resend');
const OpenAI      = require('openai');

// ── Config ────────────────────────────────────────────────────────────────────
const GMAIL_USER          = process.env.GMAIL_USER          || 'ops-support@asil.com.pk';
const CLAIMS_EMAIL        = process.env.CLAIMS_EMAIL         || 'claims@asil.com.pk';
const GMAIL_CLIENT_ID     = process.env.GMAIL_CLIENT_ID     || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || '';
const SENDER_DOMAIN       = (process.env.CLAIMS_SENDER_DOMAIN || 'wafi-energy.com').toLowerCase();
const EMAILS_ENABLED      = (process.env.EMAILS_ENABLED || 'false') === 'true';
const EMAIL_FROM          = process.env.SMTP_FROM || 'ASIL HR <hr@asil.com.pk>';
const POLL_INTERVAL_MS    = parseInt(process.env.WAFI_POLL_INTERVAL_MS) || 5 * 60 * 1000;

// Daily digest recipients
const DIGEST_RECIPIENTS = [
    'huzaifa.rafaqat@asil.com.pk',
    'laiba.mughal@asil.com.pk',
];

const resend    = new Resend(process.env.RESEND_API_KEY || '');
const openaiKey = process.env.OPENAI_API_KEY || '';
const openai    = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

// Sheet keyword matchers — accepts suffixed tab names like 'Overtime (TR3)'
const SHEET_KEYWORDS = { ot: 'overtime', expense: 'expense', medical: 'medical' };

// OT multiplier mapping
const OT_MULTIPLIER_MAP = { 'single': 1.0, 'double': 2.0, 'triple': 3.0 };

let _lastPollAt = null;

// ── Gmail OAuth2 Client ───────────────────────────────────────────────────────
function createGmailClient() {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return null;
    const auth = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, 'urn:ietf:wg:oauth:2.0:oob');
    auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
    return google.gmail({ version: 'v1', auth });
}

// ── Label Management ──────────────────────────────────────────────────────────
const LABEL_NAMES = [
    'Claims/Processed-Successfully',
    'Claims/Not-Relevant',
    'Claims/Verified-HCM',
    'Claims/Pending-Review',
    'Claims/Validation-Failed',
];
const _labelCache = {};

async function ensureLabels(gmail) {
    try {
        const { data } = await gmail.users.labels.list({ userId: 'me' });
        const existing = data.labels || [];
        for (const name of LABEL_NAMES) {
            const found = existing.find(l => l.name === name);
            if (found) {
                _labelCache[name] = found.id;
            } else {
                const { data: created } = await gmail.users.labels.create({
                    userId: 'me',
                    requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
                });
                _labelCache[name] = created.id;
                console.log(`[Wafi Claims] Created Gmail label: ${name}`);
            }
        }
    } catch (e) {
        console.warn('[Wafi Claims] Label setup warning:', e.message);
    }
}

async function applyLabel(gmail, messageId, labelName, removeUnread = true) {
    const labelId = _labelCache[labelName];
    if (!labelId) return;
    try {
        await gmail.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: {
                addLabelIds: [labelId],
                removeLabelIds: removeUnread ? ['UNREAD'] : [],
            },
        });
    } catch (e) {
        console.warn(`[Wafi Claims] Apply label warning (${labelName}):`, e.message);
    }
}

async function markAsRead(gmail, messageId) {
    try {
        await gmail.users.messages.modify({
            userId: 'me', id: messageId,
            requestBody: { removeLabelIds: ['UNREAD'] },
        });
    } catch (e) {
        console.warn('[Wafi Claims] markAsRead warning:', e.message);
    }
}

// ── Gmail Draft (thread-aware reply) ─────────────────────────────────────────
async function createGmailDraft(gmail, threadId, toEmail, subject, htmlBody) {
    try {
        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
        const raw = [
            `To: ${toEmail}`,
            `Subject: ${replySubject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
            '',
            htmlBody,
        ].join('\r\n');

        const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const { data } = await gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
                message: {
                    threadId,
                    raw: encoded,
                },
            },
        });
        console.log(`[Wafi Claims] Draft created: ${data.id} in thread ${threadId}`);
        return data.id;
    } catch (e) {
        console.warn('[Wafi Claims] Failed to create Gmail draft:', e.message);
        return null;
    }
}

// ── Normalization Helpers ─────────────────────────────────────────────────────
function normalizeCode(raw) {
    return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokenSimilarity(a, b) {
    const tokA = new Set(String(a || '').toLowerCase().split(/\s+/).filter(Boolean));
    const tokB = new Set(String(b || '').toLowerCase().split(/\s+/).filter(Boolean));
    const intersection = [...tokA].filter(t => tokB.has(t)).length;
    return intersection / Math.max(tokA.size, tokB.size, 1);
}

function isTotalRow(codeVal, nameVal) {
    const combined = `${codeVal || ''} ${nameVal || ''}`.toLowerCase().trim();
    return /total/.test(combined);
}

// Detect whether a set of raw date strings uses DD-MM-YYYY or MM-DD-YYYY.
// Strategy (in priority order):
//   0. Filename month hint: if filename says "May_2026", expected month=5.
//      If a-segment consistently = 5 → MM-DD-YYYY. If b-segment = 5 → DD-MM-YYYY.
//   1. Hard evidence: if any b > 12 → MM-DD-YYYY; if any a > 12 → DD-MM-YYYY.
//   2. Variance heuristic: the segment that stays CONSTANT is the month.
//   3. Default: DD-MM-YYYY (Pakistan standard), confident=false → AI fallback.
function detectDateFormat(rawValues, filename) {
    // Priority 0: Extract expected month from filename (e.g. "Wafi_Claims_Shikarpur_May_2026.xlsx" → 5)
    let filenameMonth = null;
    if (filename) {
        const monthMap = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
        const fn = String(filename).toLowerCase();
        for (const [abbr, num] of Object.entries(monthMap)) {
            if (fn.includes(abbr)) { filenameMonth = num; break; }
        }
    }

    let mmddEvidence = 0, ddmmEvidence = 0;
    const aVals = [], bVals = [];

    for (const raw of rawValues) {
        if (raw == null || raw === '') continue;

        // Handle Excel serial numbers — extract month directly for filename comparison
        if (typeof raw === 'number' && raw > 1000) {
            const d = new Date(new Date(1899, 11, 30).getTime() + raw * 86400000);
            if (!isNaN(d)) {
                // We can't tell a/b from serials, but we can note the parsed month
                // These are handled separately in Priority 0 below via serialMonth
            }
            continue; // serials fall through to Priority 0 check
        }

        const s = String(raw).trim();
        const match = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
        if (!match) continue;
        const a = parseInt(match[1]), b = parseInt(match[2]);
        aVals.push(a); bVals.push(b);
        if (b > 12) mmddEvidence++;
        if (a > 12) ddmmEvidence++;
    }

    // Priority 0: Filename month match against string date segments
    if (filenameMonth && aVals.length > 0) {
        const aMatchesMonth = aVals.every(v => v === filenameMonth) || (new Set(aVals).size === 1 && aVals[0] === filenameMonth);
        const bMatchesMonth = bVals.every(v => v === filenameMonth) || (new Set(bVals).size === 1 && bVals[0] === filenameMonth);
        if (aMatchesMonth && !bMatchesMonth) {
            console.log(`[Wafi Claims] Date fmt: filename says month=${filenameMonth}, a-segment matches → MM-DD-YYYY (confident)`);
            return { fmt: 'MM-DD-YYYY', confident: true };
        }
        if (bMatchesMonth && !aMatchesMonth) {
            console.log(`[Wafi Claims] Date fmt: filename says month=${filenameMonth}, b-segment matches → DD-MM-YYYY (confident)`);
            return { fmt: 'DD-MM-YYYY', confident: true };
        }
    }

    // Priority 0b: All dates are Excel serials — check if the parsed month matches filename
    // If ALL raw values are numeric serials, we have no a/b to compare; use filename to set fmt
    const allNumeric = rawValues.filter(r => r != null && r !== '').every(r => typeof r === 'number' && r > 1000);
    if (allNumeric && filenameMonth) {
        // Parse each serial → get their months
        const serialMonths = rawValues
            .filter(r => typeof r === 'number' && r > 1000)
            .map(r => new Date(new Date(1899, 11, 30).getTime() + r * 86400000).getMonth() + 1);
        const uniqueSerialMonths = [...new Set(serialMonths)];
        if (uniqueSerialMonths.length === 1 && uniqueSerialMonths[0] !== filenameMonth) {
            // Parsed month ≠ filename month → Excel stored dates wrong → flag for AI
            console.log(`[Wafi Claims] Date fmt: Excel serials give month=${uniqueSerialMonths[0]} but filename says month=${filenameMonth} — dates may have been stored with wrong locale`);
            // Return as not-confident so AI can attempt to resolve via other signals
            return { fmt: 'DD-MM-YYYY', confident: false, serialMonthMismatch: true, filenameMonth };
        }
        if (uniqueSerialMonths.length === 1 && uniqueSerialMonths[0] === filenameMonth) {
            // Serial month matches filename — dates are stored correctly
            return { fmt: 'DD-MM-YYYY', confident: true };
        }
    }

    // Priority 1: hard numeric evidence from string dates
    if (mmddEvidence > 0 && ddmmEvidence === 0) return { fmt: 'MM-DD-YYYY', confident: true };
    if (ddmmEvidence > 0 && mmddEvidence === 0) return { fmt: 'DD-MM-YYYY', confident: true };

    // Priority 2: variance heuristic (need >=3 string dates for reliability)
    if (aVals.length >= 3) {
        const aUnique = new Set(aVals).size;
        const bUnique = new Set(bVals).size;
        const aRange  = Math.max(...aVals) - Math.min(...aVals);
        const bRange  = Math.max(...bVals) - Math.min(...bVals);

        if (aUnique <= 2 && bRange > aRange && bRange >= 5) {
            console.log(`[Wafi Claims] Date fmt heuristic → MM-DD-YYYY (aUnique=${aUnique}, bRange=${bRange})`);
            return { fmt: 'MM-DD-YYYY', confident: true };
        }
        if (bUnique <= 2 && aRange > bRange && aRange >= 5) {
            console.log(`[Wafi Claims] Date fmt heuristic → DD-MM-YYYY (bUnique=${bUnique}, aRange=${aRange})`);
            return { fmt: 'DD-MM-YYYY', confident: true };
        }
    }

    // Default — not confident, AI fallback will be used
    return { fmt: 'DD-MM-YYYY', confident: false };
}

// ── AI: smart date format + claim month validation via GPT-4o-mini ─────────────
// Fallback when rule-based detection is still ambiguous (very few rows, all parts ≤12, all same date).
// Also uses the filename as a strong signal (e.g. 'May_2026' in filename → month=May).
// Cost: ~$0.001 per call — negligible.
async function aiAnalyzeClaimsDates(sampleRows, currentFormat, currentMonth, sheetName, filename) {
    if (!openai) return null;
    try {
        const sample = sampleRows
            .filter(r => r && (r[0] || r[1]))
            .slice(0, 15)
            .map((r, i) => `Row ${i + 2}: date="${r[0]}", empCode="${r[1]}", name="${r[2]}"`)
            .join('\n');

        // Extract month hint from filename (e.g. 'Wafi_Claims_Shikarpur_May_2026.xlsx' → May 2026)
        const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        let filenameMonthHint = '';
        if (filename) {
            const fn = filename.toLowerCase();
            for (let idx = 0; idx < monthNames.length; idx++) {
                if (fn.includes(monthNames[idx])) {
                    const yearMatch = fn.match(/(20\d{2})/);
                    const yr = yearMatch ? yearMatch[1] : new Date().getFullYear();
                    filenameMonthHint = `\nIMPORTANT: The filename is "${filename}" which strongly suggests this is a ${monthNames[idx].toUpperCase()} ${yr} submission.`;
                    break;
                }
            }
        }

        const prompt = `You are analyzing an Excel "${sheetName}" sheet submitted by a contractor in Pakistan (PKT timezone).
All rows belong to the SAME calendar month — this is a monthly claims submission.${filenameMonthHint}

Sample rows:
${sample}

Current system interpretation: format=${currentFormat}, detected claim month=${currentMonth || 'unknown'}

Determine the correct date format and true claim month.
Key rule: whichever date segment repeats consistently across ALL rows is the MONTH; the varying segment is the DAY.
If all dates are identical (e.g. 05/01/2026 for every row), use the filename hint to decide.

Respond ONLY with valid JSON, no extra text:
{"format":"MM-DD-YYYY","claimMonth":"2026-05","confidence":"high","reason":"First segment 05 is constant — it is the month (May)"}`;

        const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150,
            temperature: 0,
            response_format: { type: 'json_object' },
        });

        const result = JSON.parse(resp.choices[0].message.content);
        console.log(`[Wafi Claims] AI date analysis [${sheetName}]: fmt=${result.format} month=${result.claimMonth} confidence=${result.confidence} — ${result.reason}`);
        return result;
    } catch (e) {
        console.warn('[Wafi Claims] AI date analysis failed (non-fatal):', e.message);
        return null;
    }
}


// Parse date string with optional format override ('DD-MM-YYYY' or 'MM-DD-YYYY')
// Also handles natural language dates like "12th May 2026", "14 May 2026", "May 12 2026"
function parseDate(raw, fmt) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') {
        const d = new Date(new Date(1899, 11, 30).getTime() + raw * 86400000);
        return isNaN(d) ? null : d;
    }
    const s = String(raw).trim();

    // Try DD-MM-YYYY / MM-DD-YYYY numeric format
    const m1 = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
    if (m1) {
        let day, month;
        const a = parseInt(m1[1]), b = parseInt(m1[2]), c = parseInt(m1[3]);
        const fullYear = c < 100 ? 2000 + c : c;
        if (fmt === 'MM-DD-YYYY') { month = a - 1; day = b; }
        else { day = a; month = b - 1; }
        const d = new Date(fullYear, month, day);
        return isNaN(d.getTime()) || month < 0 || month > 11 || day < 1 || day > 31 ? null : d;
    }

    // Handle natural language: "12th May 2026", "14 May 2026", "May 12, 2026"
    const MONTHS_NL = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    // Pattern: [day][st|nd|rd|th] [MonthName] [year]  OR  [MonthName] [day][,] [year]
    const m2 = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\s+(\d{4})$/i);
    if (m2) {
        const day = parseInt(m2[1]);
        const mon = MONTHS_NL[m2[2].toLowerCase().slice(0,3)];
        const year = parseInt(m2[3]);
        if (mon !== undefined) {
            const d = new Date(year, mon, day);
            return isNaN(d.getTime()) ? null : d;
        }
    }
    // Pattern: [MonthName] [day][,] [year]
    const m3 = s.match(/^([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
    if (m3) {
        const mon = MONTHS_NL[m3[1].toLowerCase().slice(0,3)];
        const day = parseInt(m3[2]);
        const year = parseInt(m3[3]);
        if (mon !== undefined) {
            const d = new Date(year, mon, day);
            return isNaN(d.getTime()) ? null : d;
        }
    }

    // Fallback to JS native (handles ISO, RFC etc.)
    const d = new Date(s);
    return isNaN(d) ? null : d;
}

// Parse numeric value
function parseNum(raw) {
    if (raw == null || raw === '') return null;
    const n = parseFloat(String(raw).replace(/,/g, ''));
    return isNaN(n) ? null : n;
}

// Parse hours — handles decimal, HH:MM, Excel time serial
function parseHours(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw).trim();
    const timeMatch = s.match(/^(\d+):(\d{2})$/);
    if (timeMatch) {
        const h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        return parseFloat((h + m / 60).toFixed(4));
    }
    const n = parseFloat(s.replace(/,/g, ''));
    if (isNaN(n)) return null;
    if (n > 0 && n < 1) return parseFloat((n * 24).toFixed(4)); // Excel time serial
    return n;
}

// Extract plain text from Gmail message parts (for email_summary)
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
    return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

// Derive most common claim month from a set of items
function deriveClaimMonth(allItems) {
    const monthCounts = {};
    for (const item of allItems) {
        if (item.claim_date) {
            const d = item.claim_date instanceof Date ? item.claim_date : new Date(item.claim_date);
            if (!isNaN(d)) {
                const key = `${d.getFullYear()}-${d.getMonth()}`;
                monthCounts[key] = (monthCounts[key] || 0) + 1;
            }
        }
    }
    const top = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    const [y, m] = top[0].split('-').map(Number);
    return new Date(y, m, 1);
}

// ── Employee DB Lookup ────────────────────────────────────────────────────────
async function lookupEmployee(pool, codeRaw) {
    const normalized = normalizeCode(codeRaw);
    if (!normalized) return null;
    try {
        const { rows } = await pool.query(
            `SELECT id, name, salary, location, dept
             FROM employees
             WHERE LOWER(REGEXP_REPLACE(id, '[^a-zA-Z0-9]', '', 'g')) = $1
             LIMIT 1`,
            [normalized]
        );
        return rows[0] || null;
    } catch (e) {
        console.error('[Wafi Claims] Employee lookup error:', e.message);
        return null;
    }
}

// ── Focal Point Lookup ────────────────────────────────────────────────────────
async function checkFocalPoint(pool, email) {
    try {
        const { rows } = await pool.query(
            `SELECT id, name, location FROM wafi_focal_points WHERE LOWER(email) = LOWER($1) AND active = TRUE LIMIT 1`,
            [email]
        );
        return rows[0] || null;
    } catch (e) {
        return null;
    }
}

// ── Excel Parsing ─────────────────────────────────────────────────────────────
function parseWafiExcel(buffer, filename) {
    let wb;
    try {
        wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
    } catch (e) {
        return null;
    }
    const sheetNames = wb.SheetNames;
    const otSheet  = sheetNames.find(n => n.toLowerCase().includes(SHEET_KEYWORDS.ot));
    const expSheet = sheetNames.find(n => n.toLowerCase().includes(SHEET_KEYWORDS.expense));
    const medSheet = sheetNames.find(n => n.toLowerCase().includes(SHEET_KEYWORDS.medical));

    if (!otSheet || !expSheet || !medSheet) {
        const missing = [];
        if (!otSheet)  missing.push('"Overtime"');
        if (!expSheet) missing.push('"Expense"');
        if (!medSheet) missing.push('"Medical"');
        return { mismatch: true, found: sheetNames, missing };
    }
    return { wb, otSheet, expSheet, medSheet };
}

function getSheetRows(wb, sheetName) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
}

// ── Sheet Processors ──────────────────────────────────────────────────────────
// Returns { items, errors, warnings }
// warnings = name similarity 0.5–0.79 (shown in UI but don't fail session)
// errors   = hard failures (bad code, missing hours, etc.)

async function processOvertimeSheet(pool, rows, errors, warnings, filename) {
    const items = [];
    const seenKeys = new Set();

    // Step 1: rule-based date format detection
    const { fmt: fmtGuess, confident } = detectDateFormat(rows.slice(1).map(r => r[0]), filename);
    let dateFmt = fmtGuess;

    // Step 2: if not confident, call AI with filename context (key signal: 'May_2026' in name)
    if (!confident) {
        console.log('[Wafi Claims] OT: date format ambiguous — calling AI fallback');
        const aiResult = await aiAnalyzeClaimsDates(rows.slice(1), dateFmt, null, 'Overtime Claims', filename);
        if (aiResult && (aiResult.confidence === 'high' || aiResult.confidence === 'medium')) {
            dateFmt = aiResult.format || dateFmt;
            warnings.push({ type: 'DATE_FORMAT_AI', sheet: 'Overtime Claims', note: `AI date detection: ${aiResult.reason} → using ${dateFmt}` });
        }
    } else if (dateFmt === 'MM-DD-YYYY') {
        warnings.push({ type: 'DATE_FORMAT', sheet: 'Overtime Claims', note: 'Date format auto-detected as MM-DD-YYYY. Dates have been interpreted accordingly.' });
    }
    console.log(`[Wafi Claims] OT sheet: using date format ${dateFmt} (confident=${confident})`);

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawCode = String(row[1] || '').trim();
        const rawName = String(row[2] || '').trim();

        if (isTotalRow(rawCode, rawName)) break;
        if (!rawCode && !rawName) continue;

        const rowNum = i + 1;
        const dateRaw  = row[0];
        const dept     = String(row[3] || '').trim();
        const location = String(row[4] || '').trim();
        const lineMgr  = String(row[5] || '').trim();
        const nature   = String(row[6] || '').trim();
        const hoursRaw = row[9];
        const multRaw  = String(row[10] || '').trim();

        if (!rawCode) {
            errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'B', error: 'Employee code is required', value: '' });
            continue;
        }

        // Smart duplicate detection: OT — same employee same date is always an error
        const claimDate = parseDate(dateRaw, dateFmt);
        const dupKey = `${normalizeCode(rawCode)}|${claimDate ? claimDate.toISOString().slice(0, 10) : rowNum}`;
        if (seenKeys.has(dupKey)) {
            errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'B', error: 'Duplicate row: same employee and date already appears earlier in this sheet', value: rawCode });
        } else {
            seenKeys.add(dupKey);
        }

        const hours = parseHours(hoursRaw);
        if (hours == null || hours <= 0) {
            errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'J', error: 'Hours Worked must be a positive number', value: hoursRaw });
        }

        let multiplierFactor = null;
        if (hours != null && hours > 0) {
            if (!multRaw) {
                errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'K', error: 'Overtime Multiplier is required', value: '' });
            } else {
                const multKey = multRaw.toLowerCase().trim();
                multiplierFactor = OT_MULTIPLIER_MAP[multKey];
                if (multiplierFactor == null) {
                    errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'K', error: 'Multiplier must be Single, Double, or Triple', value: multRaw });
                }
            }
        }

        const emp = await lookupEmployee(pool, rawCode);
        if (!emp) {
            errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'B', error: 'Employee code not found. Please ensure all ASIL codes are correct and resubmit.', value: rawCode });
            items.push({ _error: true, employee_code_raw: rawCode, tab_name: 'Overtime Claims', row_number: rowNum });
            continue;
        }

        const sim = tokenSimilarity(rawName, emp.name);
        // < 0.5 = hard error (very different name); 0.5–0.79 = warning; ≥ 0.8 = fine
        if (sim < 0.5 && rawName) {
            errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'C', error: `Name mismatch — submitted: "${rawName}", DB: "${emp.name}"`, value: rawCode });
        } else if (sim < 0.8 && rawName) {
            warnings.push({ sheet: 'Overtime Claims', row: rowNum, column: 'C', warning: `Partial name match — submitted: "${rawName}", DB: "${emp.name}" (${(sim*100).toFixed(0)}%)`, value: rawCode });
        }

        items.push({
            tab_name: 'Overtime Claims',
            row_number: rowNum,
            employee_id: emp.id,
            employee_code_raw: rawCode,
            employee_name_raw: rawName,
            employee_name_db: emp.name,
            name_similarity: sim,
            claim_date: claimDate,
            ot_hours: hours,
            ot_multiplier: multRaw || null,
            ot_multiplier_factor: multiplierFactor,
            description: nature,
            location: location || emp.location || null,
            department: dept || emp.dept || null,
            line_manager: lineMgr || null,
            raw_amount: null,
            salary: parseFloat(emp.salary) || 0,
        });
    }
    return items;
}

async function processExpenseSheet(pool, rows, errors, warnings, filename) {
    const items = [];
    const seenKeys = new Set();

    // Step 1: rule-based date format detection
    const { fmt: fmtGuess, confident } = detectDateFormat(rows.slice(1).map(r => r[0]), filename);
    let dateFmt = fmtGuess;

    // Step 2: AI fallback when ambiguous
    if (!confident) {
        const aiResult = await aiAnalyzeClaimsDates(rows.slice(1), dateFmt, null, 'Expense Claims', filename);
        if (aiResult && (aiResult.confidence === 'high' || aiResult.confidence === 'medium')) {
            dateFmt = aiResult.format || dateFmt;
            warnings.push({ type: 'DATE_FORMAT_AI', sheet: 'Expense Claims', note: `AI date detection: ${aiResult.reason} → using ${dateFmt}` });
        }
    } else if (dateFmt === 'MM-DD-YYYY') {
        warnings.push({ type: 'DATE_FORMAT', sheet: 'Expense Claims', note: 'Date format auto-detected as MM-DD-YYYY. Dates have been interpreted accordingly.' });
    }
    console.log(`[Wafi Claims] Expense sheet: using date format ${dateFmt} (confident=${confident})`);

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawCode = String(row[1] || '').trim();
        const rawName = String(row[2] || '').trim();

        if (isTotalRow(rawCode, rawName)) break;
        if (!rawCode && !rawName) continue;

        const rowNum      = i + 1;
        const dateRaw     = row[0];
        const dept        = String(row[3] || '').trim();
        const location    = String(row[4] || '').trim();
        const lineMgr     = String(row[5] || '').trim();
        const expenseType = String(row[6] || '').trim();
        const description = String(row[7] || '').trim();
        const amountRaw   = row[8];

        if (!rawCode) {
            errors.push({ sheet: 'Expense Claims', row: rowNum, column: 'B', error: 'Employee code is required', value: '' });
            continue;
        }

        const claimDate = parseDate(dateRaw, dateFmt);
        const dupKey = `${normalizeCode(rawCode)}|${expenseType}|${claimDate ? claimDate.toISOString().slice(0,10) : rowNum}`;
        if (seenKeys.has(dupKey)) {
            errors.push({ sheet: 'Expense Claims', row: rowNum, column: 'B', error: 'Duplicate row: same employee, expense type, and date appears earlier', value: rawCode });
        } else {
            seenKeys.add(dupKey);
        }

        const amount = parseNum(amountRaw);
        if (amount == null) {
            errors.push({ sheet: 'Expense Claims', row: rowNum, column: 'I', error: 'Total Expense Amount must be a valid number', value: amountRaw });
        }

        const emp = await lookupEmployee(pool, rawCode);
        if (!emp) {
            errors.push({ sheet: 'Expense Claims', row: rowNum, column: 'B', error: 'Employee code not found. Please ensure all ASIL codes are correct and resubmit.', value: rawCode });
            items.push({ _error: true, employee_code_raw: rawCode, tab_name: 'Expense Claims', row_number: rowNum });
            continue;
        }

        const sim = tokenSimilarity(rawName, emp.name);
        if (sim < 0.5 && rawName) {
            errors.push({ sheet: 'Expense Claims', row: rowNum, column: 'C', error: `Name mismatch — submitted: "${rawName}", DB: "${emp.name}"`, value: rawCode });
        } else if (sim < 0.8 && rawName) {
            warnings.push({ sheet: 'Expense Claims', row: rowNum, column: 'C', warning: `Partial name match — submitted: "${rawName}", DB: "${emp.name}" (${(sim*100).toFixed(0)}%)`, value: rawCode });
        }

        items.push({
            tab_name: 'Expense Claims',
            row_number: rowNum,
            employee_id: emp.id,
            employee_code_raw: rawCode,
            employee_name_raw: rawName,
            employee_name_db: emp.name,
            name_similarity: sim,
            claim_date: claimDate,
            expense_type: expenseType || null,
            description: description || null,
            raw_amount: amount,
            location: location || emp.location || null,
            department: dept || emp.dept || null,
            line_manager: lineMgr || null,
            salary: parseFloat(emp.salary) || 0,
        });
    }
    return items;
}

async function processMedicalSheet(pool, rows, errors, warnings, filename) {
    const items = [];
    const seenKeys = new Set();

    // Step 1: rule-based date format detection
    const { fmt: fmtGuess, confident } = detectDateFormat(rows.slice(1).map(r => r[0]), filename);
    let dateFmt = fmtGuess;

    // Step 2: AI fallback when ambiguous
    if (!confident) {
        const aiResult = await aiAnalyzeClaimsDates(rows.slice(1), dateFmt, null, 'Medical & IPD Claims', filename);
        if (aiResult && (aiResult.confidence === 'high' || aiResult.confidence === 'medium')) {
            dateFmt = aiResult.format || dateFmt;
            warnings.push({ type: 'DATE_FORMAT_AI', sheet: 'Medical & IPD Claims', note: `AI date detection: ${aiResult.reason} → using ${dateFmt}` });
        }
    } else if (dateFmt === 'MM-DD-YYYY') {
        warnings.push({ type: 'DATE_FORMAT', sheet: 'Medical & IPD Claims', note: 'Date format auto-detected as MM-DD-YYYY. Dates have been interpreted accordingly.' });
    }
    console.log(`[Wafi Claims] Medical sheet: using date format ${dateFmt} (confident=${confident})`);

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawCode = String(row[1] || '').trim();
        const rawName = String(row[2] || '').trim();

        if (isTotalRow(rawCode, rawName)) break;
        if (!rawCode && !rawName) continue;

        const rowNum      = i + 1;
        const dateRaw     = row[0];
        const dept        = String(row[3] || '').trim();
        const location    = String(row[4] || '').trim();
        const lineMgr     = String(row[5] || '').trim();
        const claimType   = String(row[6] || '').trim();
        const patientName = String(row[7] || '').trim();
        const description = String(row[8] || '').trim();
        const amountRaw   = row[9];

        if (!rawCode) {
            errors.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'B', error: 'Employee code is required', value: '' });
            continue;
        }

        const claimDate = parseDate(dateRaw, dateFmt);
        const amount = parseNum(amountRaw);
        // Smart duplicate: include amount in key — same emp+type+date but DIFFERENT amount = two separate bills (warning, not error)
        const dupKeyStrict  = `${normalizeCode(rawCode)}|${claimType}|${claimDate ? claimDate.toISOString().slice(0,10) : rowNum}|${Math.round(amount || 0)}`;
        const dupKeyLoose   = `${normalizeCode(rawCode)}|${claimType}|${claimDate ? claimDate.toISOString().slice(0,10) : rowNum}`;
        if (seenKeys.has(dupKeyStrict)) {
            // Exact duplicate (same emp, type, date, amount) — hard error
            errors.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'B', error: 'Exact duplicate row: same employee, claim type, date, and amount already appears earlier', value: rawCode });
        } else if (seenKeys.has(dupKeyLoose)) {
            // Same emp+type+date but different amount — soft warning (two separate bills on same day)
            warnings.push({ sheet: 'Medical & IPD Claims', row: rowNum, warning: 'Same employee has another claim of same type on same date but different amount — verify these are separate bills', value: rawCode });
            seenKeys.add(dupKeyStrict);
        } else {
            seenKeys.add(dupKeyLoose);
            seenKeys.add(dupKeyStrict);
        }
        if (amount == null) {
            errors.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'J', error: 'Total Claim Amount must be a valid number', value: amountRaw });
        }

        const emp = await lookupEmployee(pool, rawCode);
        if (!emp) {
            errors.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'B', error: 'Employee code not found. Please ensure all ASIL codes are correct and resubmit.', value: rawCode });
            items.push({ _error: true, employee_code_raw: rawCode, tab_name: 'Medical & IPD Claims', row_number: rowNum });
            continue;
        }

        const sim = tokenSimilarity(rawName, emp.name);
        if (sim < 0.5 && rawName) {
            errors.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'C', error: `Name mismatch — submitted: "${rawName}", DB: "${emp.name}"`, value: rawCode });
        } else if (sim < 0.8 && rawName) {
            warnings.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'C', warning: `Partial name match — submitted: "${rawName}", DB: "${emp.name}" (${(sim*100).toFixed(0)}%)`, value: rawCode });
        }

        items.push({
            tab_name: 'Medical & IPD Claims',
            row_number: rowNum,
            employee_id: emp.id,
            employee_code_raw: rawCode,
            employee_name_raw: rawName,
            employee_name_db: emp.name,
            name_similarity: sim,
            claim_date: claimDate,
            claim_type: claimType || null,
            patient_name: patientName || null,
            description: description || null,
            raw_amount: amount,
            location: location || emp.location || null,
            department: dept || emp.dept || null,
            line_manager: lineMgr || null,
            salary: parseFloat(emp.salary) || 0,
        });
    }
    return items;
}

// ── Revision Detection ────────────────────────────────────────────────────────
async function detectAndMarkRevisions(pool, employeeIds, claimDate) {
    if (!employeeIds.length || !claimDate) return { revised: false, oldSessionId: null };
    try {
        const { rows } = await pool.query(`
            SELECT wci.session_id
            FROM wafi_claims_items wci
            JOIN wafi_claims_sessions wcs ON wcs.id = wci.session_id
            WHERE wci.employee_id = ANY($1::text[])
              AND wci.active = TRUE
              AND DATE_TRUNC('month', wci.claim_date) = DATE_TRUNC('month', $2::date)
              AND wcs.processing_status IN ('PROCESSED_SUCCESSFULLY','VERIFIED')
            LIMIT 1
        `, [employeeIds, claimDate.toISOString().slice(0, 10)]);

        if (!rows.length) return { revised: false, oldSessionId: null };
        const oldSessionId = rows[0].session_id;
        await pool.query(`UPDATE wafi_claims_items SET active = FALSE WHERE session_id = $1 AND employee_id = ANY($2::text[])`, [oldSessionId, employeeIds]);
        await pool.query(`UPDATE wafi_claims_sessions SET processing_status = 'REVISED' WHERE id = $1`, [oldSessionId]);
        console.log(`[Wafi Claims] Marked session ${oldSessionId} as REVISED`);
        return { revised: true, oldSessionId };
    } catch (e) {
        console.warn('[Wafi Claims] Revision detection error:', e.message);
        return { revised: false, oldSessionId: null };
    }
}

// ── Save Session + Items ──────────────────────────────────────────────────────
async function saveSession(pool, sessionData) {
    const {
        receivedAt, senderEmail, subject, gmailMessageId, gmailThreadId,
        attachmentFilename, processingStatus, validationErrors, nameWarnings,
        otRows, expenseRows, medicalRows, isRevision, supersedesSessionId,
        emailSummary, isFirstTimeSender,
    } = sessionData;

    const allItems = [...(otRows || []), ...(expenseRows || []), ...(medicalRows || [])];
    const claimMonth = deriveClaimMonth(allItems);

    const { rows } = await pool.query(`
        INSERT INTO wafi_claims_sessions
            (received_at, sender_email, subject, gmail_message_id, gmail_thread_id,
             attachment_filename, claim_month, processing_status, label_applied,
             validation_errors, name_warnings, total_ot_rows, total_expense_rows, total_medical_rows,
             is_revision, supersedes_session_id, email_summary, is_first_time_sender)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18)
        RETURNING id
    `, [
        receivedAt,
        senderEmail,
        subject || null,
        gmailMessageId || null,
        gmailThreadId  || null,
        attachmentFilename || null,
        claimMonth || null,
        processingStatus,
        processingStatus === 'PROCESSED_SUCCESSFULLY' ? 'Claims/Processed-Successfully'
            : processingStatus === 'PENDING_REVIEW'   ? 'Claims/Pending-Review'
            : null,
        JSON.stringify(validationErrors || []),
        JSON.stringify(nameWarnings || []),
        (otRows || []).filter(r => !r._error).length,
        (expenseRows || []).filter(r => !r._error).length,
        (medicalRows || []).filter(r => !r._error).length,
        isRevision || false,
        supersedesSessionId || null,
        emailSummary || null,
        isFirstTimeSender || false,
    ]);
    const sessionId = rows[0].id;

    for (const item of allItems) {
        if (item._error) continue;
        const d = item.claim_date instanceof Date ? item.claim_date : (item.claim_date ? new Date(item.claim_date) : null);
        const claimDateStr = d && !isNaN(d) ? d.toISOString().slice(0, 10) : null;

        let otPayout = null;
        if (item.ot_hours != null && item.ot_multiplier_factor != null && item.salary) {
            const hourlyRate = item.salary / 26 / 8;
            otPayout = parseFloat((item.ot_hours * item.ot_multiplier_factor * hourlyRate).toFixed(2));
        }

        let claimTypeField = null;
        if (item.tab_name === 'Overtime Claims') claimTypeField = 'OT';
        else if (item.tab_name === 'Expense Claims') claimTypeField = 'EXPENSE';
        else if (item.tab_name === 'Medical & IPD Claims') claimTypeField = 'MEDICAL';

        await pool.query(`
            INSERT INTO wafi_claims_items
                (session_id, tab_name, row_number, employee_id, employee_code_raw,
                 employee_name_raw, employee_name_db, name_similarity,
                 claim_date, claim_type, ot_hours, ot_multiplier, ot_multiplier_factor,
                 ot_payout, expense_type, description, raw_amount,
                 location, department, line_manager, patient_name, active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,TRUE)
        `, [
            sessionId, item.tab_name, item.row_number,
            item.employee_id || null, item.employee_code_raw || null,
            item.employee_name_raw || null, item.employee_name_db || null,
            item.name_similarity != null ? item.name_similarity.toFixed(3) : null,
            claimDateStr, claimTypeField,
            item.ot_hours || null, item.ot_multiplier || null, item.ot_multiplier_factor || null,
            otPayout,
            item.expense_type || null, item.description || null, item.raw_amount || null,
            item.location || null, item.department || null, item.line_manager || null,
            item.patient_name || null,
        ]);
    }
    return sessionId;
}

// ── Email Templates ───────────────────────────────────────────────────────────
async function sendQCRejectionEmail(toEmail, errors, filename) {
    if (!EMAILS_ENABLED) {
        console.log(`[Wafi Claims] [TEST MODE] Would send QC rejection to ${toEmail} — ${errors.length} errors`);
        return;
    }
    const tableRows = errors.map(e => `
        <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:8px 10px;font-size:0.82rem;">${e.sheet || ''}</td>
            <td style="padding:8px 10px;text-align:center;font-size:0.82rem;">${e.row || ''}</td>
            <td style="padding:8px 10px;text-align:center;font-size:0.82rem;">${e.column || ''}</td>
            <td style="padding:8px 10px;font-size:0.82rem;color:#dc2626;">${e.error || ''}</td>
            <td style="padding:8px 10px;font-size:0.82rem;color:#6b7280;font-style:italic;">${String(e.value || '').slice(0, 60)}</td>
        </tr>
    `).join('');

    const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:760px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#7f1d1d,#dc2626);padding:28px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.2rem;">ASIL HCM — Claims Quality Check FAILED</h1>
    <p style="color:#fca5a5;margin:6px 0 0;font-size:0.88rem;">File: ${filename || 'Attachment'}</p>
  </div>
  <div style="padding:28px 32px;">
    <h2 style="color:#7f1d1d;margin:0 0 8px;font-size:1rem;">Your submission has been rejected</h2>
    <p style="color:#64748b;margin:0 0 20px;font-size:0.9rem;">Please correct all issues below and resubmit the complete file.</p>
    <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#fef2f2;">
        <th style="padding:10px;text-align:left;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Sheet</th>
        <th style="padding:10px;text-align:center;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Row</th>
        <th style="padding:10px;text-align:center;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Col</th>
        <th style="padding:10px;text-align:left;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Error</th>
        <th style="padding:10px;text-align:left;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Value Found</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>
    <div style="margin:24px 0 0;padding:16px;background:#fef9ec;border-left:4px solid #f59e0b;border-radius:6px;">
      <p style="margin:0 0 6px;color:#92400e;font-weight:700;font-size:0.88rem;">Submission SOP:</p>
      <ul style="margin:0;padding-left:18px;color:#78350f;font-size:0.83rem;line-height:1.8;">
        <li>All ASIL employee codes must match HR records (format: ASIL/XXX/NNN/YY).</li>
        <li>Hours Worked must be a positive number; Multiplier required for all OT rows.</li>
        <li>All amounts must be numeric — remove PKR symbols, commas, text.</li>
        <li>Do not modify sheet names or column structure of the template.</li>
        <li>Once corrected, resubmit as an attachment in reply to this email.</li>
      </ul>
    </div>
  </div>
  <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.78rem;margin:0;">Allied Services International (Pvt.) Ltd. · ASIL HCM · ${new Date().getFullYear()}</p>
  </div>
</div></body></html>`;

    try {
        await resend.emails.send({ from: EMAIL_FROM, to: toEmail, subject: 'REJECTED: Claims Submission Fails Quality Check — Please Resubmit', html });
        console.log(`[Wafi Claims] QC rejection email sent to ${toEmail}`);
    } catch (e) {
        console.error('[Wafi Claims] Failed to send QC rejection email:', e.message);
    }
}

// Build confirmation HTML (used both for draft and direct send)
// items = array of wafi_claims_items rows (optional — falls back to counts if not provided)
function buildConfirmationHtml({ sessionId, filename, otCount, expCount, medCount, claimMonth, settlementMonth, items }) {
    const claimMonthLabel = claimMonth
        ? new Date(claimMonth).toLocaleString('en-US', { month: 'long', year: 'numeric' })
        : '—';
    const settlementMonthLabel = settlementMonth
        ? new Date(settlementMonth).toLocaleString('en-US', { month: 'long', year: 'numeric' })
        : '—';

    // Build per-employee summary from items if available
    let employeeTableHtml = '';
    if (items && items.length > 0) {
        // Group by employee
        const empMap = {};
        for (const item of items) {
            const empId = item.employee_id || item.employee_code_raw || '—';
            if (!empMap[empId]) {
                empMap[empId] = {
                    id: empId,
                    name: item.employee_name_db || item.employee_name_raw || '—',
                    ot1x: 0, ot2x: 0, ot3x: 0,
                    expense: 0, medical: 0,
                };
            }
            const mult = (item.ot_multiplier || '').toLowerCase().trim();
            if (item.claim_type === 'OT') {
                const hrs = parseFloat(item.ot_hours) || 0;
                if (mult === 'single') empMap[empId].ot1x += hrs;
                else if (mult === 'double') empMap[empId].ot2x += hrs;
                else if (mult === 'triple') empMap[empId].ot3x += hrs;
                else empMap[empId].ot1x += hrs; // default to 1x if unknown
            } else if (item.claim_type === 'EXPENSE') {
                empMap[empId].expense += parseFloat(item.raw_amount) || 0;
            } else if (item.claim_type === 'MEDICAL') {
                empMap[empId].medical += parseFloat(item.raw_amount) || 0;
            }
        }

        const empRows = Object.values(empMap).map((e, i) => {
            const bg = i % 2 === 0 ? '#f0fdf4' : '#fff';
            const fmt = (n) => n > 0 ? n % 1 === 0 ? String(n) : n.toFixed(1) : '—';
            const fmtPKR = (n) => n > 0 ? 'PKR ' + Math.round(n).toLocaleString('en-PK') : '—';
            return `
            <tr style="background:${bg};">
              <td style="padding:9px 12px;font-size:0.8rem;color:#374151;border-bottom:1px solid #e2e8f0;font-family:monospace;">${e.id}</td>
              <td style="padding:9px 12px;font-size:0.82rem;color:#14532d;font-weight:600;border-bottom:1px solid #e2e8f0;">${e.name}</td>
              <td style="padding:9px 12px;font-size:0.82rem;text-align:center;color:#374151;border-bottom:1px solid #e2e8f0;">${fmt(e.ot1x)}</td>
              <td style="padding:9px 12px;font-size:0.82rem;text-align:center;color:#374151;border-bottom:1px solid #e2e8f0;">${fmt(e.ot2x)}</td>
              <td style="padding:9px 12px;font-size:0.82rem;text-align:center;color:#374151;border-bottom:1px solid #e2e8f0;">${fmt(e.ot3x)}</td>
              <td style="padding:9px 12px;font-size:0.82rem;text-align:right;color:#374151;border-bottom:1px solid #e2e8f0;">${fmtPKR(e.expense)}</td>
              <td style="padding:9px 12px;font-size:0.82rem;text-align:right;color:#374151;border-bottom:1px solid #e2e8f0;">${fmtPKR(e.medical)}</td>
            </tr>`;
        }).join('');

        employeeTableHtml = `
        <div style="overflow-x:auto;margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;min-width:560px;">
            <thead>
              <tr style="background:#14532d;">
                <th style="padding:10px 12px;text-align:left;color:#bbf7d0;font-size:0.75rem;font-weight:600;letter-spacing:0.04em;">EMP ID</th>
                <th style="padding:10px 12px;text-align:left;color:#bbf7d0;font-size:0.75rem;font-weight:600;">NAME</th>
                <th style="padding:10px 12px;text-align:center;color:#bbf7d0;font-size:0.75rem;font-weight:600;">OT 1×<br><span style="font-weight:400;font-size:0.7rem;">hrs</span></th>
                <th style="padding:10px 12px;text-align:center;color:#bbf7d0;font-size:0.75rem;font-weight:600;">OT 2×<br><span style="font-weight:400;font-size:0.7rem;">hrs</span></th>
                <th style="padding:10px 12px;text-align:center;color:#bbf7d0;font-size:0.75rem;font-weight:600;">OT 3×<br><span style="font-weight:400;font-size:0.7rem;">hrs</span></th>
                <th style="padding:10px 12px;text-align:right;color:#bbf7d0;font-size:0.75rem;font-weight:600;">EXPENSE</th>
                <th style="padding:10px 12px;text-align:right;color:#bbf7d0;font-size:0.75rem;font-weight:600;">MEDICAL</th>
              </tr>
            </thead>
            <tbody>${empRows}</tbody>
          </table>
        </div>`;
    } else {
        // Fallback: simple row counts (no items available)
        employeeTableHtml = `
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
          <tr style="background:#f0fdf4;"><td style="padding:10px 14px;color:#166534;font-weight:600;">Overtime Claims</td><td style="padding:10px 14px;text-align:right;font-weight:700;color:#15803d;">${otCount || 0} rows</td></tr>
          <tr><td style="padding:10px 14px;color:#166534;font-weight:600;">Expense Claims</td><td style="padding:10px 14px;text-align:right;font-weight:700;color:#15803d;">${expCount || 0} rows</td></tr>
          <tr style="background:#f0fdf4;"><td style="padding:10px 14px;color:#166534;font-weight:600;">Medical &amp; IPD Claims</td><td style="padding:10px 14px;text-align:right;font-weight:700;color:#15803d;">${medCount || 0} rows</td></tr>
        </table>`;
    }

    return `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:720px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#14532d,#16a34a);padding:24px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.1rem;">ASIL HCM — Claims Successfully Logged</h1>
    <p style="color:#bbf7d0;margin:6px 0 0;font-size:0.85rem;">File: ${filename || 'Attachment'} · Ref: #${sessionId}</p>
  </div>
  <div style="padding:24px 32px;">
    <!-- ✏️ Add any notes or personalised message in the 2 lines below before sending -->
    <p style="color:#374151;margin:0 0 6px;font-size:0.9rem;min-height:1.4em;">&nbsp;</p>
    <p style="color:#374151;margin:0 0 20px;font-size:0.9rem;min-height:1.4em;">&nbsp;</p>
    <p style="color:#374151;margin:0 0 16px;font-size:0.9rem;">Your submission has been received, validated, and logged. Please review the details below:</p>
    ${employeeTableHtml}
    <table style="width:100%;border-collapse:collapse;border:1px solid #d1fae5;border-radius:8px;overflow:hidden;">
      <tr style="background:#f0fdf4;">
        <td style="padding:12px 16px;color:#166534;font-weight:700;font-size:0.9rem;border-bottom:1px solid #d1fae5;">Claims for Month</td>
        <td style="padding:12px 16px;text-align:right;font-weight:800;color:#15803d;font-size:1rem;border-bottom:1px solid #d1fae5;">${claimMonthLabel}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;color:#166534;font-weight:700;font-size:0.9rem;">Processed in Payroll</td>
        <td style="padding:12px 16px;text-align:right;font-weight:800;color:#15803d;font-size:1rem;">${settlementMonthLabel}</td>
      </tr>
    </table>
      <p style="margin:0;color:#166534;font-size:0.88rem;">These claims are now in ASIL's payroll processing queue for <strong>${settlementMonthLabel}</strong>. No further action is required from you.</p>
    </div>
  </div>
  <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.78rem;margin:0;">Allied Services International (Pvt.) Ltd. · ASIL HCM · ${new Date().getFullYear()}</p>
  </div>
</div></body></html>`;
}

// ── Daily Digest ──────────────────────────────────────────────────────────────
async function sendDailyDigest(pool) {
    if (!EMAILS_ENABLED) {
        console.log('[Wafi Claims] [TEST MODE] Daily digest would be sent');
        return;
    }
    try {
        const { rows } = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE processing_status = 'PENDING_REVIEW') AS pending,
                COUNT(*) FILTER (WHERE processing_status = 'VALIDATION_FAILED') AS failed,
                COUNT(*) FILTER (WHERE processing_status = 'IRRELEVANT' AND created_at > NOW() - INTERVAL '24 hours') AS new_irrelevant,
                COUNT(*) FILTER (WHERE DATE_TRUNC('month', received_at) = DATE_TRUNC('month', NOW())) AS this_month,
                COUNT(*) FILTER (WHERE processing_status IN ('PROCESSED_SUCCESSFULLY','VERIFIED') AND DATE_TRUNC('month', received_at) = DATE_TRUNC('month', NOW())) AS passed_month
            FROM wafi_claims_sessions
        `);
        const stats = rows[0];

        const pendingSessions = await pool.query(`
            SELECT id, sender_email, attachment_filename, total_ot_rows, total_expense_rows, total_medical_rows, received_at
            FROM wafi_claims_sessions
            WHERE processing_status = 'PENDING_REVIEW'
            ORDER BY received_at DESC
            LIMIT 10
        `);

        const pendingRows = pendingSessions.rows.map(s => `
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 12px;font-size:0.82rem;color:#374151;">#${s.id}</td>
              <td style="padding:8px 12px;font-size:0.82rem;">${s.sender_email}</td>
              <td style="padding:8px 12px;font-size:0.82rem;color:#6b7280;">${s.attachment_filename || '—'}</td>
              <td style="padding:8px 12px;font-size:0.82rem;color:#7c3aed;">${s.total_ot_rows} OT</td>
              <td style="padding:8px 12px;font-size:0.82rem;color:#d97706;">${s.total_expense_rows} Exp</td>
              <td style="padding:8px 12px;font-size:0.82rem;color:#0891b2;">${s.total_medical_rows} Med</td>
            </tr>
        `).join('');

        const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:760px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:24px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.1rem;">ASIL Claims — Daily Summary</h1>
    <p style="color:#94a3b8;margin:4px 0 0;font-size:0.84rem;">${new Date().toLocaleDateString('en-PK', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}</p>
  </div>
  <div style="padding:24px 32px;">
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px;">
      <div style="flex:1;min-width:120px;background:#fef9ec;border-left:4px solid #f59e0b;border-radius:8px;padding:14px;">
        <div style="font-size:1.6rem;font-weight:800;color:#d97706;">${stats.pending}</div>
        <div style="font-size:0.78rem;color:#92400e;font-weight:600;">Pending Review</div>
      </div>
      <div style="flex:1;min-width:120px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:8px;padding:14px;">
        <div style="font-size:1.6rem;font-weight:800;color:#dc2626;">${stats.failed}</div>
        <div style="font-size:0.78rem;color:#991b1b;font-weight:600;">Validation Failed</div>
      </div>
      <div style="flex:1;min-width:120px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;padding:14px;">
        <div style="font-size:1.6rem;font-weight:800;color:#16a34a;">${stats.passed_month}</div>
        <div style="font-size:0.78rem;color:#166534;font-weight:600;">Passed This Month</div>
      </div>
      <div style="flex:1;min-width:120px;background:#f8fafc;border-left:4px solid #94a3b8;border-radius:8px;padding:14px;">
        <div style="font-size:1.6rem;font-weight:800;color:#475569;">${stats.new_irrelevant}</div>
        <div style="font-size:0.78rem;color:#64748b;font-weight:600;">Irrelevant (24h)</div>
      </div>
    </div>
    ${pendingSessions.rows.length ? `
    <h3 style="color:#1e293b;font-size:0.9rem;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.05em;">⏳ Pending Review — Action Required</h3>
    <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f8fafc;">
        <th style="padding:8px 12px;text-align:left;font-size:0.72rem;color:#64748b;border-bottom:1px solid #e2e8f0;">ID</th>
        <th style="padding:8px 12px;text-align:left;font-size:0.72rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Sender</th>
        <th style="padding:8px 12px;text-align:left;font-size:0.72rem;color:#64748b;border-bottom:1px solid #e2e8f0;">File</th>
        <th style="padding:8px 12px;text-align:left;font-size:0.72rem;color:#64748b;border-bottom:1px solid #e2e8f0;">OT</th>
        <th style="padding:8px 12px;text-align:left;font-size:0.72rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Exp</th>
        <th style="padding:8px 12px;text-align:left;font-size:0.72rem;color:#64748b;border-bottom:1px solid #e2e8f0;">Med</th>
      </tr></thead>
      <tbody>${pendingRows}</tbody>
    </table></div>` : '<p style="color:#22c55e;font-weight:600;">✓ No sessions pending review — all clear!</p>'}
    <div style="margin-top:20px;text-align:center;">
      <a href="https://asilhcm.onrender.com" style="display:inline-block;background:#6366f1;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.88rem;">Open Dashboard →</a>
    </div>
  </div>
  <div style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.75rem;margin:0;">ASIL HCM · Automated Daily Digest · Do not reply to this email</p>
  </div>
</div></body></html>`;

        await resend.emails.send({
            from: EMAIL_FROM,
            to: DIGEST_RECIPIENTS,
            subject: `[ASIL Claims] Daily Summary — ${new Date().toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' })}`,
            html,
        });
        console.log('[Wafi Claims] Daily digest sent to', DIGEST_RECIPIENTS.join(', '));
    } catch (e) {
        console.error('[Wafi Claims] Daily digest error:', e.message);
    }
}

// ── Core: Process One Gmail Message ──────────────────────────────────────────
async function processOneMessage(pool, gmail, msg) {
    const msgId = msg.id;
    let threadId = msg.threadId;

    // Dedup — IRRELEVANT and SKIPPED are permanent; WRONG_FORMAT and VALIDATION_FAILED reprocess
    const dup = await pool.query(
        `SELECT id, processing_status FROM wafi_claims_sessions WHERE gmail_message_id = $1 LIMIT 1`,
        [msgId]
    );
    if (dup.rows.length) {
        const existing = dup.rows[0];
        const reprocessable = ['WRONG_FORMAT', 'VALIDATION_FAILED'];
        if (reprocessable.includes(existing.processing_status)) {
            await pool.query('DELETE FROM wafi_claims_sessions WHERE id = $1', [existing.id]);
            console.log(`[Wafi Claims] Reprocessing previous ${existing.processing_status} message ${msgId}`);
        } else {
            console.log(`[Wafi Claims] Duplicate message ${msgId} (${existing.processing_status}) — skipping`);
            await markAsRead(gmail, msgId);
            return;
        }
    }

    // Fetch full message
    let fullMsg;
    try {
        const { data } = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
        fullMsg = data;
        // Always use real threadId from API — msg.threadId is null when from reprocess queue
        threadId = fullMsg.threadId || threadId;
    } catch (e) {
        console.error(`[Wafi Claims] Failed to fetch message ${msgId}:`, e.message);
        return;
    }


    const headers = {};
    for (const h of (fullMsg.payload?.headers || [])) headers[h.name.toLowerCase()] = h.value;

    const subject    = headers.subject || '';
    const fromHeader = headers.from    || '';
    const receivedAt = fullMsg.internalDate ? new Date(parseInt(fullMsg.internalDate)) : new Date();

    const senderMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s<>]+@[^\s<>]+)/);
    const senderEmail = senderMatch ? senderMatch[1].toLowerCase() : fromHeader.toLowerCase();

    console.log(`[Wafi Claims] Processing: "${subject}" from ${senderEmail} (${msgId})`);

    // Check focal point
    const focalPoint = await checkFocalPoint(pool, senderEmail);
    const isFirstTimeSender = !focalPoint;

    // Extract email body snippet for IRRELEVANT logs
    const emailSummary = extractEmailBody(fullMsg.payload);

    // Find ALL XLSX attachments
    const attachments = [];
    function extractParts(part) {
        if (!part) return;
        if (part.filename && part.body?.attachmentId) {
            const fn = part.filename.toLowerCase();
            if (fn.endsWith('.xlsx') || fn.endsWith('.xls')) {
                attachments.push({ filename: part.filename, attachmentId: part.body.attachmentId });
            }
        }
        if (part.parts) part.parts.forEach(extractParts);
    }
    extractParts(fullMsg.payload);

    // ── No Excel at all → IRRELEVANT ────────────────────────────────────────
    if (!attachments.length) {
        console.log(`[Wafi Claims] No XLSX attachment in ${msgId} — logging as IRRELEVANT`);
        try {
            await pool.query(`
                INSERT INTO wafi_claims_sessions
                    (received_at, sender_email, subject, gmail_message_id, gmail_thread_id,
                     processing_status, email_summary, is_first_time_sender,
                     total_ot_rows, total_expense_rows, total_medical_rows,
                     validation_errors, name_warnings)
                VALUES ($1,$2,$3,$4,$5,'IRRELEVANT',$6,$7,0,0,0,'[]'::jsonb,'[]'::jsonb)
                ON CONFLICT (gmail_message_id) DO NOTHING
            `, [receivedAt, senderEmail, subject, msgId, threadId, emailSummary, isFirstTimeSender]);
        } catch (e) { console.warn('[Wafi Claims] Failed to save IRRELEVANT session:', e.message); }
        await applyLabel(gmail, msgId, 'Claims/Not-Relevant');
        return;
    }

    // ── Try each attachment, pick first with valid claims tabs ───────────────
    let validAttachment = null;
    let parseResult = null;
    let lastMismatch = null;

    for (const att of attachments) {
        let buf;
        try {
            const { data: attData } = await gmail.users.messages.attachments.get({
                userId: 'me', messageId: msgId, id: att.attachmentId,
            });
            buf = Buffer.from(attData.data, 'base64');
        } catch (e) {
            console.warn(`[Wafi Claims] Failed to download "${att.filename}":`, e.message);
            continue;
        }

        const result = parseWafiExcel(buf, att.filename);
        if (!result) continue; // not readable Excel, try next
        if (result.mismatch) {
            lastMismatch = { att, result };
            continue; // valid Excel but wrong tabs, try next
        }

        // ── Pre-parse duplicate check: same sender + same filename already processed? ──
        const { rows: prevByFilename } = await pool.query(`
            SELECT id, received_at, processing_status
            FROM wafi_claims_sessions
            WHERE sender_email = $1 AND attachment_filename = $2
              AND processing_status IN ('PROCESSED_SUCCESSFULLY','PENDING_REVIEW','VERIFIED','VALIDATION_FAILED')
            ORDER BY received_at DESC LIMIT 1
        `, [senderEmail, att.filename]);

        if (prevByFilename.length) {
            const prev = prevByFilename[0];
            const prevDate = new Date(prev.received_at).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
            const dupReason = `DUPLICATE FILE: The exact same file "${att.filename}" was already submitted by this sender and ` +
                `logged on ${prevDate} (Session #${prev.id}, status: ${prev.processing_status}). No new data has been recorded.`;
            console.log(`[Wafi Claims] Duplicate filename detected for ${senderEmail}: "${att.filename}" → session #${prev.id}`);
            try {
                await pool.query(`
                    INSERT INTO wafi_claims_sessions
                        (received_at, sender_email, subject, gmail_message_id, gmail_thread_id,
                         attachment_filename, processing_status, email_summary, is_first_time_sender,
                         total_ot_rows, total_expense_rows, total_medical_rows,
                         validation_errors, name_warnings)
                    VALUES ($1,$2,$3,$4,$5,$6,'IRRELEVANT',$7,$8,0,0,0,'[]'::jsonb,'[]'::jsonb)
                    ON CONFLICT (gmail_message_id) DO NOTHING
                `, [receivedAt, senderEmail, subject, msgId, threadId, att.filename, dupReason, isFirstTimeSender]);
            } catch (e) { console.warn('[Wafi Claims] Failed to save DUPLICATE session:', e.message); }
            await applyLabel(gmail, msgId, 'Claims/Not-Relevant');
            await markAsRead(gmail, msgId);
            return;
        }

        // Found valid claims file
        validAttachment = { att, buf };
        parseResult = result;
        break;
    }

    // ── None of the attachments had claims tabs ──────────────────────────────
    if (!parseResult) {
        if (lastMismatch) {
            // At least one Excel found but wrong format
            console.log(`[Wafi Claims] "${lastMismatch.att.filename}" logged as WRONG_FORMAT`);
            const mismatchError = [{
                sheet: 'Template Structure', row: '-', column: '-',
                error: 'Wrong template — required tabs not found.',
                value: `Found: [${lastMismatch.result.found.join(', ')}] | Missing: [${lastMismatch.result.missing.join(', ')}]`,
            }];
            try {
                await pool.query(`
                    INSERT INTO wafi_claims_sessions
                        (received_at, sender_email, subject, gmail_message_id, gmail_thread_id,
                         attachment_filename, processing_status, validation_errors, name_warnings,
                         email_summary, is_first_time_sender, total_ot_rows, total_expense_rows, total_medical_rows)
                    VALUES ($1,$2,$3,$4,$5,$6,'WRONG_FORMAT',$7::jsonb,'[]'::jsonb,$8,$9,0,0,0)
                    ON CONFLICT (gmail_message_id) DO NOTHING
                `, [receivedAt, senderEmail, subject, msgId, threadId,
                    lastMismatch.att.filename, JSON.stringify(mismatchError), emailSummary, isFirstTimeSender]);
            } catch (e) { console.warn('[Wafi Claims] Failed to save WRONG_FORMAT session:', e.message); }
        } else {
            // Only non-Excel attachments (PDFs, images, etc.) → IRRELEVANT
            console.log(`[Wafi Claims] No parseable Excel in ${msgId} — logging as IRRELEVANT`);
            try {
                await pool.query(`
                    INSERT INTO wafi_claims_sessions
                        (received_at, sender_email, subject, gmail_message_id, gmail_thread_id,
                         processing_status, email_summary, is_first_time_sender,
                         total_ot_rows, total_expense_rows, total_medical_rows,
                         validation_errors, name_warnings)
                    VALUES ($1,$2,$3,$4,$5,'IRRELEVANT',$6,$7,0,0,0,'[]'::jsonb,'[]'::jsonb)
                    ON CONFLICT (gmail_message_id) DO NOTHING
                `, [receivedAt, senderEmail, subject, msgId, threadId, emailSummary, isFirstTimeSender]);
            } catch (e) { console.warn('[Wafi Claims] Failed to save IRRELEVANT session:', e.message); }
            await applyLabel(gmail, msgId, 'Claims/Not-Relevant');
        }
        await markAsRead(gmail, msgId);
        return;
    }

    // ── Valid claims file found → parse all 3 sheets ─────────────────────────
    const { wb, otSheet, expSheet, medSheet } = parseResult;
    const att = validAttachment.att;
    const errors = [];
    const warnings = [];

    const otRawRows  = getSheetRows(wb, otSheet);
    const expRawRows = getSheetRows(wb, expSheet);
    const medRawRows = getSheetRows(wb, medSheet);

    const filename = att.filename || '';

    // Process sheets serially (not parallel) so AI date calls don't race each other
    const otItems  = await processOvertimeSheet(pool, otRawRows, errors, warnings, filename);
    const expItems = await processExpenseSheet(pool, expRawRows, errors, warnings, filename);
    const medItems = await processMedicalSheet(pool, medRawRows, errors, warnings, filename);

    const allItems   = [...otItems, ...expItems, ...medItems];
    const validItems = allItems.filter(r => !r._error);

    // ── Multi-month detection ─────────────────────────────────────────────────
    // If the file contains dates spanning more than one calendar month, reject it.
    const monthsFound = new Set();
    for (const item of allItems) {
        if (item.claim_date) {
            const d = item.claim_date instanceof Date ? item.claim_date : new Date(item.claim_date);
            if (!isNaN(d)) monthsFound.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
        }
    }
    if (monthsFound.size > 1) {
        const monthLabels = [...monthsFound].sort().map(m => {
            const [y, mo] = m.split('-');
            return new Date(parseInt(y), parseInt(mo)-1, 1).toLocaleString('en-PK', { month:'long', year:'numeric' });
        });
        errors.push({
            sheet: 'All Sheets',
            row: '-',
            column: 'Date',
            error: `Claims span ${monthsFound.size} months (${monthLabels.join(', ')}). ` +
                   `Please submit one file per claim month and resubmit.`,
            value: monthLabels.join(', '),
        });
        console.log(`[Wafi Claims] Multi-month file detected: ${monthLabels.join(', ')} — rejecting`);
    }

    // ── Empty file check → IRRELEVANT ────────────────────────────────────────
    if (validItems.length === 0 && errors.length === 0) {
        // Produce a diagnostic breakdown of WHY there are no valid items
        const otParsed  = otRawRows.length  > 1 ? otRawRows.length  - 1 : 0;
        const expParsed = expRawRows.length > 1 ? expRawRows.length - 1 : 0;
        const medParsed = medRawRows.length > 1 ? medRawRows.length - 1 : 0;
        const totalParsedRows = otParsed + expParsed + medParsed;

        let blankReason;
        if (totalParsedRows === 0) {
            blankReason = `EMPTY FILE: "${att.filename}" has the correct tab structure ` +
                `(Overtime Claims, Expense Claims, Medical & IPD Claims) but all sheets are empty. Nothing was logged.`;
        } else {
            // Rows exist but were all skipped — explain why
            const parts = [];
            if (otParsed > 0)  parts.push(`Overtime: ${otParsed} row(s) found`);
            if (expParsed > 0) parts.push(`Expense: ${expParsed} row(s) found`);
            if (medParsed > 0) parts.push(`Medical: ${medParsed} row(s) found`);
            blankReason = `COULD NOT PROCESS: "${att.filename}" has data rows (${parts.join('; ')}) but ` +
                `all rows were skipped — likely due to missing employee codes or unrecognised date format. ` +
                `Please check that: (1) ASIL Employee Code (column B) is filled for every row, ` +
                `(2) dates are in DD-MM-YYYY format (e.g. 14-05-2026). Expense and Medical rows missing employee ` +
                `information cannot be processed.`;
        }

        // Check previous submission
        const { rows: prevBlank } = await pool.query(`
            SELECT id, received_at FROM wafi_claims_sessions
            WHERE sender_email = $1 AND attachment_filename = $2
            ORDER BY received_at DESC LIMIT 1
        `, [senderEmail, att.filename]);
        if (prevBlank.length) {
            const prevDate = new Date(prevBlank[0].received_at).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
            blankReason = `DUPLICATE FILE: "${att.filename}" was already submitted on ${prevDate} (Session #${prevBlank[0].id}). ` +
                blankReason;
        }

        console.log(`[Wafi Claims] "${att.filename}" — 0 valid rows, 0 errors → IRRELEVANT`);
        try {
            await pool.query(`
                INSERT INTO wafi_claims_sessions
                    (received_at, sender_email, subject, gmail_message_id, gmail_thread_id,
                     attachment_filename, processing_status, email_summary, is_first_time_sender,
                     total_ot_rows, total_expense_rows, total_medical_rows,
                     validation_errors, name_warnings)
                VALUES ($1,$2,$3,$4,$5,$6,'IRRELEVANT',$7,$8,0,0,0,'[]'::jsonb,'[]'::jsonb)
                ON CONFLICT (gmail_message_id) DO NOTHING
            `, [receivedAt, senderEmail, subject, msgId, threadId, att.filename, blankReason, isFirstTimeSender]);
        } catch (e) { console.warn('[Wafi Claims] Failed to save IRRELEVANT session:', e.message); }
        await applyLabel(gmail, msgId, 'Claims/Not-Relevant');
        await markAsRead(gmail, msgId);
        return;
    }

    const hasErrors = errors.length > 0;
    // Clean validation → PENDING_REVIEW; has errors → VALIDATION_FAILED
    const status = hasErrors ? 'VALIDATION_FAILED' : 'PENDING_REVIEW';
    console.log(`[Wafi Claims] "${att.filename}": ${validItems.length} valid, ${errors.length} errors, ${warnings.length} warnings → ${status}`);

    // ── Similarity check against existing sessions for same sender + same claim month ──
    // Runs even if there are validation errors — helps identify duplicates early.
    let similarityNote = '';
    try {
        const newEmpIds  = new Set(validItems.map(r => r.employee_id).filter(Boolean));
        const firstDate  = validItems.find(r => r.claim_date)?.claim_date || new Date();
        if (newEmpIds.size > 0) {
            const { rows: prevEmpRows } = await pool.query(`
                SELECT DISTINCT wci.employee_id, wci.ot_hours, wci.raw_amount, wci.claim_type,
                                wcs.id AS session_id, wcs.received_at, wcs.attachment_filename
                FROM wafi_claims_items wci
                JOIN wafi_claims_sessions wcs ON wcs.id = wci.session_id
                WHERE wcs.sender_email = $1
                  AND DATE_TRUNC('month', wci.claim_date) = DATE_TRUNC('month', $2::date)
                  AND wci.active = TRUE
                  AND wcs.processing_status IN ('PROCESSED_SUCCESSFULLY','PENDING_REVIEW','VERIFIED')
            `, [senderEmail, firstDate]);

            if (prevEmpRows.length > 0) {
                const prevEmpIds     = new Set(prevEmpRows.map(r => r.employee_id).filter(Boolean));
                const prevSessionIds = [...new Set(prevEmpRows.map(r => r.session_id))];
                const overlap        = [...newEmpIds].filter(id => prevEmpIds.has(id));
                const overlapPct     = Math.round((overlap.length / Math.max(newEmpIds.size, prevEmpIds.size)) * 100);
                const newOnly        = [...newEmpIds].filter(id => !prevEmpIds.has(id));
                const removedOnly    = [...prevEmpIds].filter(id => !newEmpIds.has(id));
                const prevDate       = new Date(prevEmpRows[0].received_at).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' });
                const prevFile       = prevEmpRows[0].attachment_filename || '';

                if (overlapPct === 100 && newOnly.length === 0 && removedOnly.length === 0) {
                    similarityNote = `⚠ POSSIBLE DUPLICATE: All ${newEmpIds.size} employee(s) in this submission ` +
                        `were already logged for this claim month in Session #${prevSessionIds[0]} ` +
                        `(${prevDate}, file: "${prevFile}"). Please verify before staging.`;
                } else if (overlapPct >= 60) {
                    similarityNote = `⚠ SIMILAR TO PREVIOUS SUBMISSION (${overlapPct}% overlap with Session #${prevSessionIds[0]}, ${prevDate}): ` +
                        `${overlap.length} employee(s) match, ` +
                        (newOnly.length   ? `${newOnly.length} new employee(s) added, ` : '') +
                        (removedOnly.length ? `${removedOnly.length} employee(s) removed. ` : '') +
                        `Manual review recommended before staging.`;
                }

                if (similarityNote) {
                    console.log(`[Wafi Claims] Similarity alert for session from ${senderEmail}: ${overlapPct}% overlap`);
                    warnings.push({ type: 'SIMILARITY', note: similarityNote });
                }
            }
        }
    } catch (simErr) {
        console.warn('[Wafi Claims] Similarity check error:', simErr.message);
    }

    // Revision detection (only if no errors)
    let isRevision = false, supersedesSessionId = null;
    if (!hasErrors && validItems.length) {
        const employeeIds = [...new Set(validItems.map(r => r.employee_id).filter(Boolean))];
        const firstDate   = validItems.find(r => r.claim_date)?.claim_date;
        if (employeeIds.length && firstDate) {
            const rev = await detectAndMarkRevisions(pool, employeeIds, firstDate);
            isRevision = rev.revised;
            supersedesSessionId = rev.oldSessionId;
        }
    }

    // Save session
    let sessionId;
    try {
        sessionId = await saveSession(pool, {
            receivedAt, senderEmail, subject,
            gmailMessageId: msgId, gmailThreadId: threadId,
            attachmentFilename: att.filename,
            processingStatus: status,
            validationErrors: errors,
            nameWarnings: warnings,
            otRows: otItems, expenseRows: expItems, medicalRows: medItems,
            isRevision, supersedesSessionId,
            emailSummary, isFirstTimeSender,
        });
        console.log(`[Wafi Claims] Session ${sessionId} saved (${status})`);
    } catch (e) {
        console.error('[Wafi Claims] Failed to save session:', e.message);
        await markAsRead(gmail, msgId);
        return;
    }

    // Apply label based on final status
    if (status === 'PENDING_REVIEW') {
        await applyLabel(gmail, msgId, 'Claims/Pending-Review');
    } else if (status === 'VALIDATION_FAILED') {
        // Apply label so future polls skip this email — it won't be reprocessed
        // unless manually retriggered or the email is marked unread again.
        await applyLabel(gmail, msgId, 'Claims/Validation-Failed');
    }

    // ── Draft: Revision acknowledgment ────────────────────────────────────────
    // When a second (or later) email comes in with claims for the same employee+month,
    // create a draft in the NEW email's thread confirming receipt and that previous records were updated.
    if (isRevision && threadId) {
        try {
            const claimMonthLabel = deriveClaimMonth(validItems)
                ? new Date(deriveClaimMonth(validItems)).toLocaleString('en-US', { month: 'long', year: 'numeric' })
                : 'the submitted period';

            const empNames = [...new Set(validItems.map(r => r.employee_name_db || r.employee_name_raw).filter(Boolean))];
            const empList = empNames.slice(0, 5).join(', ') + (empNames.length > 5 ? ` and ${empNames.length - 5} others` : '');

            const firstName = (empNames[0] || senderEmail.split('@')[0]).split(' ')[0];

            const revHtml = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:660px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:24px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.1rem;">ASIL HCM — Updated Claims Received</h1>
    <p style="color:#bfdbfe;margin:6px 0 0;font-size:0.85rem;">Revision for ${claimMonthLabel} · Ref: #${sessionId}</p>
  </div>
  <div style="padding:28px 32px;">
    <p style="color:#374151;margin:0 0 16px;">Dear ${firstName},</p>
    <p style="color:#374151;margin:0 0 16px;font-size:0.92rem;">Thank you for your updated submission. We have received your revised claims file (<strong>${att.filename}</strong>) for <strong>${claimMonthLabel}</strong>.</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin-bottom:20px;">
      <p style="color:#1d4ed8;font-weight:600;margin:0 0 8px;font-size:0.88rem;">📋 UPDATED RECORDS</p>
      <p style="color:#374151;margin:0 0 8px;font-size:0.88rem;">The previous claims on record for <strong>${empList}</strong> for ${claimMonthLabel} have been superseded by this submission.</p>
      <ul style="margin:0;padding-left:18px;color:#374151;font-size:0.85rem;line-height:1.8;">
        ${otItems.filter(r => !r._error).length > 0 ? `<li>${otItems.filter(r => !r._error).length} Overtime claim row(s) updated</li>` : ''}
        ${expItems.filter(r => !r._error).length > 0 ? `<li>${expItems.filter(r => !r._error).length} Expense claim row(s) updated</li>` : ''}
        ${medItems.filter(r => !r._error).length > 0 ? `<li>${medItems.filter(r => !r._error).length} Medical & IPD claim row(s) updated</li>` : ''}
      </ul>
    </div>
    <p style="color:#374151;font-size:0.9rem;margin:0 0 8px;">Your revised submission is now pending review by the ASIL HR team. No further action is required from you unless you are contacted.</p>
    <p style="color:#374151;margin:16px 0 4px;font-size:0.9rem;">Regards,<br><strong>ASIL HR Team</strong></p>
  </div>
  <div style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.75rem;margin:0;">Allied Services International (Pvt.) Ltd. · ASIL HCM · ${new Date().getFullYear()}</p>
  </div>
</div></body></html>`;

            const draftId = await createGmailDraft(gmail, threadId, senderEmail, subject || 'Re: Claims Submission', revHtml);
            if (draftId) {
                await pool.query('UPDATE wafi_claims_sessions SET confirm_email_sent = TRUE WHERE id = $1', [sessionId]);
                console.log(`[Wafi Claims] Revision acknowledgment draft created (session ${sessionId})`);
            }
        } catch (draftErr) {
            console.warn('[Wafi Claims] Revision draft warning:', draftErr.message);
        }
    }

    // ── Draft: Already-logged duplicate submission ─────────────────────────────
    // If the SAME employee's claims for the SAME month were already VERIFIED/STAGED
    // but revision detection didn't fire (e.g. same email resent), create a "already logged" draft.
    // This is handled by the revision detection marking old session REVISED above.
    // For PENDING_REVIEW (no errors, first time), no draft needed here — the Verify action creates it.

    // Send QC rejection email if errors
    if (hasErrors) {
        try {
            await sendQCRejectionEmail(senderEmail, errors, att.filename);
            await pool.query('UPDATE wafi_claims_sessions SET qc_email_sent=TRUE WHERE id=$1', [sessionId]);
        } catch (e) { console.warn('[Wafi Claims] QC email warning:', e.message); }
    }

    await markAsRead(gmail, msgId);
}

// ── Main Poll ─────────────────────────────────────────────────────────────────
async function pollGmail(pool) {
    const gmail = createGmailClient();
    if (!gmail) {
        console.log('[Wafi Claims] Gmail not configured — skipping poll');
        return { skipped: true, reason: 'Gmail OAuth credentials not configured' };
    }

    console.log(`[Wafi Claims] ═══ Poll starting — monitoring: ${GMAIL_USER} ═══`);
    _lastPollAt = new Date();
    const summary = { processed: 0, skipped: 0, errors: 0 };

    try {
        await ensureLabels(gmail);

        // ── Process requeue'd message IDs first (these bypass the label filter) ──
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS wafi_claims_reprocess_queue (
                    gmail_message_id TEXT PRIMARY KEY,
                    queued_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            const { rows: queued } = await pool.query(
                `SELECT gmail_message_id FROM wafi_claims_reprocess_queue ORDER BY queued_at`
            );
            if (queued.length > 0) {
                console.log(`[Wafi Claims] Reprocess queue: ${queued.length} message(s) to reprocess directly`);
                for (const row of queued) {
                    const qMsgId = row.gmail_message_id;
                    try {
                        await processOneMessage(pool, gmail, { id: qMsgId, threadId: null });
                        summary.processed++;
                    } catch (e) {
                        console.error(`[Wafi Claims] Requeue error for ${qMsgId}:`, e.message);
                        summary.errors++;
                    }
                    // Remove from queue regardless of success/fail — don't loop forever
                    await pool.query(`DELETE FROM wafi_claims_reprocess_queue WHERE gmail_message_id = $1`, [qMsgId]);
                }
            }
        } catch (e) {
            console.warn('[Wafi Claims] Reprocess queue processing warning:', e.message);
        }

        // ── Normal poll: unread emails not yet labelled ──
        const q = `from:@${SENDER_DOMAIN} to:(${CLAIMS_EMAIL} OR ${GMAIL_USER}) has:attachment is:unread -label:Claims`;
        const { data } = await gmail.users.messages.list({ userId: 'me', q, maxResults: 50 });
        const messages = data.messages || [];
        console.log(`[Wafi Claims] Found ${messages.length} new unprocessed messages`);

        for (const msg of messages) {
            try {
                await processOneMessage(pool, gmail, msg);
                summary.processed++;
            } catch (e) {
                console.error(`[Wafi Claims] Error processing message ${msg.id}:`, e.message);
                summary.errors++;
            }
        }
    } catch (e) {
        console.error('[Wafi Claims] Poll error:', e.message);
        return { error: e.message, ...summary };
    }

    console.log('[Wafi Claims] ═══ Poll complete ═══', JSON.stringify(summary));
    return summary;
}

// ── Daily Digest Scheduler ────────────────────────────────────────────────────
function scheduleDailyDigest(pool) {
    // Check every minute if it's 8:00 AM PKT (UTC+5 = UTC 03:00)
    let lastDigestDate = null;
    setInterval(async () => {
        const now = new Date();
        const pkTime = new Date(now.getTime() + 5 * 60 * 60 * 1000);
        const hour = pkTime.getUTCHours();
        const minute = pkTime.getUTCMinutes();
        const today = pkTime.toISOString().slice(0, 10);

        if (hour === 8 && minute === 0 && lastDigestDate !== today) {
            lastDigestDate = today;
            console.log('[Wafi Claims] Sending daily digest...');
            await sendDailyDigest(pool).catch(e => console.error('[Wafi Claims] Digest error:', e.message));
        }
    }, 60 * 1000);
}

// ── Entry Points ──────────────────────────────────────────────────────────────
function startWafiClaimsService(pool) {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        console.log('[Wafi Claims] Service disabled — OAuth credentials not set');
        return;
    }
    console.log(`[Wafi Claims] Service started | user: ${GMAIL_USER} | emails: ${EMAILS_ENABLED ? 'ON' : 'OFF'}`);
    setTimeout(() => pollGmail(pool).catch(e => console.error('[Wafi Claims] Initial poll error:', e.message)), 10000);
    setInterval(() => pollGmail(pool).catch(e => console.error('[Wafi Claims] Poll error:', e.message)), POLL_INTERVAL_MS);
    scheduleDailyDigest(pool);
}

async function triggerWafiManualPoll(pool) {
    return pollGmail(pool);
}

function getLastPollAt() { return _lastPollAt; }


// ── Reprocess a session (admin-triggered) ─────────────────────────────────────
// Deletes the session record so the next poll re-ingests the original message.
// Also marks the Gmail message as unread and removes all Claims/* labels.
async function reprocessSession(pool, sessionId) {
    const { rows } = await pool.query(
        `SELECT id, gmail_message_id, processing_status, pushed_to_payroll FROM wafi_claims_sessions WHERE id = $1`,
        [sessionId]
    );
    if (!rows.length) throw new Error(`Session ${sessionId} not found`);
    const session = rows[0];

    const REPROCESSABLE = ['IRRELEVANT', 'WRONG_FORMAT', 'VALIDATION_FAILED', 'SKIPPED'];
    const isPassedNotStaged = (
        ['PROCESSED_SUCCESSFULLY', 'PENDING_REVIEW', 'VERIFIED'].includes(session.processing_status) &&
        !session.pushed_to_payroll
    );
    if (!REPROCESSABLE.includes(session.processing_status) && !isPassedNotStaged) {
        throw new Error(
            `Session ${sessionId} is in status '${session.processing_status}'` +
            (session.pushed_to_payroll ? ' and is currently staged to payroll — undo staging first.' : ' and cannot be reprocessed.')
        );
    }
    if (isPassedNotStaged) {
        console.log(`[Wafi Claims] Reprocess: allowing PASSED/PENDING/VERIFIED session ${sessionId} (not staged) to be reprocessed`);
    }

    const msgId = session.gmail_message_id;

    // Delete DB record so duplicate-gate doesn't block it
    await pool.query('DELETE FROM wafi_claims_sessions WHERE id = $1', [sessionId]);
    console.log(`[Wafi Claims] Reprocess: deleted session ${sessionId} (${session.processing_status})`);

    // Queue the message ID for direct reprocessing on next poll.
    // NOTE: We cannot rely on Gmail label removal — the poll uses -label:Claims which
    // matches the parent "Claims" label. Even removing all child labels, the parent persists.
    // Solution: store message ID in a reprocess queue; poll fetches it directly by ID.
    if (msgId) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS wafi_claims_reprocess_queue (
                    gmail_message_id TEXT PRIMARY KEY,
                    queued_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            await pool.query(
                `INSERT INTO wafi_claims_reprocess_queue (gmail_message_id)
                 VALUES ($1) ON CONFLICT (gmail_message_id) DO UPDATE SET queued_at = NOW()`,
                [msgId]
            );
            console.log(`[Wafi Claims] Reprocess: queued message ${msgId} — will process on next poll`);
        } catch (e) {
            console.warn(`[Wafi Claims] Reprocess queue warning (non-fatal):`, e.message);
        }
    }

    return { success: true, sessionId, previousStatus: session.processing_status, msgId, note: 'Run Poll Now to reprocess.' };
}

module.exports = {
    startWafiClaimsService,
    triggerWafiManualPoll,
    getLastPollAt,
    createGmailClient,
    buildConfirmationHtml,
    createGmailDraft,
    reprocessSession,
};
