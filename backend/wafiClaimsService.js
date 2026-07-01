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

// ── Gmail Draft (thread-aware reply) ─────────────────────────────────────────────
async function createGmailDraft(gmail, threadId, toEmail, subject, htmlBody, ccEmails = []) {
    try {
        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
        const headers = [
            `To: ${toEmail}`,
            `Subject: ${replySubject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
        ];
        if (ccEmails && ccEmails.length > 0) {
            headers.push(`Cc: ${ccEmails.join(', ')}`);
        }
        headers.push('', htmlBody);
        const raw = headers.join('\r\n');
        const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const { data } = await gmail.users.drafts.create({
            userId: 'me',
            requestBody: { message: { threadId, raw: encoded } },
        });
        console.log(`[Wafi Claims] Draft created: ${data.id} in thread ${threadId}`);
        return data.id;
    } catch (e) {
        console.warn('[Wafi Claims] Failed to create Gmail draft:', e.message);
        return null;
    }
}

// ── Download Attachment from Gmail ───────────────────────────────────────────
async function downloadAttachmentFromGmail(gmail, msgId, filename) {
    try {
        const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: msgId });
        let attachmentId = null;
        function findAttachment(part) {
            if (part.filename === filename && part.body?.attachmentId) {
                attachmentId = part.body.attachmentId;
            }
            if (part.parts) part.parts.forEach(findAttachment);
        }
        findAttachment(msg.payload);
        
        if (!attachmentId) return null;

        const { data: attData } = await gmail.users.messages.attachments.get({
            userId: 'me', messageId: msgId, id: attachmentId,
        });
        return Buffer.from(attData.data, 'base64');
    } catch (e) {
        console.warn(`[Wafi Claims] Failed to download attachment ${filename}:`, e.message);
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

// ── AI: Analyze email body to understand intent, months, and template rows ───
// Called before Excel processing. Uses GPT-4o-mini to understand:
//   - What months are being claimed
//   - Whether expense/medical sheets contain only template/example rows
//   - Whether the sender explicitly requested multi-month segregation
// Cost: ~$0.001-0.002 per email — negligible.
async function aiAnalyzeEmailContext(emailBody, subject, senderEmail, filename) {
    if (!openai || !emailBody) return null;
    try {
        const prompt = `You are analyzing an email sent by a contractor in Pakistan to an HR department (ASIL HR).
The contractor is submitting an Excel file with overtime, expense, and medical claims.

Subject: "${subject}"
Sender: ${senderEmail}
Attachment filename: "${filename}"
Email body:
---
${String(emailBody).slice(0, 2000)}
---

Analyze this email and respond ONLY with valid JSON (no extra text):
{
  "isClaimsEmail": true,
  "detectedMonths": ["2026-04","2026-05"],
  "templateSheetsDetected": ["Expense Claims","Medical & IPD Claims"],
  "shouldSegregate": true,
  "segregationReason": "Sender explicitly says April and May overtime in one file",
  "expenseMedicalHasRealData": false,
  "expenseMedicalNote": "Expense and Medical sheets appear to contain only example/template rows, not actual claims",
  "confidence": "high",
  "notes": "Sender is submitting 2 months of OT in one file. Expense and medical have no real claims."
}

Rules:
- detectedMonths: list of YYYY-MM strings for any months mentioned in email/subject/filename
- templateSheetsDetected: sheets where the sender explicitly says there are no real claims, or the filename/body suggests example rows only
- shouldSegregate: true if multiple months of claims in one file, false if single month
- expenseMedicalHasRealData: false if sender says no expense/medical claims, or only template rows
- confidence: high/medium/low`;

        const resp = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
            temperature: 0,
            response_format: { type: 'json_object' },
        });

        const result = JSON.parse(resp.choices[0].message.content);
        console.log(`[Wafi Claims] AI email analysis: months=${JSON.stringify(result.detectedMonths)} segregate=${result.shouldSegregate} templateSheets=${JSON.stringify(result.templateSheetsDetected)} confidence=${result.confidence}`);
        return result;
    } catch (e) {
        console.warn('[Wafi Claims] AI email analysis failed (non-fatal):', e.message);
        return null;
    }
}

// ── Template row detection — rule-based ──────────────────────────────────────
// Returns true if a row appears to be an example/template row inserted by the
// sender to demonstrate the format, not an actual claim.
function isTemplateRow(row, sheetType) {
    const code   = String(row[1] || '').trim().toLowerCase();
    const name   = String(row[2] || '').trim().toLowerCase();
    const desc   = String(row[sheetType === 'expense' ? 7 : sheetType === 'medical' ? 8 : 6] || '').trim().toLowerCase();
    const amount = parseFloat(row[sheetType === 'expense' ? 8 : sheetType === 'medical' ? 9 : -1]) || 0;

    // Template code patterns
    const codeTemplatePatterns = /^(asil\/spl-xxx|xxx|example|sample|emp|employee|code|your code|enter|fill|abc)$/i;
    if (codeTemplatePatterns.test(code)) return true;

    // Template name patterns
    const nameTemplatePatterns = /^(employee name|name here|your name|emp name|name|enter name|example|sample|full name|first last|john doe|xyz|abc)$/i;
    if (nameTemplatePatterns.test(name)) return true;

    // Template description patterns
    const descTemplatePatterns = /(example|sample|type here|enter here|as above|fill in|description here|your description|e\.g\.|eg\.|for example)/i;
    if (descTemplatePatterns.test(desc)) return true;

    // Amount = exactly 0 with template-like code
    if (amount === 0 && code.length < 4) return true;

    return false;
}

// ── Detect claim month from date column values ────────────────────────────────
// Strategy (in priority order):
//   1. Excel serial numbers → decode directly (unambiguous, no guessing)
//   2. Text date strings → find which segment (A or B) is CONSTANT = month
//      Days always vary (1–31), the month stays the same throughout one file
//   3. If still ambiguous → AI cross-check with context "expect previous month"
//   4. Multi-month: if dates span more than one month → flag for hard rejection
//
// Returns: { month, year, fmt, confident, multiMonth?, months?, source }
function detectClaimMonth(rawDateValues, emailReceivedAt) {
    const now = emailReceivedAt ? new Date(emailReceivedAt) : new Date();
    // 95% of submissions are for the previous calendar month
    const expectedMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // previous month (1-indexed)
    const expectedYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

    // ── Priority 1: Excel serial numbers ────────────────────────────────────
    // When dates are stored as Excel serial numbers, decoding is unambiguous.
    const serials    = rawDateValues.filter(r => typeof r === 'number' && r > 1000);
    const nonSerials = rawDateValues.filter(r => r != null && r !== '' && !(typeof r === 'number' && r > 1000));

    if (serials.length > 0 && nonSerials.length === 0) {
        const decoded = serials.map(r => {
            const d = new Date(new Date(1899, 11, 30).getTime() + r * 86400000);
            return isNaN(d) ? null : { month: d.getMonth() + 1, year: d.getFullYear() };
        }).filter(Boolean);

        const monthCounts = {};
        for (const { month, year } of decoded) {
            const key = `${year}-${month}`;
            monthCounts[key] = (monthCounts[key] || 0) + 1;
        }
        const keys = Object.keys(monthCounts);
        if (keys.length > 1) {
            return { month: null, year: null, fmt: 'DD-MM-YYYY', confident: true, multiMonth: true, months: keys, source: 'serial-multi' };
        }
        if (keys.length === 1) {
            const [y, m] = keys[0].split('-').map(Number);
            console.log(`[Wafi Claims] Date detect: Excel serials -> month=${m}/${y} (unambiguous)`);
            return { month: m, year: y, fmt: 'DD-MM-YYYY', confident: true, source: 'serial' };
        }
    }

    // ── Priority 2: Text date strings — constant-segment analysis ───────────
    // The month segment is ALWAYS constant across all rows in a single-month file.
    // The day segment ALWAYS varies. We use this to tell them apart.
    const aVals = [], bVals = [], yearVals = [];
    let mmddEvidence = 0, ddmmEvidence = 0;

    for (const raw of rawDateValues) {
        if (raw == null || raw === '' || (typeof raw === 'number' && raw > 1000)) continue;
        const s = String(raw).trim();
        const match = s.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})$/);
        if (!match) continue;
        const a = parseInt(match[1]), b = parseInt(match[2]), c = parseInt(match[3]);
        const fullYear = c < 100 ? 2000 + c : c;
        aVals.push(a); bVals.push(b); yearVals.push(fullYear);
        if (b > 12) mmddEvidence++;  // b can't be a month -> a IS the month
        if (a > 12) ddmmEvidence++;  // a can't be a month -> b IS the month
    }

    if (aVals.length >= 2) {
        const aUnique = new Set(aVals).size;
        const bUnique = new Set(bVals).size;
        const dominantYear = yearVals.length > 0 ? yearVals.sort((a,b) => b-a)[0] : expectedYear;

        // Hard numeric evidence (most reliable)
        if (ddmmEvidence > 0 && mmddEvidence === 0) {
            // A segment has values > 12 -> A is the day -> B is the month
            const uniqueMonths = [...new Set(bVals.filter(v => v >= 1 && v <= 12))];
            if (uniqueMonths.length === 1) {
                console.log(`[Wafi Claims] Date detect: A>12 evidence -> DD-MM-YYYY, month=${uniqueMonths[0]}`);
                return { month: uniqueMonths[0], year: dominantYear, fmt: 'DD-MM-YYYY', confident: true, source: 'hard-A>12' };
            }
            if (uniqueMonths.length > 1) return { month: null, year: null, fmt: 'DD-MM-YYYY', confident: true, multiMonth: true, months: uniqueMonths.map(m => `${dominantYear}-${m}`), source: 'hard-multi' };
        }
        if (mmddEvidence > 0 && ddmmEvidence === 0) {
            // B segment has values > 12 -> B is the day -> A is the month
            const uniqueMonths = [...new Set(aVals.filter(v => v >= 1 && v <= 12))];
            if (uniqueMonths.length === 1) {
                console.log(`[Wafi Claims] Date detect: B>12 evidence -> MM-DD-YYYY, month=${uniqueMonths[0]}`);
                return { month: uniqueMonths[0], year: dominantYear, fmt: 'MM-DD-YYYY', confident: true, source: 'hard-B>12' };
            }
            if (uniqueMonths.length > 1) return { month: null, year: null, fmt: 'MM-DD-YYYY', confident: true, multiMonth: true, months: uniqueMonths.map(m => `${dominantYear}-${m}`), source: 'hard-multi' };
        }

        // Constant-segment analysis: the constant segment = month
        if (aUnique === 1 && bUnique > 1 && aVals[0] >= 1 && aVals[0] <= 12) {
            console.log(`[Wafi Claims] Date detect: A-constant (${aVals[0]}) -> MM-DD-YYYY, month=${aVals[0]}/${dominantYear}`);
            return { month: aVals[0], year: dominantYear, fmt: 'MM-DD-YYYY', confident: true, source: 'constant-A' };
        }
        if (bUnique === 1 && aUnique > 1 && bVals[0] >= 1 && bVals[0] <= 12) {
            console.log(`[Wafi Claims] Date detect: B-constant (${bVals[0]}) -> DD-MM-YYYY, month=${bVals[0]}/${dominantYear}`);
            return { month: bVals[0], year: dominantYear, fmt: 'DD-MM-YYYY', confident: true, source: 'constant-B' };
        }
    }

    // ── Priority 3: Default to expected previous month, not confident ────────
    // Caller will invoke AI fallback when confident=false
    return { month: expectedMonth, year: expectedYear, fmt: 'DD-MM-YYYY', confident: false, source: 'default-expected' };
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
    const m1 = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
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

// Derive most common claim month from a set of items (includes _error items that have claim_date)
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

// ── Employee DB Lookup — 2-pass suffix matching ───────────────────────────────
// Pass 1a: Full normalized code match (e.g. "ASIL/SPL-023" → "asilspl023")
// Pass 1b: Suffix match — extract meaningful part after last '/' '\' separator
//          e.g. "ASIL/SPL-023" → suffix "SPL-023" → find employee whose ID ends in "SPL023"
//          This handles backslash variants, spacing, company prefix variations
// Pass 2:  Fuzzy name fallback — if code not found at all, find closest name match
//          Returns the match with a human-readable suggestion for the admin
async function lookupEmployee(pool, codeRaw, nameRaw) {
    if (!codeRaw) return null;
    const code = String(codeRaw).trim();

    // Extract the meaningful suffix (unique part after company prefix)
    const suffixMatch = code.match(/[\/\\]([A-Za-z0-9][A-Za-z0-9\-]+)$/);
    const suffix     = suffixMatch ? suffixMatch[1] : code;
    const suffixNorm = suffix.toLowerCase().replace(/[^a-z0-9]/g, '');
    const fullNorm   = code.toLowerCase().replace(/[^a-z0-9]/g, '');

    try {
        // Pass 1a: exact full-code normalized match
        const { rows: exact } = await pool.query(
            `SELECT id, name, salary, location, dept
             FROM employees
             WHERE LOWER(REGEXP_REPLACE(id, '[^a-zA-Z0-9]', '', 'g')) = $1
             LIMIT 1`,
            [fullNorm]
        );
        if (exact[0]) return { ...exact[0], matchType: 'exact', confidence: 1.0 };

        // Pass 1b: suffix match — covers "ASIL/SPL-023", "ASIL\SPL-023", "SPL-023" equally
        if (suffixNorm && suffixNorm !== fullNorm) {
            const { rows: sfx } = await pool.query(
                `SELECT id, name, salary, location, dept
                 FROM employees
                 WHERE LOWER(REGEXP_REPLACE(id, '[^a-zA-Z0-9]', '', 'g')) LIKE $1
                 LIMIT 1`,
                [`%${suffixNorm}`]
            );
            if (sfx[0]) {
                console.log(`[Wafi Claims] Matched by suffix: "${code}" -> "${sfx[0].id}"`);
                return { ...sfx[0], matchType: 'suffix', confidence: 0.95 };
            }
        }

        // Pass 2: fuzzy name fallback (only when a name column value is available)
        if (nameRaw && String(nameRaw).trim().length > 2) {
            const { rows: allEmps } = await pool.query(
                `SELECT id, name, salary, location, dept FROM employees WHERE is_active = TRUE LIMIT 500`
            );
            let best = null, bestSim = 0;
            for (const emp of allEmps) {
                const sim = tokenSimilarity(nameRaw, emp.name);
                if (sim > bestSim) { bestSim = sim; best = emp; }
            }
            if (best && bestSim >= 0.5) {
                const pct = (bestSim * 100).toFixed(0);
                return {
                    ...best,
                    matchType: 'fuzzy',
                    confidence: bestSim,
                    fuzzyNote: `Code "${code}" not found. Closest name match: "${best.name}" (ID: ${best.id}, ${pct}% name similarity) — please confirm this is correct.`,
                };
            }
        }

        return null;
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


// ── Pakistan Labour Law Compliance Engine ─────────────────────────────────────
// References: Factories Act 1934 (as amended), Industrial & Commercial Employment Ordinance 1968
//
// Rules:
//   Normal weekday (Mon–Sat): OT rate = 2X.  Max OT hours/day = 4 (total day ≤ 12h)
//   Sunday: OT rate = 2X (mandatory rest day; work on it earns double)
//   Gazetted holiday (non-Eid): OT rate = 2X statutory minimum
//   Eid-ul-Fitr / Eid-ul-Adha (3 days each): OT rate = 3X (traditional + company policy)
//   Time arithmetic: (Time From) + (Hours Worked) should approximately equal (Time To)

// Pakistan Gazetted Public Holidays for 2025 and 2026
// Islamic holidays shift yearly based on moon sighting — dates marked (M) are estimated
const PK_PUBLIC_HOLIDAYS = {
    // ── 2025 ──
    '2025-02-05': { name: 'Kashmir Solidarity Day', isEid: false },
    '2025-03-23': { name: 'Pakistan Day', isEid: false },
    '2025-03-31': { name: 'Eid-ul-Fitr Day 1 (est.)', isEid: true },
    '2025-04-01': { name: 'Eid-ul-Fitr Day 2 (est.)', isEid: true },
    '2025-04-02': { name: 'Eid-ul-Fitr Day 3 (est.)', isEid: true },
    '2025-05-01': { name: 'International Labour Day', isEid: false },
    '2025-06-06': { name: 'Eid-ul-Adha Day 1 (est.)', isEid: true },
    '2025-06-07': { name: 'Eid-ul-Adha Day 2 (est.)', isEid: true },
    '2025-06-08': { name: 'Eid-ul-Adha Day 3 (est.)', isEid: true },
    '2025-06-26': { name: 'Ashura (Muharram 10) (est.)', isEid: false },
    '2025-08-14': { name: 'Independence Day', isEid: false },
    '2025-09-05': { name: 'Eid Milad-un-Nabi (est.)', isEid: false },
    '2025-11-09': { name: 'Allama Iqbal Day', isEid: false },
    '2025-12-25': { name: 'Quaid-e-Azam Day / Christmas', isEid: false },
    // ── 2026 ──
    '2026-02-05': { name: 'Kashmir Solidarity Day', isEid: false },
    '2026-03-20': { name: 'Eid-ul-Fitr Day 1 (est.)', isEid: true },
    '2026-03-21': { name: 'Eid-ul-Fitr Day 2 (est.)', isEid: true },
    '2026-03-22': { name: 'Eid-ul-Fitr Day 3 (est.)', isEid: true },
    '2026-03-23': { name: 'Pakistan Day', isEid: false },
    '2026-05-01': { name: 'International Labour Day', isEid: false },
    '2026-05-27': { name: 'Eid-ul-Adha Day 1 (est.)', isEid: true },
    '2026-05-28': { name: 'Eid-ul-Adha Day 2 (est.)', isEid: true },
    '2026-05-29': { name: 'Eid-ul-Adha Day 3 (est.)', isEid: true },
    '2026-06-16': { name: 'Ashura (Muharram 10) (est.)', isEid: false },
    '2026-08-14': { name: 'Independence Day', isEid: false },
    '2026-08-25': { name: 'Eid Milad-un-Nabi (est.)', isEid: false },
    '2026-11-09': { name: 'Allama Iqbal Day', isEid: false },
    '2026-12-25': { name: 'Quaid-e-Azam Day / Christmas', isEid: false },
};

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function getPKDateType(date) {
    if (!date || isNaN(date)) return null;
    // Use local date components — NOT toISOString() which converts to UTC and shifts the date for PKT (+5h)
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const holiday = PK_PUBLIC_HOLIDAYS[dateStr];
    if (holiday) return { type: holiday.isEid ? 'EID' : 'HOLIDAY', name: holiday.name };
    const dow = date.getDay(); // 0=Sunday
    if (dow === 0) return { type: 'SUNDAY', name: 'Sunday' };
    return { type: 'WEEKDAY', name: WEEKDAY_NAMES[dow] };
}


// Parse a time string like "10:00 PM", "22:00", "9:30 AM" → fractional hours (0–23.9)
function parseTimeHours(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toUpperCase();
    const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (m12) {
        let h = parseInt(m12[1]), min = parseInt(m12[2]);
        if (m12[3] === 'PM' && h !== 12) h += 12;
        if (m12[3] === 'AM' && h === 12) h = 0;
        return h + min / 60;
    }
    const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m24) return parseInt(m24[1]) + parseInt(m24[2]) / 60;
    return null;
}

/**
 * checkPakistanLabourLaw
 *
 * Validates a single OT claim row against Pakistan Labour Law.
 * Returns array of { severity: 'ERROR'|'WARNING', message }
 *
 * @param {Date}   claimDate   - The date of work
 * @param {number} otHours     - Hours claimed as OT
 * @param {string} multRaw     - Multiplier string ("Single", "Double", "Triple")
 * @param {*}      timeFromRaw - Raw value from column H (Time From)
 * @param {*}      timeToRaw   - Raw value from column I (Time To)
 */
function checkPakistanLabourLaw(claimDate, otHours, multRaw, timeFromRaw, timeToRaw) {
    const violations = [];
    const dateType = getPKDateType(claimDate);
    if (!dateType) return violations;

    const mult = (multRaw || '').toLowerCase().trim();
    const dateLabel = claimDate.toLocaleDateString('en-PK', { weekday:'long', day:'2-digit', month:'short', year:'numeric' });

    // ── Rule 1: Correct OT rate for day type ──────────────────────────────
    switch (dateType.type) {
        case 'WEEKDAY':
        case 'SUNDAY':
            // Max 2X on weekdays and Sundays per Factories Act
            if (mult === 'triple') {
                violations.push({
                    severity: 'ERROR',
                    message: `Labour Law Violation — ${dateType.name} (${dateLabel}) is a regular ${dateType.type === 'SUNDAY' ? 'rest day' : 'workday'}. `
                           + `3X (Triple) overtime is NOT permissible. Maximum rate is 2X (Double). `
                           + `3X is only applicable on Eid-ul-Fitr and Eid-ul-Adha (gazetted Eid holidays).`,
                });
            }
            if (mult === 'single' && dateType.type === 'SUNDAY') {
                violations.push({
                    severity: 'ERROR',
                    message: `Labour Law Violation — ${dateLabel} is a Sunday (mandatory rest day). `
                           + `Work on Sunday must be compensated at minimum 2X (Double) rate per Pakistan Labour Law. `
                           + `Please correct to Double.`,
                });
            }
            break;
        case 'HOLIDAY':
            // Gazetted holiday: statutory minimum 2X
            if (mult === 'single') {
                violations.push({
                    severity: 'ERROR',
                    message: `Labour Law Violation — ${dateLabel} is a gazetted public holiday (${dateType.name}). `
                           + `Work on a public holiday must be compensated at minimum 2X (Double) rate. `
                           + `Please correct to Double or Triple (if company policy permits).`,
                });
            }
            if (mult === 'triple') {
                violations.push({
                    severity: 'WARNING',
                    message: `Note — ${dateLabel} is "${dateType.name}" (gazetted holiday, non-Eid). `
                           + `3X is customarily reserved for Eid holidays. Statutory minimum is 2X. `
                           + `Verify this is within company policy before approving.`,
                });
            }
            break;
        case 'EID':
            // Eid: 3X is acceptable (traditional + company policy)
            if (mult === 'single') {
                violations.push({
                    severity: 'ERROR',
                    message: `Labour Law Violation — ${dateLabel} is ${dateType.name} (Eid holiday). `
                           + `Minimum 2X (Double) required; 3X (Triple) is standard company practice on Eid.`,
                });
            }
            // 2X and 3X both acceptable on Eid — no violation
            break;
    }

    // ── Rule 2: Maximum OT hours per day ─────────────────────────────────
    // Pakistan Labour Law: total work ≤ 12 hours/day → max 4 OT hours (after 8 regular)
    // Exception: some employers allow up to 6 OT hours on holidays — treated as warning
    const isHoliday = dateType.type === 'EID' || dateType.type === 'HOLIDAY';
    const maxOtHours = isHoliday ? 6 : 4;
    if (otHours > maxOtHours) {
        violations.push({
            severity: 'WARNING',
            message: `High OT: ${otHours}h claimed on ${claimDate.toLocaleDateString('en-GB', {day:'2-digit', month:'short'})}. Max allowed is ${maxOtHours}h/day.`,
        });
    }

    // ── Rule 3: Time arithmetic check — expected OT = shift − 8h standard ───
    const tFrom = parseTimeHours(timeFromRaw);
    const tTo   = parseTimeHours(timeToRaw);
    if (tFrom !== null && tTo !== null) {
        // Handle overnight shifts (e.g. 10 PM to 1 AM)
        let totalShiftHours = tTo - tFrom;
        if (totalShiftHours < 0) totalShiftHours += 24; // overnight crossing

        // Expected OT = total shift minus standard 8-hour working day
        const STANDARD_HOURS = 8;
        const expectedOt = Math.max(0, totalShiftHours - STANDARD_HOURS);
        const discrepancyRegular = otHours - expectedOt; // e.g. 10h shift = 2h OT
        const discrepancyOTOnly = otHours - totalShiftHours; // e.g. 2h shift = 2h OT (only OT logged)

        if (Math.abs(discrepancyRegular) > 0.5 && Math.abs(discrepancyOTOnly) > 0.5) { 
            violations.push({
                severity: 'WARNING',
                message: `Time Mismatch: ${totalShiftHours.toFixed(1)} hrs shift, ${otHours} hrs OT Claimed`,
            });
        }
    }


    return violations;
}

// ── Sheet Processors ──────────────────────────────────────────────────────────
// Returns { items, errors, warnings }
// warnings = name similarity 0.5–0.79 (shown in UI but don't fail session)
// errors   = hard failures (bad code, missing hours, etc.)

async function processOvertimeSheet(pool, rows, errors, warnings, filename) {
    const items = [];
    const seenKeys = new Set();

    // Detect claim month from date values inside the file (not from filename)
    const rawDateVals = rows.slice(1).map(r => r[0]);
    const monthResult = detectClaimMonth(rawDateVals, null);
    let dateFmt = monthResult.fmt;

    // Multi-month file: hard reject — ask sender to split and resubmit
    if (monthResult.multiMonth) {
        const monthList = (monthResult.months || []).join(', ');
        errors.push({
            sheet: 'Overtime Claims', row: 0, column: 'A',
            error: `MULTI-MONTH FILE — This file contains OT claims for multiple months (${monthList}). Please split the file by month and submit one file per month. Each submission must cover a single calendar month only.`,
            value: 'MULTI_MONTH',
            hard: true,
        });
        return [];
    }

    // If detection was not confident, ask AI for clarification (last resort)
    if (!monthResult.confident) {
        console.log('[Wafi Claims] OT: month detection ambiguous — calling AI fallback');
        const aiResult = await aiAnalyzeClaimsDates(rows.slice(1), dateFmt, null, 'Overtime Claims', filename);
        if (aiResult && (aiResult.confidence === 'high' || aiResult.confidence === 'medium')) {
            dateFmt = aiResult.format || dateFmt;
        }
    }
    console.log(`[Wafi Claims] OT sheet: month=${monthResult.month}/${monthResult.year} fmt=${dateFmt} source=${monthResult.source}`);

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawCode = String(row[1] || '').trim();
        const rawName = String(row[2] || '').trim();

        if (isTotalRow(rawCode, rawName)) break;
        if (!rawCode && !rawName) continue;

        // Skip template/example rows (pre-filled by sender to show format, not actual claims)
        if (isTemplateRow(row, 'ot')) {
            warnings.push({ type: 'TEMPLATE_ROW', sheet: 'Overtime Claims', row: i + 1, note: `Row ${i + 1} in Overtime Claims appears to be a template/example row — skipped automatically.` });
            continue;
        }

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

        const emp = await lookupEmployee(pool, rawCode, rawName);
        if (!emp) {
            errors.push({
                sheet: 'Overtime Claims', row: rowNum, column: 'B',
                error: `Employee code "${rawCode}" not found in HR master. Check the unique part (e.g. SPL-023) — the company prefix (ASIL/) can be omitted.`,
                value: rawCode,
            });
            items.push({ _error: true, employee_code_raw: rawCode, tab_name: 'Overtime Claims', row_number: rowNum, claim_date: claimDate });
            continue;
        }

        // Fuzzy match: show admin a confirmation warning instead of silent acceptance
        if (emp.matchType === 'fuzzy') {
            warnings.push({ sheet: 'Overtime Claims', row: rowNum, column: 'B', warning: emp.fuzzyNote, value: rawCode });
        }

        const sim = emp.matchType === 'fuzzy' ? emp.confidence : tokenSimilarity(rawName, emp.name);
        // < 0.5 = hard name mismatch error; 0.5-0.79 = warning; >= 0.8 = fine
        if (emp.matchType !== 'fuzzy') {
            if (sim < 0.5 && rawName) {
                errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'C', error: `Name mismatch — submitted: "${rawName}", DB: "${emp.name}"`, value: rawCode });
            } else if (sim < 0.8 && rawName) {
                warnings.push({ sheet: 'Overtime Claims', row: rowNum, column: 'C', warning: `Partial name match — submitted: "${rawName}", DB: "${emp.name}" (${(sim*100).toFixed(0)}%)`, value: rawCode });
            }
        }

        // ── Pakistan Labour Law Compliance Check ─────────────────────────────
        if (claimDate && hours != null && hours > 0 && multiplierFactor != null) {
            const llViolations = checkPakistanLabourLaw(claimDate, hours, multRaw, row[7], row[8]);
            for (const v of llViolations) {
                const prefix = emp ? `[${emp.id} - ${emp.name}] ` : '';
                if (v.severity === 'ERROR') {
                    errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'K', error: `${prefix}${v.message}`, value: multRaw });
                } else {
                    warnings.push({ type: 'LABOUR_LAW', sheet: 'Overtime Claims', row: rowNum, note: `${prefix}${v.message}` });
                }
            }
        }

        // Determine day type for Labour Law display in UI ledger
        const pkDayType = claimDate ? getPKDateType(claimDate) : null;

        items.push({
            tab_name: 'Overtime Claims',
            row_number: rowNum,
            employee_id: emp.id,
            employee_code_raw: rawCode,
            employee_name_raw: rawName,
            employee_name_db: emp.name,
            name_similarity: sim,
            claim_date: claimDate,
            day_type: pkDayType ? pkDayType.type : null,       // WEEKDAY / SUNDAY / HOLIDAY / EID
            day_type_name: pkDayType ? pkDayType.name : null,  // e.g. 'Monday', 'Eid-ul-Fitr Day 1'
            ot_hours: hours,
            ot_multiplier: multRaw || null,
            ot_multiplier_factor: multiplierFactor,
            description: nature,
            location: location || emp.location || null,
            department: dept || emp.dept || null,
            line_manager: lineMgr || null,
            raw_amount: null,
            salary: parseFloat(emp.salary) || 0,
            time_from: row[7],
            time_to: row[8],
        });
    }
    return items;
}

async function processExpenseSheet(pool, rows, errors, warnings, filename) {
    const items = [];
    const seenKeys = new Set();

    // Detect template-only sheet: if ALL data rows are example rows, skip silently
    const expDataRows = rows.slice(1).filter(r => {
        const c = String(r[1] || '').trim(), n = String(r[2] || '').trim();
        return (c || n) && !isTotalRow(c, n);
    });
    if (expDataRows.length > 0 && expDataRows.every(r => isTemplateRow(r, 'expense'))) {
        console.log('[Wafi Claims] Expense sheet: all rows are template/example rows — skipping sheet');
        warnings.push({ type: 'TEMPLATE_SHEET', sheet: 'Expense Claims', note: 'Expense Claims sheet contains only template/example rows — no actual expense claims detected. Sheet skipped.' });
        return [];
    }

    // Detect claim month from date values inside the file
    const expRawDates = rows.slice(1).map(r => r[0]);
    const expMonthResult = detectClaimMonth(expRawDates, null);
    let dateFmt = expMonthResult.fmt;
    
    // If detection was not confident, ask AI for clarification
    if (!expMonthResult.confident) {
        console.log('[Wafi Claims] EXP: month detection ambiguous — calling AI fallback');
        const aiResult = await aiAnalyzeClaimsDates(rows.slice(1), dateFmt, null, 'Expense Claims', filename);
        if (aiResult && (aiResult.confidence === 'high' || aiResult.confidence === 'medium')) {
            dateFmt = aiResult.format || dateFmt;
        }
    }
    console.log(`[Wafi Claims] Expense sheet: month=${expMonthResult.month}/${expMonthResult.year} fmt=${dateFmt} source=${expMonthResult.source}`);

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

        const emp = await lookupEmployee(pool, rawCode, rawName);
        if (!emp) {
            errors.push({ sheet: 'Expense Claims', row: rowNum, column: 'B', error: `Employee code "${rawCode}" not found. Check the unique part (e.g. SPL-023) and resubmit.`, value: rawCode });
            items.push({ _error: true, employee_code_raw: rawCode, tab_name: 'Expense Claims', row_number: rowNum });
            continue;
        }
        if (emp.matchType === 'fuzzy') {
            warnings.push({ sheet: 'Expense Claims', row: rowNum, column: 'B', warning: emp.fuzzyNote, value: rawCode });
        }
        const sim = emp.matchType === 'fuzzy' ? emp.confidence : tokenSimilarity(rawName, emp.name);
        if (emp.matchType !== 'fuzzy') {
            if (sim < 0.5 && rawName) errors.push({ sheet: 'Expense Claims', row: rowNum, column: 'C', error: `Name mismatch — submitted: "${rawName}", DB: "${emp.name}"`, value: rawCode });
            else if (sim < 0.8 && rawName) warnings.push({ sheet: 'Expense Claims', row: rowNum, column: 'C', warning: `Partial name match — submitted: "${rawName}", DB: "${emp.name}" (${(sim*100).toFixed(0)}%)`, value: rawCode });
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

    // Detect template-only sheet: if ALL data rows are example rows, skip silently
    const medDataRows = rows.slice(1).filter(r => {
        const c = String(r[1] || '').trim(), n = String(r[2] || '').trim();
        return (c || n) && !isTotalRow(c, n);
    });
    if (medDataRows.length > 0 && medDataRows.every(r => isTemplateRow(r, 'medical'))) {
        console.log('[Wafi Claims] Medical sheet: all rows are template/example rows — skipping sheet');
        warnings.push({ type: 'TEMPLATE_SHEET', sheet: 'Medical & IPD Claims', note: 'Medical & IPD Claims sheet contains only template/example rows — no actual medical claims detected. Sheet skipped.' });
        return [];
    }

    // Detect claim month from date values inside the file
    const medRawDates = rows.slice(1).map(r => r[0]);
    const medMonthResult = detectClaimMonth(medRawDates, null);
    let dateFmt = medMonthResult.fmt;

    // If detection was not confident, ask AI for clarification
    if (!medMonthResult.confident) {
        console.log('[Wafi Claims] MED: month detection ambiguous — calling AI fallback');
        const aiResult = await aiAnalyzeClaimsDates(rows.slice(1), dateFmt, null, 'Medical & IPD Claims', filename);
        if (aiResult && (aiResult.confidence === 'high' || aiResult.confidence === 'medium')) {
            dateFmt = aiResult.format || dateFmt;
        }
    }
    console.log(`[Wafi Claims] Medical sheet: month=${medMonthResult.month}/${medMonthResult.year} fmt=${dateFmt} source=${medMonthResult.source}`);

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawCode = String(row[1] || '').trim();
        const rawName = String(row[2] || '').trim();

        if (isTotalRow(rawCode, rawName)) break;
        if (!rawCode && !rawName) continue;

        // Skip template/example rows (pre-filled by sender to show format, not actual claims)
        if (isTemplateRow(row, 'medical')) {
            warnings.push({ type: 'TEMPLATE_ROW', sheet: 'Medical & IPD Claims', row: i + 1, note: `Row ${i + 1} appears to be a template/example row — skipped automatically.` });
            continue;
        }

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

        const emp = await lookupEmployee(pool, rawCode, rawName);
        if (!emp) {
            errors.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'B', error: `Employee code "${rawCode}" not found. Check the unique part (e.g. SPL-023) and resubmit.`, value: rawCode });
            items.push({ _error: true, employee_code_raw: rawCode, tab_name: 'Medical & IPD Claims', row_number: rowNum });
            continue;
        }
        if (emp.matchType === 'fuzzy') {
            warnings.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'B', warning: emp.fuzzyNote, value: rawCode });
        }
        const sim = emp.matchType === 'fuzzy' ? emp.confidence : tokenSimilarity(rawName, emp.name);
        if (emp.matchType !== 'fuzzy') {
            if (sim < 0.5 && rawName) errors.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'C', error: `Name mismatch — submitted: "${rawName}", DB: "${emp.name}"`, value: rawCode });
            else if (sim < 0.8 && rawName) warnings.push({ sheet: 'Medical & IPD Claims', row: rowNum, column: 'C', warning: `Partial name match — submitted: "${rawName}", DB: "${emp.name}" (${(sim*100).toFixed(0)}%)`, value: rawCode });
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
    let claimMonth = deriveClaimMonth(allItems);

    // Fallback: derive claim month from filename if date-based derivation fails
    // (e.g. when all rows have employee code errors and no valid items exist)
    if (!claimMonth && attachmentFilename) {
        const monthMap = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
        const fn = String(attachmentFilename).toLowerCase();
        for (const [abbr, idx] of Object.entries(monthMap)) {
            if (fn.includes(abbr)) {
                const yearMatch = fn.match(/(20\d{2})/);
                const yr = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
                claimMonth = new Date(yr, idx, 1);
                console.log(`[Wafi Claims] saveSession: claim_month derived from filename "${attachmentFilename}" → ${claimMonth.toISOString().slice(0, 7)}`);
                break;
            }
        }
    }

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
                 location, department, line_manager, patient_name,
                 day_type, active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,TRUE)
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
            item.day_type || null,
        ]);
    }
    return sessionId;
}

// ── Email Templates ───────────────────────────────────────────────────────────
// ── Rejection Email — Gmail DRAFT (not auto-sent) ────────────────────────────
// Creates a Gmail draft in the sender's thread so HR can review before sending.
// HR opens Gmail Drafts, reads it, adds any notes, then clicks Send.
function buildRejectionHtml({ sessionId, filename, senderEmail, errors, warnings }) {
    const templateWarnings = (warnings || []).filter(w => w.type === 'TEMPLATE_ROW');

    const errorRows = errors.map(e => `
        <tr style="border-bottom:1px solid #fecaca;">
            <td style="padding:9px 12px;font-size:0.82rem;color:#374151;">${e.sheet || '—'}</td>
            <td style="padding:9px 12px;text-align:center;font-size:0.82rem;color:#374151;">${e.row || '—'}</td>
            <td style="padding:9px 12px;text-align:center;font-size:0.82rem;color:#374151;">${e.column || '—'}</td>
            <td style="padding:9px 12px;font-size:0.82rem;color:#dc2626;font-weight:600;">${e.error || ''}</td>
            <td style="padding:9px 12px;font-size:0.82rem;color:#6b7280;font-family:monospace;">${String(e.value || '').slice(0, 60)}</td>
        </tr>
    `).join('');

    const templateNote = templateWarnings.length > 0 ? `
        <div style="margin:16px 0;padding:12px 16px;background:#fef9ec;border-left:4px solid #f59e0b;border-radius:6px;">
            <p style="margin:0 0 4px;color:#92400e;font-weight:700;font-size:0.85rem;">ℹ Template Rows Detected &amp; Skipped</p>
            <p style="margin:0;color:#78350f;font-size:0.82rem;">${templateWarnings.map(w => w.note).join('<br>')}</p>
        </div>` : '';

    return `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:760px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#7f1d1d,#dc2626);padding:28px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.15rem;">ASIL HCM — Claims Submission Requires Correction</h1>
    <p style="color:#fca5a5;margin:6px 0 0;font-size:0.85rem;">File: ${filename || 'Attachment'} · Ref: #${sessionId}</p>
  </div>
  <div style="padding:28px 32px;">
    <!-- ✏️ Add any personalised notes here before sending -->
    <p style="color:#374151;margin:0 0 6px;font-size:0.92rem;min-height:1.4em;">&nbsp;</p>
    <p style="color:#374151;margin:0 0 20px;font-size:0.92rem;min-height:1.4em;">&nbsp;</p>
    <p style="color:#374151;margin:0 0 8px;font-size:0.92rem;">Thank you for submitting your claims. Unfortunately, we were unable to process your file <strong>${filename || 'attachment'}</strong> due to the following errors. Please review, correct, and resubmit the file as a reply to this email.</p>
    ${templateNote}
    <div style="overflow-x:auto;margin:20px 0;">
    <table style="width:100%;border-collapse:collapse;border:1px solid #fecaca;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#fef2f2;">
        <th style="padding:10px 12px;text-align:left;color:#7f1d1d;font-size:0.82rem;border-bottom:2px solid #fca5a5;">Sheet</th>
        <th style="padding:10px 12px;text-align:center;color:#7f1d1d;font-size:0.82rem;border-bottom:2px solid #fca5a5;">Row</th>
        <th style="padding:10px 12px;text-align:center;color:#7f1d1d;font-size:0.82rem;border-bottom:2px solid #fca5a5;">Col</th>
        <th style="padding:10px 12px;text-align:left;color:#7f1d1d;font-size:0.82rem;border-bottom:2px solid #fca5a5;">Error</th>
        <th style="padding:10px 12px;text-align:left;color:#7f1d1d;font-size:0.82rem;border-bottom:2px solid #fca5a5;">Value Found</th>
      </tr></thead>
      <tbody>${errorRows}</tbody>
    </table></div>
    <div style="padding:16px;background:#fef9ec;border-left:4px solid #f59e0b;border-radius:6px;margin-top:8px;">
      <p style="margin:0 0 6px;color:#92400e;font-weight:700;font-size:0.85rem;">Correction Checklist:</p>
      <ul style="margin:0;padding-left:18px;color:#78350f;font-size:0.83rem;line-height:1.9;">
        <li>ASIL Employee Codes must match HR records exactly (e.g. <code>ASIL/SPL-117/21</code>).</li>
        <li>Hours Worked (column J) must be a positive number. OT Multiplier (column K) must be Single, Double, or Triple.</li>
        <li>All amounts must be numeric — remove PKR symbols, commas, or any text.</li>
        <li>Dates must be in the correct format (DD-MM-YYYY, e.g. 14-05-2026).</li>
        <li>Do not add, remove, or rename sheet tabs or column headers.</li>
        <li>Reply to this email with the corrected file attached — no need to send a new email.</li>
      </ul>
    </div>
    <p style="color:#374151;margin:20px 0 4px;font-size:0.88rem;">Regards,<br><strong>ASIL HR Team</strong></p>
  </div>
  <div style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.75rem;margin:0;">Allied Services International (Pvt.) Ltd. · ASIL HCM · ${new Date().getFullYear()}</p>
  </div>
</div></body></html>`;
}

async function createRejectionDraft(gmail, threadId, senderEmail, subject, sessionId, filename, errors, warnings) {
    try {
        const html = buildRejectionHtml({ sessionId, filename, senderEmail, errors, warnings });
        const draftId = await createGmailDraft(gmail, threadId, senderEmail, subject, html);
        if (draftId) {
            console.log(`[Wafi Claims] Rejection draft created for session ${sessionId} (thread ${threadId})`);
        }
        return draftId;
    } catch (e) {
        console.warn('[Wafi Claims] Rejection draft warning:', e.message);
        return null;
    }
}

// ── Line Manager Email Matching ─────────────────────────────────────────────
// Extracts unique line manager names from processed items, then fuzzy-matches
// each name to the @wafi-energy.com addresses from the email's CC list.
// Format assumed: first.last@wafi-energy.com or firstname.lastname@wafi-energy.com
function matchLineManagerEmails(items, ccWafiEmails) {
    if (!ccWafiEmails || ccWafiEmails.length === 0) return [];
    const matched = new Set();
    const managerNames = [...new Set((items || []).map(i => i.line_manager).filter(Boolean))];

    for (const managerName of managerNames) {
        let bestEmail = null;
        let bestScore = 0;
        const cleanName = String(managerName).toLowerCase().replace(/[^a-z ]/g, '');

        for (const email of ccWafiEmails) {
            // Convert email local part to name: 'ahmed.khan' -> 'ahmed khan'
            const localPart = email.split('@')[0].replace(/[._-]/g, ' ').toLowerCase();
            const score = tokenSimilarity(cleanName, localPart);
            if (score > bestScore) { bestScore = score; bestEmail = email; }
        }
        // Accept match if similarity > 40% (handles abbreviated names like 'A. Khan' vs 'ahmed.khan')
        if (bestScore >= 0.4 && bestEmail) {
            matched.add(bestEmail);
            console.log(`[Wafi Claims] Line manager "${managerName}" matched to ${bestEmail} (score: ${(bestScore*100).toFixed(0)}%)`);
        }
    }
    return [...matched];
}

// ── Verification Draft (PENDING_REVIEW with warnings) ─────────────────────────────
// Created when claims are accepted but have warnings that need sender confirmation.
// Sent to the original submitter, CC'ing any matched line managers from the CC list.
function buildVerificationHtml({ sessionId, filename, warnings }) {
    const timeMismatches = (warnings || []).filter(w => (w.warning || w.note || '').includes('Time mismatch'));
    const highOt         = (warnings || []).filter(w => (w.warning || w.note || '').includes('High OT'));
    const labourLaw      = (warnings || []).filter(w => (w.warning || w.note || '').includes('customarily reserved') || (w.warning || w.note || '').toLowerCase().includes('3x is customarily'));

    const buildRows = (list) => list.map(w => `
        <tr style="border-bottom:1px solid #fef3c7;">
            <td style="padding:9px 12px;font-size:0.82rem;color:#374151;">${w.sheet || 'Overtime Claims'}</td>
            <td style="padding:9px 12px;text-align:center;font-size:0.82rem;color:#374151;">${w.row || '—'}</td>
            <td style="padding:9px 12px;font-size:0.82rem;color:#92400e;">${w.warning || w.note || ''}</td>
        </tr>`).join('');

    const timeMismatchSection = timeMismatches.length > 0 ? `
        <div style="margin:20px 0;">
            <p style="color:#92400e;font-weight:700;font-size:0.9rem;margin:0 0 10px;">⏱ Time In/Out Does Not Match Claimed OT Hours</p>
            <p style="color:#78350f;font-size:0.83rem;margin:0 0 12px;">
                The times recorded in your file suggest a different number of overtime hours than what was claimed.
                Please confirm with your line manager whether the claimed hours are correct, or provide a corrected file.
            </p>
            <table style="width:100%;border-collapse:collapse;border:1px solid #fde68a;border-radius:6px;overflow:hidden;">
                <thead><tr style="background:#fef9ec;">
                    <th style="padding:9px 12px;text-align:left;color:#78350f;font-size:0.78rem;">Sheet</th>
                    <th style="padding:9px 12px;text-align:center;color:#78350f;font-size:0.78rem;">Row</th>
                    <th style="padding:9px 12px;text-align:left;color:#78350f;font-size:0.78rem;">Discrepancy</th>
                </tr></thead>
                <tbody>${buildRows(timeMismatches)}</tbody>
            </table>
        </div>` : '';

    const highOtSection = highOt.length > 0 ? `
        <div style="margin:20px 0;">
            <p style="color:#92400e;font-weight:700;font-size:0.9rem;margin:0 0 10px;">⚠ High OT Hours — Line Manager Sign-Off Required</p>
            <p style="color:#78350f;font-size:0.83rem;margin:0 0 12px;">
                Pakistan Labour Law generally caps overtime at 4 hours per day. The following rows exceed this threshold
                and require written confirmation from the line manager before they can be approved.
            </p>
            <table style="width:100%;border-collapse:collapse;border:1px solid #fde68a;border-radius:6px;overflow:hidden;">
                <thead><tr style="background:#fef9ec;">
                    <th style="padding:9px 12px;text-align:left;color:#78350f;font-size:0.78rem;">Sheet</th>
                    <th style="padding:9px 12px;text-align:center;color:#78350f;font-size:0.78rem;">Row</th>
                    <th style="padding:9px 12px;text-align:left;color:#78350f;font-size:0.78rem;">Note</th>
                </tr></thead>
                <tbody>${buildRows(highOt)}</tbody>
            </table>
        </div>` : '';

    const labourLawSection = labourLaw.length > 0 ? `
        <div style="margin:20px 0;padding:14px 18px;background:#fef9ec;border-left:4px solid #f59e0b;border-radius:6px;">
            <p style="color:#92400e;font-weight:700;font-size:0.9rem;margin:0 0 6px;">📋 OT Rate Notice</p>
            <p style="color:#78350f;font-size:0.83rem;margin:0;">${labourLaw.map(w => w.warning || w.note).join('<br>')}</p>
        </div>` : '';

    return `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#fffbeb;padding:20px;">
<div style="max-width:740px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#92400e,#f59e0b);padding:26px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.1rem;">ASIL HCM &mdash; Claims Received: Verification Required</h1>
    <p style="color:#fef3c7;margin:6px 0 0;font-size:0.85rem;">File: ${filename || 'Attachment'} &middot; Ref: #${sessionId}</p>
  </div>
  <div style="padding:28px 32px;">
    <!-- ✏️ Add any personalised notes here before sending -->
    <p style="color:#374151;margin:0 0 6px;font-size:0.92rem;min-height:1.4em;">&nbsp;</p>
    <p style="color:#374151;margin:0 0 16px;font-size:0.92rem;">
        Thank you for submitting your claims. Your file <strong>${filename || 'attachment'}</strong> has been received
        and the entries have been logged in our system. However, we noticed the following items that require your
        confirmation before they can be approved for payroll processing:
    </p>
    ${timeMismatchSection}
    ${highOtSection}
    ${labourLawSection}
    <div style="padding:16px;background:#f0fdf4;border-left:4px solid #16a34a;border-radius:6px;margin-top:20px;">
        <p style="margin:0 0 6px;color:#14532d;font-weight:700;font-size:0.85rem;">How to Respond:</p>
        <ul style="margin:0;padding-left:18px;color:#166534;font-size:0.83rem;line-height:2;">
            <li>If the OT hours are correct: reply with <strong>"Confirmed — [Line Manager Name]"</strong></li>
            <li>If the hours need correction: reply with a corrected file attached</li>
            <li>Your line manager has been copied on this email for their awareness</li>
        </ul>
    </div>
    <p style="color:#374151;margin:20px 0 4px;font-size:0.88rem;">Regards,<br><strong>ASIL HR Team</strong></p>
  </div>
  <div style="background:#fffbeb;padding:14px 32px;border-top:1px solid #fde68a;">
    <p style="color:#d97706;font-size:0.75rem;margin:0;">Allied Services International (Pvt.) Ltd. &middot; ASIL HCM &middot; ${new Date().getFullYear()}</p>
  </div>
</div></body></html>`;
}

async function createVerificationDraft(gmail, threadId, senderEmail, ccEmails, subject, sessionId, filename, warnings) {
    try {
        const html = buildVerificationHtml({ sessionId, filename, warnings });
        const draftId = await createGmailDraft(gmail, threadId, senderEmail, subject, html, ccEmails);
        if (draftId) {
            console.log(`[Wafi Claims] Verification draft created for session ${sessionId}, CC: ${ccEmails.join(', ')}`);
        }
        return draftId;
    } catch (e) {
        console.warn('[Wafi Claims] Verification draft warning:', e.message);
        return null;
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
        const reprocessable = ['WRONG_FORMAT', 'VALIDATION_FAILED', 'REJECTED', 'SKIPPED', 'IRRELEVANT', 'PENDING_REVIEW'];
        if (reprocessable.includes(existing.processing_status)) {
            await pool.query('DELETE FROM wafi_claims_items WHERE session_id = $1', [existing.id]);
            await pool.query('DELETE FROM wafi_claims_sessions WHERE id = $1', [existing.id]);
            console.log(`[Wafi Claims] Cleared old ${existing.processing_status} session ${existing.id} — reprocessing message ${msgId}`);
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

    // Extract @wafi-energy.com CC addresses (used later for line manager matching)
    const ccHeader = headers['cc'] || headers['cc '] || '';
    const ccWafiEmails = [...ccHeader.matchAll(/([a-zA-Z0-9._%+-]+@wafi-energy\.com)/gi)].map(m => m[1].toLowerCase());
    if (ccWafiEmails.length > 0) {
        console.log(`[Wafi Claims] CC Wafi emails found: ${ccWafiEmails.join(', ')}`);
    }

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

    // ── AI Email Context Analysis ────────────────────────────────────────────
    // Understand what the sender is saying: months, template rows, segregation intent.
    // Run early (before sheet processing) so it can influence multi-month decision.
    let aiEmailContext = null;
    if (attachments.length > 0) {
        const firstFilename = attachments[0]?.filename || '';
        aiEmailContext = await aiAnalyzeEmailContext(emailSummary, subject, senderEmail, firstFilename);
    }

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

    // ── Collect ALL valid Excel attachments (process each separately) ───────────
    // Each valid Excel gets its own session. Email forwarding attachments (.eml/.msg)
    // and wrong-format Excels are noted but do not block valid files in the same email.
    const validAttachments = [];
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
        if (!result) continue;           // not a readable Excel (e.g. embedded email)
        if (result.mismatch) {
            lastMismatch = { att, result };
            continue;                    // valid Excel but wrong tabs — note and try next
        }

        // Per-attachment session ID: single attachment → use msgId (backward-compatible)
        //                            multiple attachments → use msgId::filename (unique per file)
        const sessionMsgId = attachments.length > 1 ? `${msgId}::${att.filename}` : msgId;

        // Dedup check for this specific attachment
        const dup = await pool.query(
            'SELECT id, processing_status FROM wafi_claims_sessions WHERE gmail_message_id = $1 LIMIT 1',
            [sessionMsgId]
        );
        if (dup.rows.length) {
            const existing = dup.rows[0];
            // Allow reprocessing any non-staged status
            const DELETABLE = ['WRONG_FORMAT', 'VALIDATION_FAILED', 'REJECTED', 'SKIPPED', 'IRRELEVANT', 'PENDING_REVIEW'];
            if (DELETABLE.includes(existing.processing_status)) {
                await pool.query('DELETE FROM wafi_claims_items WHERE session_id = $1', [existing.id]);
                await pool.query('DELETE FROM wafi_claims_sessions WHERE id = $1', [existing.id]);
                console.log(`[Wafi Claims] Cleared old ${existing.processing_status} session for "${att.filename}" — reprocessing`);
            } else {
                console.log(`[Wafi Claims] Already processed "${att.filename}" (${existing.processing_status}) — skipping`);
                continue;
            }
        }

        validAttachments.push({ att, buf, sessionMsgId });
    }

    // ── No valid claims attachments found ───────────────────────────────────────
    if (validAttachments.length === 0) {
        if (lastMismatch) {
            // Excel found but wrong tab names
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
            console.log(`[Wafi Claims] No valid claims Excel in ${msgId} — logging as IRRELEVANT`);
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

    console.log(`[Wafi Claims] Processing ${validAttachments.length} valid Excel file(s) from message ${msgId}`);

    // ── Process each valid attachment as its own session ────────────────────────
    for (const { att, buf, sessionMsgId } of validAttachments) {
        // Parse result was already validated above
        const parseResult = parseWafiExcel(buf, att.filename);
        if (!parseResult || parseResult.mismatch) continue; // safety

    const errors = [];
    const warnings = [];

    const { wb, otSheet, expSheet, medSheet } = parseResult;
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

    // ── Multi-month detection → auto-segregate or reject ─────────────────────
    const monthsFound = new Set();
    for (const item of allItems) {
        if (item.claim_date) {
            const d = item.claim_date instanceof Date ? item.claim_date : new Date(item.claim_date);
            if (!isNaN(d)) monthsFound.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
        }
    }

    // ── Multi-month check: one file must cover exactly one calendar month ────────────────
    // The correct approach for multi-month is to send separate files per month.
    // When multiple Excels are attached to one email, this is handled by processing
    // each attachment independently (see the loop in processOneMessage).
    if (monthsFound.size > 1) {
        const monthLabels = [...monthsFound].sort().map(m => {
            const [y, mo] = m.split('-');
            return new Date(parseInt(y), parseInt(mo)-1, 1).toLocaleString('en-PK', { month:'long', year:'numeric' });
        });
        errors.push({
            sheet: 'All Sheets', row: '-', column: 'Date',
            error: `This file contains claims for ${monthsFound.size} different months: ${monthLabels.join(' and ')}. ` +
                   `Please submit a separate Excel file for each month and attach both to your reply.`,
            value: monthLabels.join(', '),
        });
        console.log(`[Wafi Claims] Multi-month file "${att.filename}": ${monthLabels.join(', ')} — adding error`);
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
            gmailMessageId: sessionMsgId,  // per-attachment unique ID
            gmailThreadId: threadId,
            attachmentFilename: att.filename,
            processingStatus: status,
            validationErrors: errors,
            nameWarnings: warnings,
            otRows: otItems, expenseRows: expItems, medicalRows: medItems,
            isRevision, supersedesSessionId,
            emailSummary, isFirstTimeSender,
        });
        console.log(`[Wafi Claims] Session ${sessionId} saved for "${att.filename}" (${status})`);
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

    // ── Rejection draft (VALIDATION_FAILED) ────────────────────────────────────────
    // Creates a Gmail draft in the sender's thread. HR reviews and sends manually.
    if (hasErrors && gmail && threadId) {
        try {
            const draftId = await createRejectionDraft(gmail, threadId, senderEmail, subject, sessionId, att.filename, errors, warnings);
            if (draftId) {
                await pool.query('UPDATE wafi_claims_sessions SET qc_email_sent=TRUE WHERE id=$1', [sessionId]);
            }
        } catch (e) { console.warn('[Wafi Claims] Rejection draft warning:', e.message); }
    }

    // ── Verification draft (PENDING_REVIEW with time/OT warnings) ──────────────────────
    // When claims are accepted but have discrepancies, draft a verification email asking
    // Wafi to confirm — CC'ing the matched line manager from the email's CC list.
    if (!hasErrors && warnings.length > 0 && gmail && threadId) {
        const verifyWarnings = warnings.filter(w => {
            const text = (w.warning || w.note || '').toLowerCase();
            return text.includes('time mismatch') || text.includes('high ot') ||
                   text.includes('customarily reserved') || text.includes('3x is customarily');
        });
        if (verifyWarnings.length > 0) {
            try {
                const allItems = [...(otItems || []), ...(expItems || []), ...(medItems || [])];
                const lineManagerEmails = matchLineManagerEmails(allItems, ccWafiEmails);
                const draftId = await createVerificationDraft(
                    gmail, threadId, senderEmail, lineManagerEmails,
                    subject, sessionId, att.filename, verifyWarnings
                );
                if (draftId) {
                    await pool.query('UPDATE wafi_claims_sessions SET qc_email_sent=TRUE WHERE id=$1', [sessionId]);
                    console.log(`[Wafi Claims] Verification draft — ${verifyWarnings.length} warning(s), ${lineManagerEmails.length} manager(s) CC'd`);
                }
            } catch (e) { console.warn('[Wafi Claims] Verification draft error:', e.message); }
        }
    }


    } // end per-attachment loop

    // Mark email as read once all attachments have been processed
    await markAsRead(gmail, msgId);
} // end processOneMessage

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

        // Pick up: unread emails from Wafi domain not yet successfully processed.
        // We exclude ONLY the 'passed' labels — Validation-Failed / Rejected emails
        // can be picked up again when marked unread (e.g. via the Reprocess button).
        const q = `from:@${SENDER_DOMAIN} to:(${CLAIMS_EMAIL} OR ${GMAIL_USER}) has:attachment is:unread -label:Claims/Processed-Successfully -label:Claims/Pending-Review`;
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
        `SELECT id, gmail_message_id, gmail_thread_id, processing_status, pushed_to_payroll FROM wafi_claims_sessions WHERE id = $1`,
        [sessionId]
    );
    if (!rows.length) throw new Error(`Session ${sessionId} not found`);
    const session = rows[0];

    const REPROCESSABLE = ['IRRELEVANT', 'WRONG_FORMAT', 'VALIDATION_FAILED', 'SKIPPED', 'REJECTED', 'PENDING_REVIEW'];
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

    const msgId     = session.gmail_message_id;
    const threadId  = session.gmail_thread_id;

    // Delete items first (FK constraint), then session record
    await pool.query('DELETE FROM wafi_claims_items WHERE session_id = $1', [sessionId]);
    await pool.query('DELETE FROM wafi_claims_sessions WHERE id = $1', [sessionId]);
    console.log(`[Wafi Claims] Reprocess: deleted session ${sessionId} and its items (${session.processing_status})`);

    // Queue message(s) for direct reprocessing on next poll (bypasses label filter).
    // Also look up the thread to find any reply messages (e.g. corrected resubmissions).
    const gmail = createGmailClient();
    const msgsToQueue = new Set(msgId ? [msgId] : []);

    if (gmail && threadId) {
        try {
            const { data: thread } = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'minimal' });
            if (thread.messages) {
                for (const m of thread.messages) {
                    msgsToQueue.add(m.id);
                }
            }
            console.log(`[Wafi Claims] Reprocess: found ${msgsToQueue.size} message(s) in thread ${threadId} to re-queue`);
        } catch (e) {
            console.warn(`[Wafi Claims] Reprocess: could not fetch thread ${threadId}:`, e.message);
        }
    }

    if (msgsToQueue.size > 0) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS wafi_claims_reprocess_queue (
                    gmail_message_id TEXT PRIMARY KEY,
                    queued_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            for (const qMsgId of msgsToQueue) {
                await pool.query(
                    `INSERT INTO wafi_claims_reprocess_queue (gmail_message_id)
                     VALUES ($1) ON CONFLICT (gmail_message_id) DO UPDATE SET queued_at = NOW()`,
                    [qMsgId]
                );
            }
            console.log(`[Wafi Claims] Reprocess: queued ${msgsToQueue.size} message(s) — will process on next poll`);
        } catch (e) {
            console.warn(`[Wafi Claims] Reprocess queue warning (non-fatal):`, e.message);
        }
    }

    return { success: true, sessionId, previousStatus: session.processing_status, msgId, threadId, queuedMessages: msgsToQueue.size, note: 'Run Poll Now to reprocess.' };
}

