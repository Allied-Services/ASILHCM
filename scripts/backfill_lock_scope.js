#!/usr/bin/env node
'use strict';

/**
 * P1 — Backfill payroll_transactions.client / contract_name / locked_net for already-locked rows.
 *
 * Usage:
 *   node scripts/backfill_lock_scope.js [--dry-run] [--year YYYY] [--month M]
 *   node scripts/backfill_lock_scope.js --apply [--year YYYY] [--month M]
 *
 * Default mode is dry-run. Uses DATABASE_URL / STAGING_DATABASE_URL / TEST_DATABASE_URL
 * from the environment (or --database-url). Never hardcodes a connection string.
 */

const path = require('path');

const backendRoot = path.join(__dirname, '..', 'backend');
try {
    require(path.join(backendRoot, 'node_modules', 'dotenv')).config({
        path: path.join(backendRoot, '.env.local'),
    });
    require(path.join(backendRoot, 'node_modules', 'dotenv')).config({
        path: path.join(backendRoot, '.env'),
    });
} catch {
    /* dotenv optional when env already set */
}

function parseArgs(argv) {
    const args = { dryRun: true, year: null, month: null, databaseUrl: null };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry-run') args.dryRun = true;
        else if (a === '--apply') args.dryRun = false;
        else if (a === '--year' && argv[i + 1]) args.year = parseInt(argv[++i], 10);
        else if (a === '--month' && argv[i + 1]) args.month = parseInt(argv[++i], 10);
        else if (a === '--database-url' && argv[i + 1]) args.databaseUrl = argv[++i];
        else if (a.startsWith('--year=')) args.year = parseInt(a.slice(7), 10);
        else if (a.startsWith('--month=')) args.month = parseInt(a.slice(8), 10);
        else if (a.startsWith('--database-url=')) args.databaseUrl = a.slice(15);
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv);
    const dbUrl = args.databaseUrl
        || process.env.STAGING_DATABASE_URL
        || process.env.TEST_DATABASE_URL
        || process.env.DATABASE_URL;

    if (!dbUrl) {
        console.error('FATAL: set DATABASE_URL, STAGING_DATABASE_URL, or TEST_DATABASE_URL (or pass --database-url).');
        process.exit(2);
    }

    const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
    const pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: true },
        max: 2,
    });

    const filters = [];
    const params = [];
    if (args.year != null && Number.isFinite(args.year)) {
        params.push(args.year);
        filters.push(`pt.year = $${params.length}`);
    }
    if (args.month != null && Number.isFinite(args.month)) {
        params.push(args.month);
        filters.push(`pt.month = $${params.length}`);
    }
    const extraWhere = filters.length ? ` AND ${filters.join(' AND ')}` : '';

    try {
        const { rows: candidates } = await pool.query(
            `SELECT pt.employee_id, pt.year, pt.month, pt.net, pt.client AS frozen_client,
                    pt.contract_name AS frozen_contract, pt.locked_net,
                    e.id AS emp_exists, e.client AS emp_client, e.contract_name AS emp_contract
             FROM payroll_transactions pt
             LEFT JOIN employees e ON e.id = pt.employee_id
             WHERE pt.locked = TRUE
               AND (pt.client IS NULL OR pt.locked_net IS NULL)
               ${extraWhere}
             ORDER BY pt.year, pt.month, pt.employee_id`,
            params
        );

        const orphans = candidates.filter((r) => !r.emp_exists);
        const fillable = candidates.filter((r) => r.emp_exists);
        const skipped = 0; // every matching locked row with null scope is either fillable or orphan

        console.log(`Mode: ${args.dryRun ? 'DRY-RUN' : 'APPLY'}`);
        console.log(`Candidates needing backfill: ${candidates.length}`);
        console.log(`  fillable (employee found): ${fillable.length}`);
        console.log(`  orphans (no employee row): ${orphans.length}`);
        console.log(`  skipped: ${skipped}`);

        if (orphans.length) {
            console.log('\nOrphans (locked payroll with no matching employees row — AP shortfall risk):');
            for (const o of orphans) {
                console.log(`  ${o.employee_id}  ${o.year}-${String(o.month).padStart(2, '0')}  net=${o.net}`);
            }
        }

        if (args.dryRun) {
            console.log(`\nWould update ${fillable.length} row(s). Re-run with --apply to write.`);
            return;
        }

        if (!fillable.length) {
            console.log('\nNothing to update.');
            return;
        }

        const { rowCount } = await pool.query(
            `UPDATE payroll_transactions AS pt
             SET client = e.client,
                 contract_name = e.contract_name,
                 locked_net = ROUND(pt.net)
             FROM employees e
             WHERE e.id = pt.employee_id
               AND pt.locked = TRUE
               AND (pt.client IS NULL OR pt.locked_net IS NULL)
               ${extraWhere}`,
            params
        );

        console.log(`\nUpdated ${rowCount || 0} row(s).`);
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('[backfill_lock_scope]', err);
    process.exit(1);
});
