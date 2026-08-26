'use strict';
/**
 * Go-red: permanently remove the 3 portal-claims test employees from production.
 * Usage (backend/): node scripts/delete_portal_test_employees.js --dry-run
 *                  node scripts/delete_portal_test_employees.js --apply
 */
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { resetPortalClaimsSample } = require('../src/modules/claims/portalService');

const ALLOWED_IDS = [
    'ASIL/TEST-CLAIM-SHEZAD/26',
    'ASIL/TEST-CLAIM-RABIA/26',
    'ASIL/TEST-CLAIM-LAIBA/26',
];

function loadEnv() {
    const p = path.join(__dirname, '../.env');
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (!m) continue;
        const k = m[1].trim();
        const v = m[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[k]) process.env[k] = v;
    }
}

async function purgeEmployee(client, employeeId) {
    const cleared = {};
    const tables = [
        ['payroll_run_rows', 'employee_id'],
        ['payroll_transactions', 'employee_id'],
        ['attendance_records', 'employee_id'],
        ['employee_claims', 'employee_id'],
        ['claims_inbox', 'employee_id'],
        ['pf_ledger', 'employee_id'],
        ['payroll_advances', 'employee_id'],
        ['employee_documents', 'employee_id'],
        ['employee_assets', 'employee_id'],
        ['employee_change_requests', 'employee_id'],
        ['cost_allocations', 'employee_id'],
        ['claim_manual_overrides', 'employee_id'],
        ['payment_ledger', 'employee_id'],
    ];
    for (const [table, col] of tables) {
        const sp = `sp_${table.replace(/[^a-z0-9_]/gi, '_')}`;
        try {
            await client.query(`SAVEPOINT ${sp}`);
            const r = await client.query(`DELETE FROM ${table} WHERE ${col} = $1`, [employeeId]);
            await client.query(`RELEASE SAVEPOINT ${sp}`);
            cleared[table] = r.rowCount;
        } catch (e) {
            await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
            if (e.code === '42P01' || e.code === '42703') cleared[table] = `skip:${e.code}`;
            else throw e;
        }
    }
    const del = await client.query(
        'DELETE FROM employees WHERE id = $1 RETURNING id, name',
        [employeeId]
    );
    return { deleted: del.rows[0] || null, cleared };
}

async function main() {
    loadEnv();
    const apply = process.argv.includes('--apply');
    const dryRun = !apply || process.argv.includes('--dry-run');
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL missing');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });

    try {
        const { rows: before } = await pool.query(
            'SELECT id, name, client FROM employees WHERE id = ANY($1::text[]) ORDER BY id',
            [ALLOWED_IDS]
        );
        console.log(JSON.stringify({ dryRun, found: before }, null, 2));
        if (!before.length) {
            console.log('Nothing to delete — employees already absent.');
            return;
        }
        if (dryRun) {
            console.log('Dry-run only. Re-run with --apply to delete.');
            return;
        }

        const claimsReset = await resetPortalClaimsSample(pool);
        console.log('Portal claims reset:', JSON.stringify(claimsReset, null, 2));

        const client = await pool.connect();
        const results = [];
        try {
            await client.query('BEGIN');
            for (const id of ALLOWED_IDS) {
                const { rows: exists } = await client.query('SELECT id FROM employees WHERE id = $1', [id]);
                if (!exists.length) {
                    results.push({ id, skipped: true, reason: 'not_found' });
                    continue;
                }
                results.push({ id, ...(await purgeEmployee(client, id)) });
            }
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }

        const { rows: after } = await pool.query(
            'SELECT id FROM employees WHERE id = ANY($1::text[])',
            [ALLOWED_IDS]
        );
        console.log(JSON.stringify({ results, remaining: after.length }, null, 2));
        if (after.length) {
            console.error('FAIL — employees still present');
            process.exit(1);
        }
        console.log('OK — all 3 test employees removed.');
    } finally {
        await pool.end();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
