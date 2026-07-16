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
    const map = {};
    for (const [k, v] of Object.entries(row)) map[normalizeHeaderKey(k)] = v;
    for (const n of names) {
        const v = map[normalizeHeaderKey(n)];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
}

function pad2(n) {
    return String(n).padStart(2, '0');
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

    // Excel Date object stringified
    const dmy = s.match(/^(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{4})$/);
    if (dmy) {
        // Prefer DD-MM-YYYY (Pakistan)
        const a = Number(dmy[1]);
        const b = Number(dmy[2]);
        const y = Number(dmy[3]);
        if (a > 12 && b <= 12) return isoFromParts(y, b, a); // DD-MM
        if (b > 12 && a <= 12) return isoFromParts(y, a, b); // MM-DD
        return isoFromParts(y, b, a); // default DD-MM
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
        const hoursRaw = pick(row, 'Hours Worked', 'Hours', 'OT Hours');
        const dateRaw = pick(row, 'Date (DD-MM-YYYY)', 'Date', 'Claim Date');
        const timeFrom = pick(row, 'Time From (e.g. 08:00 PM)', 'Time From', 'From');
        const nature = pick(row, 'Nature of Work / Reason', 'Nature of Work', 'Reason');
        if (!empId && !hoursRaw && !dateRaw) continue;
        if (empId && !hoursRaw && !dateRaw && !timeFrom && !nature) continue; // prefill only

        const draft = {
            claim_type: 'OT',
            claim_date: toIsoDate(dateRaw),
            claim_date_raw: dateRaw || '',
            ot_hours: hoursRaw === '' ? null : parseFloat(String(hoursRaw).replace(/,/g, '')),
            ot_multiplier: normalizeMultiplier(pick(row, 'Overtime Multiplier', 'Multiplier', 'Rate')),
            nature,
            time_from: timeFrom,
            time_to: pick(row, 'Time To (e.g. 11:00 PM)', 'Time To', 'To'),
            description: nature,
        };
        if (!isMeaningfulOtRow(draft)) continue;
        if (dateRaw && !draft.claim_date) {
            errors.push(`Overtime row ${otRow}: could not read date "${dateRaw}". Try 06-01-2026, 6 Jan 2026, or 2026-01-06.`);
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
            const amountRaw = pick(row, 'Total Expense Amount', 'Amount', 'Expense Amount');
            const dateRaw = pick(row, 'Date (DD-MM-YYYY)', 'Date', 'Claim Date');
            const desc = pick(row, 'Description of Expense', 'Description');
            if (!empId && !amountRaw && !dateRaw) continue;
            if (empId && !amountRaw && !dateRaw && !desc) continue;
            const amount = amountRaw === '' ? null : parseFloat(String(amountRaw).replace(/,/g, ''));
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
                errors.push(`Expense row ${r}: could not read date "${dateRaw}". Try 15-06-2026 or 15 Jun 2026.`);
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
            const amountRaw = pick(row, 'Total Claim Amount', 'Amount', 'Claim Amount');
            const dateRaw = pick(row, 'Date (DD-MM-YYYY)', 'Date', 'Claim Date');
            const desc = pick(row, 'Description / Treatment Detail', 'Description', 'Treatment');
            if (!empId && !amountRaw && !dateRaw) continue;
            if (empId && !amountRaw && !dateRaw && !desc) continue;
            const amount = amountRaw === '' ? null : parseFloat(String(amountRaw).replace(/,/g, ''));
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
                errors.push(`Medical row ${r}: could not read date "${dateRaw}". Try 15-06-2026 or 15 Jun 2026.`);
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
    'Line Manager Name', 'Nature of Work / Reason', 'Time From', 'Time To',
    'Hours Worked (OT only)', 'Overtime Multiplier',
];
const EXP_HEADERS = [
    'Date', 'ASIL Employee Code', 'Employee Name', 'Department', 'Location',
    'Line Manager Name', 'Expense Type', 'Description of Expense', 'Total Expense Amount (PKR)',
];
const MED_HEADERS = [
    'Date', 'ASIL Employee Code', 'Employee Name', 'Department', 'Location',
    'Line Manager Name', 'Claim Type', 'Patient Name / Relation', 'Description / Treatment Detail', 'Total Claim Amount (PKR)',
];

const HEADER_FILL = '1E3A8A';
const HEADER_FONT = 'FFFFFF';
const LOCK_FILL = 'E2E8F0';
const ALT_ROW = 'F8FAFC';
const TITLE_FILL = '1E40AF';

async function buildPersonalizedClaimsWorkbookAsync(employees, opts = {}) {
    const list = employees || [];
    const claimMonth = opts.claimMonth || null;
    const claimYear = opts.claimYear || null;
    const monthLabel = claimMonth && claimYear
        ? `${MONTH_NAMES[claimMonth] || claimMonth} ${claimYear}`
        : 'this claim month';

    if (!ExcelJS) {
        return buildPersonalizedClaimsWorkbookFallback(list, opts);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ASIL HCM';
    wb.created = new Date();

    // Instructions
    const instr = wb.addWorksheet('Instructions', { views: [{ showGridLines: false }] });
    instr.getColumn(1).width = 100;
    instr.mergeCells('A1:A1');
    instr.getCell('A1').value = 'ASIL Claims Workbook — Instructions';
    instr.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    instr.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_FILL } };
    instr.getRow(1).height = 28;
    const lines = [
        '',
        `Claim month: ${monthLabel}`,
        '',
        '1. Yellow / grey columns (Employee Code, Name, Dept, Location, Manager) are prefilled for YOUR team — do not change them.',
        '2. Fill only the white claim columns: Date, times/hours/amounts, and descriptions.',
        '3. Dates: use any common format (15-06-2026, 15/06/2026, 15 Jun 2026, 2026-06-15).',
        '4. Times: 5:00 PM, 17:00, 5pm, or 1700 are all fine.',
        '5. Weekday OT: Time From / Time To must be the overtime period AFTER the standard 8-hour shift. Hours = OT only (not the full day).',
        '6. Triple (3×) OT is only for gazetted Eid days. Use Double (2×) for most OT.',
        '7. Only dates in the claim month above are accepted here. Older months cannot be submitted in this form — email claims@asil.com.pk.',
        '8. After upload: attach Expense supports and Medical supports as separate files before Submit. Without supports, those refunds are not processed.',
        '9. Questions / errors: ops-support@asil.com.pk or claims@asil.com.pk',
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
        ws.getRow(2).height = 20;
    }

    function addDataSheet(name, headers, slotsPerEmp, lockedCols) {
        const ws = wb.addWorksheet(name, {
            views: [{ state: 'frozen', ySplit: 3, activeCell: 'A4' }],
        });
        addTitleBlock(
            ws,
            `ASIL — ${name}`,
            `Claim month: ${monthLabel}  ·  Prefill = your employees only  ·  Fill white cells only`,
            headers.length
        );
        headers.forEach((h, i) => { ws.getCell(3, i + 1).value = h; });
        styleHeaderRow(ws, 3, headers.length);

        const widths = headers.map((h) => {
            if (/Employee Code/i.test(h)) return 26;
            if (/Employee Name/i.test(h)) return 22;
            if (/Nature|Description|Treatment/i.test(h)) return 28;
            if (/Department|Location|Manager/i.test(h)) return 16;
            if (/Multiplier|Hours|Amount/i.test(h)) return 14;
            if (/Time/i.test(h)) return 12;
            if (/Date/i.test(h)) return 14;
            return 14;
        });
        widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

        let r = 4;
        for (const e of list) {
            const id = e.id || e.employee_id || '';
            const nm = e.name || e.employee_name || '';
            const dept = e.dept || '';
            const loc = e.location || '';
            const mgr = e.line_manager_name || e.lineManagerName || '';
            for (let i = 0; i < slotsPerEmp; i++) {
                const row = ws.getRow(r);
                const values = headers.map((h) => {
                    if (/Employee Code/i.test(h)) return id;
                    if (/Employee Name/i.test(h)) return nm;
                    if (/Department/i.test(h)) return dept;
                    if (/Location/i.test(h)) return loc;
                    if (/Line Manager/i.test(h)) return mgr;
                    if (/Multiplier/i.test(h)) return i === 0 ? 'Double' : '';
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
                });
                row.height = 18;
                r += 1;
            }
        }

        // Data validation for multiplier on OT
        if (/overtime/i.test(name)) {
            const multCol = headers.findIndex(h => /Multiplier/i.test(h)) + 1;
            if (multCol > 0 && r > 4) {
                for (let rr = 4; rr < r; rr++) {
                    ws.getCell(rr, multCol).dataValidation = {
                        type: 'list',
                        allowBlank: true,
                        formulae: ['"Single,Double,Triple"'],
                        showErrorMessage: true,
                        errorTitle: 'OT Rate',
                        error: 'Choose Single, Double, or Triple',
                    };
                }
            }
        }
        return ws;
    }

    // Locked columns: Code, Name, Dept, Location, Manager = indexes 1-5
    addDataSheet('Overtime', OT_HEADERS, 2, [1, 2, 3, 4, 5]);
    addDataSheet('Expense Claims', EXP_HEADERS, 2, [1, 2, 3, 4, 5]);
    addDataSheet('Medical & IPD Claims', MED_HEADERS, 2, [1, 2, 3, 4, 5]);

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

    const wb = XLSX.utils.book_new();
    const note = [
        ['ASIL Claims — how to fill this file'],
        [`Claim month: ${monthLabel}`],
        [''],
        ['1. Employee Code and Name are prefilled for YOUR team only. Do not change them.'],
        ['2. Fill only claim columns (Date, hours/amounts, times, descriptions).'],
        ['3. Dates: 15-06-2026, 15/06/2026, 15 Jun 2026, or 2026-06-15.'],
        ['4. Times: 5:00 PM, 17:00, 5pm, or 1700.'],
        ['5. Weekday OT: Time From/To after the 8-hour shift; Hours = OT only.'],
        ['6. Older months cannot be submitted here — email claims@asil.com.pk.'],
        ['7. Attach Expense/Medical supports before Submit. Questions: ops-support@asil.com.pk'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(note), 'Instructions');

    function makeSheet(headers, slots) {
        const rows = [
            [`ASIL Claims · ${monthLabel}`],
            ['Prefill = your employees (grey conceptually) · Fill claim columns only'],
            headers,
        ];
        for (const e of list) {
            const id = e.id || e.employee_id || '';
            const name = e.name || e.employee_name || '';
            const dept = e.dept || '';
            const loc = e.location || '';
            const mgr = e.line_manager_name || e.lineManagerName || '';
            for (let i = 0; i < slots; i++) {
                const row = headers.map((h) => {
                    if (/Employee Code/i.test(h)) return id;
                    if (/Employee Name/i.test(h)) return name;
                    if (/Department/i.test(h)) return dept;
                    if (/Location/i.test(h)) return loc;
                    if (/Line Manager/i.test(h)) return mgr;
                    if (/Multiplier/i.test(h)) return i === 0 ? 'Double' : '';
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

    XLSX.utils.book_append_sheet(wb, makeSheet(OT_HEADERS, 2), 'Overtime');
    XLSX.utils.book_append_sheet(wb, makeSheet(EXP_HEADERS, 2), 'Expense Claims');
    XLSX.utils.book_append_sheet(wb, makeSheet(MED_HEADERS, 2), 'Medical & IPD Claims');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    parseMasterClaimsWorkbook,
    buildPersonalizedClaimsWorkbook,
    buildPersonalizedClaimsWorkbookAsync,
    resolveAllowedEmployeeId,
    toIsoDate,
    normalizeMultiplier,
    parseTimeToMinutes,
    hoursBetween,
    formatMinutes,
    isMeaningfulOtRow,
    isMeaningfulMoneyRow,
    MONTH_NAMES,
};
