#!/usr/bin/env node
'use strict';

/**
 * Rebuild attendance_ledger SO shortages for a contract/month from
 * monthly_attendance_overrides using nested service unit rates / calendar days.
 *
 * Usage:
 *   node backend/scripts/rebuild_fv_so_deductions.js --contract CTR-PSO-NORTH-ZONE --month 8 --year 2026
 *   node backend/scripts/rebuild_fv_so_deductions.js --contract CTR-PSO-NORTH-ZONE --month 8 --year 2026 --apply
 *   node backend/scripts/rebuild_fv_so_deductions.js --contract CTR-PSO-NORTH-ZONE --month 8 --year 2026 --apply --allow-production
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Pool } = require('pg');
const { PSO_CONTRACT_ID, calendarDaysInMonth } = require('../src/modules/serviceOrders/sitesMeta');
const { syncSoDeductionsFromCycleRows } = require('../src/modules/serviceOrders/cycleAttendanceSync');

function argValue(flag, fallback) {
    const i = process.argv.indexOf(flag);
    if (i < 0 || i + 1 >= process.argv.length) return fallback;
    return process.argv[i + 1];
}

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-production');
const CONTRACT_ID = argValue('--contract', PSO_CONTRACT_ID);
const MONTH = parseInt(argValue('--month', '8'), 10);
const YEAR = parseInt(argValue('--year', '2026'), 10);

function looksProduction(url) {
    const s = String(url || '').toLowerCase();
    return s.includes('neon.tech') && !s.includes('staging') && !s.includes('ci-test');
}

async function main() {
    const url = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) {
        console.error('STAGING_DATABASE_URL or DATABASE_URL required');
        process.exit(1);
    }
    if (APPLY && looksProduction(url) && !ALLOW_PROD) {
        console.error('Refusing production apply without --allow-production');
        process.exit(2);
    }
    if (!MONTH || !YEAR || MONTH < 1 || MONTH > 12) {
        console.error('Need --month 1-12 and --year');
        process.exit(1);
    }

    const days = calendarDaysInMonth(MONTH, YEAR) || 30;
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
    const report = {
        contractId: CONTRACT_ID,
        month: MONTH,
        year: YEAR,
        calendarDays: days,
        apply: APPLY,
    };
    const client = await pool.connect();

    try {
        const { rows } = await client.query(
            `SELECT o.employee_id AS "employeeId", o.absent_days AS "absentDays"
             FROM monthly_attendance_overrides o
             JOIN employees e ON e.id = o.employee_id
             WHERE e.contract_id::text = $1
               AND o.period_month = $2
               AND o.period_year = $3
               AND COALESCE(o.absent_days, 0) > 0`,
            [CONTRACT_ID, MONTH, YEAR]
        );
        report.absentRows = rows.length;
        await client.query('BEGIN');
        const summary = await syncSoDeductionsFromCycleRows(client, {
            contractId: CONTRACT_ID,
            month: MONTH,
            year: YEAR,
            actor: APPLY ? 'rebuild_fv_so_deductions' : 'rebuild_fv_so_deductions:dry-run',
            rows,
            monthDays: days,
        });
        report.deductions = summary.deductions;
        report.cleared = summary.cleared;
        report.errors = summary.errors || [];
        report.skipped = summary.skipped || [];
        if (APPLY) await client.query('COMMIT');
        else await client.query('ROLLBACK');
        console.log(JSON.stringify(report, null, 2));
        process.exit(summary.errors?.length ? 1 : 0);
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        console.error(err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
