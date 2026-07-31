#!/usr/bin/env node
'use strict';

/**
 * Wafi master roster dry-run / apply (P2).
 *
 * Usage:
 *   node scripts/wafi_roster_refresh.js --csv "C:\path\ASIL_Master_Roster (1).csv" [--dry-run]
 *   node scripts/wafi_roster_refresh.js --csv ... --apply --database-url "$STAGING_DATABASE_URL"
 *
 * Default mode is --dry-run. Never pass prod DATABASE_URL to --apply without MD gate.
 */

const fs = require('fs');
const path = require('path');
const { runWafiRosterRefresh, formatReportMd } = require('../backend/src/modules/employees/wafiRosterRefresh');

function parseArgs(argv) {
    const args = { dryRun: true, csv: null, databaseUrl: null };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') args.dryRun = true;
        else if (a === '--apply') args.dryRun = false;
        else if (a === '--csv' && argv[i + 1]) { args.csv = argv[++i]; }
        else if (a === '--database-url' && argv[i + 1]) { args.databaseUrl = argv[++i]; }
        else if (a.startsWith('--csv=')) args.csv = a.slice(6);
        else if (a.startsWith('--database-url=')) args.databaseUrl = a.slice(15);
    }
    return args;
}

function isProdUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (u.includes('ci-test') || u.includes('staging') || u.includes('restore-test')) return false;
    return true;
}

async function main() {
    const args = parseArgs(process.argv);
    if (!args.csv) {
        console.error('Usage: node scripts/wafi_roster_refresh.js --csv <path> [--dry-run|--apply] [--database-url URL]');
        process.exit(2);
    }

    const csvPath = path.resolve(args.csv);
    if (!fs.existsSync(csvPath)) {
        console.error(`CSV not found: ${csvPath}`);
        process.exit(2);
    }

    const csvText = fs.readFileSync(csvPath, 'utf8');
    const dbUrl = args.databaseUrl || process.env.STAGING_DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

    if (!args.dryRun && isProdUrl(dbUrl) && !process.env.STAGING_DATABASE_URL) {
        console.error('REFUSED: --apply blocked on production-looking DATABASE_URL. Set STAGING_DATABASE_URL explicitly.');
        process.exit(3);
    }

    let pool = null;
    let report;

    if (dbUrl) {
        const { Pool } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
        pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true }, max: 2 });
        try {
            report = await runWafiRosterRefresh(pool, { csvText, csvPath, dryRun: args.dryRun });
        } finally {
            await pool.end();
        }
    } else {
        // Offline parse-only: no DB match
        const { parseCsvText, isWafiRow, mapCsvRowToDb, buildDryRunReport } = require('../backend/src/modules/employees/wafiRosterRefresh');
        const { rows } = parseCsvText(csvText);
        const wafiRows = rows.filter(isWafiRow);
        const unmatched_csv = [];
        for (const row of wafiRows) {
            const m = mapCsvRowToDb(row);
            if (m) unmatched_csv.push({ asil_code: m.id, name: row['Employee Name'] || '', reason: 'no_database_url' });
        }
        report = buildDryRunReport({
            csvPath,
            csvRows: wafiRows,
            dbWafiRows: [],
            matched: [],
            unmatched_csv,
            unmatched_db_wafi: [],
            deltas: [],
            warnings: [{ message: 'offline_mode_no_db' }],
            errors: [],
            mode: 'dry-run-offline',
        });
        console.warn('No DATABASE_URL — offline parse only (all rows listed as unmatched_csv).');
    }

    const auditDir = path.join(__dirname, '..', 'audit', 'cutover');
    fs.mkdirSync(auditDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    const jsonPath = path.join(auditDir, `wafi_roster_dryrun_${stamp}.json`);
    const mdPath = path.join(auditDir, `wafi_roster_dryrun_${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdPath, formatReportMd(report));

    console.log(`Report: ${jsonPath}`);
    console.log(`Summary: matched=${report.summary.matched} would_update=${report.summary.would_update} insert=${report.summary.would_insert} delete=${report.summary.would_delete}`);
    if (report.summary.would_insert !== 0 || report.summary.would_delete !== 0) {
        console.error('GATE FAILED: would_insert and would_delete must be 0');
        process.exit(1);
    }
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
