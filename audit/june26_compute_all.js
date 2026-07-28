'use strict';
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({ path: path.join(backendRoot, '.env.local') });
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const { computeRunForContract } = require(path.join(backendRoot, 'src', 'modules', 'payrollrun', 'service'));

const pool = new Pool({ connectionString: process.env.STAGING_DATABASE_URL, ssl: { rejectUnauthorized: true } });

(async () => {
  const contracts = await pool.query(`
    SELECT c.id, c.contract_name, COUNT(e.id)::int AS emp_count
    FROM contracts c
    JOIN employees e ON e.contract_id = c.id AND e.active::text IN ('true', 't', '1', 'Yes')
    GROUP BY c.id, c.contract_name
    HAVING COUNT(e.id) > 0
    ORDER BY emp_count DESC
  `);
  console.log('Contracts with active employees:', JSON.stringify(contracts.rows, null, 2));

  let totalRows = 0;
  for (const c of contracts.rows) {
    if (c.id.startsWith('TEST')) continue;
    try {
      const result = await computeRunForContract(pool, { contractId: c.id, month: 6, year: 2026 });
      const n = result.rows?.length || 0;
      totalRows += n;
      const net = (result.rows || []).reduce((s, r) => s + (r.computed?.netPay || 0), 0);
      console.log(`${c.id} (${c.contract_name}): ${n} rows, net=${Math.round(net)}`);
    } catch (e) {
      console.log(`${c.id}: ERROR ${e.message}`);
    }
  }
  console.log(`Total computed rows: ${totalRows}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
