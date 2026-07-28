'use strict';
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({ path: path.join(backendRoot, '.env.local') });
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const { computeRunForContract } = require(path.join(backendRoot, 'src', 'modules', 'payrollrun', 'service'));

const CONTRACTS = [
  'CTR-1773046722553',
  'CTR-1773048523696',
  'CTR-1773048704450',
  'CTR-1778149976025',
];

const pool = new Pool({ connectionString: process.env.STAGING_DATABASE_URL, ssl: { rejectUnauthorized: true } });

(async () => {
  const contracts = await pool.query('SELECT id, contract_name FROM contracts ORDER BY id');
  console.log('All contracts:', JSON.stringify(contracts.rows, null, 2));
  for (const cid of CONTRACTS) {
    const exists = contracts.rows.find((c) => c.id === cid);
    if (!exists) { console.log(`Skip ${cid}`); continue; }
    try {
      const result = await computeRunForContract(pool, { contractId: cid, month: 6, year: 2026 });
      console.log(`${cid}: ${result.rows?.length || 0} rows`);
    } catch (e) {
      console.log(`${cid}: ERROR ${e.message}`);
    }
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
