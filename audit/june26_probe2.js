'use strict';
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({ path: path.join(backendRoot, '.env.local') });
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const pool = new Pool({ connectionString: process.env.STAGING_DATABASE_URL, ssl: { rejectUnauthorized: true } });
(async () => {
  const pol = await pool.query('SELECT contract_id FROM contract_policies');
  console.log('policies:', pol.rows.map((r) => r.contract_id));
  const shakil = await pool.query("SELECT id, name, salary, contract_id FROM employees WHERE id = 'ASIL/PSO-255/25'");
  console.log('shakil:', shakil.rows);
  const att = await pool.query("SELECT COUNT(*)::int c FROM attendance_records WHERE employee_id='ASIL/PSO-255/25' AND date >= '2026-06-01' AND date <= '2026-06-30'");
  console.log('shakil june attendance:', att.rows[0]);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
