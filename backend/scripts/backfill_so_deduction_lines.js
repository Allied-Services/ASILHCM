'use strict';
/**
 * Re-attribute so_deductions.line_id for rows orphaned by replaceLines
 * (ON DELETE SET NULL after SO line re-insert).
 *
 * Usage:
 *   node backend/scripts/backfill_so_deduction_lines.js
 *   node backend/scripts/backfill_so_deduction_lines.js --apply
 *   node backend/scripts/backfill_so_deduction_lines.js --contract CTR-PSO-NORTH-ZONE --month 7 --year 2026 --apply
 *
 * Default is dry-run. Needs DATABASE_URL or STAGING_DATABASE_URL.
 */
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { findLineForDesignation } = require('../src/modules/serviceOrders/designationMatch');

function loadEnv() {
    for (const p of [
        path.join(__dirname, '../.env'),
        path.join(__dirname, '../../.env'),
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), 'backend/.env'),
    ]) {
        if (!fs.existsSync(p)) continue;
        for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^([^#=]+)=(.*)$/);
            if (!m) continue;
            const k = m[1].trim();
            const v = m[2].trim().replace(/^["']|["']$/g, '');
            if (!process.env[k]) process.env[k] = v;
        }
        break;
    }
}
loadEnv();

function argValue(flag) {
    const i = process.argv.indexOf(flag);
    if (i < 0 || i + 1 >= process.argv.length) return null;
    return process.argv[i + 1];
}

async function main() {
    const apply = process.argv.includes('--apply');
    const contractId = argValue('--contract');
    const month = argValue('--month') ? parseInt(argValue('--month'), 10) : null;
    const year = argValue('--year') ? parseInt(argValue('--year'), 10) : null;

    const dbUrl = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL / STAGING_DATABASE_URL missing');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: true },
        max: 4,
    });

    const params = [];
    const where = [`(d.line_id IS NULL OR d.type = 'absence')`];
    if (contractId) {
        params.push(contractId);
        where.push(`so.contract_id = $${params.length}`);
    }
    if (month) {
        params.push(month);
        where.push(`d.period_month = $${params.length}`);
    }
    if (year) {
        params.push(year);
        where.push(`d.period_year = $${params.length}`);
    }

    const { rows } = await pool.query(
        `SELECT d.id, d.service_order_id, d.employee_id, d.days_absent, d.amount, d.type,
                d.period_month, d.period_year,
                e.name AS employee_name, e.designation AS employee_designation,
                so.contract_id, so.site_code
         FROM so_deductions d
         JOIN service_orders so ON so.id = d.service_order_id
         LEFT JOIN employees e ON e.id = d.employee_id
         WHERE ${where.join(' AND ')}
         ORDER BY d.service_order_id, d.id`,
        params
    );

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        filters: { contractId, month, year },
        orphanCount: rows.length,
    }, null, 2));

    if (!rows.length) {
        console.log('No orphaned deductions to backfill.');
        await pool.end();
        return;
    }

    const soIds = [...new Set(rows.map((r) => r.service_order_id))];
    const linesBySo = new Map();
    for (const soId of soIds) {
        const { rows: lineRows } = await pool.query(
            `SELECT id, name, line_number, is_manpower_dependent, roles, rate
             FROM service_order_lines WHERE service_order_id = $1 ORDER BY id`,
            [soId]
        );
        linesBySo.set(soId, lineRows);
    }

    const updates = [];
    const unmatched = [];
    for (const d of rows) {
        const lines = linesBySo.get(d.service_order_id) || [];
        const found = findLineForDesignation(lines, d.employee_designation, { siteCode: d.site_code });
        if (found?.line?.id) {
            if (Number(d.line_id) === Number(found.line.id)) continue;
            updates.push({
                deductionId: d.id,
                serviceOrderId: d.service_order_id,
                siteCode: d.site_code,
                employeeId: d.employee_id,
                employeeName: d.employee_name,
                designation: d.employee_designation,
                daysAbsent: d.days_absent,
                amount: Number(d.amount),
                period: `${d.period_month}/${d.period_year}`,
                oldLineId: d.line_id,
                newLineId: found.line.id,
                newLineName: found.line.name,
            });
        } else {
            unmatched.push({
                deductionId: d.id,
                serviceOrderId: d.service_order_id,
                employeeId: d.employee_id,
                employeeName: d.employee_name,
                designation: d.employee_designation,
                amount: Number(d.amount),
                period: `${d.period_month}/${d.period_year}`,
                reason: d.employee_designation ? 'no_matching_line' : 'no_designation',
            });
        }
    }

    console.log('\n=== Would re-point ===');
    for (const u of updates) {
        console.log(
            `${u.deductionId}\t${u.serviceOrderId}\t${u.employeeId || ''}\t${u.employeeName || ''}`
            + `\t${u.designation || ''}\t→ line ${u.newLineId} (${u.newLineName})\t${u.amount}`
        );
    }
    console.log(`\nMatched: ${updates.length}`);
    console.log(`Unmatched: ${unmatched.length}`);
    if (unmatched.length) {
        console.log('\n=== Unmatched (left as orphan) ===');
        for (const u of unmatched) {
            console.log(
                `${u.deductionId}\t${u.serviceOrderId}\t${u.employeeId || ''}\t${u.employeeName || ''}`
                + `\t${u.designation || ''}\t${u.reason}\t${u.amount}`
            );
        }
    }

    if (!apply) {
        console.log('\nDry-run only. Re-run with --apply to UPDATE so_deductions.line_id.');
        await pool.end();
        return;
    }

    if (!updates.length) {
        console.log('Nothing to apply.');
        await pool.end();
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ids = updates.map((u) => u.deductionId);
        const lineIds = updates.map((u) => u.newLineId);
        const { rowCount } = await client.query(
            `UPDATE so_deductions AS d
             SET line_id = v.new_line_id
             FROM (
               SELECT UNNEST($1::int[]) AS id, UNNEST($2::int[]) AS new_line_id
             ) AS v
             WHERE d.id = v.id`,
            [ids, lineIds]
        );
        await client.query('COMMIT');
        console.log(`\nApplied: ${rowCount} rows updated.`);
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
