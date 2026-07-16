'use strict';

/**
 * Parse / build ASIL Consolidated Master Claims Template (3 sheets):
 *  - Overtime (or legacy "Sheet")
 *  - Expense Claims
 *  - Medical & IPD Claims
 */
const XLSX = require('xlsx');
const fs = require('fs');

function sheetToObjects(ws) {
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
}

function normalizeHeaderKey(k) {
    return String(k || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function pick(row, ...names) {
    const map = {};
    for (const [k, v] of Object.entries(row)) map[normalizeHeaderKey(k)] = v;
    for (const n of names) {
        const v = map[normalizeHeaderKey(n)];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
}

/** Excel often stores DD-MM-YYYY as text or as serial */
function toIsoDate(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const parsed = XLSX.SSF.parse_date_code(raw);
        if (parsed) {
            const m = String(parsed.m).padStart(2, '0');
            const d = String(parsed.d).padStart(2, '0');
            return `${parsed.y}-${m}-${d}`;
        }
    }
    const s = String(raw).trim();
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
        const dd = dmy[1].padStart(2, '0');
        const mm = dmy[2].padStart(2, '0');
        return `${dmy[3]}-${mm}-${dd}`;
    }
    const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (ymd) {
        return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
}

function normalizeMultiplier(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (!s) return 'Double';
    if (s.includes('triple') || s === '3' || s === '3x' || s === '3×') return 'Triple';
    if (s.includes('single') || s === '1' || s === '1x' || s === '1×') return 'Single';
    return 'Double';
}

function normalizeEmpKey(id) {
    return String(id || '').trim().toUpperCase();
}

/**
 * Resolve Excel employee code to a canonical id from the filler's allowed list.
 */
function resolveAllowedEmployeeId(raw, allowedEmployeeIds = []) {
    const key = normalizeEmpKey(raw);
    if (!key) return null;
    const list = allowedEmployeeIds || [];
    if (!list.length) return String(raw).trim();
    const hit = list.find(id => normalizeEmpKey(id) === key);
    return hit || null;
}

/** Parse times like "08:00 PM", "20:00", "8pm" → minutes from midnight, or null */
function parseTimeToMinutes(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        if (raw >= 0 && raw < 1) return Math.round(raw * 24 * 60) % (24 * 60);
        return null;
    }
    let s = String(raw).trim().toUpperCase().replace(/\./g, '');
    if (!s) return null;
    const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
    if (ampm) {
        let h = parseInt(ampm[1], 10);
        const m = parseInt(ampm[2] || '0', 10);
        if (ampm[3] === 'PM' && h < 12) h += 12;
        if (ampm[3] === 'AM' && h === 12) h = 0;
        if (h > 23 || m > 59) return null;
        return h * 60 + m;
    }
    const hm = s.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) {
        const h = parseInt(hm[1], 10);
        const m = parseInt(hm[2], 10);
        if (h > 23 || m > 59) return null;
        return h * 60 + m;
    }
    return null;
}

