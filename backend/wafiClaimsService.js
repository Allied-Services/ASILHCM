'use strict';

/**
 * wafiClaimsService.js — Wafi Claims Ingestion Engine (ASIL HCM)
 *
 * Polls Gmail via OAuth2 for unread claim emails from wafi-energy.com,
 * parses Excel attachments against the 3-sheet Wafi template,
 * validates all rows, stores results in wafi_claims_sessions + wafi_claims_items,
 * and sends QC/success/revision notification emails via Resend.
 */

const { google }  = require('googleapis');
const XLSX        = require('xlsx');
const { Resend }  = require('resend');

// ── Config ────────────────────────────────────────────────────────────────────
const GMAIL_USER          = process.env.GMAIL_USER          || 'ops-support@asil.com.pk';
const CLAIMS_EMAIL        = process.env.CLAIMS_EMAIL         || 'claims@asil.com.pk'; // alias to monitor
const GMAIL_CLIENT_ID     = process.env.GMAIL_CLIENT_ID     || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || '';
const SENDER_DOMAIN       = (process.env.CLAIMS_SENDER_DOMAIN || 'wafi-energy.com').toLowerCase();
const EMAILS_ENABLED      = (process.env.EMAILS_ENABLED || 'false') === 'true';
const EMAIL_FROM          = process.env.SMTP_FROM || 'ASIL HR <hr@asil.com.pk>';
const POLL_INTERVAL_MS    = parseInt(process.env.WAFI_POLL_INTERVAL_MS) || 5 * 60 * 1000; // 5 minutes

const resend = new Resend(process.env.RESEND_API_KEY || '');

// Required sheet names in exact order
// Sheet names from the ASIL Consolidated Master Claims Template
// Tab 1 is named 'Overtime Claims' (rename from default 'Sheet' in the template)
// If the focal point sends a file where the first tab is still 'Sheet', we accept both
const REQUIRED_SHEETS         = ['Overtime Claims', 'Expense Claims', 'Medical & IPD Claims'];
const REQUIRED_SHEETS_LEGACY  = ['Sheet',           'Expense Claims', 'Medical & IPD Claims'];

// OT multiplier mapping
const OT_MULTIPLIER_MAP = { 'single': 1.0, 'double': 2.0, 'triple': 3.0 };

// Last poll timestamp for status endpoint
let _lastPollAt = null;

// ── Gmail OAuth2 Client ────────────────────────────────────────────────────────
function createGmailClient() {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        return null;
    }
    const auth = new google.auth.OAuth2(
        GMAIL_CLIENT_ID,
        GMAIL_CLIENT_SECRET,
        'urn:ietf:wg:oauth:2.0:oob'
    );
    auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
    return google.gmail({ version: 'v1', auth });
}

// ── Required Label Management ─────────────────────────────────────────────────
const LABEL_NAMES = [
    'Claims/In-Progress',
    'Claims/Validation-Failed',
    'Claims/Processed-Successfully',
];
const _labelCache = {}; // name → id

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

async function applyLabel(gmail, messageId, labelName) {
    const labelId = _labelCache[labelName];
    if (!labelId) return;
    try {
        await gmail.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: {
                addLabelIds: [labelId],
                removeLabelIds: ['UNREAD'],
            },
        });
    } catch (e) {
        console.warn(`[Wafi Claims] Apply label warning (${labelName}):`, e.message);
    }
}

