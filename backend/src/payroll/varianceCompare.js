'use strict';

/** Canonical fields compared between Excel export and HCM payroll_run_rows */
const COMPARE_FIELDS = [
    'paid_days',
    'gross',
    'income_tax',
    'eobi',
    'sessi_or_pessi',
    'pf',
    'advances',
    'other_deductions',
    'net_pay',
];

const EXCEL_ALIASES = {
    employee_id: ['employee_id', 'emp_id', 'id', 'asil_id'],
    employee_name: ['employee_name', 'name', 'emp_name'],
    paid_days: ['paid_days', 'paid days', 'present_days'],
    gross: ['gross', 'gross_pay', 'gross pay'],
    income_tax: ['income_tax', 'wht', 'tax', 'income tax'],
    eobi: ['eobi', 'eobi_ee'],
    sessi_or_pessi: ['sessi_or_pessi', 'sessi', 'pessi', 'sessi_er'],
    pf: ['pf', 'pf_ee', 'provident_fund'],
    advances: ['advances', 'advance', 'adv'],
    other_deductions: ['other_deductions', 'other_deduction', 'other deductions'],
    net_pay: ['net_pay', 'net', 'net pay'],
};

function normalizeEmployeeId(id) {
    if (id == null) return '';
    return String(id).trim().toUpperCase().replace(/\s+/g, '');
}

function parseMoney(value) {
    if (value == null || value === '') return 0;
    const s = String(value).replace(/,/g, '').trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

function roundRupee(n) {
    if (!Number.isFinite(n)) return NaN;
    return Math.round(n * 100) / 100;
}

function fieldDelta(excelVal, hcmVal) {
    const av = roundRupee(excelVal);
    const bv = roundRupee(hcmVal);
    if (Number.isNaN(av) || Number.isNaN(bv)) return NaN;
    return roundRupee(av - bv);
}

function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function buildHeaderMap(headers) {
    const map = {};
    for (const h of headers) {
        map[normalizeHeader(h)] = h;
    }
    return map;
}

function mapCsvRow(rawRow, headerMap) {
    const out = { employee_id: '', employee_name: '' };
    for (const [canonical, aliases] of Object.entries(EXCEL_ALIASES)) {
        for (const alias of aliases) {
            const norm = normalizeHeader(alias);
            const key = headerMap[norm];
            if (key != null && rawRow[key] !== undefined && rawRow[key] !== '') {
                if (canonical === 'employee_id') {
                    out.employee_id = normalizeEmployeeId(rawRow[key]);
                } else if (canonical === 'employee_name') {
                    out.employee_name = String(rawRow[key]).trim();
                } else {
                    out[canonical] = parseMoney(rawRow[key]);
                }
                break;
            }
        }
    }
    return out;
}

function parseExcelCsv(text) {
    const { parse } = require('csv-parse/sync');
    const records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
    });
    if (!records.length) return [];
    const headerMap = buildHeaderMap(Object.keys(records[0]));
    return records.map((r) => mapCsvRow(r, headerMap)).filter((r) => r.employee_id);
}

function extractHcmRow(row) {
    const c = typeof row.computed === 'string' ? JSON.parse(row.computed) : (row.computed || {});
    const inputs = typeof row.inputs === 'string' ? JSON.parse(row.inputs) : (row.inputs || {});
    return {
        employee_id: normalizeEmployeeId(row.employee_id),
        employee_name: row.employee_name || '',
        paid_days: Number(c.paidDays ?? row.paid_days ?? 0),
        gross: Number(c.gross ?? 0),
        income_tax: Number(c.wht ?? 0),
        eobi: Number(c.eobiEmployee ?? 0),
        sessi_or_pessi: Number(c.sessiEmployer ?? 0),
        pf: Number(c.pfDeduction ?? inputs.pfDeduction ?? 0),
        advances: Number(inputs.advanceDeduction ?? inputs.advances ?? 0),
        other_deductions: Number(inputs.otherDeduction ?? 0),
        net_pay: Number(c.netPay ?? 0),
    };
}

function hcmRowToExcelShape(hcmExtracted) {
    return { ...hcmExtracted };
}

