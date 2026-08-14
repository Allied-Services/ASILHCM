'use strict';

/**
 * Parse / build ASIL Consolidated Master Claims Template (3 sheets).
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

let ExcelJS = null;
try {
    ExcelJS = require('exceljs');
} catch {
    ExcelJS = null;
}

const MONTH_NAMES = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_ALIASES = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** Find header row index (0-based) that contains ASIL Employee Code / Date columns. */
function findHeaderRowIndex(ws) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
        const joined = (rows[i] || []).map(c => normalizeHeaderKey(c)).join(' | ');
        if (joined.includes('asil employee code') || (joined.includes('employee code') && joined.includes('date'))) {
            return i;
        }
    }
    return 0;
}

function sheetToObjects(ws) {
    if (!ws) return [];
    const headerIdx = findHeaderRowIndex(ws);
    return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, range: headerIdx });
}

function normalizeHeaderKey(k) {
    return String(k || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function pick(row, ...names) {
    const entries = Object.entries(row).map(([k, v]) => [normalizeHeaderKey(k), v]);
    const map = Object.fromEntries(entries);
    for (const n of names) {
        const key = normalizeHeaderKey(n);
        const v = map[key];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    // Fuzzy: header contains the search name (e.g. "Total Expense Amount (PKR)")
    for (const n of names) {
        const key = normalizeHeaderKey(n);
        if (key.length < 4) continue;
        for (const [hk, v] of entries) {
            if (hk.includes(key) || key.includes(hk)) {
                if (v !== undefined && v !== null && String(v).trim() !== '') return v;
            }
        }
    }
    return '';
}

/** Parse PKR amounts: 8000, 8,000, Rs.8,000, 8000.50 */
function parseAmount(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    let s = String(raw).trim();
    if (!s) return null;
    s = s.replace(/^(rs\.?|pkr|usd|\$)\s*/i, '');
    s = s.replace(/,/g, '').replace(/\s+/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

const MONTH_FULL = [
    '', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function daysInMonth(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
}

function isoFromParts(y, m, d) {
    const yi = Number(y);
    const mi = Number(m);
    const di = Number(d);
    if (!yi || !mi || !di || mi < 1 || mi > 12 || di < 1 || di > 31) return null;
    const dt = new Date(yi, mi - 1, di);
    if (dt.getFullYear() !== yi || dt.getMonth() !== mi - 1 || dt.getDate() !== di) return null;
    return `${yi}-${pad2(mi)}-${pad2(di)}`;
}

/**
 * Human-readable reason a date string failed (e.g. 31.06.2026 → June has 30 days).
 */
function dateParseErrorMessage(raw, rowLabel = 'Row') {
    const s = String(raw == null ? '' : raw).trim();
    const fix = 'Please correct the file and upload again.';
    if (!s) return `${rowLabel}: date is missing. ${fix}`;

    const dmy = s.match(/^(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{2,4})$/);
    if (dmy) {
        let a = Number(dmy[1]);
        let b = Number(dmy[2]);
        let y = Number(dmy[3]);
        if (y < 100) y += y >= 70 ? 1900 : 2000;
        let day;
        let month;
        if (a > 12 && b <= 12) { day = a; month = b; }
        else if (b > 12 && a <= 12) { day = b; month = a; }
        else { day = a; month = b; } // Pakistan default DD-MM
        if (month >= 1 && month <= 12) {
            const max = daysInMonth(y, month);
            const monthName = MONTH_FULL[month];
            if (day < 1 || day > max) {
                return (
                    `${rowLabel}: ${day} ${monthName} ${y} is not a valid date — `
                    + `${monthName} ${y} has only ${max} days (there is no ${day} ${monthName}). `
                    + `${fix}`
                );
            }
        } else if (month < 1 || month > 12) {
            return `${rowLabel}: "${s}" is not applicable — month must be 1–12. ${fix}`;
        }
    }

    return (
        `${rowLabel}: could not read date "${s}". `
        + `Try 15-06-2026, 15 Jun 2026, or 2026-06-15. ${fix}`
    );
}

/**
 * Flexible date parser (PK-friendly: day-month-year preferred when ambiguous).
 * Accepts: Excel serial, DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, 6 Jan 2026, Jan 6 2026, etc.
 */
function toIsoDate(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
        return isoFromParts(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        if (raw > 20000 && raw < 80000) {
            const parsed = XLSX.SSF.parse_date_code(raw);
            if (parsed) return isoFromParts(parsed.y, parsed.m, parsed.d);
        }
    }
    let s = String(raw).trim();
    if (!s) return null;

    // Strip weekday names
    s = s.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i, '');

    // DD-MM-YYYY / DD/MM/YYYY
    const dmy = s.match(/^(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{4})$/);
    if (dmy) {
        const a = Number(dmy[1]);
        const b = Number(dmy[2]);
        const y = Number(dmy[3]);
        if (a > 12 && b <= 12) return isoFromParts(y, b, a); // DD-MM
        if (b > 12 && a <= 12) return isoFromParts(y, a, b); // MM-DD
        return isoFromParts(y, b, a); // default DD-MM (Pakistan)
    }

    // DD-MM-YY / 21-06-26 → 2026-06-21
    const dmy2 = s.match(/^(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{2})$/);
    if (dmy2) {
        const a = Number(dmy2[1]);
        const b = Number(dmy2[2]);
        let y = Number(dmy2[3]);
        y += y >= 70 ? 1900 : 2000;
        if (a > 12 && b <= 12) return isoFromParts(y, b, a);
        if (b > 12 && a <= 12) return isoFromParts(y, a, b);
        return isoFromParts(y, b, a);
    }

    const ymd = s.match(/^(\d{4})[\/\-.\s](\d{1,2})[\/\-.\s](\d{1,2})$/);
    if (ymd) return isoFromParts(ymd[1], ymd[2], ymd[3]);

    // 6 Jan 2026 / 06-Jan-2026 / 6th January 2026
    const dMonY = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-\/]+([A-Za-z]{3,9})[\s\-\/,]+(\d{4})$/);
    if (dMonY) {
        const m = MONTH_ALIASES[dMonY[2].toLowerCase()];
        if (m) return isoFromParts(dMonY[3], m, dMonY[1]);
    }

    // Jan 6, 2026 / January 6 2026
    const monDY = s.match(/^([A-Za-z]{3,9})[\s\-\/,]+(\d{1,2})(?:st|nd|rd|th)?[\s\-\/,]+(\d{4})$/);
    if (monDY) {
        const m = MONTH_ALIASES[monDY[1].toLowerCase()];
        if (m) return isoFromParts(monDY[3], m, monDY[2]);
    }

    // Bare "May 2026" is month-only — reject (need a day)
    if (/^[A-Za-z]{3,9}\s+\d{4}$/.test(s)) return null;

    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
        // Avoid UTC shift for date-only ISO
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        return isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    return null;
}

function normalizeMultiplier(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (!s) return 'Double';
    if (s.includes('triple') || s === '3' || s === '3x' || s === '3×' || s === '3.0') return 'Triple';
    if (s.includes('single') || s === '1' || s === '1x' || s === '1×' || s === '1.0') return 'Single';
    if (s.includes('double') || s === '2' || s === '2x' || s === '2×' || s === '2.0') return 'Double';
    return 'Double';
}

function normalizeEmpKey(id) {
    return String(id || '').trim().toUpperCase();
}

function resolveAllowedEmployeeId(raw, allowedEmployeeIds = []) {
    const key = normalizeEmpKey(raw);
    if (!key) return null;
    const list = allowedEmployeeIds || [];
    if (!list.length) return String(raw).trim();
    const hit = list.find(id => normalizeEmpKey(id) === key);
    return hit || null;
}

/** Parse many common time formats → minutes from midnight */
function parseTimeToMinutes(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        if (raw >= 0 && raw < 1) return Math.round(raw * 24 * 60) % (24 * 60);
        // Excel sometimes stores 1700 as number
        if (raw >= 0 && raw <= 2359 && Number.isInteger(raw)) {
            const h = Math.floor(raw / 100);
            const m = raw % 100;
            if (h <= 23 && m <= 59) return h * 60 + m;
        }
        return null;
    }
    let s = String(raw).trim().toUpperCase()
        .replace(/\./g, ':')
        .replace(/\s+/g, ' ')
        .replace(/HRS?$/, '')
        .trim();
    if (!s) return null;

    // 5PM / 5 PM / 5:00PM / 05:00 PM
    let m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
    if (m) {
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2] || '0', 10);
        if (m[3] === 'PM' && h < 12) h += 12;
        if (m[3] === 'AM' && h === 12) h = 0;
        if (h > 23 || min > 59) return null;
        return h * 60 + min;
    }

    // 17:00 / 17.00 already normalized to 17:00
    m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
        const h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        if (h > 23 || min > 59) return null;
        return h * 60 + min;
    }

    // 1700 / 900
    m = s.match(/^(\d{3,4})$/);
    if (m) {
        const n = parseInt(m[1], 10);
        const h = Math.floor(n / 100);
        const min = n % 100;
        if (h <= 23 && min <= 59) return h * 60 + min;
    }

    return null;
}

