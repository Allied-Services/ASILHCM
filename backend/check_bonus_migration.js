/**
 * Diagnostic: Check Apr-2026 bonus migration status in payroll_transactions
 * Run: node check_bonus_migration.js
 */
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

async function main() {
    const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    console.log('Connected to Neon DB\n');

    // 1. Summary: how many rows in April 2026?
    const total = await client.query(`
        SELECT COUNT(*) AS total_rows
        FROM payroll_transactions
        WHERE year = 2026 AND month = 4
    `);
    console.log(`=== April 2026 Payroll Rows: ${total.rows[0].total_rows} ===\n`);

    // 2. Rows where bonus_amount > 0 (migration target — should be ALL bonus employees)
    const bonusOk = await client.query(`
        SELECT COUNT(*) AS count, SUM(bonus_amount) AS total_bonus
        FROM payroll_transactions
        WHERE year = 2026 AND month = 4
          AND bonus_amount > 0
    `);
    console.log(`Rows with bonus_amount > 0 (migrated correctly): ${bonusOk.rows[0].count}`);
    console.log(`  Total bonus_amount: Rs. ${Number(bonusOk.rows[0].total_bonus || 0).toLocaleString()}\n`);

    // 3. Rows where special_allowance > 0 (should be NONE after migration)
    const splRemaining = await client.query(`
        SELECT COUNT(*) AS count, SUM(special_allowance) AS total_spl
        FROM payroll_transactions
        WHERE year = 2026 AND month = 4
          AND special_allowance > 0
    `);
    console.log(`Rows with special_allowance > 0 (should be 0 if migration ran): ${splRemaining.rows[0].count}`);
    if (splRemaining.rows[0].count > 0) {
        console.log(`  ⚠️  special_allowance total still present: Rs. ${Number(splRemaining.rows[0].total_spl || 0).toLocaleString()}`);
        console.log(`  → Migration has NOT run yet (Render not restarted) or there are genuine special allowances.\n`);
    } else {
        console.log(`  ✅ All special_allowance zeroed — migration ran successfully!\n`);
    }

    // 4. Per-employee detail: top 20 rows showing key fields
    const detail = await client.query(`
        SELECT
            pt.employee_id,
            e.name,
            pt.bonus_amount,
            pt.special_allowance,
            pt.gross,
            pt.net,
            pt.locked
        FROM payroll_transactions pt
        LEFT JOIN employees e ON e.id = pt.employee_id
        WHERE pt.year = 2026 AND pt.month = 4
        ORDER BY pt.bonus_amount DESC, pt.special_allowance DESC
        LIMIT 30
    `);

    console.log(`=== Per-Employee Detail (top 30, sorted by bonus_amount desc) ===`);
    console.log(`${'Employee'.padEnd(35)} ${'Bonus'.padStart(10)} ${'SplAllow'.padStart(10)} ${'Gross'.padStart(12)} ${'Net'.padStart(12)} ${'Locked'.padStart(8)}`);
    console.log('─'.repeat(100));
    detail.rows.forEach(r => {
        const bonus  = Number(r.bonus_amount  || 0).toLocaleString().padStart(10);
        const spl    = Number(r.special_allowance || 0).toLocaleString().padStart(10);
        const gross  = Number(r.gross || 0).toLocaleString().padStart(12);
        const net    = Number(r.net   || 0).toLocaleString().padStart(12);
        const locked = (r.locked ? '🔒 YES' : 'no').padStart(8);
        const name   = (r.name || r.employee_id || '?').substring(0, 34).padEnd(35);
        console.log(`${name} ${bonus} ${spl} ${gross} ${net} ${locked}`);
    });

    // 5. Check rows with BOTH bonus_amount > 0 AND special_allowance > 0 (genuine special allowances)
    const both = await client.query(`
        SELECT COUNT(*) AS count
        FROM payroll_transactions
        WHERE year = 2026 AND month = 4
          AND bonus_amount > 0 AND special_allowance > 0
    `);
    console.log(`\nRows with BOTH bonus_amount > 0 AND special_allowance > 0: ${both.rows[0].count}`);
    console.log(`(These have genuine special allowances in addition to bonus — expected if any exist)\n`);

    await client.end();
    console.log('Done.');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
