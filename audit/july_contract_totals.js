#!/usr/bin/env node
'use strict';
/**
 * July 2026 WAFI contract-level net pay totals vs owner targets.
 *
 * Usage: node audit/july_contract_totals.js [--out audit/JULY_CONTRACT_TOTALS.md]
 */
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..', 'backend');
const tempRoot = 'C:/temp/BPOFMSystem-backend';
const WAFI_CLIENT = 'Wafi Energy Pakistan Pvt Ltd';
const MONTH = 7;
const YEAR = 2026;

const SEGMENTS = {
    BPO: {
        label: 'Wafi BPO',
        contractIds: ['CTR-1773046722553'],
        targetActive: 221,
        targetNet: 40535984,
    },
    FM: {
        label: 'Wafi Facility Management',
        contractIds: ['CTR-1773048704450', 'CTR-1773048523696'],
        targetActive: 84,
        targetNet: 3417289,
    },
};

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

function fmt(n) {
    return (Number(n) || 0).toLocaleString('en-PK');
}

function isActive(val) {
    const s = String(val || '').toLowerCase().trim();
    return !s || s === 'yes' || s === 'true' || s === '1';
}

(async () => {
    const outArg = process.argv.indexOf('--out');
    const outPath = outArg >= 0 ? process.argv[outArg + 1] : path.join(__dirname, 'JULY_CONTRACT_TOTALS.md');

    const dbUrl = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL not set');

    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

    const { rows } = await pool.query(
        `SELECT e.id, e.name, e.contract_id, e.active,
                COALESCE(pt.net, 0)::numeric AS net,
                COALESCE(pt.bonus_amount, 0)::numeric AS bonus
         FROM employees e
         LEFT JOIN payroll_transactions pt
           ON pt.employee_id = e.id AND pt.year = $1 AND pt.month = $2
         WHERE LOWER(TRIM(e.client)) = LOWER($3)`,
        [YEAR, MONTH, WAFI_CLIENT],
    );

    await pool.end();

    const lines = [];
    lines.push('# July 2026 WAFI Contract Totals');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push(`Period: ${MONTH}/${YEAR} · Client: ${WAFI_CLIENT}`);
    lines.push('');
    lines.push('| Segment | Contract ID(s) | Active HC (HCM) | Target HC | HCM Net | Target Net | Net Δ |');
    lines.push('|---------|----------------|----------------:|----------:|--------:|-----------:|------:|');

    let totalHcmNet = 0;
    let totalTargetNet = 0;
    let totalHcmHc = 0;
    let totalTargetHc = 0;

    for (const seg of Object.values(SEGMENTS)) {
        const segRows = rows.filter(r => seg.contractIds.includes(r.contract_id));
        const activeRows = segRows.filter(r => isActive(r.active));
        const hcmNet = Math.round(activeRows.reduce((s, r) => s + Number(r.net), 0));
        const hcmHc = activeRows.length;
        const delta = seg.targetNet - hcmNet;

        totalHcmNet += hcmNet;
        totalTargetNet += seg.targetNet;
        totalHcmHc += hcmHc;
        totalTargetHc += seg.targetActive;

        lines.push(`| ${seg.label} | ${seg.contractIds.join(' + ')} | ${hcmHc} | ${seg.targetActive} | ${fmt(hcmNet)} | ${fmt(seg.targetNet)} | ${fmt(delta)} |`);
    }

    lines.push(`| **Combined** | — | **${totalHcmHc}** | **${totalTargetHc}** | **${fmt(totalHcmNet)}** | **${fmt(totalTargetNet)}** | **${fmt(totalTargetNet - totalHcmNet)}** |`);
    lines.push('');
    lines.push('## Notes');
    lines.push('');
    lines.push('- **Active HC** = employees with `active` Yes/true on master, grouped by `contract_id`.');
    lines.push('- **HCM Net** = sum of `payroll_transactions.net` for July 2026 (active employees in segment).');
    lines.push('- Owner combined target **43,953,273** = BPO 40,535,984 + FM 3,417,289.');
    lines.push('- Gaps > PKR 5,000 are base-pay / OT / attendance engine differences — see `JULY_GAP_REPORT_FINAL.md`.');
    lines.push('');

    // Unassigned contract_ids among active WAFI
    const otherActive = rows.filter(r => isActive(r.active)
        && !Object.values(SEGMENTS).some(s => s.contractIds.includes(r.contract_id)));
    if (otherActive.length) {
        lines.push('## Other active WAFI contracts (not BPO/FM segment)');
        lines.push('');
        const byContract = {};
        otherActive.forEach(r => {
            const k = r.contract_id || 'NONE';
            if (!byContract[k]) byContract[k] = { count: 0, net: 0 };
            byContract[k].count += 1;
            byContract[k].net += Number(r.net) || 0;
        });
        lines.push('| Contract ID | Active | HCM Net |');
        lines.push('|-------------|-------:|--------:|');
        Object.entries(byContract).forEach(([cid, g]) => {
            lines.push(`| ${cid} | ${g.count} | ${fmt(Math.round(g.net))} |`);
        });
        lines.push('');
    }

    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log(`Wrote ${outPath}`);
    console.log(`BPO+FM HCM net: ${fmt(totalHcmNet)} | target: ${fmt(totalTargetNet)} | Δ: ${fmt(totalTargetNet - totalHcmNet)}`);
})().catch((err) => { console.error(err); process.exit(1); });
