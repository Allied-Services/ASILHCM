'use strict';
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({ path: path.join(backendRoot, '.env.local') });
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const { computeRunForContract } = require(path.join(backendRoot, 'src', 'modules', 'payrollrun', 'service'));

const pool = new Pool({ connectionString: process.env.STAGING_DATABASE_URL, ssl: { rejectUnauthorized: true } });

(async () => {
  const contracts = ['CTR-1773046722553', 'CTR-1773048523696'];
  for (const cid of contracts) {
    const pol = await pool.query('SELECT contract_id FROM contract_policies WHERE contract_id = $1', [cid]);
    const rc = await pool.query('SELECT COUNT(*)::int AS c FROM contract_rate_cards WHERE contract_id = $1', [cid]);
    const att = await pool.query(`
      SELECT COUNT(*)::int AS c FROM attendance_records ar
      JOIN employees e ON e.id = ar.employee_id
      WHERE e.contract_id = $1 AND ar.date >= '2026-06-01' AND ar.date <= '2026-06-30'
    `, [cid]);
    const emp = await pool.query(`SELECT COUNT(*)::int AS c FROM employees WHERE contract_id = $1 AND active::text IN ('true','t','1','Yes')`, [cid]);
    console.log(cid, { policy: pol.rows.length ? 'YES' : 'NONE', rateCards: rc.rows[0].c, juneAttendance: att.rows[0].c, activeEmployees: emp.rows[0].c });
    try {
      const result = await computeRunForContract(pool, { contractId: cid, month: 6, year: 2026 });
      console.log('  compute:', result.rows?.length || 0, 'rows, status:', result.status);
      if (result.rows?.length === 0) console.log('  result keys:', Object.keys(result));
    } catch (e) {
      console.log('  compute ERROR:', e.message);
    }
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
