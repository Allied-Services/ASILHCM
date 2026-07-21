'use strict';

/**
 * Pure attendance CSV format detection + row parsers (Format A / Format B)
 * and Monthly Report Hub 15-column helpers.
 */

const MONTHLY_HUB_COLUMNS = [
    'CNIC',
    'Staff Code',
    'Month',
    'Year',
    'ASIL Employee Code',
    'Contract Name',
    'Present Days',
    'OT Hrs @ 2X',
    'OT Hrs @ 3X',
    'OPD',
    'Expense Reimbursement',
    'Arrears',
    'Special Allowance',
    'Other Allowance Fuel | Mobile',
    'Other Deduction',
];

const STANDARD_DAY_HOURS = 8;

function normalizeHeader(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function detectAttendanceFormat(headers) {
    const norms = (headers || []).map(normalizeHeader);
    const hasTimeIn = norms.some(h => ['timein', 'punchin', 'clockin', 'intime'].includes(h) || h === 'timein');
    const hasTimeOut = norms.some(h => ['timeout', 'punchout', 'clockout', 'outtime'].includes(h) || h === 'timeout');
    // Also match "Time In" / "Time Out" after normalize → timein / timeout
    const hasIn = norms.some(h => h.includes('timein') || h === 'in' || h.endsWith('timein'));
    const hasOut = norms.some(h => h.includes('timeout') || h === 'out' || h.endsWith('timeout'));
    if ((hasTimeIn && hasTimeOut) || (hasIn && hasOut && norms.some(h => h.includes('time')))) {
        // Prefer Format B when both in/out time columns present
        if (norms.some(h => h.includes('timein') || h.includes('punchin') || h.includes('clockin'))
            && norms.some(h => h.includes('timeout') || h.includes('punchout') || h.includes('clockout'))) {
            return 'format_b';
        }
    }
    const hasStatus = norms.some(h => h.includes('status') || h === 'p' || h.includes('attendance'));
    if (hasStatus) return 'format_a';
    return 'format_a';
}

function normalizeStatus(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (['p', 'present', '1', 'yes'].includes(s)) return 'present';
    if (['a', 'absent', '0', 'no'].includes(s)) return 'absent';
    if (['u', 'unexcused'].includes(s)) return 'unexcused';
    if (['l', 'leave'].includes(s)) return 'leave';
    if (['h', 'half', 'half_day', '½'].includes(s)) return 'half_day';
    if (['ot', 'overtime'].includes(s)) return 'ot';
    if (['sun', 'sunday'].includes(s)) return 'sunday';
    if (['hol', 'holiday', 'ph'].includes(s)) return 'holiday';
    return 'present';
}

function pickField(row, candidates) {
    const keys = Object.keys(row || {});
    const normMap = Object.fromEntries(keys.map(k => [normalizeHeader(k), k]));
    for (const c of candidates) {
        const nk = normalizeHeader(c);
        if (normMap[nk] != null && row[normMap[nk]] != null && String(row[normMap[nk]]).trim() !== '') {
            return String(row[normMap[nk]]).trim();
        }
        // partial includes match
        for (const [nk2, orig] of Object.entries(normMap)) {
            if (nk2.includes(nk) || nk.includes(nk2)) {
                const v = row[orig];
                if (v != null && String(v).trim() !== '') return String(v).trim();
            }
        }
    }
    return null;
}

function normalizeDate(val) {
    if (!val) return null;
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
        const d = m[1].padStart(2, '0');
        const mo = m[2].padStart(2, '0');
        let y = m[3];
        if (y.length === 2) y = `20${y}`;
        // Prefer DD/MM/YYYY (PK convention)
        return `${y}-${mo}-${d}`;
    }
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
    return s;
}

