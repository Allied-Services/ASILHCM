#!/usr/bin/env node
'use strict';

/**
 * Compare CTR-PSO-NORTH-ZONE live service-order lines to pso_sites.json.
 * Restores missing lines, manpower flags, roles, and role rates.
 * Does not overwrite a live line rate that already differs from seed.
 *
 * Usage:
 *   node backend/scripts/repair_pso_north_zone_so.js
 *   node backend/scripts/repair_pso_north_zone_so.js --apply
 *   node backend/scripts/repair_pso_north_zone_so.js --apply --allow-production
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PSO_CONTRACT_ID } = require('../src/modules/serviceOrders/sitesMeta');
const { replaceLines } = require('../src/modules/serviceOrders/crud');

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-production');

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

function soIdForSite(siteCode) {
    return `SO-PSO-${siteCode}`;
}

function rolesOf(line) {
    if (Array.isArray(line?.roles)) return line.roles;
    if (typeof line?.roles === 'string') {
        try { return JSON.parse(line.roles || '[]'); } catch { return []; }
    }
    return [];
}

function normName(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function roleKey(r) {
    return String(r.designation || r.role || '').trim().toLowerCase();
}

function mergeRoles(liveRoles, seedRoles) {
    const byKey = new Map();
    for (const r of liveRoles || []) {
        const key = roleKey(r);
        if (key) byKey.set(key, { ...r });
    }
    let changed = false;
    for (const seed of seedRoles || []) {
        const key = roleKey(seed);
        if (!key) continue;
        const live = byKey.get(key);
        if (!live) {
            byKey.set(key, { ...seed });
            changed = true;
            continue;
        }
        if (!(Number(live.count) > 0) && Number(seed.count) > 0) {
            live.count = seed.count;
            changed = true;
        }
        if (!(Number(live.rate) > 0) && Number(seed.rate) > 0) {
            live.rate = seed.rate;
            changed = true;
        }
        const seedKw = String(seed.keywords || '').trim();
        if (seedKw && !String(live.keywords || '').trim()) {
            live.keywords = seedKw;
            changed = true;
        }
    }
    return { roles: [...byKey.values()], changed };
}

function looksProduction(url) {
    const s = String(url || '').toLowerCase();
    return s.includes('neon.tech') && !s.includes('staging') && !s.includes('ci-test');
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
        sites: [],
        would_update: 0,
        applied: 0,
    };

    try {
        for (const site of seedSites) {
            const soId = soIdForSite(site.id);
            const { rows: soRows } = await pool.query(
                `SELECT so.*,
                        (SELECT COALESCE(json_agg(l ORDER BY l.id), '[]'::json)
                         FROM service_order_lines l WHERE l.service_order_id = so.id) AS lines
                 FROM service_orders so
                 WHERE so.id = $1 OR (so.contract_id = $2 AND so.site_code = $3)
                 ORDER BY so.id = $1 DESC
                 LIMIT 1`,
                [soId, PSO_CONTRACT_ID, site.id]
            );
            const live = soRows[0];
            const liveLines = live ? (Array.isArray(live.lines) ? live.lines : []) : [];
            const nextLines = [];
            const siteReport = {
                site: site.id,
                soId: live?.id || soId,
                missing_so: !live,
                changes: [],
            };

            (site.lineItems || []).forEach((seedLine, idx) => {
                const lineNo = String(idx + 1);
                const liveLine = liveLines.find((l) => String(l.line_number) === lineNo)
                    || liveLines.find((l) => normName(l.name) === normName(seedLine.name));
                const merged = {
                    line_number: liveLine?.line_number || lineNo,
                    name: liveLine?.name || seedLine.name,
                    unit: liveLine?.unit || seedLine.unit || 'MON',
                    quantity: liveLine?.quantity != null ? Number(liveLine.quantity)
                        : (seedLine.quantity != null ? Number(seedLine.quantity) : 1),
                    rate: liveLine && Number(liveLine.rate) > 0 ? Number(liveLine.rate) : Number(seedLine.rate || 0),
                    total_amount: liveLine && Number(liveLine.rate) > 0
                        ? Number(liveLine.total_amount ?? liveLine.rate)
                        : Number(seedLine.totalAmount ?? seedLine.rate || 0),
                    is_manpower_dependent: liveLine
                        ? !!(liveLine.is_manpower_dependent ?? seedLine.isManpowerDependent)
                        : !!seedLine.isManpowerDependent,
                    roles: rolesOf(liveLine),
                };
                if (!liveLine) {
                    merged.is_manpower_dependent = !!seedLine.isManpowerDependent;
                    merged.roles = seedLine.roles || [];
                    siteReport.changes.push({ line: lineNo, action: 'insert_missing_line', name: seedLine.name });
                } else {
                    if (!!(liveLine.is_manpower_dependent) !== !!seedLine.isManpowerDependent) {
                        merged.is_manpower_dependent = !!seedLine.isManpowerDependent;
                        siteReport.changes.push({ line: lineNo, action: 'restore_manpower_flag', to: merged.is_manpower_dependent });
                    }
                    const roleMerge = mergeRoles(rolesOf(liveLine), seedLine.roles || []);
                    merged.roles = roleMerge.roles;
                    if (roleMerge.changed) {
                        siteReport.changes.push({ line: lineNo, action: 'restore_roles_or_rates' });
                    }
                    if (!(Number(liveLine.rate) > 0) && Number(seedLine.rate) > 0) {
                        merged.rate = Number(seedLine.rate);
                        merged.total_amount = Number(seedLine.rate);
                        siteReport.changes.push({ line: lineNo, action: 'restore_zero_line_rate', rate: seedLine.rate });
                    }
                }
                nextLines.push(merged);
            });

            for (const extra of liveLines) {
                const kept = nextLines.some((l) => (
                    String(l.line_number) === String(extra.line_number)
                    || normName(l.name) === normName(extra.name)
                ));
                if (!kept) {
                    nextLines.push({
                        line_number: extra.line_number,
                        name: extra.name,
                        unit: extra.unit,
                        quantity: extra.quantity,
                        rate: extra.rate,
                        total_amount: extra.total_amount ?? extra.rate,
                        is_manpower_dependent: !!extra.is_manpower_dependent,
                        roles: rolesOf(extra),
                    });
                    siteReport.changes.push({ line: extra.line_number, action: 'keep_unrelated_live_line', name: extra.name });
                }
            }

            report.sites.push(siteReport);
            if (!siteReport.changes.length || !live) continue;
            report.would_update += 1;
            if (!APPLY) continue;
            await replaceLines(pool, live.id, nextLines);
            report.applied += 1;
        }

        const outDir = path.join(__dirname, '../../audit/cutover');
        fs.mkdirSync(outDir, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 10);
        const outFile = path.join(outDir, `pso_north_zone_so_repair_${stamp}.json`);
        fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
        console.log(`Wrote ${outFile}`);
        if (!APPLY) console.log('Dry run only. Re-run with --apply after review.');
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
