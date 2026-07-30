'use strict';
/**
 * Seed PSO North Zone Fixed Value / Conservancy contract, sites, and workers.
 * Usage: node scripts/seed_pso_north_zone.js
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
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL missing — script ready but not executed.');
        console.error('Run migration first: cd backend && npm run migrate');
        console.error('Or seed via POST /api/fixed-value/seed-pso on staging as superadmin.');
        process.exit(1);
    }

    const pgPaths = [
        path.join(__dirname, '../backend/node_modules/pg'),
        path.join(__dirname, '../node_modules/pg'),
        'pg',
    ];
    let Pool;
    for (const p of pgPaths) {
        try {
            Pool = require(p).Pool;
            break;
        } catch { /* try next */ }
    }
    if (!Pool) {
        console.error('pg module not found — run npm ci in backend/');
        process.exit(1);
    }

    const { seedPsoNorthZone } = require('../backend/src/modules/serviceOrders/seed');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    try {
        const result = await seedPsoNorthZone(pool, { actor: 'seed_pso_north_zone.js' });
        console.log(JSON.stringify(result, null, 2));
        if (!result.tarujabbaCheck.pass) {
            console.error('Tarujabba check FAILED');
            process.exit(2);
        }
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
