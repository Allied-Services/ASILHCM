#!/usr/bin/env node
'use strict';
/**
 * July 2026 WAFI payroll alignment — Excel verify vs HCM payroll_transactions.
 * Scope: Wafi Energy Pakistan Pvt Ltd only.
 *
 * Usage:
 *   node audit/july_alignment_report.js [--out audit/JULY_GAP_REPORT_BASELINE.md]
 *
 * Env: DATABASE_URL or STAGING_DATABASE_URL (from backend/.env / .env.local)
 */
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..', 'backend');
const tempRoot = 'C:/temp/BPOFMSystem-backend';

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

loadEnvFile(path.join(backendRoot, '.env'));
loadEnvFile(path.join(backendRoot, '.env.local'));

function req(name) {
    for (const root of [tempRoot, backendRoot]) {
        try { return require(path.join(root, 'node_modules', name)); }
        catch (_) { /* try next */ }
    }
    throw new Error(`Cannot load module ${name}`);
}

const { Pool } = req('pg');
const { resolvePayrollSheetBonus } = require(path.join(tempRoot, 'src', 'payroll', 'prSheetEngine'));
const { loadBonusWorkingMap } = require(path.join(tempRoot, 'src', 'payroll', 'julyBonusAccrual'));

const WAFI_CLIENT = 'Wafi Energy Pakistan Pvt Ltd';
const TARGET_MONTH = 7;
const TARGET_YEAR = 2026;
const TOLERANCE = 1; // PKR per employee

const VERIFY_CSV = path.join(__dirname, 'july_inputs', 'july_verify.csv');
const DEFAULT_OUT = process.env.GAP_REPORT_OUT
    || path.join(__dirname, 'JULY_GAP_REPORT_BASELINE.md');

const COL = {
    ASIL_CODE: 'ASIL Employee Code',
    ACTIVE: 'Active',
    CLIENT: 'Client',
    CLIENT_BU: 'Client BU',
    EMP_NAME: 'Employee Name',
    MONTH: 'Month #',
    YEAR: 'Year',
    NET_PAY: 'Net Pay for the Month',
    SPECIAL_ALLOWANCE: 'Special Allowance',
};

