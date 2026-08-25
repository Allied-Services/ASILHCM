require('dotenv').config();
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
(async () => {
    const r = await p.query(`SELECT id, claim_month, claim_year, status, fill_close_at, approve_close_at, campaign_mode FROM portal_claim_periods WHERE claim_year = 2026 AND claim_month = 7 ORDER BY id`);
    console.log('periods', JSON.stringify(r.rows, null, 2));
    const s = await p.query(`SELECT s.status, COUNT(*)::int AS c FROM portal_claim_submissions s JOIN portal_claim_periods p ON p.id = s.period_id WHERE p.claim_month = 7 AND p.claim_year = 2026 GROUP BY 1 ORDER BY 1`);
    console.log('status', s.rows);
    await p.end();
})().catch(e => { console.error(e); process.exit(1); });
