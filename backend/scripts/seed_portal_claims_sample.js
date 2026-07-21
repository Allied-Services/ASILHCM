'use strict';
/**
 * Seed 3 sample employees for portal claims ASIL test.
 * From backend/: node scripts/seed_portal_claims_sample.js
 */
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

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

const SAMPLES = [
    { id: 'ASIL/TEST-CLAIM-SHEZAD/26', name: 'Portal Test Employee Shezad', email: 'test.shezad.claim@wafi-energy.com', claim_authority: 'shezad.mumtaz@asil.com.pk', client: 'Wafi Energy Pakistan Limited' },
    { id: 'ASIL/TEST-CLAIM-RABIA/26', name: 'Portal Test Employee Rabia', email: 'test.rabia.claim@wafi-energy.com', claim_authority: 'rabia.bhutto@asil.com.pk', client: 'Wafi Energy Pakistan Limited' },
    { id: 'ASIL/TEST-CLAIM-LAIBA/26', name: 'Portal Test Employee Laiba', email: 'test.laiba.claim@wafi-energy.com', claim_authority: 'laiba.mughal@asil.com.pk', client: 'Wafi Energy Pakistan Limited' },
];
const APPROVER = 'huzaifa.rafaqat@asil.com.pk';

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL missing');
        process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS claim_authority TEXT');
    await pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS supervisor_email VARCHAR(255)');
    for (const s of SAMPLES) {
        await pool.query(
            `INSERT INTO employees (id, name, email, client, active, salary, claim_authority, supervisor_email, location, dept)
             VALUES ($1,$2,$3,$4,'Yes',50000,$5,$6,'Test Site','Operations')
             ON CONFLICT (id) DO UPDATE SET
               claim_authority = EXCLUDED.claim_authority,
               supervisor_email = EXCLUDED.supervisor_email,
               email = EXCLUDED.email,
               client = EXCLUDED.client,
               active = 'Yes'`,
            [s.id, s.name, s.email, s.client, s.claim_authority, APPROVER]
        );
        console.log('Upserted', s.id, '->', s.claim_authority);
    }
    console.log('Approver:', APPROVER);
    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