function num(v) {
    if (v == null || v === '') return 0;
    const s = String(v).replace(/,/g, '').replace(/[^\d.\-]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

function normalizeId(id) {
    return String(id || '').trim().toUpperCase().replace(/\s+/g, '');
}

function parseCsvLine(line) {
    const vals = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    vals.push(cur.trim());
    return vals;
}

function parseVerifyCsv(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '');
    const lines = raw.split('\n').filter(Boolean);
    // Handle multiline header (EOBI employer column spans lines in source file)
    let headerLine = lines[0];
    let dataStart = 1;
    if (!headerLine.includes('Net Pay for the Month') && lines.length > 1) {
        headerLine = lines.slice(0, 2).join('').replace(/\n/g, '');
        dataStart = 2;
    }
    const hdrs = parseCsvLine(headerLine).map(h => h.replace(/"/g, '').trim());
    const idx = (name) => hdrs.findIndex(h => h === name || h.startsWith(name));

    const rows = [];
    for (let i = dataStart; i < lines.length; i += 1) {
        const vals = parseCsvLine(lines[i]);
        const obj = {};
        hdrs.forEach((h, j) => { obj[h] = vals[j] || ''; });

        const eid = String(obj[COL.ASIL_CODE] || '').trim();
        if (!eid || !/^ASIL/i.test(eid)) continue;

        const client = String(obj[COL.CLIENT] || '').trim();
        if (client !== WAFI_CLIENT) continue;

        const active = String(obj[COL.ACTIVE] || '').toLowerCase();
        if (active === 'no' || active === 'false') continue;

        const m = num(obj[COL.MONTH]);
        const y = num(obj[COL.YEAR]);
        if (m !== TARGET_MONTH || y !== TARGET_YEAR) continue;

        const net = num(obj[COL.NET_PAY]);
        const bonusExcel = num(obj[COL.SPECIAL_ALLOWANCE]);
        if (!Number.isFinite(net) && !Number.isFinite(bonusExcel)) continue;

        rows.push({
            employee_id: normalizeId(eid),
            employee_name: String(obj[COL.EMP_NAME] || '').trim(),
            contract_bu: String(obj[COL.CLIENT_BU] || '').trim(),
            net_pay: Number.isFinite(net) ? Math.round(net) : 0,
            bonus_excel: Number.isFinite(bonusExcel) ? Math.round(bonusExcel) : 0,
        });
    }
    return rows;
}

function fmt(n) {
    return (Number(n) || 0).toLocaleString('en-PK');
}

async function loadHcm(pool) {
    const { rows: employees } = await pool.query(
        `SELECT e.id, e.name, e.salary, e.doj, e.contract_id, e.contract_name, e.client,
                c.costs AS contract_costs
         FROM employees e
         LEFT JOIN contracts c ON c.id = e.contract_id
         WHERE LOWER(TRIM(e.client)) = LOWER($1)
           AND COALESCE(LOWER(TRIM(e.active)), 'yes') IN ('yes', 'true', '1')`,
        [WAFI_CLIENT],
    );

    const { rows: payroll } = await pool.query(
        `SELECT pt.* FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE pt.month = $1 AND pt.year = $2
           AND LOWER(TRIM(e.client)) = LOWER($3)`,
        [TARGET_MONTH, TARGET_YEAR, WAFI_CLIENT],
    );

    const payrollMap = {};
    payroll.forEach(r => { payrollMap[normalizeId(r.employee_id)] = r; });

    return { employees, payrollMap };
}

function hcmBonusDisbursed(emp, pt, costs = {}, bonusMap) {
    if (pt?.bonus_amount != null && pt.bonus_amount !== '') {
        return Math.round(parseFloat(pt.bonus_amount) || 0);
    }
    const c = costs || {};
    return resolvePayrollSheetBonus({
        employeeId: emp.id,
        contractId: emp.contract_id,
        salary: emp.salary,
        doj: emp.doj,
        month: TARGET_MONTH,
        year: TARGET_YEAR,
        bonusMonths: c.bonus_months,
        bonusMinMonths: c.bonus_min_months,
        disbursementMonth: c.bonus_disbursement_month,
        bonusMap,
    });
}

function buildReport(excelRows, hcm, bonusMap) {
    const { employees, payrollMap } = hcm;
    const hcmIds = new Set(employees.map(e => normalizeId(e.id)));
    const excelIds = new Set(excelRows.map(r => r.employee_id));

    const empById = {};
    employees.forEach(e => { empById[normalizeId(e.id)] = e; });

    const mismatches = [];
    let excelNetTotal = 0;
    let hcmNetTotal = 0;
    let excelBonusTotal = 0;
    let hcmBonusTotal = 0;
    let matchCount = 0;
    let bonusMatchCount = 0;
    let bonusWithExcel = 0;

    const byContract = {};

    for (const ex of excelRows) {
        excelNetTotal += ex.net_pay;
        excelBonusTotal += ex.bonus_excel;

        const emp = empById[ex.employee_id];
        const pt = payrollMap[ex.employee_id];
        const contractKey = ex.contract_bu || emp?.contract_name || 'Unknown';
        if (!byContract[contractKey]) {
            byContract[contractKey] = {
                count: 0, excelNet: 0, hcmNet: 0, mismatches: 0, bonusExcel: 0, bonusHcm: 0,
            };
        }
        byContract[contractKey].count += 1;
        byContract[contractKey].excelNet += ex.net_pay;
        byContract[contractKey].bonusExcel += ex.bonus_excel;

        const hcmNet = pt ? Math.round(parseFloat(pt.net) || 0) : null;
        const costs = emp?.contract_costs || {};
        const bonusHcm = emp ? hcmBonusDisbursed(emp, pt, costs, bonusMap) : 0;

        if (ex.bonus_excel > 0) bonusWithExcel += 1;

        if (hcmNet != null) {
            hcmNetTotal += hcmNet;
            hcmBonusTotal += bonusHcm;
            byContract[contractKey].hcmNet += hcmNet;
            byContract[contractKey].bonusHcm += bonusHcm;
        }

        const netDelta = hcmNet != null ? ex.net_pay - hcmNet : null;
        const bonusDelta = bonusHcm - ex.bonus_excel;
        const netOk = netDelta != null && Math.abs(netDelta) <= TOLERANCE;
        const bonusOk = Math.abs(bonusDelta) <= TOLERANCE;

        let explainNote = '';
        if (!netOk && bonusOk) {
            if (/^ASILFM\//i.test(ex.employee_id)) {
                explainNote = 'FM staffing row: Excel uses FM partial-month rate; HCM master salary/engine differs';
            } else {
                explainNote = 'Bonus matches; net gap from base pay / OT / arrears / WHT engine vs Excel verify';
            }
        } else if (!netOk && !bonusOk) {
            explainNote = 'Bonus and net both differ';
        } else if (!netOk && ex.bonus_excel === 0 && bonusHcm === 0) {
            explainNote = 'No bonus; net gap from attendance or salary components';
        }

        if (netOk) matchCount += 1;
        if (bonusOk && ex.bonus_excel > 0) bonusMatchCount += 1;

        if (!netOk || !bonusOk || hcmNet == null) {
            mismatches.push({
                employee_id: ex.employee_id,
                name: ex.employee_name,
                contract: contractKey,
                excel_net: ex.net_pay,
                hcm_net: hcmNet,
                net_delta: netDelta,
                excel_bonus: ex.bonus_excel,
                hcm_bonus: bonusHcm,
                bonus_delta: bonusDelta,
                explain: explainNote,
                in_hcm: !!pt,
                in_master: !!emp,
            });
            if (!netOk) byContract[contractKey].mismatches += 1;
        }
    }

    const excelOnly = [...excelIds].filter(id => !hcmIds.has(id));
    const hcmOnly = [...hcmIds].filter(id => !excelIds.has(id) && payrollMap[id]);

    const excelBonusById = {};
    excelRows.forEach((ex) => { excelBonusById[ex.employee_id] = ex.bonus_excel; });

    const hcmBonusNoExcel = [];
    let hcmBonusRowCount = 0;
    for (const emp of employees) {
        const eid = normalizeId(emp.id);
        const pt = payrollMap[eid];
        const costs = emp.contract_costs || {};
        const bonusHcm = hcmBonusDisbursed(emp, pt, costs, bonusMap);
        if (bonusHcm > 0) {
            hcmBonusRowCount += 1;
            const excelBonus = excelBonusById[eid] || 0;
            if (excelBonus <= 0) {
                hcmBonusNoExcel.push({
                    employee_id: eid,
                    name: emp.name,
                    contract_id: emp.contract_id || '',
                    hcm_bonus: bonusHcm,
                });
            }
        }
    }

    const explainedBase = mismatches.filter(m => m.explain && m.explain.startsWith('Bonus matches')).length;
    const explainedFm = mismatches.filter(m => m.explain && m.explain.startsWith('FM staffing')).length;

    return {
        excelCount: excelRows.length,
        hcmPayrollCount: Object.keys(payrollMap).length,
        hcmMasterCount: employees.length,
        excelNetTotal,
        hcmNetTotal,
        netDeltaTotal: excelNetTotal - hcmNetTotal,
        excelBonusTotal,
        hcmBonusTotal,
        bonusDeltaTotal: hcmBonusTotal - excelBonusTotal,
        matchCount,
        mismatchCount: excelRows.length - matchCount,
        bonusMatchCount,
        bonusWithExcel,
        bonusMismatchCount: bonusWithExcel - bonusMatchCount,
        explainedBaseEngine: explainedBase,
        explainedFmStaffing: explainedFm,
        hcmBonusRowCount,
        hcmBonusNoExcel,
        mismatches: mismatches.sort((a, b) => Math.abs(b.net_delta || 999999) - Math.abs(a.net_delta || 999999)),
        byContract,
        excelOnly,
        hcmOnly,
    };
}

function formatMd(report, label) {
    const lines = [];
    lines.push(`# July 2026 WAFI Payroll Gap Report — ${label}`);
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Scope: **${WAFI_CLIENT}** only`);
    lines.push(`Excel source: \`audit/july_inputs/july_verify.csv\``);
    lines.push(`Target: ${TARGET_MONTH}/${TARGET_YEAR} net pay ± PKR ${TOLERANCE} per employee`);
    lines.push('');
    lines.push('## Population');
    lines.push('');
    lines.push(`| Metric | Count |`);
    lines.push(`|--------|------:|`);
    lines.push(`| Excel active WAFI rows | ${report.excelCount} |`);
    lines.push(`| HCM employee master (WAFI) | ${report.hcmMasterCount} |`);
    lines.push(`| HCM payroll_transactions July 2026 | ${report.hcmPayrollCount} |`);
    lines.push(`| Net pay matches (±${TOLERANCE}) | ${report.matchCount} |`);
    lines.push(`| Net pay mismatches | ${report.mismatchCount} |`);
    lines.push(`| Bonus matches (Excel AB > 0, ±${TOLERANCE}) | ${report.bonusMatchCount} / ${report.bonusWithExcel} |`);
    lines.push(`| Bonus mismatches (Excel AB > 0) | ${report.bonusMismatchCount} |`);
    lines.push(`| HCM rows with bonus > 0 (all active WAFI) | ${report.hcmBonusRowCount} |`);
    lines.push(`| HCM bonus > 0 but Excel AB = 0 | ${report.hcmBonusNoExcel.length} |`);
    lines.push(`| Excel-only (not in HCM master) | ${report.excelOnly.length} |`);
    lines.push(`| HCM payroll-only (not in Excel) | ${report.hcmOnly.length} |`);
    lines.push('');
    lines.push('## Totals');
    lines.push('');
    lines.push(`| | Excel | HCM | Delta |`);
    lines.push(`|---|------:|----:|------:|`);
    lines.push(`| Net pay | ${fmt(report.excelNetTotal)} | ${fmt(report.hcmNetTotal)} | ${fmt(report.netDeltaTotal)} |`);
    lines.push(`| Bonus (Excel AB / HCM bonus_amount) | ${fmt(report.excelBonusTotal)} | ${fmt(report.hcmBonusTotal)} | ${fmt(report.bonusDeltaTotal)} |`);
    lines.push('');
    lines.push(`**Bonus alignment:** ${report.bonusMatchCount}/${report.bonusWithExcel} employees with Excel AB > 0 match within ±${TOLERANCE} PKR. Total bonus delta: ${fmt(report.bonusDeltaTotal)}.`);
    lines.push('');
    if (report.hcmBonusNoExcel.length) {
        lines.push('## HCM bonus > 0 but Excel AB = 0 (223 vs 217 explanation)');
        lines.push('');
        lines.push('These employees show bonus on the Payroll Sheet but Excel July verify has zero Special Allowance (AB).');
        lines.push('');
        lines.push('| Employee ID | Name | Contract ID | HCM Bonus | Likely reason |');
        lines.push('|-------------|------|-------------|----------:|---------------|');
        report.hcmBonusNoExcel
            .sort((a, b) => b.hcm_bonus - a.hcm_bonus)
            .forEach((r) => {
                let reason = 'On bonus working sheet; not in July Excel AB';
                if (r.employee_id === 'ASIL/SPL-361/21') reason = 'Duplicate Rafae Kayani — deactivate 361; pay 420 only';
                if (/^ASILFM\//i.test(r.employee_id)) reason = 'FM staffing — Excel AB zero; HCM should be zero';
                lines.push(`| ${r.employee_id} | ${r.name} | ${r.contract_id} | ${fmt(r.hcm_bonus)} | ${reason} |`);
            });
        lines.push('');
    }
    lines.push('## Explained gap summary (net pay)');
    lines.push('');
    lines.push(`| Category | Count |`);
    lines.push(`|----------|------:|`);
    lines.push(`| Net mismatches (total) | ${report.mismatchCount} |`);
    lines.push(`| Bonus OK, base/engine gap | ${report.explainedBaseEngine} |`);
    lines.push(`| FM staffing (ASILFM/*) partial-month | ${report.explainedFmStaffing} |`);
    lines.push(`| Net matches (±${TOLERANCE}) | ${report.matchCount} |`);
    lines.push('');
    lines.push('_July 2026 bonus uses 12-month accrual sheet Total (+ SPL-420 override 105,000). FM contracts Apr disbursement = zero July bonus. Wafi BPO contract month 8 = payment timing only — bonus still on July payroll sheet._');
    lines.push('');
    lines.push('## By contract (Client BU)');
    lines.push('');
    lines.push('| Contract | Employees | Excel Net | HCM Net | Net Δ | Mismatches | Excel Bonus | HCM Bonus |');
    lines.push('|----------|----------:|----------:|--------:|------:|-----------:|------------:|----------:|');
    Object.entries(report.byContract)
        .sort((a, b) => b[1].excelNet - a[1].excelNet)
        .forEach(([name, g]) => {
            lines.push(`| ${name} | ${g.count} | ${fmt(g.excelNet)} | ${fmt(g.hcmNet)} | ${fmt(g.excelNet - g.hcmNet)} | ${g.mismatches} | ${fmt(g.bonusExcel)} | ${fmt(g.bonusHcm)} |`);
        });
    lines.push('');
    lines.push('## Top mismatches (by |net Δ|)');
    lines.push('');
    lines.push('| Employee | Contract | Excel Net | HCM Net | Δ Net | Excel Bonus | HCM Bonus | Δ Bonus | Notes |');
    lines.push('|----------|----------|----------:|--------:|------:|------------:|----------:|--------:|-------|');
    report.mismatches.slice(0, 50).forEach(m => {
        const notes = [];
        if (m.explain) notes.push(m.explain);
        if (!m.in_master) notes.push('not in master');
        if (!m.in_hcm) notes.push('no payroll row');
        lines.push(`| ${m.employee_id} | ${m.contract} | ${fmt(m.excel_net)} | ${m.hcm_net != null ? fmt(m.hcm_net) : '—'} | ${m.net_delta != null ? fmt(m.net_delta) : '—'} | ${fmt(m.excel_bonus)} | ${fmt(m.hcm_bonus)} | ${fmt(m.bonus_delta)} | ${notes.join('; ')} |`);
    });
    if (report.mismatches.length > 50) {
        lines.push('');
        lines.push(`_…and ${report.mismatches.length - 50} more mismatches_`);
    }
    if (report.excelOnly.length) {
        lines.push('');
        lines.push('## Excel-only IDs');
        lines.push(report.excelOnly.slice(0, 20).join(', ') + (report.excelOnly.length > 20 ? '…' : ''));
    }
    lines.push('');
    return lines.join('\n');
}

(async () => {
    const outArg = process.argv.indexOf('--out');
    const outPath = outArg >= 0 ? process.argv[outArg + 1] : DEFAULT_OUT;

    if (!fs.existsSync(VERIFY_CSV)) {
        console.error('FATAL: missing', VERIFY_CSV);
        process.exit(1);
    }

    const dbUrl = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('FATAL: set DATABASE_URL in backend/.env');
        process.exit(1);
    }

    const excelRows = parseVerifyCsv(VERIFY_CSV);
    console.log(`Excel WAFI rows: ${excelRows.length}`);

    const bonusMap = loadBonusWorkingMap();
    console.log(`Bonus working sheet rows: ${bonusMap.size}`);

    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true } });
    try {
        const hcm = await loadHcm(pool);
        const report = buildReport(excelRows, hcm, bonusMap);
        const label = outPath.includes('FINAL') ? 'FINAL' : 'BASELINE';
        const md = formatMd(report, label);
        fs.writeFileSync(outPath, md, 'utf8');
        console.log(`Wrote ${outPath}`);
        console.log(`Excel net: ${fmt(report.excelNetTotal)} | HCM net: ${fmt(report.hcmNetTotal)} | Δ: ${fmt(report.netDeltaTotal)}`);
        console.log(`Matches: ${report.matchCount}/${report.excelCount} net | Bonus: ${report.bonusMatchCount}/${report.bonusWithExcel}`);
        const bonusOk = report.bonusMismatchCount === 0;
        const netOk = report.mismatchCount === 0 && Math.abs(report.netDeltaTotal) <= report.excelCount;
        process.exit(bonusOk && netOk ? 0 : 1);
    } finally {
        await pool.end();
    }
})();