function hoursBetween(fromMin, toMin) {
    if (fromMin == null || toMin == null) return null;
    let diff = toMin - fromMin;
    if (diff <= 0) diff += 24 * 60;
    return Math.round((diff / 60) * 100) / 100;
}

function formatMinutes(mins) {
    if (mins == null) return '';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${pad2(m)} ${ampm}`;
}

const MON_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Display dates as DD-MON-YYYY (e.g. 07-MAY-2026). */
function formatDateDdMonYyyy(raw) {
    const iso = toIsoDate(raw) || (String(raw || '').match(/^\d{4}-\d{2}-\d{2}/) ? String(raw).slice(0, 10) : null);
    if (!iso) return String(raw || '').trim() || '';
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    return `${pad2(d)}-${MON_SHORT[m - 1]}-${y}`;
}

/** True if row has enough filled claim fields to validate (not a blank prefilled slot). */
function isMeaningfulOtRow(row) {
    const date = String(row.claim_date || '').trim();
    const hours = parseFloat(row.ot_hours);
    const tf = String(row.time_from || '').trim();
    const tt = String(row.time_to || '').trim();
    const nature = String(row.nature || row.description || '').trim();
    return !!(date || (Number.isFinite(hours) && hours > 0) || tf || tt || nature);
}

function isMeaningfulMoneyRow(row) {
    const date = String(row.claim_date || '').trim();
    const amt = parseFloat(row.amount);
    const desc = String(row.description || '').trim();
    const patient = String(row.patient_name || '').trim();
    return !!(date || (Number.isFinite(amt) && amt > 0) || desc || patient);
}

/**
 * @param {Buffer} buffer
 * @param {{ allowedEmployeeIds?: string[] }} opts
 */
function parseMasterClaimsWorkbook(buffer, opts = {}) {
    const allowedList = opts.allowedEmployeeIds || [];
    const allowedSet = new Set(allowedList.map(normalizeEmpKey));
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const errors = [];
    const warnings = [];
    const itemsByEmployee = new Map();

    function addItem(empIdRaw, item, rowLabel) {
        const raw = String(empIdRaw || '').trim();
        if (!raw) {
            errors.push(`${rowLabel}: missing ASIL Employee Code`);
            return;
        }
        if (allowedSet.size && !allowedSet.has(normalizeEmpKey(raw))) {
            errors.push(`${rowLabel}: "${raw}" is not on your Claim Authority list — this row was ignored`);
            return;
        }
        const canonical = resolveAllowedEmployeeId(raw, allowedList) || raw;
        if (!itemsByEmployee.has(canonical)) itemsByEmployee.set(canonical, []);
        itemsByEmployee.get(canonical).push({ ...item, _rowLabel: rowLabel });
    }

    const otName = wb.SheetNames.find(n => /overtime|\bot\b/i.test(n) || /^sheet$/i.test(n)) || wb.SheetNames[0];
    let otRow = 1;
    for (const row of sheetToObjects(wb.Sheets[otName])) {
        otRow += 1;
        // Skip title / instruction rows (no employee code column value that looks like code)
        const empId = pick(row, 'ASIL Employee Code', 'Employee Code', 'Employee ID');
        const hoursRaw = pick(
            row,
            'OT Hours (auto)', 'Hours Worked (auto)', 'Hours Worked (OT only)',
            'Hours Worked', 'Hours', 'OT Hours'
        );
        const dateRaw = pick(row, 'Date (DD-MM-YYYY)', 'Date', 'Claim Date');
        const timeFrom = pick(
            row,
            'OT Start Time', 'OT Start', 'Overtime Start',
            'Time From (e.g. 08:00 PM)', 'Time From', 'From'
        );
        const timeTo = pick(
            row,
            'OT End Time', 'OT End', 'Overtime End',
            'Time To (e.g. 11:00 PM)', 'Time To', 'To'
        );
        const nature = pick(row, 'Nature of Work / Reason', 'Nature of Work', 'Reason');
        if (!empId && !hoursRaw && !dateRaw && !timeFrom) continue;
        if (empId && !hoursRaw && !dateRaw && !timeFrom && !timeTo && !nature) continue; // prefill only
        if (/SAMPLE/i.test(String(empId || '')) || /do not edit/i.test(String(nature || ''))) continue;

        let otHours = parseAmount(hoursRaw);
        // Prefer calculated duration from OT Start/End when Excel formula cache is empty or hours blank
        const fromMin = parseTimeToMinutes(timeFrom);
        const toMin = parseTimeToMinutes(timeTo);
        const span = hoursBetween(fromMin, toMin);
        if ((!Number.isFinite(otHours) || otHours <= 0) && span != null) otHours = span;

        const draft = {
            claim_type: 'OT',
            claim_date: toIsoDate(dateRaw),
            claim_date_raw: dateRaw || '',
            ot_hours: otHours,
            ot_multiplier: normalizeMultiplier(pick(
                row,
                'OT Rate (1X/2X/3X)', 'Overtime Multiplier', 'Multiplier', 'Rate', 'OT Rate'
            )),
            nature,
            time_from: timeFrom,
            time_to: timeTo,
            description: nature,
        };
        if (!isMeaningfulOtRow(draft)) continue;
        if (dateRaw && !draft.claim_date) {
            errors.push(dateParseErrorMessage(dateRaw, `Overtime row ${otRow}`));
            continue;
        }
        addItem(empId, draft, `Overtime row ${otRow}`);
    }

    const expName = wb.SheetNames.find(n => /expense/i.test(n));
    if (expName) {
        let r = 1;
        for (const row of sheetToObjects(wb.Sheets[expName])) {
            r += 1;
            const empId = pick(row, 'ASIL Employee Code', 'Employee Code');
            const amountRaw = pick(
                row,
                'Total Expense Amount (PKR)', 'Total Expense Amount', 'Expense Amount (PKR)',
                'Expense Amount', 'Amount (PKR)', 'Amount'
            );
            const dateRaw = pick(row, 'Date (DD-MM-YYYY)', 'Date', 'Claim Date');
            const desc = pick(row, 'Description of Expense', 'Description');
            if (!empId && !amountRaw && !dateRaw) continue;
            if (empId && !amountRaw && !dateRaw && !desc) continue;
            const amount = parseAmount(amountRaw);
            const draft = {
                claim_type: 'EXPENSE',
                claim_date: toIsoDate(dateRaw),
                claim_date_raw: dateRaw || '',
                amount,
                expense_type: pick(row, 'Expense Type', 'Type'),
                description: desc,
            };
            if (!isMeaningfulMoneyRow(draft)) continue;
            if (dateRaw && !draft.claim_date) {
                errors.push(dateParseErrorMessage(dateRaw, `Expense row ${r}`));
                continue;
            }
            addItem(empId, draft, `Expense row ${r}`);
        }
    } else {
        warnings.push('Expense Claims sheet not found in workbook');
    }

    const medName = wb.SheetNames.find(n => /medical|ipd/i.test(n));
    if (medName) {
        let r = 1;
        for (const row of sheetToObjects(wb.Sheets[medName])) {
            r += 1;
            const empId = pick(row, 'ASIL Employee Code', 'Employee Code');
            const amountRaw = pick(
                row,
                'Total Claim Amount (PKR)', 'Total Claim Amount', 'Claim Amount (PKR)',
                'Claim Amount', 'Medical Amount', 'Amount (PKR)', 'Amount'
            );
            const dateRaw = pick(row, 'Date (DD-MM-YYYY)', 'Date', 'Claim Date');
            const desc = pick(row, 'Description / Treatment Detail', 'Description', 'Treatment');
            if (!empId && !amountRaw && !dateRaw) continue;
            if (empId && !amountRaw && !dateRaw && !desc) continue;
            const amount = parseAmount(amountRaw);
            const draft = {
                claim_type: 'MEDICAL',
                claim_date: toIsoDate(dateRaw),
                claim_date_raw: dateRaw || '',
                amount,
                patient_name: pick(row, 'Patient Name / Relation', 'Patient Name', 'Patient'),
                description: desc,
                expense_type: pick(row, 'Claim Type', 'Type'),
            };
            if (!isMeaningfulMoneyRow(draft)) continue;
            if (dateRaw && !draft.claim_date) {
                errors.push(dateParseErrorMessage(dateRaw, `Medical row ${r}`));
                continue;
            }
            addItem(empId, draft, `Medical row ${r}`);
        }
    } else {
        warnings.push('Medical & IPD Claims sheet not found in workbook');
    }

    return { itemsByEmployee, errors, warnings, sheetNames: wb.SheetNames };
}

const OT_HEADERS = [
    'Date', 'ASIL Employee Code', 'Employee Name', 'Department', 'Location',
    'Line Manager Name', 'Nature of Work / Reason', 'OT Start Time', 'OT End Time',
    'OT Hours (auto)',
];
const EXP_HEADERS = [
    'Date', 'ASIL Employee Code', 'Employee Name', 'Department', 'Location',
    'Line Manager Name', 'Expense Type', 'Description of Expense', 'Total Expense Amount (PKR)',
];
const MED_HEADERS = [
    'Date', 'ASIL Employee Code', 'Employee Name', 'Department', 'Location',
    'Line Manager Name', 'Claim Type', 'Patient Name / Relation', 'Description / Treatment Detail', 'Total Claim Amount (PKR)',
];

/** Data rows with formulas per employee. */
const SLOTS_PER_EMP = 6;

const HEADER_FILL = '1E3A8A';
const HEADER_FONT = 'FFFFFF';
const LOCK_FILL = 'E2E8F0';
const ALT_ROW = 'F8FAFC';
const TITLE_FILL = '1E40AF';
const WARN_FILL = 'FECACA';
const SUM_FILL = 'FEF3C7';

async function buildPersonalizedClaimsWorkbookAsync(employees, opts = {}) {
    const list = employees || [];
    const claimMonth = opts.claimMonth || null;
    const claimYear = opts.claimYear || null;
    const monthLabel = claimMonth && claimYear
        ? `${MONTH_NAMES[claimMonth] || claimMonth} ${claimYear}`
        : 'this claim month';
    const holidayDates = Array.isArray(opts.holidayDates) ? opts.holidayDates : [];
    const slots = opts.slotsPerEmp || SLOTS_PER_EMP;

    if (!ExcelJS) {
        return buildPersonalizedClaimsWorkbookFallback(list, opts);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ASIL HCM';
    wb.created = new Date();

    // Holidays helper (hidden) — used by Rate Check for 3×
    const holWs = wb.addWorksheet('Holidays');
    holWs.getCell(1, 1).value = 'Gazetted Holiday Date';
    holWs.getCell(1, 2).value = 'Name / note';
    holidayDates.forEach((iso, i) => {
        const [y, m, d] = String(iso).split('-').map(Number);
        const cell = holWs.getCell(i + 2, 1);
        cell.value = new Date(y, m - 1, d);
        cell.numFmt = 'DD-MMM-YYYY';
        holWs.getCell(i + 2, 2).value = iso;
    });
    holWs.state = 'veryHidden';

    // Instructions
    const instr = wb.addWorksheet('Instructions', { views: [{ showGridLines: false }] });
    instr.getColumn(1).width = 110;
    instr.getCell('A1').value = 'ASIL Claims Workbook — Instructions';
    instr.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    instr.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
    instr.getRow(1).height = 28;
    const lines = [
        '',
        `Claim month: ${monthLabel}`,
        '',
        '1. Grey columns (Employee Code, Name, Dept, Location, Manager) are prefilled for YOUR team — do not change them.',
        '2. Overtime — fill only: Date, Nature, OT Start Time, OT End Time. Rate (2×/3×) is applied automatically per labour law.',
        '3. OT Start / OT End = overtime hours claimed AFTER normal duty. Do NOT enter the full shift start/end (e.g. not 9:00 AM–6:00 PM).',
        '4. OT Hours calculates automatically as OT End − OT Start. Do not type hours by hand.',
        '5. Use the SAMPLE row under the header as your format guide. Dates: 15-07-2026. Times: 05:00 PM and 08:00 PM.',
        '6. Submit by day 18 of the claim month. LM approves by day 22. Approved amounts pay with the following month’s salary.',
        '7. Only this claim month’s dates are accepted. Older months → email claims@asil.com.pk.',
        '8. After upload: attach Expense Reimbursement and Medical supports as separate files before Submit.',
        '9. Questions: ops-support@asil.com.pk or claims@asil.com.pk',
    ];
    lines.forEach((t, i) => {
        const cell = instr.getCell(i + 2, 1);
        cell.value = t;
        cell.font = { size: 11, color: { argb: 'FF334155' } };
        if (i === 1) cell.font = { size: 12, bold: true, color: { argb: 'FF1E3A8A' } };
    });

    function styleHeaderRow(ws, rowNum, colCount) {
        const row = ws.getRow(rowNum);
        for (let c = 1; c <= colCount; c++) {
            const cell = row.getCell(c);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
            cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 10 };
            cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'center' };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF1E3A8A' } },
                bottom: { style: 'thin', color: { argb: 'FF1E3A8A' } },
                left: { style: 'thin', color: { argb: 'FF1E3A8A' } },
                right: { style: 'thin', color: { argb: 'FF1E3A8A' } },
            };
        }
        row.height = 32;
    }

    function addTitleBlock(ws, title, subtitle, colCount) {
        ws.mergeCells(1, 1, 1, colCount);
        const t = ws.getCell(1, 1);
        t.value = title;
        t.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
        t.alignment = { vertical: 'middle', horizontal: 'left' };
        ws.getRow(1).height = 26;

        ws.mergeCells(2, 1, 2, colCount);
        const s = ws.getCell(2, 1);
        s.value = subtitle;
        s.font = { size: 10, italic: true, color: { argb: 'FF475569' } };
        s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
        ws.getRow(2).height = 36;
        s.alignment = { wrapText: true, vertical: 'middle' };
    }

    function addMoneySummaryRow(ws, amountColLetter, headerRow, firstData, lastData, colCount) {
        const sumRow = 3;
        ws.mergeCells(sumRow, 1, sumRow, Math.max(1, amountColLetter.charCodeAt(0) - 65));
        ws.getCell(sumRow, 1).value = 'TOTAL AMOUNT (auto)';
        ws.getCell(sumRow, 1).font = { bold: true, size: 11, color: { argb: 'FF92400E' } };
        ws.getCell(sumRow, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_FILL } };
        const amtCell = ws.getCell(sumRow, amountColLetter.charCodeAt(0) - 64);
        amtCell.value = { formula: `SUM(${amountColLetter}${firstData}:${amountColLetter}${lastData})` };
        amtCell.numFmt = '#,##0.00';
        amtCell.font = { bold: true, size: 12, color: { argb: 'FF92400E' } };
        amtCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_FILL } };
        for (let c = 1; c <= colCount; c++) {
            if (!ws.getCell(sumRow, c).fill || !ws.getCell(sumRow, c).fill.fgColor) {
                ws.getCell(sumRow, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_FILL } };
            }
        }
        ws.getRow(sumRow).height = 22;
        return sumRow;
    }

    function formatManagerName(mgr) {
        const v = String(mgr || '').trim();
        return v || 'No Line Manager Set';
    }

    function addHeaderNotes(ws, headerRow, notesByCol) {
        Object.entries(notesByCol).forEach(([col, text]) => {
            ws.getCell(headerRow, Number(col)).note = text;
        });
    }

    function addSampleRow(ws, rowNum, headers, sampleValues) {
        sampleValues.forEach((v, i) => {
            const cell = ws.getCell(rowNum, i + 1);
            cell.value = v;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
            cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 9 };
            cell.alignment = { vertical: 'middle', wrapText: true };
        });
        ws.getRow(rowNum).height = 36;
    }

    function addDataSheet(name, headers, slotsPerEmp, lockedCols, amountColLetter) {
        const headerRow = 4;
        const sampleRow = 5;
        const firstData = 6;
        const ws = wb.addWorksheet(name, {
            views: [{ state: 'frozen', ySplit: sampleRow, activeCell: `A${firstData}` }],
        });
        addTitleBlock(
            ws,
            `ASIL — ${name}`,
            `Claim month: ${monthLabel}  ·  Prefill = your employees only  ·  Fill white cells only  ·  Total at top updates automatically`,
            headers.length
        );

        for (let c = 1; c <= headers.length; c++) {
            ws.getCell(3, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_FILL } };
        }

        headers.forEach((h, i) => { ws.getCell(headerRow, i + 1).value = h; });
        styleHeaderRow(ws, headerRow, headers.length);
        addHeaderNotes(ws, headerRow, {
            1: 'Date work/expense happened — DD-MMM-YYYY e.g. 15-Jul-2026',
            7: 'Expense type e.g. Travel, Fuel',
            8: 'Brief description of the expense',
            9: 'Amount in PKR',
        });

        const sampleDate = claimMonth && claimYear
            ? `15-${String(claimMonth).padStart(2, '0')}-${claimYear}`
            : '15-07-2026';
        addSampleRow(ws, sampleRow, headers, [
            sampleDate, '(SAMPLE — do not edit)', 'Format example only', '—', '—', 'No Line Manager Set',
            /expense/i.test(name) ? 'Travel' : 'OPD',
            /expense/i.test(name) ? 'Taxi fare — client visit' : 'Consultation',
            /medical/i.test(name) ? 'Self' : '',
            /medical/i.test(name) ? '5000' : '1500',
        ].slice(0, headers.length));

        const widths = headers.map((h) => {
            if (/Employee Code/i.test(h)) return 26;
            if (/Employee Name/i.test(h)) return 22;
            if (/Nature|Description|Treatment/i.test(h)) return 28;
            if (/Department|Location|Manager/i.test(h)) return 16;
            if (/Amount/i.test(h)) return 16;
            if (/Date/i.test(h)) return 14;
            return 14;
        });
        widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

        let r = firstData;
        for (const e of list) {
            const id = e.id || e.employee_id || '';
            const nm = e.name || e.employee_name || '';
            const dept = e.dept || '';
            const loc = e.location || '';
            const mgr = formatManagerName(e.line_manager_name || e.lineManagerName);
            for (let i = 0; i < slotsPerEmp; i++) {
                const row = ws.getRow(r);
                const values = headers.map((h) => {
                    if (/Employee Code/i.test(h)) return id;
                    if (/Employee Name/i.test(h)) return nm;
                    if (/Department/i.test(h)) return dept;
                    if (/Location/i.test(h)) return loc;
                    if (/Line Manager/i.test(h)) return mgr;
                    return '';
                });
                values.forEach((v, ci) => {
                    const cell = row.getCell(ci + 1);
                    cell.value = v;
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    };
                    cell.alignment = { vertical: 'middle' };
                    if (lockedCols.includes(ci)) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LOCK_FILL } };
                        cell.font = { color: { argb: 'FF334155' }, size: 10 };
                    } else if ((r % 2) === 0) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_ROW } };
                    }
                    if (/Amount/i.test(headers[ci])) cell.numFmt = '#,##0.00';
                });
                row.height = 18;
                r += 1;
            }
        }

        const lastData = Math.max(firstData, r - 1);
        if (amountColLetter) {
            addMoneySummaryRow(ws, amountColLetter, headerRow, firstData, lastData, headers.length);
        }
        return ws;
    }

    function addOvertimeSheet(slotsPerEmp) {
        const headers = OT_HEADERS;
        const headerRow = 4;
        const sampleRow = 5;
        const firstData = 6;
        const ws = wb.addWorksheet('Overtime', {
            views: [{ state: 'frozen', ySplit: sampleRow, activeCell: `A${firstData}` }],
        });
        addTitleBlock(
            ws,
            'ASIL — Overtime',
            'Enter Date · OT Start · OT End only. OT must be AFTER normal duty (NOT shift clock-in/out). OT Hours = End − Start (auto). Rate 2×/3× applied by system.',
            headers.length
        );

        for (let c = 1; c <= headers.length; c++) {
            ws.getCell(3, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_FILL } };
        }

        headers.forEach((h, i) => { ws.getCell(headerRow, i + 1).value = h; });
        styleHeaderRow(ws, headerRow, headers.length);
        addHeaderNotes(ws, headerRow, {
            1: 'Date OT was worked — DD-MMM-YYYY e.g. 15-Jul-2026',
            7: 'What work was done during overtime',
            8: 'OT Start — overtime AFTER normal duty e.g. 05:00 PM (NOT shift start 9:00 AM)',
            9: 'OT End — when overtime finished e.g. 08:00 PM (NOT shift end 6:00 PM)',
            10: 'Auto-calculated — do not type',
        });

        const sampleDate = claimMonth && claimYear
            ? new Date(claimYear, claimMonth - 1, 15)
            : new Date(2026, 6, 15);
        addSampleRow(ws, sampleRow, headers, [
            sampleDate,
            '(SAMPLE — do not edit)',
            'Format example only',
            '—', '—', 'No Line Manager Set',
            'OT after duty — NOT shift times (e.g. NOT 9:00 AM–6:00 PM)',
            '05:00 PM',
            '08:00 PM',
            '3.00',
        ]);
        ws.getCell(sampleRow, 1).numFmt = 'DD-MMM-YYYY';

        const widths = [12, 26, 22, 14, 14, 18, 30, 13, 13, 12];
        widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

        const fromCol = 8;
        const toCol = 9;
        const hoursCol = 10;
        const lockedIdx = [1, 2, 3, 4, 5, 9]; // identity + hours (0-based)

        let r = firstData;
        for (const e of list) {
            const id = e.id || e.employee_id || '';
            const nm = e.name || e.employee_name || '';
            const dept = e.dept || '';
            const loc = e.location || '';
            const mgr = formatManagerName(e.line_manager_name || e.lineManagerName);
            for (let i = 0; i < slotsPerEmp; i++) {
                const row = ws.getRow(r);
                const prefill = ['', id, nm, dept, loc, mgr, '', '', '', null];
                prefill.forEach((v, ci) => {
                    const cell = row.getCell(ci + 1);
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    };
                    cell.alignment = { vertical: 'middle', wrapText: ci === 6 };
                    if (lockedIdx.includes(ci) && ci < 6) {
                        cell.value = v;
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LOCK_FILL } };
                        cell.font = { color: { argb: 'FF334155' }, size: 10 };
                    } else if ((r % 2) === 0) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_ROW } };
                    }
                });

                ws.getCell(r, fromCol).numFmt = 'h:mm AM/PM';
                ws.getCell(r, toCol).numFmt = 'h:mm AM/PM';
                ws.getCell(r, 1).numFmt = 'DD-MMM-YYYY';

                const hf = ws.getCell(r, hoursCol);
                hf.value = {
                    formula: `IF(OR(H${r}="",I${r}=""),"",ROUND(IF(I${r}>=H${r},(I${r}-H${r})*24,(1+I${r}-H${r})*24),2))`,
                };
                hf.numFmt = '0.00';
                hf.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_FILL } };
                hf.font = { bold: true, color: { argb: 'FF92400E' }, size: 10 };

                row.height = 20;
                r += 1;
            }
        }

        const last = Math.max(firstData, r - 1);
        ws.getCell(3, 1).value = 'TOTAL OT HOURS (auto)';
        ws.getCell(3, 1).font = { bold: true, size: 10, color: { argb: 'FF92400E' } };
        if (last >= firstData) {
            const c = ws.getCell(3, 10);
            c.value = { formula: `SUM(J${firstData}:J${last})` };
            c.numFmt = '0.00';
            c.font = { bold: true, size: 12, color: { argb: 'FF92400E' } };
        }
        ws.getRow(3).height = 22;
        return ws;
    }

    addOvertimeSheet(slots);
    addDataSheet('Expense Claims', EXP_HEADERS, slots, [1, 2, 3, 4, 5], 'I');
    addDataSheet('Medical & IPD Claims', MED_HEADERS, slots, [1, 2, 3, 4, 5], 'J');

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
}

function buildPersonalizedClaimsWorkbook(employees, templatePathOrOpts = null, maybeOpts = {}) {
    // Sync wrapper used by older callers — prefer async path when ExcelJS present
    const opts = (templatePathOrOpts && typeof templatePathOrOpts === 'object' && !Array.isArray(templatePathOrOpts))
        ? templatePathOrOpts
        : { ...(maybeOpts || {}), templatePath: typeof templatePathOrOpts === 'string' ? templatePathOrOpts : null };
    // Fire sync fallback; callers that need formatting should use async
    return buildPersonalizedClaimsWorkbookFallback(employees || [], opts);
}

function buildPersonalizedClaimsWorkbookFallback(employees, opts = {}) {
    const list = employees || [];
    const claimMonth = opts.claimMonth;
    const claimYear = opts.claimYear;
    const monthLabel = claimMonth && claimYear
        ? `${MONTH_NAMES[claimMonth] || claimMonth} ${claimYear}`
        : 'this claim month';
    const slots = opts.slotsPerEmp || SLOTS_PER_EMP;

    const wb = XLSX.utils.book_new();
    const note = [
        ['ASIL Claims — how to fill this file'],
        [`Claim month: ${monthLabel}`],
        [''],
        ['1. Employee Code and Name are prefilled for YOUR team only. Do not change them.'],
        ['2. Overtime: enter Date, Nature, OT Start Time, OT End Time, and OT Rate (1X/2X/3X).'],
        ['3. OT Start/End = overtime AFTER normal duty — not the full shift clock-in/out.'],
        ['4. OT Hours = End − Start (calculate yourself if formulas are unavailable). Do not claim shift hours as OT.'],
        ['5. Use 2X for normal OT (accepted without question). 3X only on gazetted public/festival holidays.'],
        ['6. Dates: 15-06-2026, 15/06/2026, 15 Jun 2026. Times: 5:00 PM, 17:00, 5pm, or 1700.'],
        ['7. Older months cannot be submitted here — email claims@asil.com.pk.'],
        ['8. Attach Expense/Medical supports before Submit. Questions: ops-support@asil.com.pk'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(note), 'Instructions');

    function makeSheet(headers, slotCount, summaryLabel) {
        const rows = [
            [`ASIL Claims · ${monthLabel}`],
            ['OT Start/End = overtime after duty only · 3× only on gazetted holidays · Prefer 2×'],
            [summaryLabel || 'Totals appear here when opened in Excel with formulas (download prefers formatted file)'],
            headers,
        ];
        for (const e of list) {
            const id = e.id || e.employee_id || '';
            const name = e.name || e.employee_name || '';
            const dept = e.dept || '';
            const loc = e.location || '';
            const mgr = e.line_manager_name || e.lineManagerName || '';
            for (let i = 0; i < slotCount; i++) {
                const row = headers.map((h) => {
                    if (/Employee Code/i.test(h)) return id;
                    if (/Employee Name/i.test(h)) return name;
                    if (/Department/i.test(h)) return dept;
                    if (/Location/i.test(h)) return loc;
                    if (/Line Manager/i.test(h)) return mgr;
                    if (/OT Rate|Multiplier/i.test(h)) return i === 0 ? '2X' : '';
                    return '';
                });
                rows.push(row);
            }
        }
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = headers.map((h) => ({ wch: Math.min(28, Math.max(12, String(h).length + 2)) }));
        ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
        return ws;
    }

    XLSX.utils.book_append_sheet(
        wb,
        makeSheet(OT_HEADERS, slots, 'TOTAL OT HOURS — fill OT Start/End; hours = End − Start'),
        'Overtime'
    );
    XLSX.utils.book_append_sheet(
        wb,
        makeSheet(EXP_HEADERS, slots, 'TOTAL EXPENSE AMOUNT (sum Amount column)'),
        'Expense Claims'
    );
    XLSX.utils.book_append_sheet(
        wb,
        makeSheet(MED_HEADERS, slots, 'TOTAL MEDICAL AMOUNT (sum Amount column)'),
        'Medical & IPD Claims'
    );
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    parseMasterClaimsWorkbook,
    buildPersonalizedClaimsWorkbook,
    buildPersonalizedClaimsWorkbookAsync,
    resolveAllowedEmployeeId,
    toIsoDate,
    dateParseErrorMessage,
    parseAmount,
    normalizeMultiplier,
    parseTimeToMinutes,
    hoursBetween,
    formatMinutes,
    formatDateDdMonYyyy,
    isMeaningfulOtRow,
    isMeaningfulMoneyRow,
    MONTH_NAMES,
};
