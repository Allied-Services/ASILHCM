'use strict';
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({ path: path.join(backendRoot, '.env.local') });
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const pool = new Pool({ connectionString: process.env.STAGING_DATABASE_URL, ssl: { rejectUnauthorized: true } });
(async () => {
  await pool.query('ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS ot_rate NUMERIC DEFAULT 0');
  console.log('ot_rate column ensured');
  const emps = await pool.query('SELECT contract_id, COUNT(*)::int c FROM employees WHERE active=true GROUP BY contract_id ORDER BY c DESC');
  console.log(JSON.stringify(emps.rows, null, 2));
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