/** Duration in hours between two minute-of-day values (supports overnight). */
function hoursBetween(fromMin, toMin) {
    if (fromMin == null || toMin == null) return null;
    let diff = toMin - fromMin;
    if (diff <= 0) diff += 24 * 60;
    return Math.round((diff / 60) * 100) / 100;
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
            errors.push(`${rowLabel}: employee code "${raw}" is not in your Claim Authority list — ignored`);
            return;
        }
        const canonical = resolveAllowedEmployeeId(raw, allowedList) || raw;
        if (!itemsByEmployee.has(canonical)) itemsByEmployee.set(canonical, []);
        itemsByEmployee.get(canonical).push(item);
    }

    const otName = wb.SheetNames.find(n => /overtime|\bot\b/i.test(n) || /^sheet$/i.test(n)) || wb.SheetNames[0];
    let otRow = 1;
    for (const row of sheetToObjects(wb.Sheets[otName])) {
        otRow += 1;
        const empId = pick(row, 'ASIL Employee Code', 'Employee Code', 'Employee ID');
        const hoursRaw = pick(row, 'Hours Worked', 'Hours', 'OT Hours');
        const hours = parseFloat(hoursRaw);
        const hasAny = empId || hoursRaw || pick(row, 'Date (DD-MM-YYYY)', 'Date')
            || pick(row, 'Time From (e.g. 08:00 PM)', 'Time From')
            || pick(row, 'Nature of Work / Reason', 'Nature of Work', 'Reason');
        if (!hasAny) continue;
        // Prefill-only rows (identity filled, no claim data) — skip quietly
        if (empId && !hoursRaw && !pick(row, 'Date (DD-MM-YYYY)', 'Date')
            && !pick(row, 'Time From (e.g. 08:00 PM)', 'Time From')
            && !pick(row, 'Nature of Work / Reason', 'Nature of Work', 'Reason')) {
            continue;
        }

        const claim_date = toIsoDate(pick(row, 'Date (DD-MM-YYYY)', 'Date'));
        addItem(empId, {
            claim_type: 'OT',
            claim_date,
            ot_hours: Number.isFinite(hours) ? hours : null,
            ot_multiplier: normalizeMultiplier(pick(row, 'Overtime Multiplier', 'Multiplier', 'Rate')),
            nature: pick(row, 'Nature of Work / Reason', 'Nature of Work', 'Reason'),
            time_from: pick(row, 'Time From (e.g. 08:00 PM)', 'Time From'),
            time_to: pick(row, 'Time To (e.g. 11:00 PM)', 'Time To'),
            description: pick(row, 'Nature of Work / Reason', 'Nature of Work', 'Reason'),
        }, `Overtime row ${otRow}`);
    }

    const expName = wb.SheetNames.find(n => /expense/i.test(n));
    if (expName) {
        let r = 1;
        for (const row of sheetToObjects(wb.Sheets[expName])) {
            r += 1;
            const empId = pick(row, 'ASIL Employee Code', 'Employee Code');
            const amountRaw = pick(row, 'Total Expense Amount', 'Amount', 'Expense Amount');
            const amount = parseFloat(amountRaw);
            if (!empId && !amountRaw) continue;
            if (empId && !amountRaw && !pick(row, 'Date (DD-MM-YYYY)', 'Date')
                && !pick(row, 'Description of Expense', 'Description')) {
                continue;
            }
            addItem(empId, {
                claim_type: 'EXPENSE',
                claim_date: toIsoDate(pick(row, 'Date (DD-MM-YYYY)', 'Date')),
                amount: Number.isFinite(amount) ? amount : null,
                expense_type: pick(row, 'Expense Type', 'Type'),
                description: pick(row, 'Description of Expense', 'Description'),
            }, `Expense row ${r}`);
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
            const amountRaw = pick(row, 'Total Claim Amount', 'Amount', 'Claim Amount');
            const amount = parseFloat(amountRaw);
            if (!empId && !amountRaw) continue;
            if (empId && !amountRaw && !pick(row, 'Date (DD-MM-YYYY)', 'Date')
                && !pick(row, 'Description / Treatment Detail', 'Description')) {
                continue;
            }
            addItem(empId, {
                claim_type: 'MEDICAL',
                claim_date: toIsoDate(pick(row, 'Date (DD-MM-YYYY)', 'Date')),
                amount: Number.isFinite(amount) ? amount : null,
                patient_name: pick(row, 'Patient Name / Relation', 'Patient Name', 'Patient'),
                description: pick(row, 'Description / Treatment Detail', 'Description', 'Treatment'),
                expense_type: pick(row, 'Claim Type', 'Type'),
            }, `Medical row ${r}`);
        }
    } else {
        warnings.push('Medical & IPD Claims sheet not found in workbook');
    }

    return { itemsByEmployee, errors, warnings, sheetNames: wb.SheetNames };
}

const OT_HEADERS = [
    'Date (DD-MM-YYYY)', 'ASIL Employee Code', 'Employee Name', 'Department', 'Location',
    'Line Manager Name', 'Nature of Work / Reason', 'Time From (e.g. 08:00 PM)', 'Time To (e.g. 11:00 PM)',
    'Hours Worked', 'Overtime Multiplier',
];
const EXP_HEADERS = [
    'Date (DD-MM-YYYY)', 'ASIL Employee Code', 'Employee Name', 'Department', 'Location',
    'Line Manager Name', 'Expense Type', 'Description of Expense', 'Total Expense Amount',
];
const MED_HEADERS = [
    'Date (DD-MM-YYYY)', 'ASIL Employee Code', 'Employee Name', 'Department', 'Location',
    'Line Manager Name', 'Claim Type', 'Patient Name / Relation', 'Description / Treatment Detail', 'Total Claim Amount',
];