async function markAsRead(gmail, messageId) {
    try {
        await gmail.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: { removeLabelIds: ['UNREAD'] },
        });
    } catch (e) {
        console.warn('[Wafi Claims] markAsRead warning:', e.message);
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

// Parse DD-MM-YYYY or Excel date serial into JS Date
function parseDate(raw) {
    if (raw == null || raw === '') return null;
    // Excel serial date
    if (typeof raw === 'number') {
        const excelEpoch = new Date(1899, 11, 30);
        const d = new Date(excelEpoch.getTime() + raw * 86400000);
        return isNaN(d) ? null : d;
    }
    const s = String(raw).trim();
    // DD-MM-YYYY
    const m1 = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
    if (m1) {
        const day = parseInt(m1[1]), month = parseInt(m1[2]) - 1, year = parseInt(m1[3]);
        const fullYear = year < 100 ? 2000 + year : year;
        const d = new Date(fullYear, month, day);
        return isNaN(d) ? null : d;
    }
    // ISO
    const d = new Date(s);
    return isNaN(d) ? null : d;
}

// Parse numeric value from cell (could be string with commas)
function parseNum(raw) {
    if (raw == null || raw === '') return null;
    const n = parseFloat(String(raw).replace(/,/g, ''));
    return isNaN(n) ? null : n;
}

// ── Employee DB Lookup ─────────────────────────────────────────────────────────
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

// ── Excel Parsing ─────────────────────────────────────────────────────────────
/**
 * Returns null if not a Wafi file (wrong sheets).
 * Returns { otRows, expenseRows, medicalRows, errors, claimMonth }
 */
/**
 * Returns null if buffer is not readable as Excel.
 * Returns { wb } if all 3 required sheets are present.
 * Returns { mismatch: true, found: [], missing: [] } if it IS an Excel but tabs don't match.
 */
function parseWafiExcel(buffer, filename) {
    let wb;
    try {
        wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });
    } catch (e) {
        console.error('[Wafi Claims] XLSX read error:', e.message);
        return null; // not a valid Excel file — silently ignore
    }

    const sheetNames = wb.SheetNames;
    const hasNew    = REQUIRED_SHEETS.every(r => sheetNames.includes(r));
    const hasLegacy = REQUIRED_SHEETS_LEGACY.every(r => sheetNames.includes(r));

    if (!hasNew && !hasLegacy) {
        // It IS an Excel file but doesn't have the 3 required tabs
        // Log which tabs are present vs missing so admin can see in dashboard
        const missingNew    = REQUIRED_SHEETS.filter(r => !sheetNames.includes(r));
        const missingLegacy = REQUIRED_SHEETS_LEGACY.filter(r => !sheetNames.includes(r));
        const missing = missingNew.length <= missingLegacy.length ? missingNew : missingLegacy;
        console.log(`[Wafi Claims] "${filename}" — wrong format. Found: [${sheetNames.join(', ')}] | Missing: [${missing.join(', ')}]`);
        return { mismatch: true, found: sheetNames, missing };
    }

    // Normalize legacy 'Sheet' tab name to 'Overtime Claims' in memory
    if (hasLegacy && !hasNew) {
        console.log(`[Wafi Claims] "${filename}" uses legacy tab name "Sheet" — normalizing to "Overtime Claims"`);
        const ws = wb.Sheets['Sheet'];
        wb.Sheets['Overtime Claims'] = ws;
        wb.SheetNames = wb.SheetNames.map(n => n === 'Sheet' ? 'Overtime Claims' : n);
        delete wb.Sheets['Sheet'];
    }

    return { wb };
}

function getSheetRows(wb, sheetName) {
    const ws = wb.Sheets[sheetName];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: '',
        blankrows: false,
        raw: false,
    });
}

