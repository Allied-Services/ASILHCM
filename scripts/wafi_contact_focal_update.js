#!/usr/bin/env node
'use strict';

/**
 * Wafi 3P contact + Focal / Line Manager updater.
 *
 * Default is --dry-run. Contact/routing columns only — never salary or bank.
 *
 * Usage:
 *   node scripts/wafi_contact_focal_update.js --file "/tmp/asil_master_roster.csv"
 *   node scripts/wafi_contact_focal_update.js --file "....xlsx" --scope=wafi-3p
 *   node scripts/wafi_contact_focal_update.js --file ... --apply --database-url "$STAGING_DATABASE_URL"
 *
 * Never pass a production DATABASE_URL to --apply without an MD gate.
 */

const fs = require('fs');
const path = require('path');
const {
    runWafiContactUpdate,
    formatReportMd,
    loadTabularFile,
    scopeFilter,
    mapContactRow,
    buildDryRunReport,
} = require('../backend/src/modules/employees/wafiContactUpdate');

function parseArgs(argv) {
    const args = {
        dryRun: true,
        file: null,
        databaseUrl: null,
        scope: 'wafi-3p',
    };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') args.dryRun = true;
        else if (a === '--apply') args.dryRun = false;
        else if (a === '--file' && argv[i + 1]) args.file = argv[++i];
        else if (a === '--csv' && argv[i + 1]) args.file = argv[++i];
        else if (a === '--database-url' && argv[i + 1]) args.databaseUrl = argv[++i];
        else if (a === '--scope' && argv[i + 1]) args.scope = argv[++i];
        else if (a.startsWith('--file=')) args.file = a.slice(7);
        else if (a.startsWith('--csv=')) args.file = a.slice(6);
        else if (a.startsWith('--database-url=')) args.databaseUrl = a.slice(15);
        else if (a.startsWith('--scope=')) args.scope = a.slice(8);
    }
    return args;
}

function isProdUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    if (u.includes('ci-test') || u.includes('staging') || u.includes('restore-test') || u.includes('asil_hcm_dev')) {
        return false;
    }
    if (u.includes('localhost') || u.includes('127.0.0.1')) return false;
    return true;
}

async function main() {
    const args = parseArgs(process.argv);
    if (!args.file) {
        console.error('Usage: node scripts/wafi_contact_focal_update.js --file <csv|xlsx> [--dry-run|--apply] [--scope wafi-3p|wafi|file] [--database-url URL]');
        process.exit(2);
    }

    const sourcePath = path.resolve(args.file);
    if (!fs.existsSync(sourcePath)) {
        console.error(`File not found: ${sourcePath}`);
        process.exit(2);
    }

    const dbUrl = args.databaseUrl
        || process.env.STAGING_DATABASE_URL
        || process.env.TEST_DATABASE_URL
        || process.env.DATABASE_URL;

    if (!args.dryRun && isProdUrl(dbUrl) && !process.env.STAGING_DATABASE_URL) {
        console.error('REFUSED: --apply blocked on production-looking DATABASE_URL. Set STAGING_DATABASE_URL explicitly.');
        process.exit(3);
    }

    let pool = null;
    let report;

    if (dbUrl) {
        const { Pool } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
        const ssl = isProdUrl(dbUrl) || /sslmode=require/i.test(dbUrl)
            ? { rejectUnauthorized: true }
            : false;
        pool = new Pool({ connectionString: dbUrl, ssl, max: 2 });
        try {
            report = await runWafiContactUpdate(pool, {
                sourcePath,
                dryRun: args.dryRun,
                scope: args.scope,
            });
        } finally {
            await pool.end();
        }
    } else {
        const { rows } = loadTabularFile(sourcePath);
        const scoped = rows.filter((row) => scopeFilter(row, args.scope));
        const unmatched_csv = [];
        for (const row of scoped) {
            const m = mapContactRow(row);
            if (m) unmatched_csv.push({ asil_code: m.id, name: row['Employee Name'] || '', reason: 'no_database_url' });
        }
        report = buildDryRunReport({
            sourcePath,
            sourceRows: scoped,
            matched: [],
            unmatched_csv,
            unmatched_db: [],
            deltas: [],
            warnings: [{ message: 'offline_mode_no_db' }],
            errors: [],
            mode: 'dry-run-offline',
            scope: args.scope,
        });
        console.warn('No DATABASE_URL — offline parse only (all rows listed as unmatched_csv).');
    }

    const auditDir = path.join(__dirname, '..', 'audit', 'cutover');
    fs.mkdirSync(auditDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    const jsonPath = path.join(auditDir, `wafi_contact_dryrun_${stamp}.json`);
    const mdPath = path.join(auditDir, `wafi_contact_dryrun_${stamp}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdPath, formatReportMd(report));

    console.log(`Report: ${jsonPath}`);
    console.log(`Summary: matched=${report.summary.matched} would_update=${report.summary.would_update} phone=${report.summary.phone_changes} email=${report.summary.email_changes} routing=${report.summary.routing_changes}`);
    if (report.summary.would_insert !== 0 || report.summary.would_delete !== 0) {
        console.error('GATE FAILED: would_insert and would_delete must be 0');
        process.exit(1);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