function parseTimeToMinutes(t) {
    if (!t) return null;
    const s = String(t).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = (m[4] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return h * 60 + min;
}

function computeHoursWorked(timeIn, timeOut) {
    const a = parseTimeToMinutes(timeIn);
    const b = parseTimeToMinutes(timeOut);
    if (a == null || b == null) return null;
    let diff = b - a;
    if (diff < 0) diff += 24 * 60; // overnight
    return Math.round((diff / 60) * 100) / 100;
}

function mapOtHoursFromExcess(hours) {
    if (hours == null || Number.isNaN(Number(hours))) {
        return { status: 'absent', hours: null, otHours: 0 };
    }
    const h = Number(hours);
    const otHours = h > STANDARD_DAY_HOURS ? Math.round((h - STANDARD_DAY_HOURS) * 100) / 100 : 0;
    return {
        status: otHours > 0 ? 'ot' : 'present',
        hours: h,
        otHours,
    };
}

function parseFormatARow(row) {
    const employeeId = pickField(row, ['EmployeeID', 'Employee ID', 'ASIL Employee Code', 'employee_id', 'Staff Code', 'id']);
    const date = normalizeDate(pickField(row, ['Date', 'Attendance Date', 'day']));
    const status = normalizeStatus(pickField(row, ['Status', 'Status (P/A/SUN/HOL)', 'attendance', 'code']) || 'P');
    return {
        employeeId,
        date,
        status,
        hours: null,
        otHours: 0,
        format: 'format_a',
    };
}

function parseFormatBRow(row) {
    const employeeId = pickField(row, ['EmployeeID', 'Employee ID', 'ASIL Employee Code', 'Emp ID', 'employee_id', 'id']);
    const date = normalizeDate(pickField(row, ['Date', 'Punch Date', 'Attendance Date', 'day']));
    const timeIn = pickField(row, ['TimeIn', 'Time In', 'Punch In', 'Clock In', 'In']);
    const timeOut = pickField(row, ['TimeOut', 'Time Out', 'Punch Out', 'Clock Out', 'Out']);
    const hours = computeHoursWorked(timeIn, timeOut);
    if (hours == null) {
        return {
            employeeId,
            date,
            status: 'absent',
            hours: null,
            otHours: 0,
            timeIn,
            timeOut,
            format: 'format_b',
        };
    }
    const mapped = mapOtHoursFromExcess(hours);
    return {
        employeeId,
        date,
        status: mapped.status,
        hours: mapped.hours,
        otHours: mapped.otHours,
        timeIn,
        timeOut,
        format: 'format_b',
    };
}

function isBlankCell(v) {
    return v == null || String(v).trim() === '';
}

function toNumberOrNull(v) {
    if (isBlankCell(v)) return null;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

function buildMonthlyExportRow(src) {
    return {
        CNIC: src.cnic || '',
        'Staff Code': src.staffCode || src.staff_code || '',
        Month: src.month,
        Year: src.year,
        'ASIL Employee Code': src.employeeId || src.employee_id || '',
        'Contract Name': src.contractName || src.contract_name || '',
        'Present Days': src.presentDays ?? src.present_days ?? 0,
        'OT Hrs @ 2X': src.ot2 ?? 0,
        'OT Hrs @ 3X': src.ot3 ?? 0,
        OPD: src.opd ?? 0,
        'Expense Reimbursement': src.expense ?? 0,
        Arrears: src.arrears ?? 0,
        'Special Allowance': src.specialAllowance ?? src.special_allowance ?? 0,
        'Other Allowance Fuel | Mobile': src.fuelMobile ?? src.fuel_mobile ?? 0,
        'Other Deduction': src.otherDeduction ?? src.other_deduction ?? 0,
    };
}

/**
 * Merge import CSV row onto existing month data.
 * Blank/null/whitespace cells NEVER overwrite existing values.
 */
function mergeMonthlyImportRow(existing, incoming) {
    const map = {
        presentDays: 'Present Days',
        ot2: 'OT Hrs @ 2X',
        ot3: 'OT Hrs @ 3X',
        opd: 'OPD',
        expense: 'Expense Reimbursement',
        arrears: 'Arrears',
        specialAllowance: 'Special Allowance',
        fuelMobile: 'Other Allowance Fuel | Mobile',
        otherDeduction: 'Other Deduction',
    };
    const out = { ...existing };
    for (const [key, col] of Object.entries(map)) {
        const raw = incoming[col];
        const num = toNumberOrNull(raw);
        if (num != null) out[key] = num;
    }
    const code = incoming['ASIL Employee Code'] || incoming.employeeId;
    if (!isBlankCell(code)) out.employeeId = String(code).trim();
    return out;
}

module.exports = {
    MONTHLY_HUB_COLUMNS,
    STANDARD_DAY_HOURS,
    detectAttendanceFormat,
    normalizeStatus,
    normalizeDate,
    pickField,
    computeHoursWorked,
    mapOtHoursFromExcess,
    parseFormatARow,
    parseFormatBRow,
    buildMonthlyExportRow,
    mergeMonthlyImportRow,
    isBlankCell,
    toNumberOrNull,
};