// ── Sheet Processors ──────────────────────────────────────────────────────────
async function processOvertimeSheet(pool, rows, errors) {
    // Skip header row (row index 0)
    const items = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rawCode = String(row[1] || '').trim();
        const rawName = String(row[2] || '').trim();

        if (isTotalRow(rawCode, rawName)) break;
        if (!rawCode && !rawName) continue; // blank row

        const rowNum = i + 1;
        const dateRaw   = row[0];
        const dept      = String(row[3] || '').trim();
        const location  = String(row[4] || '').trim();
        const lineMgr   = String(row[5] || '').trim();
        const nature    = String(row[6] || '').trim();
        const timeFrom  = String(row[7] || '').trim();
        const timeTo    = String(row[8] || '').trim();
        const hoursRaw  = row[9];
        const multRaw   = String(row[10] || '').trim();

        // Required: employee code
        if (!rawCode) {
            errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'B', error: 'Employee code is required', value: '' });
            continue;
        }

        // Required: hours
        const hours = parseNum(hoursRaw);
        if (hours == null || hours <= 0) {
            errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'J', error: 'Hours Worked must be a positive number', value: hoursRaw });
        }

        // Required: multiplier if hours > 0
        let multiplierFactor = null;
        if (hours != null && hours > 0) {
            if (!multRaw) {
                errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'K', error: 'Overtime Multiplier is required when hours > 0', value: '' });
            } else {
                const multKey = multRaw.toLowerCase().trim();
                multiplierFactor = OT_MULTIPLIER_MAP[multKey];
                if (multiplierFactor == null) {
                    errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'K', error: 'Multiplier must be Single, Double, or Triple', value: multRaw });
                }
            }
        }

        // Lookup employee
        const emp = await lookupEmployee(pool, rawCode);
        if (!emp) {
            errors.push({ sheet: 'Overtime Claims', row: rowNum, column: 'B', error: 'Employee code not found. Please ensure all ASIL codes are correct and resubmit.', value: rawCode });
            items.push({ _error: true, employee_code_raw: rawCode, tab_name: 'Overtime Claims', row_number: rowNum });
            continue;
        }

        // Name similarity warning
        const sim = tokenSimilarity(rawName, emp.name);
        const nameWarning = sim < 0.5 ? `Name mismatch: submitted "${rawName}", DB has "${emp.name}" (similarity: ${(sim * 100).toFixed(0)}%)` : null;

        items.push({
            tab_name: 'Overtime Claims',
            row_number: rowNum,
            employee_id: emp.id,
            employee_code_raw: rawCode,
            employee_name_raw: rawName,
            employee_name_db: emp.name,
            name_similarity: sim,
            name_warning: nameWarning,
            claim_date: parseDate(dateRaw),
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

async function processExpenseSheet(pool, rows, errors) {
    const items = [];
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
        const nameWarning = sim < 0.5 ? `Name mismatch: submitted "${rawName}", DB has "${emp.name}" (similarity: ${(sim * 100).toFixed(0)}%)` : null;

        items.push({
            tab_name: 'Expense Claims',
            row_number: rowNum,
            employee_id: emp.id,
            employee_code_raw: rawCode,
            employee_name_raw: rawName,
            employee_name_db: emp.name,
            name_similarity: sim,
            name_warning: nameWarning,
            claim_date: parseDate(dateRaw),
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

async function processMedicalSheet(pool, rows, errors) {
    const items = [];
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

        const amount = parseNum(amountRaw);
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
        const nameWarning = sim < 0.5 ? `Name mismatch: submitted "${rawName}", DB has "${emp.name}" (similarity: ${(sim * 100).toFixed(0)}%)` : null;

        items.push({
            tab_name: 'Medical & IPD Claims',
            row_number: rowNum,
            employee_id: emp.id,
            employee_code_raw: rawCode,
            employee_name_raw: rawName,
            employee_name_db: emp.name,
            name_similarity: sim,
            name_warning: nameWarning,
            claim_date: parseDate(dateRaw),
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
            SELECT wci.session_id, wci.employee_id
            FROM wafi_claims_items wci
            JOIN wafi_claims_sessions wcs ON wcs.id = wci.session_id
            WHERE wci.employee_id = ANY($1::text[])
              AND wci.active = TRUE
              AND DATE_TRUNC('month', wci.claim_date) = DATE_TRUNC('month', $2::date)
              AND wcs.processing_status = 'PROCESSED_SUCCESSFULLY'
            LIMIT 1
        `, [employeeIds, claimDate.toISOString().slice(0, 10)]);

        if (!rows.length) return { revised: false, oldSessionId: null };

        const oldSessionId = rows[0].session_id;
        // Mark old items as inactive
        await pool.query(
            `UPDATE wafi_claims_items SET active = FALSE
             WHERE session_id = $1 AND employee_id = ANY($2::text[])`,
            [oldSessionId, employeeIds]
        );
        // Mark old session as revised
        await pool.query(
            `UPDATE wafi_claims_sessions SET processing_status = 'REVISED' WHERE id = $1`,
            [oldSessionId]
        );
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
        attachmentFilename, processingStatus, validationErrors,
        otRows, expenseRows, medicalRows, isRevision, supersedesSessionId,
    } = sessionData;

    // Infer claim_month from first date found in items
    let claimMonth = null;
    const allItems = [...(otRows || []), ...(expenseRows || []), ...(medicalRows || [])];
    for (const item of allItems) {
        if (item.claim_date) {
            const d = item.claim_date instanceof Date ? item.claim_date : new Date(item.claim_date);
            if (!isNaN(d)) {
                claimMonth = new Date(d.getFullYear(), d.getMonth(), 1);
                break;
            }
        }
    }

    const { rows } = await pool.query(`
        INSERT INTO wafi_claims_sessions
            (received_at, sender_email, subject, gmail_message_id, gmail_thread_id,
             attachment_filename, claim_month, processing_status, label_applied,
             validation_errors, total_ot_rows, total_expense_rows, total_medical_rows,
             is_revision, supersedes_session_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15)
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
            : processingStatus === 'VALIDATION_FAILED' ? 'Claims/Validation-Failed'
            : 'Claims/In-Progress',
        JSON.stringify(validationErrors || []),
        (otRows || []).filter(r => !r._error).length,
        (expenseRows || []).filter(r => !r._error).length,
        (medicalRows || []).filter(r => !r._error).length,
        isRevision || false,
        supersedesSessionId || null,
    ]);
    const sessionId = rows[0].id;

    // Insert items
    for (const item of allItems) {
        if (item._error) continue; // skip rows that had hard errors
        const d = item.claim_date instanceof Date ? item.claim_date : (item.claim_date ? new Date(item.claim_date) : null);
        const claimDateStr = d && !isNaN(d) ? d.toISOString().slice(0, 10) : null;

        // Compute OT payout if applicable
        let otPayout = null;
        if (item.ot_hours != null && item.ot_multiplier_factor != null && item.salary) {
            const hourlyRate = item.salary / 26 / 8;
            otPayout = parseFloat((item.ot_hours * item.ot_multiplier_factor * hourlyRate).toFixed(2));
        }

        // Determine claim_type for item
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
            sessionId,
            item.tab_name,
            item.row_number,
            item.employee_id || null,
            item.employee_code_raw || null,
            item.employee_name_raw || null,
            item.employee_name_db || null,
            item.name_similarity != null ? item.name_similarity.toFixed(3) : null,
            claimDateStr,
            claimTypeField,
            item.ot_hours || null,
            item.ot_multiplier || null,
            item.ot_multiplier_factor || null,
            otPayout,
            item.expense_type || null,
            item.description || null,
            item.raw_amount || null,
            item.location || null,
            item.department || null,
            item.line_manager || null,
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
    <p style="color:#64748b;margin:0 0 20px;font-size:0.9rem;">The following errors were found. Please correct all issues and resubmit the complete file.</p>
    <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
      <thead>
        <tr style="background:#fef2f2;">
          <th style="padding:10px;text-align:left;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Sheet</th>
          <th style="padding:10px;text-align:center;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Row</th>
          <th style="padding:10px;text-align:center;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Column</th>
          <th style="padding:10px;text-align:left;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Error</th>
          <th style="padding:10px;text-align:left;color:#7f1d1d;border-bottom:2px solid #fca5a5;">Value Found</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    </div>
    <div style="margin:24px 0 0;padding:16px;background:#fef9ec;border-left:4px solid #f59e0b;border-radius:6px;">
      <p style="margin:0 0 6px;color:#92400e;font-weight:700;font-size:0.88rem;">Submission SOP Reminders:</p>
      <ul style="margin:0;padding-left:18px;color:#78350f;font-size:0.83rem;line-height:1.8;">
        <li>All ASIL employee codes must exactly match the official HR records (format: ASIL/XXX/NNN/YY).</li>
        <li>Hours Worked must be a positive number; Overtime Multiplier is required for all OT rows.</li>
        <li>All monetary amounts must be numeric — remove PKR symbols, commas, or text.</li>
        <li>Do not modify the sheet names or column structure of the template.</li>
        <li>Once corrected, resubmit the complete file as an attachment to this email.</li>
      </ul>
    </div>
  </div>
  <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.78rem;margin:0;">Allied Services International (Pvt.) Ltd. · ASIL HCM · ${new Date().getFullYear()}</p>
  </div>
</div></body></html>`;

    try {
        await resend.emails.send({
            from: EMAIL_FROM,
            to: toEmail,
            subject: 'REJECTED: Claims Submission Fails Quality Check — Please Resubmit',
            html,
        });
        console.log(`[Wafi Claims] QC rejection email sent to ${toEmail}`);
    } catch (e) {
        console.error('[Wafi Claims] Failed to send QC rejection email:', e.message);
    }
}

async function sendRevisionAcknowledgmentEmail(toEmail, employeeNames, claimMonth) {
    if (!EMAILS_ENABLED) {
        console.log(`[Wafi Claims] [TEST MODE] Would send revision acknowledgment to ${toEmail}`);
        return;
    }
    const monthLabel = claimMonth ? new Date(claimMonth).toLocaleString('en-PK', { month: 'long', year: 'numeric' }) : 'the previous period';
    const empList = employeeNames.length ? employeeNames.join(', ') : 'the listed employees';

    const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:680px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#1e3a5f,#2d5f8a);padding:28px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.2rem;">ASIL HCM — Revision Received</h1>
  </div>
  <div style="padding:28px 32px;">
    <p style="color:#334155;">We have received your revised claims submission for <strong>${monthLabel}</strong>.</p>
    <p style="color:#334155;">The previous records for <strong>${empList}</strong> for <strong>${monthLabel}</strong> have been superseded and marked as revised in our system.</p>
    <p style="color:#334155;">Your new submission is now being processed and validated. You will receive a separate confirmation once it has been successfully logged.</p>
    <p style="color:#94a3b8;font-size:0.83rem;margin-top:20px;">If you believe this is an error, please contact HR immediately.</p>
  </div>
  <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.78rem;margin:0;">Allied Services International (Pvt.) Ltd. · ASIL HCM · ${new Date().getFullYear()}</p>
  </div>
</div></body></html>`;

    try {
        await resend.emails.send({
            from: EMAIL_FROM,
            to: toEmail,
            subject: 'UPDATE RECEIVED: Previous claims being superseded',
            html,
        });
        console.log(`[Wafi Claims] Revision acknowledgment sent to ${toEmail}`);
    } catch (e) {
        console.error('[Wafi Claims] Failed to send revision ack email:', e.message);
    }
}

async function sendSuccessConfirmationEmail(toEmail, sessionId, otCount, expenseCount, medicalCount, filename) {
    if (!EMAILS_ENABLED) {
        console.log(`[Wafi Claims] [TEST MODE] Would send success confirmation to ${toEmail} — OT:${otCount} EXP:${expenseCount} MED:${medicalCount}`);
        return;
    }
    const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:680px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#14532d,#16a34a);padding:28px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.2rem;">ASIL HCM — Claims Successfully Logged</h1>
    <p style="color:#bbf7d0;margin:6px 0 0;font-size:0.88rem;">File: ${filename || 'Attachment'} · Ref: #${sessionId}</p>
  </div>
  <div style="padding:28px 32px;">
    <h2 style="color:#14532d;margin:0 0 16px;font-size:1rem;">Your submission has been received and validated</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr style="background:#f0fdf4;"><td style="padding:10px 14px;color:#166534;font-weight:600;">Overtime Claims Logged</td><td style="padding:10px 14px;text-align:right;font-size:1.1rem;font-weight:700;color:#15803d;">${otCount} rows</td></tr>
      <tr><td style="padding:10px 14px;color:#166534;font-weight:600;">Expense Claims Logged</td><td style="padding:10px 14px;text-align:right;font-size:1.1rem;font-weight:700;color:#15803d;">${expenseCount} rows</td></tr>
      <tr style="background:#f0fdf4;"><td style="padding:10px 14px;color:#166534;font-weight:600;">Medical & IPD Claims Logged</td><td style="padding:10px 14px;text-align:right;font-size:1.1rem;font-weight:700;color:#15803d;">${medicalCount} rows</td></tr>
    </table>
    <div style="padding:14px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:6px;">
      <p style="margin:0;color:#166534;font-size:0.88rem;">These claims are now in ASIL's payroll processing queue. No further action is required from you at this stage. You will be contacted if any review is needed.</p>
    </div>
  </div>
  <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.78rem;margin:0;">Allied Services International (Pvt.) Ltd. · ASIL HCM · ${new Date().getFullYear()}</p>
  </div>
</div></body></html>`;

    try {
        await resend.emails.send({
            from: EMAIL_FROM,
            to: toEmail,
            subject: 'LOGGED: Claims Submission Received & Validated',
            html,
        });
        console.log(`[Wafi Claims] Success confirmation sent to ${toEmail}`);
    } catch (e) {
        console.error('[Wafi Claims] Failed to send success email:', e.message);
    }
}

// ── Core: Process One Gmail Message ──────────────────────────────────────────
async function processOneMessage(pool, gmail, msg) {
    const msgId = msg.id;
    const threadId = msg.threadId;

    // Check dedup
    const dup = await pool.query(
        'SELECT id FROM wafi_claims_sessions WHERE gmail_message_id = $1 LIMIT 1',
        [msgId]
    );
    if (dup.rows.length) {
        console.log(`[Wafi Claims] Duplicate message ${msgId}, skipping`);
        await markAsRead(gmail, msgId);
        return;
    }

    // Fetch full message
    let fullMsg;
    try {
        const { data } = await gmail.users.messages.get({
            userId: 'me',
            id: msgId,
            format: 'full',
        });
        fullMsg = data;
    } catch (e) {
        console.error(`[Wafi Claims] Failed to fetch message ${msgId}:`, e.message);
        return;
    }

    const headers = {};
    for (const h of (fullMsg.payload?.headers || [])) {
        headers[h.name.toLowerCase()] = h.value;
    }

    const subject    = headers.subject || '';
    const fromHeader = headers.from    || '';
    const receivedAt = fullMsg.internalDate ? new Date(parseInt(fullMsg.internalDate)) : new Date();

    // Extract sender email address
    const senderMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s<>]+@[^\s<>]+)/);
    const senderEmail = senderMatch ? senderMatch[1].toLowerCase() : fromHeader.toLowerCase();

    console.log(`[Wafi Claims] Processing: "${subject}" from ${senderEmail} (${msgId})`);
    // NOTE: No label applied yet — only PROCESSED_SUCCESSFULLY emails get a label

    // Find XLSX attachments
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

    if (!attachments.length) {
        // No Excel attachment — silently ignore (could be a general email)
        console.log(`[Wafi Claims] No XLSX attachment in message ${msgId} — ignoring`);
        await markAsRead(gmail, msgId);
        return;
    }

    // Process first XLSX attachment
    const att = attachments[0];
    let attBuffer;
    try {
        const { data: attData } = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: msgId,
            id: att.attachmentId,
        });
        attBuffer = Buffer.from(attData.data, 'base64');
    } catch (e) {
        console.error(`[Wafi Claims] Failed to download attachment "${att.filename}":`, e.message);
        await markAsRead(gmail, msgId);
        return;
    }

    // Parse Excel — check content signature
    const parseResult = parseWafiExcel(attBuffer, att.filename);

    if (!parseResult) {
        // Not a valid Excel file at all — silently ignore
        console.log(`[Wafi Claims] "${att.filename}" is not a readable Excel file — ignoring`);
        await markAsRead(gmail, msgId);
        return;
    }

    if (parseResult.mismatch) {
        // It IS an Excel file but missing required tabs — log to DB as WRONG_FORMAT so admin can see
        console.log(`[Wafi Claims] "${att.filename}" logged as WRONG_FORMAT — missing tabs: ${parseResult.missing.join(', ')}`);
        const mismatchError = [{
            sheet: 'Template Structure',
            row: '-',
            column: '-',
            error: `Wrong template format. Required tabs not found.`,
            value: `Found: [${parseResult.found.join(', ')}] | Missing: [${parseResult.missing.join(', ')}]`,
        }];
        try {
            await pool.query(`
                INSERT INTO wafi_claims_sessions
                    (received_at, sender_email, subject, gmail_message_id, gmail_thread_id,
                     attachment_filename, processing_status, validation_errors,
                     total_ot_rows, total_expense_rows, total_medical_rows)
                VALUES ($1,$2,$3,$4,$5,$6,'WRONG_FORMAT',$7::jsonb,0,0,0)
                ON CONFLICT (gmail_message_id) DO NOTHING
            `, [receivedAt, senderEmail, subject, msgId, threadId, att.filename, JSON.stringify(mismatchError)]);
        } catch (e) {
            console.warn('[Wafi Claims] Failed to save WRONG_FORMAT session:', e.message);
        }
        await markAsRead(gmail, msgId);
        return;
    }

    const { wb } = parseResult;
    const errors = [];

    // Process each sheet
    const otRawRows    = getSheetRows(wb, 'Overtime Claims');
    const expRawRows   = getSheetRows(wb, 'Expense Claims');
    const medRawRows   = getSheetRows(wb, 'Medical & IPD Claims');

    const [otItems, expItems, medItems] = await Promise.all([
        processOvertimeSheet(pool, otRawRows, errors),
        processExpenseSheet(pool, expRawRows, errors),
        processMedicalSheet(pool, medRawRows, errors),
    ]);

    const allItems     = [...otItems, ...expItems, ...medItems];
    const validItems   = allItems.filter(r => !r._error);
    const hasErrors    = errors.length > 0;
    const status       = hasErrors ? 'VALIDATION_FAILED' : 'PROCESSED_SUCCESSFULLY';

    console.log(`[Wafi Claims] "${att.filename}": ${validItems.length} valid rows, ${errors.length} errors → ${status}`);

    // Revision detection (only if passing)
    let isRevision = false;
    let supersedesSessionId = null;
    if (!hasErrors && validItems.length) {
        const employeeIds = [...new Set(validItems.map(r => r.employee_id).filter(Boolean))];
        const firstDate   = validItems.find(r => r.claim_date)?.claim_date;
        if (employeeIds.length && firstDate) {
            const revResult = await detectAndMarkRevisions(pool, employeeIds, firstDate);
            isRevision         = revResult.revised;
            supersedesSessionId = revResult.oldSessionId;
        }
    }

    // Save to DB
    let sessionId;
    try {
        sessionId = await saveSession(pool, {
            receivedAt,
            senderEmail,
            subject,
            gmailMessageId: msgId,
            gmailThreadId: threadId,
            attachmentFilename: att.filename,
            processingStatus: status,
            validationErrors: errors,
            otRows: otItems,
            expenseRows: expItems,
            medicalRows: medItems,
            isRevision,
            supersedesSessionId,
        });
        console.log(`[Wafi Claims] Session ${sessionId} saved`);
    } catch (e) {
        console.error('[Wafi Claims] Failed to save session:', e.message);
        await markAsRead(gmail, msgId);
        return;
    }

    // Apply Gmail label ONLY on successful processing
    if (status === 'PROCESSED_SUCCESSFULLY') {
        await applyLabel(gmail, msgId, 'Claims/Processed-Successfully');
    }
    // VALIDATION_FAILED and other statuses get NO label — admin sees them in dashboard only

    // Update session with email send status
    try {
        if (hasErrors) {
            await sendQCRejectionEmail(senderEmail, errors, att.filename);
            await pool.query('UPDATE wafi_claims_sessions SET qc_email_sent=TRUE WHERE id=$1', [sessionId]);
        } else {
            if (isRevision) {
                const empNames = validItems.map(r => r.employee_name_db || r.employee_name_raw).filter(Boolean);
                const firstDate = validItems.find(r => r.claim_date)?.claim_date;
                await sendRevisionAcknowledgmentEmail(senderEmail, [...new Set(empNames)], firstDate);
            }
            await sendSuccessConfirmationEmail(
                senderEmail,
                sessionId,
                otItems.filter(r => !r._error).length,
                expItems.filter(r => !r._error).length,
                medItems.filter(r => !r._error).length,
                att.filename
            );
            await pool.query('UPDATE wafi_claims_sessions SET confirm_email_sent=TRUE WHERE id=$1', [sessionId]);
        }
    } catch (e) {
        console.warn('[Wafi Claims] Email send warning:', e.message);
    }

    await markAsRead(gmail, msgId);
}

// ── Main Poll ─────────────────────────────────────────────────────────────────
async function pollGmail(pool) {
    const gmail = createGmailClient();
    if (!gmail) {
        console.log('[Wafi Claims] Gmail not configured (missing OAuth credentials) — skipping poll');
        return { skipped: true, reason: 'Gmail OAuth credentials not configured' };
    }

    console.log(`[Wafi Claims] ═══ Poll starting — monitoring: ${CLAIMS_EMAIL} ═══`);
    _lastPollAt = new Date();
    const summary = { processed: 0, skipped: 0, errors: 0 };

    try {
        await ensureLabels(gmail);

        // FROM: wafi-energy@asil.com.pk only
        // TO: claims@asil.com.pk OR ops-support@asil.com.pk (alias + real address)
        // Both read and unread — dedup via gmail_message_id prevents reprocessing
        const q = `from:@wafi-energy.com to:(${CLAIMS_EMAIL} OR ${GMAIL_USER}) has:attachment`;
        const { data } = await gmail.users.messages.list({
            userId: 'me',
            q,
            maxResults: 100,
        });

        const messages = data.messages || [];
        console.log(`[Wafi Claims] Found ${messages.length} messages matching query: ${q}`);

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

// ── Entry Points ──────────────────────────────────────────────────────────────
function startWafiClaimsService(pool) {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
        console.log('[Wafi Claims] Service disabled — GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN not set');
        console.log('[Wafi Claims] Run: node gmail-auth-setup.js to generate OAuth credentials');
        return;
    }
    console.log(`[Wafi Claims] Service started | user: ${GMAIL_USER} | domain: @${SENDER_DOMAIN} | interval: ${POLL_INTERVAL_MS / 60000}min | emails: ${EMAILS_ENABLED ? 'ON' : 'OFF (test mode)'}`);

    // Initial poll after 10 seconds
    setTimeout(() => pollGmail(pool).catch(e => console.error('[Wafi Claims] Initial poll error:', e.message)), 10000);

    // Recurring poll every 5 minutes
    setInterval(() => {
        pollGmail(pool).catch(e => console.error('[Wafi Claims] Scheduled poll error:', e.message));
    }, POLL_INTERVAL_MS);
}

async function triggerWafiManualPoll(pool) {
    return pollGmail(pool);
}

function getLastPollAt() {
    return _lastPollAt;
}

module.exports = { startWafiClaimsService, triggerWafiManualPoll, getLastPollAt };
