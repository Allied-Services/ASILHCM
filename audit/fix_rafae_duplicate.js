#!/usr/bin/env node
'use strict';
/**
 * Rafae Kayani duplicate cleanup — ASIL/SPL-361/21 → inactive; ASIL/SPL-420/21 canonical.
 *
 * Usage:
 *   node audit/fix_rafae_duplicate.js [--dry-run]   # default: dry-run
 *   node audit/fix_rafae_duplicate.js --apply       # production change (RED approval required)
 */
const fs = require('fs');
const path = require('path');

const OLD_ID = 'ASIL/SPL-361/21';
const NEW_ID = 'ASIL/SPL-420/21';
const MONTH = 7;
const YEAR = 2026;
const BONUS_420 = 105000;
const REMARK = 'Moved from ASIL/SPL-361/21';

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
const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

(async () => {
    const dbUrl = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL not set');

    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

    const { rows: emps } = await pool.query(
        'SELECT id, name, active, contract_id FROM employees WHERE id = ANY($1::text[])',
        [[OLD_ID, NEW_ID]],
    );
    const byId = Object.fromEntries(emps.map(e => [e.id, e]));

    const { rows: ptRows } = await pool.query(
        `SELECT employee_id, bonus_amount, net, remarks
         FROM payroll_transactions WHERE year=$1 AND month=$2 AND employee_id = ANY($3::text[])`,
        [YEAR, MONTH, [OLD_ID, NEW_ID]],
    );
    const ptById = Object.fromEntries(ptRows.map(r => [r.employee_id, r]));

    console.log('=== BEFORE ===');
    console.log(JSON.stringify({ oldEmp: byId[OLD_ID], newEmp: byId[NEW_ID], payroll: ptById }, null, 2));

    if (DRY_RUN) {
        console.log('\nDRY RUN — would execute:');
        console.log(`  1. UPDATE employees SET active='No' WHERE id='${OLD_ID}'`);
        console.log(`  2. DELETE payroll_transactions July ${YEAR} for ${OLD_ID}`);
        console.log(`  3. UPDATE payroll_transactions SET bonus_amount=${BONUS_420}, remarks='${REMARK}' for ${NEW_ID}`);
        await pool.end();
        return;
    }

    const locked = await pool.query(
        'SELECT 1 FROM payroll_transactions WHERE year=$1 AND month=$2 AND locked=TRUE LIMIT 1',
        [YEAR, MONTH],
    );
    if (locked.rows.length) throw new Error('July 2026 payroll is locked');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE employees SET active = 'No', updated_at = NOW() WHERE id = $1`,
            [OLD_ID],
        );
        const del = await client.query(
            'DELETE FROM payroll_transactions WHERE employee_id=$1 AND year=$2 AND month=$3 RETURNING employee_id',
            [OLD_ID, YEAR, MONTH],
        );
        await client.query(
            `UPDATE payroll_transactions
             SET bonus_amount = $4, remarks = $5, updated_at = NOW()
             WHERE employee_id = $3 AND year = $2 AND month = $1`,
            [MONTH, YEAR, NEW_ID, BONUS_420, REMARK],
        );
        await client.query('COMMIT');
        console.log('\nAPPLIED:', { deactivated: OLD_ID, payrollDeleted: del.rowCount, bonus420: BONUS_420 });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
})().catch((err) => { console.error(err); process.exit(1); });