/**
 * Build a personalized workbook: Code/Name/Dept/Location/Manager prefilled; claim columns blank.
 */
function buildPersonalizedClaimsWorkbook(employees, templatePath = null) {
    const list = employees || [];
    let wb;
    if (templatePath && fs.existsSync(templatePath)) {
        wb = XLSX.read(fs.readFileSync(templatePath), { type: 'buffer' });
    } else {
        wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([OT_HEADERS]), 'Overtime');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([EXP_HEADERS]), 'Expense Claims');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([MED_HEADERS]), 'Medical & IPD Claims');
    }

    let otSheetName = wb.SheetNames.find(n => /overtime|\bot\b/i.test(n) || /^sheet$/i.test(n)) || wb.SheetNames[0];
    const expSheetName = wb.SheetNames.find(n => /expense/i.test(n)) || 'Expense Claims';
    const medSheetName = wb.SheetNames.find(n => /medical|ipd/i.test(n)) || 'Medical & IPD Claims';

    const otRows = [OT_HEADERS];
    const expRows = [EXP_HEADERS];
    const medRows = [MED_HEADERS];

    for (const e of list) {
        const id = e.id || e.employee_id || '';
        const name = e.name || e.employee_name || '';
        const dept = e.dept || '';
        const loc = e.location || '';
        const mgr = e.line_manager_name || e.lineManagerName || '';
        for (let i = 0; i < 3; i++) {
            otRows.push(['', id, name, dept, loc, mgr, '', '', '', '', '']);
        }
        for (let i = 0; i < 2; i++) {
            expRows.push(['', id, name, dept, loc, mgr, '', '', '']);
            medRows.push(['', id, name, dept, loc, mgr, '', '', '', '']);
        }
    }

    const note = [
        ['ASIL Claims — how to fill this file'],
        [''],
        ['1. ASIL Employee Code and Employee Name are prefilled for YOUR team only. Do not change them.'],
        ['2. Fill only the claim columns (Date, hours/amounts, times, descriptions).'],
        ['3. Weekday OT: enter Time From / Time To for overtime AFTER the standard 8-hour shift. Hours Worked = OT hours only (not the full day).'],
        ['4. Upload this file on the claims form, then attach Expense supports and Medical supports as separate files before Submit.'],
        ['5. Without Expense/Medical support files, those refunds will not be processed.'],
        ['6. Questions: ops-support@asil.com.pk'],
    ];

    // Rename legacy Sheet → Overtime
    if (/^sheet$/i.test(otSheetName)) {
        wb.Sheets.Overtime = wb.Sheets[otSheetName];
        delete wb.Sheets[otSheetName];
        const idx = wb.SheetNames.indexOf(otSheetName);
        if (idx >= 0) wb.SheetNames[idx] = 'Overtime';
        otSheetName = 'Overtime';
    }

    wb.Sheets[otSheetName] = XLSX.utils.aoa_to_sheet(otRows);
    if (!wb.SheetNames.includes(expSheetName)) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), 'Expense Claims');
    } else {
        wb.Sheets[expSheetName] = XLSX.utils.aoa_to_sheet(expRows);
    }
    if (!wb.SheetNames.includes(medSheetName)) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(medRows), 'Medical & IPD Claims');
    } else {
        wb.Sheets[medSheetName] = XLSX.utils.aoa_to_sheet(medRows);
    }

    if (!wb.SheetNames.includes('Instructions')) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(note), 'Instructions');
    } else {
        wb.Sheets.Instructions = XLSX.utils.aoa_to_sheet(note);
    }

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    parseMasterClaimsWorkbook,
    buildPersonalizedClaimsWorkbook,
    resolveAllowedEmployeeId,
    toIsoDate,
    normalizeMultiplier,
    parseTimeToMinutes,
    hoursBetween,
};
