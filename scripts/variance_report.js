#!/usr/bin/env node
'use strict';

/**
 * Read-only Excel-vs-HCM payroll variance report.
 * Usage: node scripts/variance_report.js --csv <path> --contract <id> --month <m> --year <y>
 * Env: DATABASE_URL or TEST_DATABASE_URL (SELECT only).
 */
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({
    path: path.join(backendRoot, '.env.local'),
});
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({
    path: path.join(backendRoot, '.env'),
});

const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const {
    parseExcelCsv,
    comparePayrollVariance,
    formatVarianceCsv,
    formatVarianceSummaryMd,
    COMPARE_FIELDS,
    hcmRowToExcelShape,
    extractHcmRow,
} = require(path.join(backendRoot, 'src', 'payroll', 'varianceCompare'));

function usage() {
    console.error(`Usage: node scripts/variance_report.js --csv <path> --contract <id> --month <m> --year <y>
       node scripts/variance_report.js --csv <path> --hcm-json <path>   (offline / verification)
Options:
  --out-dir <dir>     Output directory (default: cwd)
  --database-url      Override DATABASE_URL`);
    process.exit(2);
}

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--csv') args.csv = argv[++i];
        else if (a === '--contract') args.contract = argv[++i];
        else if (a === '--month') args.month = Number(argv[++i]);
        else if (a === '--year') args.year = Number(argv[++i]);
        else if (a === '--hcm-json') args.hcmJson = argv[++i];
        else if (a === '--out-dir') args.outDir = argv[++i];
        else if (a === '--database-url') args.databaseUrl = argv[++i];
        else if (a === '--help' || a === '-h') usage();
        else {
            console.error(`Unknown argument: ${a}`);
            usage();
        }
    }
    if (!args.csv) usage();
    if (!args.hcmJson && (!args.contract || !args.month || !args.year)) usage();
    return args;
}

async function loadHcmRowsFromDb(contractId, month, year, databaseUrl) {
    const url = databaseUrl
        || process.env.DATABASE_URL
        || process.env.TEST_DATABASE_URL
        || process.env.STAGING_DATABASE_URL;
    if (!url) {
        throw new Error('DATABASE_URL, TEST_DATABASE_URL, or STAGING_DATABASE_URL is required');
    }
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
    try {
        const { rows: runs } = await pool.query(
            `SELECT id FROM payroll_runs
             WHERE contract_id = $1 AND period_month = $2 AND period_year = $3
             ORDER BY computed_at DESC NULLS LAST LIMIT 1`,
            [contractId, month, year]
        );
        if (!runs.length) {
            throw new Error(`No payroll_run for contract=${contractId} period=${year}-${month}`);
        }
        const runId = runs[0].id;
        const { rows } = await pool.query(
            `SELECT prr.employee_id, e.name AS employee_name, prr.paid_days, prr.computed, prr.inputs
             FROM payroll_run_rows prr
             LEFT JOIN employees e ON e.id = prr.employee_id
             WHERE prr.run_id = $1
             ORDER BY e.name`,
            [runId]
        );
        return rows;
    } finally {
        await pool.end();
    }
}

function loadHcmRowsFromJson(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('--hcm-json must be a JSON array');
    return raw;
}

function hcmRowsToExcelCsv(hcmRows) {
    const header = ['employee_id', 'employee_name', ...COMPARE_FIELDS].join(',');
    const lines = [header];
    for (const row of hcmRows) {
        const h = row.net_pay != null ? row : extractHcmRow(row);
        const shape = hcmRowToExcelShape(h);
        lines.push([
            shape.employee_id,
            `"${(shape.employee_name || '').replace(/"/g, '""')}"`,
            ...COMPARE_FIELDS.map((f) => shape[f] ?? 0),
        ].join(','));
    }
    return lines.join('\n') + '\n';
}

async function main() {
    const args = parseArgs(process.argv);
    const csvText = fs.readFileSync(path.resolve(args.csv), 'utf8');
    const excelRows = parseExcelCsv(csvText);

    const hcmRows = args.hcmJson
        ? loadHcmRowsFromJson(path.resolve(args.hcmJson))
        : await loadHcmRowsFromDb(args.contract, args.month, args.year, args.databaseUrl);

    const result = comparePayrollVariance(excelRows, hcmRows);
    const outDir = path.resolve(args.outDir || process.cwd());
    const tag = args.contract
        ? `${args.contract}_${args.year}-${String(args.month).padStart(2, '0')}`
        : path.basename(args.csv, path.extname(args.csv));
    const csvOut = path.join(outDir, `variance_${tag}.csv`);
    const mdOut = path.join(outDir, `variance_summary.md`);

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(csvOut, formatVarianceCsv(result));
    const summaryMd = formatVarianceSummaryMd(result, {
        contractId: args.contract,
        month: args.month,
        year: args.year,
    });
    fs.writeFileSync(mdOut, summaryMd);

    console.log(summaryMd);
    console.log(`\nWrote ${csvOut}`);
    console.log(`Wrote ${mdOut}`);

    process.exit(result.summary.hasVariance ? 1 : 0);
}

main().catch((err) => {
    console.error('[variance_report]', err.message || err);
    process.exit(2);
});

module.exports = { hcmRowsToExcelCsv, parseArgs };
