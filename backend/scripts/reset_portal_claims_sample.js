'use strict';
/**
 * Reset portal claims sample test data so the ASIL sample cycle can be re-run.
 * Safe scope: only ASIL/TEST-CLAIM-* employees.
 *
 * From backend/: node scripts/reset_portal_claims_sample.js
 */
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { resetPortalClaimsSample } = require('../src/modules/claims/portalService');

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
loadEnv();

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL missing');
        process.exit(1);
    }
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });
    try {
        const result = await resetPortalClaimsSample(pool);
        console.log(JSON.stringify(result, null, 2));
        console.log('OK — re-seed then send invites:');
        console.log('  node scripts/seed_portal_claims_sample.js');
    } finally {
        await pool.end();
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
