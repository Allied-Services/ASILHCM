'use strict';
/**
 * Assign 64 CORO SS94 employees to CTR-PSO-CORO-MA.
 * Source: audit/cutover/active_no_contract_20260731.csv where Contract Name = PSO CORO OPS - SS94 M.A
 *
 * Usage: node scripts/assign_coro_employees.js [--apply]
 * Default is dry-run.
 */
const path = require('path');
const fs = require('fs');

const CONTRACT_ID = 'CTR-PSO-CORO-MA';
const CONTRACT_NAME = 'CORO - Masood Anwari';
const CLIENT = 'Pakistan State Oil Company Limited';
const SITE = 'SS94';
const LOCATION = 'Lahore';
const PROVINCE = 'Punjab';
const MATCH = 'PSO CORO OPS - SS94 M.A';

function loadEnv() {
    for (const p of [
        path.join(__dirname, '../backend/.env'),
        path.join(__dirname, '../.env'),
        path.join(process.cwd(), '.env'),
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

function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map((line) => {
        // Simple CSV — fields in this file have no embedded commas in critical cols.
        const cols = line.split(',');
        const row = {};
        headers.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
        return row;
    });
}

async function main() {
    const apply = process.argv.includes('--apply');
    const csvPath = path.join(__dirname, '../audit/cutover/active_no_contract_20260731.csv');
    if (!fs.existsSync(csvPath)) {
        console.error('CSV not found:', csvPath);
        process.exit(1);
    }
    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'))
        .filter(r => (r['Contract Name'] || '') === MATCH);
    const ids = rows.map(r => r['ASIL Employee Code']).filter(Boolean);
    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        match: MATCH,
        count: ids.length,
        ids,
    }, null, 2));

    if (ids.length !== 64) {
        console.warn(`Expected 64 CORO rows, found ${ids.length}`);
    }

    if (!apply) {
        console.log('Dry-run only. Re-run with --apply to UPDATE employees.');
        return;
    }

    const dbUrl = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL / STAGING_DATABASE_URL missing');
        process.exit(1);
    }

    let Pool;
    for (const p of [
        path.join(__dirname, '../backend/node_modules/pg'),
        path.join(__dirname, '../node_modules/pg'),
        'pg',
    ]) {
        try { Pool = require(p).Pool; break; } catch { /* next */ }
    }
    if (!Pool) {
        console.error('pg module not found');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
        const ct = await pool.query(`SELECT id, contract_name FROM contracts WHERE id = $1`, [CONTRACT_ID]);
        if (!ct.rows.length) {
            console.error(`Contract ${CONTRACT_ID} not found — run seed_pso_coro_ma.js first`);
            process.exit(2);
        }

        const { rows: updated } = await pool.query(
            `UPDATE employees
             SET contract_id = $1,
                 contract_name = $2,
                 client = $3,
                 site = $4,
                 location = $5,
                 province = $6
             WHERE id = ANY($7::text[])
             RETURNING id, name, contract_id, site`,
            [CONTRACT_ID, CONTRACT_NAME, CLIENT, SITE, LOCATION, PROVINCE, ids]
        );

        const stamp = new Date().toISOString().replace(/[:.]/g, '');
        const auditDir = path.join(__dirname, '../audit/cutover');
        fs.mkdirSync(auditDir, { recursive: true });
        const auditPath = path.join(auditDir, `coro_assign_${stamp}.json`);
        fs.writeFileSync(auditPath, JSON.stringify({
            at: new Date().toISOString(),
            contractId: CONTRACT_ID,
            requested: ids.length,
            updated: updated.length,
            rows: updated,
        }, null, 2));

        console.log(JSON.stringify({
            ok: true,
            requested: ids.length,
            updated: updated.length,
            auditPath,
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