function comparePayrollVariance(excelRows, hcmRows) {
    const excelMap = new Map();
    for (const r of excelRows) {
        if (r.employee_id) excelMap.set(r.employee_id, r);
    }
    const hcmMap = new Map();
    for (const r of hcmRows) {
        const h = typeof r.net_pay !== 'undefined' ? r : extractHcmRow(r);
        if (h.employee_id) hcmMap.set(h.employee_id, h);
    }

    const unmatchedExcel = [];
    const unmatchedHcm = [];
    for (const id of excelMap.keys()) {
        if (!hcmMap.has(id)) unmatchedExcel.push(excelMap.get(id));
    }
    for (const id of hcmMap.keys()) {
        if (!excelMap.has(id)) unmatchedHcm.push(hcmMap.get(id));
    }

    const matchedIds = [...excelMap.keys()].filter((id) => hcmMap.has(id));
    const comparisons = [];
    let rowsAllZero = 0;
    const fieldNonZeroCounts = Object.fromEntries(COMPARE_FIELDS.map((f) => [f, 0]));
    let maxAbsDelta = 0;
    let maxAbsDeltaEmployee = null;
    let maxAbsDeltaField = null;
    let totalNetDelta = 0;

    for (const id of matchedIds) {
        const excel = excelMap.get(id);
        const hcm = hcmMap.get(id);
        const fields = {};
        let rowAllZero = true;

        for (const field of COMPARE_FIELDS) {
            const ev = excel[field] ?? 0;
            const hv = hcm[field] ?? 0;
            const d = fieldDelta(ev, hv);
            fields[field] = { excel: ev, hcm: hv, delta: d };
            if (d !== 0) {
                rowAllZero = false;
                fieldNonZeroCounts[field] += 1;
                if (Math.abs(d) > Math.abs(maxAbsDelta)) {
                    maxAbsDelta = d;
                    maxAbsDeltaEmployee = id;
                    maxAbsDeltaField = field;
                }
            }
        }

        if (rowAllZero) rowsAllZero += 1;
        totalNetDelta += fields.net_pay.delta;
        comparisons.push({
            employee_id: id,
            employee_name: excel.employee_name || hcm.employee_name,
            fields,
            all_zero: rowAllZero,
        });
    }

    const hasVariance = unmatchedExcel.length > 0
        || unmatchedHcm.length > 0
        || rowsAllZero < matchedIds.length;

    return {
        comparisons,
        unmatchedExcel,
        unmatchedHcm,
        summary: {
            rowsCompared: matchedIds.length,
            rowsAllZero,
            unmatchedExcelCount: unmatchedExcel.length,
            unmatchedHcmCount: unmatchedHcm.length,
            fieldNonZeroCounts,
            maxAbsDelta,
            maxAbsDeltaEmployee,
            maxAbsDeltaField,
            totalNetDelta: roundRupee(totalNetDelta),
            hasVariance,
        },
    };
}

function formatVarianceCsv(result) {
    const header = [
        'employee_id',
        'employee_name',
        ...COMPARE_FIELDS.flatMap((f) => [`excel_${f}`, `hcm_${f}`, `delta_${f}`]),
        'all_zero',
    ];
    const lines = [header.join(',')];
    for (const row of result.comparisons) {
        const cols = [
            row.employee_id,
            `"${(row.employee_name || '').replace(/"/g, '""')}"`,
        ];
        for (const field of COMPARE_FIELDS) {
            const f = row.fields[field];
            cols.push(f.excel, f.hcm, f.delta);
        }
        cols.push(row.all_zero ? '1' : '0');
        lines.push(cols.join(','));
    }
    return lines.join('\n') + '\n';
}

function formatVarianceSummaryMd(result, meta = {}) {
    const s = result.summary;
    const lines = [
        '# Payroll variance summary',
        '',
        `**Contract:** ${meta.contractId || '—'}`,
        `**Period:** ${meta.year || '—'}-${String(meta.month || '').padStart(2, '0')}`,
        `**Generated:** ${new Date().toISOString()}`,
        '',
        '## Totals',
        `- Rows compared: ${s.rowsCompared}`,
        `- Rows with all-field delta = 0: ${s.rowsAllZero}`,
        `- Unmatched Excel rows: ${s.unmatchedExcelCount}`,
        `- Unmatched HCM rows: ${s.unmatchedHcmCount}`,
        `- Total net delta (Excel − HCM): ${s.totalNetDelta}`,
        '',
        '## Per-field non-zero delta counts',
    ];
    for (const field of COMPARE_FIELDS) {
        lines.push(`- ${field}: ${s.fieldNonZeroCounts[field]}`);
    }
    lines.push('');
    lines.push('## Max |delta|');
    lines.push(`- Employee: ${s.maxAbsDeltaEmployee || '—'}`);
    lines.push(`- Field: ${s.maxAbsDeltaField || '—'}`);
    lines.push(`- Delta: ${s.maxAbsDelta}`);
    lines.push('');

    if (result.unmatchedExcel.length) {
        lines.push('## Unmatched in Excel only');
        for (const r of result.unmatchedExcel) {
            lines.push(`- ${r.employee_id} ${r.employee_name || ''}`);
        }
        lines.push('');
    }
    if (result.unmatchedHcm.length) {
        lines.push('## Unmatched in HCM only');
        for (const r of result.unmatchedHcm) {
            lines.push(`- ${r.employee_id} ${r.employee_name || ''}`);
        }
        lines.push('');
    }

    lines.push(`**Gate:** ${s.hasVariance ? 'FAIL (variance present)' : 'PASS (zero variance)'}`);
    return lines.join('\n');
}

module.exports = {
    COMPARE_FIELDS,
    EXCEL_ALIASES,
    normalizeEmployeeId,
    parseMoney,
    roundRupee,
    fieldDelta,
    parseExcelCsv,
    extractHcmRow,
    hcmRowToExcelShape,
    comparePayrollVariance,
    formatVarianceCsv,
    formatVarianceSummaryMd,
};
