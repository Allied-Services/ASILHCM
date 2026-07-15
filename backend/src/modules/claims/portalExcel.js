'use strict';

/**
 * Parse ASIL Consolidated Master Claims Template (3 sheets):
 *  - Sheet (OT)
 *  - Expense Claims
 *  - Medical & IPD Claims
 */
const XLSX = require('xlsx');

function sheetToObjects(ws) {
    if (!ws) return [];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    return rows;
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

/**
 * @param {Buffer} buffer
 * @param {{ allowedEmployeeIds?: string[] }} opts
 * @returns {{ itemsByEmployee: Map<string, object[]>, errors: string[], warnings: string[] }}
 */
function parseMasterClaimsWorkbook(buffer, opts = {}) {
    const allowed = new Set((opts.allowedEmployeeIds || []).map(id => String(id).trim().toUpperCase()));
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const errors = [];
    const warnings = [];
    const itemsByEmployee = new Map();

    function addItem(empId, item) {
        const id = String(empId || '').trim();
        if (!id) {
            errors.push(`Row missing ASIL Employee Code (${item.claim_type})`);
            return;
        }
        if (allowed.size && !allowed.has(id.toUpperCase())) {
            errors.push(`${id}: not in your Claim Authority list for this period`);
            return;
        }
        if (!itemsByEmployee.has(id)) itemsByEmployee.set(id, []);
        itemsByEmployee.get(id).push(item);
    }

    // OT sheet — first sheet is usually named "Sheet"
    const otName = wb.SheetNames.find(n => /^sheet$/i.test(n) || /overtime|\bot\b/i.test(n)) || wb.SheetNames[0];
    for (const row of sheetToObjects(wb.Sheets[otName])) {
        const empId = pick(row, 'ASIL Employee Code', 'Employee Code', 'Employee ID');
        const hours = parseFloat(pick(row, 'Hours Worked', 'Hours', 'OT Hours'));
        if (!empId && !hours) continue;
        const claim_date = toIsoDate(pick(row, 'Date (DD-MM-YYYY)', 'Date'));
        addItem(empId, {
            claim_type: 'OT',
            claim_date,
            ot_hours: hours,
            ot_multiplier: normalizeMultiplier(pick(row, 'Overtime Multiplier', 'Multiplier', 'Rate')),
            nature: pick(row, 'Nature of Work / Reason', 'Nature of Work', 'Reason'),
            time_from: pick(row, 'Time From (e.g. 08:00 PM)', 'Time From'),
            time_to: pick(row, 'Time To (e.g. 11:00 PM)', 'Time To'),
            description: pick(row, 'Nature of Work / Reason', 'Nature of Work', 'Reason'),
        });
    }

    const expName = wb.SheetNames.find(n => /expense/i.test(n));
    if (expName) {
        for (const row of sheetToObjects(wb.Sheets[expName])) {
            const empId = pick(row, 'ASIL Employee Code', 'Employee Code');
            const amount = parseFloat(pick(row, 'Total Expense Amount', 'Amount', 'Expense Amount'));
            if (!empId && !amount) continue;
            addItem(empId, {
                claim_type: 'EXPENSE',
                claim_date: toIsoDate(pick(row, 'Date (DD-MM-YYYY)', 'Date')),
                amount,
                expense_type: pick(row, 'Expense Type', 'Type'),
                description: pick(row, 'Description of Expense', 'Description'),
            });
        }
    } else {
        warnings.push('Expense Claims sheet not found in workbook');
    }

    const medName = wb.SheetNames.find(n => /medical|ipd/i.test(n));
    if (medName) {
        for (const row of sheetToObjects(wb.Sheets[medName])) {
            const empId = pick(row, 'ASIL Employee Code', 'Employee Code');
            const amount = parseFloat(pick(row, 'Total Claim Amount', 'Amount', 'Claim Amount'));
            if (!empId && !amount) continue;
            addItem(empId, {
                claim_type: 'MEDICAL',
                claim_date: toIsoDate(pick(row, 'Date (DD-MM-YYYY)', 'Date')),
                amount,
                patient_name: pick(row, 'Patient Name / Relation', 'Patient Name', 'Patient'),
                description: pick(row, 'Description / Treatment Detail', 'Description', 'Treatment'),
                expense_type: pick(row, 'Claim Type', 'Type'),
            });
        }
    } else {
        warnings.push('Medical & IPD Claims sheet not found in workbook');
    }

    return { itemsByEmployee, errors, warnings, sheetNames: wb.SheetNames };
}

module.exports = {
    parseMasterClaimsWorkbook,
    toIsoDate,
    normalizeMultiplier,
};
