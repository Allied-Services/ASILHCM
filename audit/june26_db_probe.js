'use strict';
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({ path: path.join(backendRoot, '.env.local') });
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const pool = new Pool({ connectionString: process.env.STAGING_DATABASE_URL, ssl: { rejectUnauthorized: true } });
(async () => {
  const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='payroll_transactions' ORDER BY ordinal_position");
  console.log('payroll_transactions:', cols.rows.map((r) => r.column_name).join(', '));
  const runs = await pool.query('SELECT id, contract_id, status FROM payroll_runs WHERE period_year=2026 AND period_month=6');
  console.log('june runs:', runs.rows.length, JSON.stringify(runs.rows));
  const pt = await pool.query('SELECT COUNT(*)::int AS c FROM payroll_transactions WHERE year=2026 AND month=6');
  console.log('june pt count:', pt.rows[0].c);
  if (runs.rows.length) {
    const rc = await pool.query('SELECT COUNT(*)::int AS c FROM payroll_run_rows WHERE run_id=$1', [runs.rows[0].id]);
    console.log('rows in first run:', rc.rows[0].c);
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
