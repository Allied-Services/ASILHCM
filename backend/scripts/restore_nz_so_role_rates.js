#!/usr/bin/env node
'use strict';

/**
 * Restore nested Service Order role rates on CTR-PSO-NORTH-ZONE in place.
 * Does not delete or re-insert lines (so_deductions.line_id stays put).
 *
 * Fills missing role rates from pso_sites.json, then applies known live
 * overrides (Sihala Sweeping / Cleaning = Rs. 52,043 per resource).
 *
 *   node backend/scripts/restore_nz_so_role_rates.js
 *   node backend/scripts/restore_nz_so_role_rates.js --apply --allow-production
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PSO_CONTRACT_ID } = require('../src/modules/serviceOrders/sitesMeta');

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-production');

const LIVE_OVERRIDES = [
    {
        site: 'SIHALA',
        designation: 'Sweeping / Cleaning Services',
        rate: 52043,
        isManpowerDependent: true,
    },
];

function loadSeed() {
    const candidates = [
        path.join(__dirname, '../src/modules/serviceOrders/seedData/pso_sites.json'),
        path.join(__dirname, '../../scripts/seeds/pso_sites.json'),
    ];
    for (const file of candidates) {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    throw new Error('pso_sites.json not found');
}

function rolesOf(line) {
    if (Array.isArray(line?.roles)) return line.roles.map((r) => ({ ...r }));
    if (typeof line?.roles === 'string') {
        try { return JSON.parse(line.roles || '[]'); } catch { return []; }
    }
    return [];
}

function norm(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function roleKey(r) {
    return norm(r.designation || r.role);
}

function positiveRate(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function looksProduction(url) {
    const s = String(url || '').toLowerCase();
    return s.includes('neon.tech') && !s.includes('staging') && !s.includes('ci-test');
}

function mergeRoles(liveRoles, seedRoles, override) {
    const byKey = new Map();
    for (const r of liveRoles || []) {
        const key = roleKey(r);
        if (key) byKey.set(key, { ...r });
    }
    const changes = [];
    for (const seed of seedRoles || []) {
        const key = roleKey(seed);
        if (!key) continue;
        let live = byKey.get(key);
        if (!live) {
            live = { ...seed };
            byKey.set(key, live);
            changes.push({ action: 'insert_role', designation: seed.designation, rate: seed.rate, count: seed.count });
            continue;
        }
        if (!(Number(live.count) > 0) && Number(seed.count) > 0) {
            live.count = seed.count;
            changes.push({ action: 'restore_count', designation: seed.designation, count: seed.count });
        }
        if (!positiveRate(live.rate) && positiveRate(seed.rate)) {
            live.rate = Number(seed.rate);
            changes.push({ action: 'restore_seed_rate', designation: seed.designation, rate: seed.rate });
        }
        if (live.is_manpower_dependent == null && live.isManpowerDependent == null
            && (seed.isManpowerDependent != null || seed.is_manpower_dependent != null)) {
            const mp = !!(seed.isManpowerDependent ?? seed.is_manpower_dependent);
            live.is_manpower_dependent = mp;
            live.isManpowerDependent = mp;
            changes.push({ action: 'restore_manpower', designation: seed.designation, manpower: mp });
        }
    }
    if (override) {
        const key = norm(override.designation);
        let live = byKey.get(key);
        if (!live) {
            live = {
                designation: override.designation,
                count: override.count || 1,
                rate: override.rate,
                is_manpower_dependent: override.isManpowerDependent !== false,
                isManpowerDependent: override.isManpowerDependent !== false,
            };
            byKey.set(key, live);
            changes.push({ action: 'insert_override_role', designation: override.designation, rate: override.rate });
        } else if (positiveRate(live.rate) !== override.rate) {
            live.rate = override.rate;
            live.is_manpower_dependent = override.isManpowerDependent !== false;
            live.isManpowerDependent = override.isManpowerDependent !== false;
            changes.push({ action: 'restore_override_rate', designation: override.designation, rate: override.rate });
        }
    }
    return { roles: [...byKey.values()], changes };
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

    const seedSites = loadSeed();
    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });
    const report = {
        contractId: PSO_CONTRACT_ID,
        apply: APPLY,
        lines_updated: 0,
        changes: [],
    };

    try {
        const { rows: liveLines } = await pool.query(
            `SELECT l.id, so.site_code, l.line_number, l.name, l.roles
             FROM service_order_lines l
             JOIN service_orders so ON so.id = l.service_order_id
             WHERE so.contract_id = $1
             ORDER BY so.site_code, l.id`,
            [PSO_CONTRACT_ID]
        );

        for (const live of liveLines) {
            const site = seedSites.find((s) => s.id === live.site_code);
            const seedLines = site?.lineItems || [];
            const seedLine = seedLines.find((sl, i) => String(i + 1) === String(live.line_number))
                || seedLines.find((sl) => norm(sl.name) === norm(live.name));
            const override = LIVE_OVERRIDES.find((o) => (
                o.site === live.site_code
                && (seedLine?.roles || []).some((r) => norm(r.designation) === norm(o.designation))
            )) || LIVE_OVERRIDES.find((o) => (
                o.site === live.site_code
                && rolesOf(live).some((r) => roleKey(r) === norm(o.designation))
            ));
            const merged = mergeRoles(rolesOf(live), seedLine?.roles || [], override && {
                ...override,
                count: (rolesOf(live).find((r) => roleKey(r) === norm(override.designation)) || {}).count
                    || (seedLine?.roles || []).find((r) => norm(r.designation) === norm(override.designation))?.count,
            });
            if (!merged.changes.length) continue;
            report.changes.push({
                site: live.site_code,
                lineId: live.id,
                line: live.line_number,
                name: live.name,
                changes: merged.changes,
            });
            if (!APPLY) continue;
            await pool.query(
                `UPDATE service_order_lines SET roles = $2::jsonb WHERE id = $1`,
                [live.id, JSON.stringify(merged.roles)]
            );
            report.lines_updated += 1;
        }

        const outDir = path.join(__dirname, '../../audit/cutover');
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 10);
        const outFile = path.join(outDir, `pso_north_zone_role_rate_restore_${stamp}.json`);
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
