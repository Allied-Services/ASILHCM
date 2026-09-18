'use strict';
/**
 * Read-only Phase 0 safety pre-check.
 *
 * Who does the old wide FV payroll query include that a strict
 * contract_id query excludes? Those people are roster problems —
 * assign the correct employees.contract_id before shipping the
 * scoped query. Never re-widen payroll to keep them.
 *
 *   node backend/scripts/pso_payroll_scope_diff.js
 *   node backend/scripts/pso_payroll_scope_diff.js --contract CTR-PSO-NORTH-ZONE --month 8 --year 2026
 *
 * Needs DATABASE_URL or STAGING_DATABASE_URL. Default is production-shaped
 * URL if present; does not write.
 */
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

function loadEnv() {
    for (const p of [
        path.join(__dirname, '../.env'),
        path.join(__dirname, '../../.env'),
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), 'backend/.env'),
        path.join('C:/Projects/HCM/BPOFMSystem/backend/.env'),
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

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
    return fallback;
}

async function main() {
    loadEnv();
    const url = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL / STAGING_DATABASE_URL is not set. Diff not run.');
        process.exit(2);
    }
    const contractId = arg('contract', 'CTR-PSO-NORTH-ZONE');
    const month = Number(arg('month', '8'));
    const year = Number(arg('year', '2026'));
    const pool = new Pool({
        connectionString: url,
        ssl: url.includes('localhost') ? false : { rejectUnauthorized: true },
        max: 2,
    });

    const active = `LOWER(TRIM(e.active::text)) NOT IN ('no','false','0','inactive')
           AND (
               e.active IS NULL
               OR LOWER(TRIM(e.active::text)) IN ('yes','true','1','active','')
               OR e.active::text = 'Yes'
           )
           AND (e.last_working_day IS NULL OR e.last_working_day >= make_date($3, $2, 1))`;

    const { rows: nameRows } = await pool.query(
        `SELECT contract_name FROM contracts WHERE id = $1`,
        [contractId]
    );
    const contractName = nameRows[0]?.contract_name || null;

    const { rows: wide } = await pool.query(
        `SELECT DISTINCT e.id, e.name, e.contract_id, e.contract_name, e.site, e.location, e.designation
         FROM employees e
         WHERE ${active}
           AND (
             e.contract_id = $1
             OR ($4::text IS NOT NULL AND e.contract_name = $4)
             OR EXISTS (
               SELECT 1 FROM so_deductions d
               JOIN service_orders so ON so.id = d.service_order_id
               WHERE d.employee_id = e.id
                 AND so.contract_id = $1
                 AND d.period_month = $2
                 AND d.period_year = $3
             )
             OR (
               EXISTS (
                 SELECT 1 FROM monthly_attendance_overrides mao
                 WHERE mao.employee_id = e.id
                   AND mao.period_month = $2
                   AND mao.period_year = $3
                   AND mao.source IN ('fv_conservancy_attendance', 'cycle_machine_file')
               )
               AND NOT EXISTS (
                 SELECT 1 FROM service_orders so_other
                 WHERE so_other.contract_id = e.contract_id
                   AND so_other.contract_id IS DISTINCT FROM $1
               )
             )
           )
         ORDER BY e.name`,
        [contractId, month, year, contractName]
    );

    const { rows: strict } = await pool.query(
        `SELECT e.id, e.name, e.contract_id, e.contract_name, e.site, e.location, e.designation
         FROM employees e
         WHERE ${active}
           AND e.contract_id = $1
         ORDER BY e.name`,
        [contractId, month, year]
    );

    const strictIds = new Set(strict.map((r) => r.id));
    const extra = wide.filter((r) => !strictIds.has(r.id));
    const missing = strict.filter((r) => !wide.some((w) => w.id === r.id));

    const report = {
        contractId,
        contractName,
        month,
        year,
        wideCount: wide.length,
        strictCount: strict.length,
        extraCount: extra.length,
        missingFromWide: missing.length,
        extra,
    };

    const outDir = path.join(__dirname, '../../audit/cutover');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `pso_payroll_scope_diff_${contractId}_${year}-${String(month).padStart(2, '0')}.json`);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

    console.log(JSON.stringify({
        contractId,
        month,
        year,
        wideCount: wide.length,
        strictCount: strict.length,
        extraCount: extra.length,
        extra: extra.map((r) => ({
            id: r.id,
            name: r.name,
            contract_id: r.contract_id,
            site: r.site,
        })),
        report: outFile,
    }, null, 2));

    await pool.end();
    process.exit(extra.length ? 1 : 0);
}

main().catch((err) => {
    console.error('[pso_payroll_scope_diff]', err.message || err);
    process.exit(2);
});