// ── Upload Fix logic ────────────────────────────────────────────────────────
async function processUploadedFix(pool, buffer, sessionId, senderEmail, filename) {
    const parseResult = parseWafiExcel(buffer, filename);
    if (!parseResult || parseResult.mismatch) return { success: false, error: 'Invalid Excel template structure' };

    const errors = [];
    const warnings = [];

    const { wb, otSheet, expSheet, medSheet } = parseResult;
    const otRawRows  = getSheetRows(wb, otSheet);
    const expRawRows = getSheetRows(wb, expSheet);
    const medRawRows = getSheetRows(wb, medSheet);

    const otItems  = await processOvertimeSheet(pool, otRawRows, errors, warnings, filename);
    const expItems = await processExpenseSheet(pool, expRawRows, errors, warnings, filename);
    const medItems = await processMedicalSheet(pool, medRawRows, errors, warnings, filename);

    const allItems   = [...otItems, ...expItems, ...medItems];
    const validItems = allItems.filter(r => !r._error);

    const hasErrors = errors.length > 0;
    const status = hasErrors ? 'VALIDATION_FAILED' : 'PENDING_REVIEW';

    const otCount  = otItems.filter(r => !r._error).length;
    const expCount = expItems.filter(r => !r._error).length;
    const medCount = medItems.filter(r => !r._error).length;

    // Replace items
    await pool.query('DELETE FROM wafi_claims_items WHERE session_id = $1', [sessionId]);

    await pool.query(`
        UPDATE wafi_claims_sessions
        SET processing_status = $1, validation_errors = $2::jsonb, name_warnings = $3::jsonb,
            total_ot_rows = $4, total_expense_rows = $5, total_medical_rows = $6, attachment_filename = $7
        WHERE id = $8
    `, [status, JSON.stringify(errors), JSON.stringify(warnings), otCount, expCount, medCount, filename, sessionId]);

    for (const r of allItems) {
        await pool.query(`
            INSERT INTO wafi_claims_items
                (session_id, employee_id, employee_name_db, location, department, claim_type, expense_type,
                 description, raw_amount, claim_date, ot_hours, ot_multiplier, time_from, time_to,
                 line_manager, wbs_cost_center, raw_row_data, has_error, error_msg)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        `, [
            sessionId, r.employee_id, r.employee_name_db, r.location, r.department,
            r.claim_type, r.expense_type, r.description, r.raw_amount, r.claim_date,
            r.ot_hours, r.ot_multiplier, r.time_from, r.time_to,
            r.line_manager, r.wbs_cost_center, r.raw_row_data,
            !!r._error, r._error || r.note
        ]);
    }

    return { success: true };
}

module.exports = {
    startWafiClaimsService,
    triggerWafiManualPoll,
    getLastPollAt,
    createGmailClient,
    buildConfirmationHtml,
    createGmailDraft,
    reprocessSession,
    // Exported for server.js manual-trigger endpoints
    createGmailClientExported:          createGmailClient,
    matchLineManagerEmailsExported:     matchLineManagerEmails,
    createVerificationDraftExported:    createVerificationDraft,
    downloadAttachmentFromGmailExported: downloadAttachmentFromGmail,
    processUploadedFixExported:         processUploadedFix,
};
