'use strict';
/**
 * Staging gate for FV CORO onboarding (FV-11 … FV-14).
 * Requires STAGING_DATABASE_URL (or DATABASE_URL pointing at staging).
 *
 * Steps:
 *  1) migrate (caller should run npm run migrate first)
 *  2) optional NZ re-sync (confirm)
 *  3) create CORO contract
 *  4) assign 64 CORO employees
 *  5) offline CORO invoice smoke + DB invoice compute for SO-PSO-CORO-SS94 July 2026
 *  6) apply PSO-085 CNIC expiry fix
 *
 * Usage:
 *   STAGING_DATABASE_URL=... node scripts/run_fv_coro_staging_ops.js --apply
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

function loadEnv() {
    for (const p of [
        path.join(__dirname, '../backend/.env'),
        path.join(__dirname, '../.env'),
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

async function main() {
    const apply = process.argv.includes('--apply');
    const dbUrl = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error(JSON.stringify({
            ok: false,
            blocked: true,
            reason: 'STAGING_DATABASE_URL / DATABASE_URL missing in this environment',
            readyScripts: [
                'cd backend && npm run migrate',
                'node scripts/seed_pso_coro_ma.js',
                'node scripts/assign_coro_employees.js --apply',
                'psql "$DATABASE_URL" -f scripts/fix_pso085_cnic_expiry.sql',
                'node scripts/smoke_coro_invoice.js',
            ],
        }, null, 2));
        process.exit(1);
    }

    // Prefer staging URL for child scripts.
    process.env.DATABASE_URL = dbUrl;

    const smoke = spawnSync('node', [path.join(__dirname, 'smoke_coro_invoice.js')], { stdio: 'inherit' });
    if (smoke.status !== 0) process.exit(smoke.status || 2);

    if (!apply) {
        console.log(JSON.stringify({
            ok: true,
            mode: 'dry-run',
            message: 'Offline CORO math passed. Re-run with --apply to seed/assign against staging DB.',
        }, null, 2));
        return;
    }

    const seed = spawnSync('node', [path.join(__dirname, 'seed_pso_coro_ma.js')], {
        stdio: 'inherit',
        env: process.env,
    });
    if (seed.status !== 0) process.exit(seed.status || 2);

    const assign = spawnSync('node', [path.join(__dirname, 'assign_coro_employees.js'), '--apply'], {
        stdio: 'inherit',
        env: process.env,
    });
    if (assign.status !== 0) process.exit(assign.status || 2);

    let Pool;
    for (const p of [
        path.join(__dirname, '../backend/node_modules/pg'),
        'pg',
    ]) {
        try { Pool = require(p).Pool; break; } catch { /* next */ }
    }
    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
        await pool.query(`UPDATE employees SET cnic_expiry = '2032-08-16' WHERE id = 'ASIL/PSO-085/25'`);
        const { computeSoInvoice } = require('../backend/src/modules/serviceOrders/billing');
        const inv = await computeSoInvoice(pool, {
            serviceOrderId: 'SO-PSO-CORO-SS94',
            month: 7,
            year: 2026,
        });
        const round2 = (n) => Math.round(Number(n) * 100) / 100;
        const check = {
            gross: round2(inv.gross),
            provincialSt: round2(inv.provincialSt),
            grandTotal: round2(inv.grandTotal),
            expected: { gross: 4136919.94, provincialSt: 661907.19, grandTotal: 4798827.13 },
        };
        check.pass = check.gross === 4136919.94
            && check.provincialSt === 661907.19
            && check.grandTotal === 4798827.13;

        const empCount = await pool.query(
            `SELECT COUNT(*)::int AS n FROM employees WHERE contract_id = 'CTR-PSO-CORO-MA' AND site = 'SS94'`
        );
        console.log(JSON.stringify({
            ok: !!check.pass,
            invoice: check,
            coroEmployees: empCount.rows[0].n,
            pso085: (await pool.query(
                `SELECT id, cnic_expiry FROM employees WHERE id = 'ASIL/PSO-085/25'`
            )).rows[0],
        }, null, 2));
        if (!check.pass) process.exit(2);
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
