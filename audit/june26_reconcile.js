#!/usr/bin/env node
'use strict';
/**
 * June 2026 payroll reconciliation: Excel workbook vs HCM staging DB.
 * Usage: node audit/june26_reconcile.js
 */
const fs = require('fs');
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({
  path: path.join(backendRoot, '.env.local'),
});
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const XLSX = require(path.join(backendRoot, 'node_modules', 'xlsx'));
const {
  comparePayrollVariance,
  formatVarianceSummaryMd,
  formatVarianceCsv,
  extractHcmRow,
  roundRupee,
} = require(path.join(backendRoot, 'src', 'payroll', 'varianceCompare'));

const XLSX_PATH = process.env.JUNE26_XLSX
  || 'G:\\My Drive\\Experiments\\BPOFMSystem\\Attachments\\BPO FM Payroll & Invoice File (1).xlsx';
const OUT_DIR = path.join(__dirname, 'june26_reconcile');
const TARGET_MONTH = 6;
const TARGET_YEAR = 2026;

// Column indices (0-based) — verified against workbook headers row 1
const COL = {
  ASIL_CODE: 1,       // B
  EMPLOYEE_NAME: 9,   // J
  CLIENT: 3,          // D
  MONTH: 14,          // O
  YEAR: 15,           // P
  PAID_DAYS: 19,      // T
  GROSS: 30,          // AE
  INCOME_TAX: 31,     // AF
  PF: 32,             // AG
  EOBI: 33,           // AH
  OTHER_DED: 29,      // AD
  NET_PAY_JUNE: 35,   // AJ — "Net Pay for the Month" on June-26
  NEED_TO_PAY_PSO: 35, // AJ — "Need to Pay" on PSO Operational PR June-26
  SESSI: 37,          // AL on June-26, AN on PSO (different offset)
};

