'use strict';

/**
 * Insert missing Serainourang non-manpower SO lines (consumables + tractor).
 *
 *   node backend/scripts/add_serainourang_nonmp_lines.js
 *   node backend/scripts/add_serainourang_nonmp_lines.js --apply --allow-production
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PSO_CONTRACT_ID } = require('../src/modules/serviceOrders/sitesMeta');

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-production');
const SITE = 'SERAINOURANG';

function looksProduction(url) {
    const s = String(url || '').toLowerCase();
    return s.includes('neon.tech') && !s.includes('staging') && !s.includes('ci-test');
}

function loadSeedLines() {
    const file = path.join(__dirname, '../src/modules/serviceOrders/seedData/pso_sites.json');
    const sites = JSON.parse(fs.readFileSync(file, 'utf8'));
    const site = sites.find((s) => s.id === SITE);
    if (!site) throw new Error('SERAINOURANG missing from seed');
    return site.lineItems || [];
}

function norm(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
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

    const seedLines = loadSeedLines();
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
    const report = { site: SITE, contractId: PSO_CONTRACT_ID, apply: APPLY, inserted: [], lines: [], rateSum: 0 };

    try {
        const { rows: soRows } = await pool.query(
            `SELECT id FROM service_orders WHERE contract_id = $1 AND site_code = $2 LIMIT 1`,
            [PSO_CONTRACT_ID, SITE]
        );
        const so = soRows[0];
        if (!so) throw new Error('Live service order not found');
        report.soId = so.id;

        const { rows: live } = await pool.query(
            `SELECT id, line_number, name, quantity, rate, is_manpower_dependent
             FROM service_order_lines WHERE service_order_id = $1 ORDER BY id`,
            [so.id]
        );
        const liveNames = new Set(live.map((l) => norm(l.name)));

        for (let i = 0; i < seedLines.length; i += 1) {
            const seed = seedLines[i];
            if (liveNames.has(norm(seed.name))) continue;
            const lineNo = String(i + 1);
            const row = {
                line_number: lineNo,
                name: seed.name,
                unit: seed.unit || 'EA',
                quantity: Number(seed.quantity || 1),
                rate: Number(seed.rate || 0),
                total_amount: Number(seed.totalAmount ?? seed.rate ?? 0),
                is_manpower_dependent: !!seed.isManpowerDependent,
            };
            report.inserted.push(row);
            if (!APPLY) continue;
            await pool.query(
                `INSERT INTO service_order_lines
                 (service_order_id, line_number, name, unit, quantity, rate, total_amount, is_manpower_dependent, roles)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'[]'::jsonb)`,
                [so.id, row.line_number, row.name, row.unit, row.quantity, row.rate, row.total_amount, row.is_manpower_dependent]
            );
        }

        const { rows: after } = await pool.query(
            `SELECT line_number, name, quantity, rate, is_manpower_dependent
             FROM service_order_lines WHERE service_order_id = $1 ORDER BY id`,
            [so.id]
        );
        report.lines = after;
        report.rateSum = after.reduce((n, l) => n + Number(l.rate || 0), 0);
        if (APPLY) {
            await pool.query(`UPDATE service_orders SET total_value = $2 WHERE id = $1`, [so.id, report.rateSum]);
        }

        const outDir = path.join(__dirname, '../../audit/cutover');
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, 'serainourang_nonmp_lines_2026-09-22.json');
        fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
        console.log(`Wrote ${outFile}`);
        if (!APPLY) console.log('Dry run only. Re-run with --apply --allow-production after review.');
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
