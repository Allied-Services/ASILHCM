'use strict';
/**
 * Idempotent CORO SS94 Masood Anwari Fixed Value contract seed.
 * Usage: node scripts/seed_pso_coro_ma.js
 * Requires DATABASE_URL (or STAGING_DATABASE_URL).
 */
const path = require('path');
const fs = require('fs');

function loadEnv() {
    const candidates = [
        path.join(__dirname, '../backend/.env'),
        path.join(__dirname, '../.env'),
        path.join(process.cwd(), '.env'),
    ];
    for (const p of candidates) {
        if (!fs.existsSync(p)) continue;
        const text = fs.readFileSync(p, 'utf8');
        for (const line of text.split(/\r?\n/)) {
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
    const dbUrl = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL / STAGING_DATABASE_URL missing — script ready but not executed.');
        console.error('Run migrations first, then: node scripts/seed_pso_coro_ma.js');
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
        console.error('pg module not found — run npm ci in backend/');
        process.exit(1);
    }

    const { createCoroFromSeed, CORO_EXPECTED_GROSS } = require('../backend/src/modules/serviceOrders/contractCrud');
    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
        const result = await createCoroFromSeed(pool, { actor: 'seed_pso_coro_ma.js' });
        const so = result.contract?.service_orders?.[0];
        const lines = so?.lines || [];
        const gross = lines.reduce((s, l) => s + Number(l.rate || 0), 0);
        const round2 = (n) => Math.round(Number(n) * 100) / 100;
        const st = round2(gross * 0.16);
        const grand = round2(gross + st);
        const check = {
            gross: round2(gross),
            salesTax: st,
            grand,
            expected: { gross: CORO_EXPECTED_GROSS, salesTax: 661907.19, grand: 4798827.13 },
            pass: round2(gross) === CORO_EXPECTED_GROSS && st === 661907.19 && grand === 4798827.13,
        };
        console.log(JSON.stringify({ ...result, coroCheck: check }, null, 2));
        if (!check.pass) process.exit(2);
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