function num(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/,/g, '').replace(/[^\d.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeId(id) {
  return String(id || '').trim().toUpperCase().replace(/\s+/g, '');
}

function cellVal(ws, row, col) {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return '';
  return cell.v;
}

const JUNE_DATA_END = 518; // Excel rows 4–519 (indices 3–518)

function parseSheet(ws, { netCol, sessiCol, dataStartRow, dataEndRow, month = TARGET_MONTH, year = TARGET_YEAR, skipMonthFilter = false, skipMonthFilterFromRow = null }) {
  const rows = [];
  for (let r = dataStartRow; r <= dataEndRow; r += 1) {
    const eid = String(cellVal(ws, r, COL.ASIL_CODE) || '').trim();
    if (!eid || !/^ASIL/i.test(eid)) continue;
    const useMonthFilter = !skipMonthFilter && !(skipMonthFilterFromRow != null && r >= skipMonthFilterFromRow);
    if (useMonthFilter) {
      const m = num(cellVal(ws, r, COL.MONTH));
      const y = num(cellVal(ws, r, COL.YEAR));
      if (m !== month || y !== year) continue;
    }

    const net = num(cellVal(ws, r, netCol));
    const gross = num(cellVal(ws, r, COL.GROSS));
    if (net <= 0 && gross <= 0) continue;

    rows.push({
      employee_id: normalizeId(eid),
      employee_name: String(cellVal(ws, r, COL.EMPLOYEE_NAME) || '').trim(),
      client: String(cellVal(ws, r, COL.CLIENT) || '').trim(),
      paid_days: num(cellVal(ws, r, COL.PAID_DAYS)),
      gross,
      income_tax: num(cellVal(ws, r, COL.INCOME_TAX)),
      eobi: num(cellVal(ws, r, COL.EOBI)),
      sessi_or_pessi: num(cellVal(ws, r, sessiCol)),
      pf: num(cellVal(ws, r, COL.PF)),
      advances: 0,
      other_deductions: num(cellVal(ws, r, COL.OTHER_DED)),
      net_pay: net,
    });
  }
  return rows;
}

/** Sum numeric fields when the same employee_id appears more than once (e.g. PSO-329/25 duplicate). */
function aggregateSheetRows(rows) {
  const sumFields = ['paid_days', 'gross', 'income_tax', 'eobi', 'sessi_or_pessi', 'pf', 'advances', 'other_deductions', 'net_pay'];
  const map = new Map();
  for (const r of rows) {
    const id = r.employee_id;
    if (!map.has(id)) {
      map.set(id, { ...r });
      continue;
    }
    const agg = map.get(id);
    for (const f of sumFields) {
      agg[f] = roundRupee((agg[f] || 0) + (r[f] || 0));
    }
  }
  return [...map.values()];
}

function parseMasterData(wb) {
  const ws = wb.Sheets['Master Data'];
  if (!ws) return { rows: [], headerRow: null };
  const range = XLSX.utils.decode_range(ws['!ref']);
  const map = new Map();
  // Headers in row 2 (index 1), data from row 4 (index 3)
  for (let r = 3; r <= range.e.r; r += 1) {
    const eid = String(cellVal(ws, r, 2) || '').trim(); // col C = ASIL Employee Code
    if (!eid || !/^ASIL/i.test(eid)) continue;
    map.set(normalizeId(eid), {
      employee_id: normalizeId(eid),
      employee_name: String(cellVal(ws, r, 10) || '').trim(),
      client: String(cellVal(ws, r, 4) || '').trim(),
      salary: num(cellVal(ws, r, 19)),
      active: String(cellVal(ws, r, 3) || '').trim(),
    });
  }
  return { rows: [...map.values()], count: map.size };
}

function analyzeMismatches(result) {
  return result.comparisons
    .filter((c) => !c.all_zero)
    .map((c) => {
      const reasons = [];
      const f = c.fields;
      if (f.net_pay.delta !== 0) reasons.push(`net Δ${f.net_pay.delta}`);
      if (f.gross.delta !== 0) reasons.push(`gross Δ${f.gross.delta}`);
      if (f.income_tax.delta !== 0) reasons.push(`tax Δ${f.income_tax.delta}`);
      if (f.paid_days.delta !== 0) reasons.push(`days Δ${f.paid_days.delta}`);
      if (f.eobi.delta !== 0) reasons.push(`eobi Δ${f.eobi.delta}`);
      if (f.pf.delta !== 0) reasons.push(`pf Δ${f.pf.delta}`);
      if (f.other_deductions.delta !== 0) reasons.push(`other ded Δ${f.other_deductions.delta}`);
      return {
        employee_id: c.employee_id,
        employee_name: c.employee_name,
        sheet_net: f.net_pay.excel,
        hcm_net: f.net_pay.hcm,
        delta: f.net_pay.delta,
        likely_cause: reasons.join('; ') || 'field mismatch',
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function buildComparisonReport(label, sheetRows, hcmRows) {
  const result = comparePayrollVariance(sheetRows, hcmRows);
  const mismatches = analyzeMismatches(result);
  const sheetTotal = roundRupee(sheetRows.reduce((s, r) => s + (r.net_pay || 0), 0));
  const hcmTotal = roundRupee(hcmRows.reduce((s, r) => {
    const h = extractHcmRow(r);
    return s + (h.net_pay || 0);
  }, 0));
  const matchedHcmIds = new Set(sheetRows.map((r) => r.employee_id));
  const hcmMatchedTotal = roundRupee(
    hcmRows
      .filter((r) => matchedHcmIds.has(normalizeId(r.employee_id)))
      .reduce((s, r) => s + extractHcmRow(r).net_pay, 0),
  );

  return {
    label,
    counts: {
      sheetEmployees: sheetRows.length,
      hcmEmployees: hcmRows.length,
      matched: result.summary.rowsCompared,
      mismatched: result.summary.rowsCompared - result.summary.rowsAllZero,
      unmatchedSheet: result.summary.unmatchedExcelCount,
      unmatchedHcm: result.summary.unmatchedHcmCount,
    },
    totals: {
      sheetNet: sheetTotal,
      hcmNetPay: hcmTotal,
      hcmMatchedNet: hcmMatchedTotal,
      delta: roundRupee(sheetTotal - hcmMatchedTotal),
    },
    matchRate: result.summary.rowsCompared
      ? `${((result.summary.rowsAllZero / result.summary.rowsCompared) * 100).toFixed(1)}%`
      : '0%',
    aligned: !result.summary.hasVariance,
    topMismatches: mismatches.slice(0, 15),
    allMismatches: mismatches,
    unmatchedSheet: result.unmatchedExcel.map((r) => ({ id: r.employee_id, name: r.employee_name, net: r.net_pay })),
    unmatchedHcm: result.unmatchedHcm.map((r) => ({ id: r.employee_id, name: r.employee_name, net: r.net_pay })),
    varianceSummary: result.summary,
    varianceResult: result,
  };
}

async function loadAllHcmJuneRows(pool) {
  const { rows: runs } = await pool.query(`
    SELECT pr.id, pr.contract_id, pr.status, pr.computed_at
    FROM payroll_runs pr
    WHERE pr.period_year = $1 AND pr.period_month = $2
    ORDER BY pr.computed_at DESC NULLS LAST
  `, [TARGET_YEAR, TARGET_MONTH]);

  const hcmRows = [];
  const seen = new Set();
  for (const run of runs) {
    const { rows } = await pool.query(`
      SELECT prr.employee_id, e.name AS employee_name, prr.paid_days, prr.computed, prr.inputs
      FROM payroll_run_rows prr
      LEFT JOIN employees e ON e.id = prr.employee_id
      WHERE prr.run_id = $1
    `, [run.id]);
    for (const r of rows) {
      const id = normalizeId(r.employee_id);
      if (seen.has(id)) continue;
      seen.add(id);
      hcmRows.push(r);
    }
  }
  return { runs, hcmRows };
}

async function loadWorldAJuneRows(pool) {
  const { rows } = await pool.query(`
    SELECT pt.employee_id, e.name AS employee_name, pt.paid_days,
           jsonb_build_object(
             'gross', COALESCE(pt.gross, 0),
             'wht', COALESCE(pt.wht, 0),
             'eobiEmployee', COALESCE(pt.eobi_ee, 400),
             'sessiEmployer', COALESCE(pt.sessi_er, 0),
             'pfDeduction', COALESCE(pt.pf_ee, 0),
             'netPay', COALESCE(pt.net, 0)
           ) AS computed,
           '{}'::jsonb AS inputs
    FROM payroll_transactions pt
    LEFT JOIN employees e ON e.id = pt.employee_id
    WHERE pt.year = $1 AND pt.month = $2 AND COALESCE(pt.net, 0) > 0
  `, [TARGET_YEAR, TARGET_MONTH]);
  return rows;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.error('[reconcile] Reading workbook:', XLSX_PATH);
  const wb = XLSX.readFile(XLSX_PATH);

  const juneWs = wb.Sheets['June-26'];
  const psoWs = wb.Sheets['PSO Operational PR June-26'];
  if (!juneWs) throw new Error('Sheet "June-26" not found');
  if (!psoWs) throw new Error('Sheet "PSO Operational PR June-26" not found');

  const juneRange = XLSX.utils.decode_range(juneWs['!ref']);
  const psoRange = XLSX.utils.decode_range(psoWs['!ref']);

  const juneRows = aggregateSheetRows(parseSheet(juneWs, {
    netCol: COL.NET_PAY_JUNE,
    sessiCol: 37, // AL
    dataStartRow: 3,  // row 4
    dataEndRow: Math.min(JUNE_DATA_END, juneRange.e.r), // row 519
    skipMonthFilterFromRow: 513, // rows 514–519: conservancy tail, no month col
  }));

  const psoRows = aggregateSheetRows(parseSheet(psoWs, {
    netCol: COL.NEED_TO_PAY_PSO,
    sessiCol: 39, // AN on PSO sheet
    dataStartRow: 3,  // row 4
    dataEndRow: Math.min(168, psoRange.e.r), // row 169
    skipMonthFilter: true, // sheet Month# col shows 4 (April) but sheet is June operational PR
  }));

  const masterData = parseMasterData(wb);

  const extraction = {
    method: 'xlsx direct parse',
    file: XLSX_PATH,
    sheets: {
      'June-26': {
        dataRows: `${4}-${Math.min(519, juneRange.e.r + 1)}`,
        employeesParsed: juneRows.length,
        netColumn: 'AJ (Net Pay for the Month)',
        columnMap: {
          employee_id: 'B (ASIL Employee Code)',
          net_pay: 'AJ (Net Pay for the Month)',
          gross: 'AE (Gross Monthly Salary)',
          paid_days: 'T (Paid Days)',
          income_tax: 'AF (Income Tax)',
          eobi: 'AH (EOBI Employee)',
          pf: 'AG (PF Deduction)',
          other_deductions: 'AD (Other Deduction)',
        },
      },
      'PSO Operational PR June-26': {
        dataRows: `${4}-${Math.min(169, psoRange.e.r + 1)}`,
        employeesParsed: psoRows.length,
        netColumn: 'AJ (Need to Pay)',
        monthFilterNote: 'Month# column shows 4 (April) — filter skipped; sheet name is authoritative for June operational PR',
        columnMap: {
          employee_id: 'B (ASIL Employee Code)',
          net_pay: 'AJ (Need to Pay)',
          gross: 'AE (Gross Monthly Salary)',
        },
      },
      'Master Data': {
        employeesParsed: masterData.count || masterData.rows.length,
        headerRow: 2,
        dataStartRow: 4,
      },
    },
  };

  const dbUrl = process.env.STAGING_DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!dbUrl) throw new Error('No STAGING_DATABASE_URL or TEST_DATABASE_URL in backend/.env.local');
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: true } : false,
  });

  let hcmSource = 'payroll_runs (World B)';
  let { runs, hcmRows } = await loadAllHcmJuneRows(pool);
  if (!hcmRows.length) {
    hcmRows = await loadWorldAJuneRows(pool);
    hcmSource = 'payroll_transactions (World A)';
  }
  await pool.end();

  const mainComparison = buildComparisonReport('June-26 Net Pay vs HCM', juneRows, hcmRows);
  const psoComparison = buildComparisonReport('PSO Need to Pay vs HCM', psoRows, hcmRows);

  const report = {
    extraction,
    period: `${TARGET_YEAR}-${String(TARGET_MONTH).padStart(2, '0')}`,
    hcmSource,
    hcmRuns: runs,
    hcmEmployeeCount: hcmRows.length,
    comparisons: {
      main: mainComparison,
      pso: psoComparison,
    },
    masterDataCount: masterData.count || masterData.rows.length,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'variance_main.csv'), formatVarianceCsv(mainComparison.varianceResult));
  fs.writeFileSync(path.join(OUT_DIR, 'variance_pso.csv'), formatVarianceCsv(psoComparison.varianceResult));
  fs.writeFileSync(path.join(OUT_DIR, 'variance_summary.md'), [
    formatVarianceSummaryMd(mainComparison.varianceResult, {
      contractId: 'ALL — June-26 Net Pay',
      month: TARGET_MONTH,
      year: TARGET_YEAR,
    }),
    '',
    '---',
    '',
    formatVarianceSummaryMd(psoComparison.varianceResult, {
      contractId: 'PSO — Need to Pay',
      month: TARGET_MONTH,
      year: TARGET_YEAR,
    }),
  ].join('\n'));

  console.log(JSON.stringify({
    extraction: report.extraction,
    hcmSource,
    hcmEmployeeCount: hcmRows.length,
    hcmRuns: runs.length,
    main: {
      counts: mainComparison.counts,
      totals: mainComparison.totals,
      matchRate: mainComparison.matchRate,
      aligned: mainComparison.aligned,
      topMismatches: mainComparison.topMismatches,
    },
    pso: {
      counts: psoComparison.counts,
      totals: psoComparison.totals,
      matchRate: psoComparison.matchRate,
      aligned: psoComparison.aligned,
      topMismatches: psoComparison.topMismatches,
    },
  }, null, 2));
}

main().catch((e) => {
  console.error('[june26_reconcile]', e.message || e);
  process.exit(2);
});
