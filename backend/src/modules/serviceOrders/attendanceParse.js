'use strict';

const XLSX = require('xlsx');

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const HEADER_ALIASES = {
    empCode: ['emp code', 'employee code', 'emp id', 'employee id', 'code'],
    name: ['name', 'employee name', 'emp name'],
    designation: ['designation', 'role', 'title'],
    expectedDays: ['expected days', 'expected', 'working days'],
    present: ['total present', 'present', 'days present'],
    absent: ['total absent', 'absent', 'days absent', 'absences'],
};

function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumnIndex(headers, aliases) {
    const normalized = headers.map(normalizeHeader);
    for (const alias of aliases) {
        const idx = normalized.indexOf(alias);
        if (idx >= 0) return idx;
    }
    for (let i = 0; i < normalized.length; i++) {
        if (aliases.some(a => normalized[i].includes(a))) return i;
    }
    return -1;
}

function expectedSheetName(month, year) {
    const m = Number(month);
    const y = Number(year);
    if (!m || m < 1 || m > 12 || !y) return null;
    return `${MONTH_NAMES[m - 1]} ${y}`;
}

function parseConservancyWorkbook(buffer, { month, year, sheetName } = {}) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const targetSheet = sheetName || expectedSheetName(month, year);
    let sheet = targetSheet ? wb.Sheets[targetSheet] : null;
    if (!sheet && targetSheet) {
        const lower = targetSheet.toLowerCase();
        const key = wb.SheetNames.find(n => n.toLowerCase() === lower);
        if (key) sheet = wb.Sheets[key];
    }
    if (!sheet) {
        sheet = wb.Sheets[wb.SheetNames[0]];
    }
    if (!sheet) {
        return { ok: false, error: 'No worksheet found', sheetName: targetSheet, rows: [] };
    }

    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!matrix.length) {
        return { ok: false, error: 'Empty worksheet', sheetName: targetSheet || wb.SheetNames[0], rows: [] };
    }

    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(matrix.length, 10); i++) {
        const row = matrix[i].map(c => normalizeHeader(c));
        if (row.some(c => c.includes('emp') && c.includes('code'))) {
            headerRowIdx = i;
            break;
        }
    }

    const headers = (matrix[headerRowIdx] || []).map(h => String(h || ''));
    const col = {
        empCode: findColumnIndex(headers, HEADER_ALIASES.empCode),
        name: findColumnIndex(headers, HEADER_ALIASES.name),
        designation: findColumnIndex(headers, HEADER_ALIASES.designation),
        expectedDays: findColumnIndex(headers, HEADER_ALIASES.expectedDays),
        present: findColumnIndex(headers, HEADER_ALIASES.present),
        absent: findColumnIndex(headers, HEADER_ALIASES.absent),
    };

    if (col.empCode < 0 || col.absent < 0) {
        return {
            ok: false,
            error: 'Required columns not found (Emp Code, Total Absent)',
            sheetName: targetSheet || wb.SheetNames[0],
            headers,
            rows: [],
        };
    }

    const rows = [];
    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
        const line = matrix[r];
        const empCode = String(line[col.empCode] || '').trim();
        if (!empCode || empCode.toLowerCase() === 'total') continue;
        rows.push({
            empCode,
            name: col.name >= 0 ? String(line[col.name] || '').trim() : '',
            designation: col.designation >= 0 ? String(line[col.designation] || '').trim() : '',
            expectedDays: col.expectedDays >= 0 ? Number(line[col.expectedDays]) || 0 : 0,
            presentDays: col.present >= 0 ? Number(line[col.present]) || 0 : 0,
            absentDays: Number(line[col.absent]) || 0,
        });
    }

    return {
        ok: true,
        sheetName: targetSheet || wb.SheetNames[0],
        headers,
        rows,
    };
}

module.exports = {
    MONTH_NAMES,
    expectedSheetName,
    parseConservancyWorkbook,
    normalizeHeader,
    findColumnIndex,
};
