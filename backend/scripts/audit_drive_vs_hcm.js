'use strict';
/**
 * Compare Google Drive conservancy attendance (source) vs HCM overrides/deductions.
 * Usage: node scripts/audit_drive_vs_hcm.js --site KUNDIAN --month 7 --year 2026
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { pullAttendanceForSite } = require('../src/modules/serviceOrders/driveAttendance');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const out = { site: 'KUNDIAN', month: 7, year: 2026, ids: [] };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--site') out.site = args[++i];
        else if (args[i] === '--month') out.month = Number(args[++i]);
        else if (args[i] === '--year') out.year = Number(args[++i]);
        else if (args[i] === '--ids') out.ids = args[++i].split(',').map(s => s.trim());
    }
    return out;
}

async function main() {
    const { site, month, year, ids } = parseArgs();
    const pulled = await pullAttendanceForSite({ siteCode: site, month, year });
    if (!pulled.ok) {
        console.error('Drive pull failed:', pulled.code, pulled.available || '');
        process.exit(1);
    }
    console.log('Drive file:', pulled.fileName);
    console.log('Sheet rows:', pulled.parse.rows.length);

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: true },
    });

    const { rows: soRows } = await pool.query(
        `SELECT id, contract_id, site_code FROM service_orders WHERE site_code = $1 LIMIT 1`,
        [site]
    );
    const so = soRows[0];
    if (!so) {
        console.error('No service order for site', site);
        process.exit(1);
    }

    const driveByCode = new Map();
    for (const r of pulled.parse.rows) {
        driveByCode.set(r.empCode, r);
    }

    const filterIds = ids.length ? ids : null;
    const { rows: hcmRows } = await pool.query(
        `SELECT e.id, e.name, o.present_days, o.absent_days, o.working_days,
                d.days_absent AS ded_absent, d.amount AS ded_amount
         FROM monthly_attendance_overrides o
         JOIN employees e ON e.id = o.employee_id
         LEFT JOIN so_deductions d ON d.employee_id = e.id
           AND d.service_order_id = $4
           AND d.period_month = $1 AND d.period_year = $2
           AND d.source = 'attendance_ledger'
         WHERE o.period_month = $1 AND o.period_year = $2
           AND o.source = 'fv_conservancy_attendance'
           AND (e.site = $3 OR e.location ILIKE $5)
         ORDER BY e.id`,
        [month, year, site, so.id, `%${site}%`]
    );

    let mismatches = 0;
    let checked = 0;
    console.log('\nEmpCode | Drive Absent | HCM Absent | Deduction | Match');
    console.log('-'.repeat(70));

    for (const [empCode, drive] of driveByCode) {
        const { rows: empMatch } = await pool.query(
            `SELECT id FROM employees WHERE id = $1 OR id ILIKE $2 LIMIT 1`,
            [empCode, `%${empCode.replace(/^W-/i, '')}%`]
        );
        const empId = empMatch[0]?.id;
        if (filterIds && empId && !filterIds.includes(empId)) continue;

        const hcm = hcmRows.find(r => r.id === empId);
        const driveAbsent = Number(drive.absentDays) || 0;
        const hcmAbsent = hcm ? Number(hcm.absent_days) || 0 : null;
        const dedAbsent = hcm ? Number(hcm.ded_absent) || 0 : null;
        const ok = hcmAbsent != null && driveAbsent === hcmAbsent
            && (driveAbsent === 0 || dedAbsent === driveAbsent);
        if (!ok) mismatches += 1;
        checked += 1;
        const flag = ok ? 'OK' : 'MISMATCH';
        console.log(`${empCode} | ${driveAbsent} | ${hcmAbsent ?? 'MISSING'} | ${dedAbsent ?? '-'} | ${flag}`);
    }

    console.log('\nSummary:', { checked, mismatches, hcmOverrideCount: hcmRows.length });
    await pool.end();
    process.exit(mismatches > 0 ? 1 : 0);
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
