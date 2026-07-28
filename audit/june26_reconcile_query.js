'use strict';
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({
  path: path.join(backendRoot, '.env.local'),
});
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));

const dbUrl = process.env.STAGING_DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('No database URL found');
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: true } : false,
});

(async () => {
  const runs = await pool.query(`
    SELECT pr.id, pr.contract_id, c.name AS contract_name, pr.period_month, pr.period_year,
           pr.status, pr.computed_at,
           (SELECT COUNT(*) FROM payroll_run_rows r WHERE r.run_id = pr.id) AS row_count
    FROM payroll_runs pr
    LEFT JOIN contracts c ON c.id = pr.contract_id
    ORDER BY pr.computed_at DESC
  `);
  console.log('=== June 2026 payroll_runs ===');
  console.log(JSON.stringify(runs.rows, null, 2));

  if (runs.rows.length) {
    const runId = runs.rows[0].id;
    const sample = await pool.query(`
      SELECT prr.employee_id, e.name, prr.paid_days, prr.computed
      FROM payroll_run_rows prr
      LEFT JOIN employees e ON e.id = prr.employee_id
      WHERE prr.run_id = $1
      ORDER BY e.name
      LIMIT 5
    `, [runId]);
    console.log('\n=== Sample rows from latest run ===');
    console.log(JSON.stringify(sample.rows, null, 2));
  }

  const worldA = await pool.query(`
    SELECT COUNT(*) AS cnt, SUM((computed->>'netPay')::numeric) AS total_net
    FROM payroll_transactions pt
    WHERE pt.year = 2026 AND pt.month = 6 AND pt.locked = true
  `);
  console.log('\n=== World A locked payroll_transactions June 2026 ===');
  console.log(JSON.stringify(worldA.rows[0], null, 2));

  await pool.end();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
