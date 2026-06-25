// Uses Node v24 built-in fetch to hit Neon's HTTP API (no pg module needed)
// Neon supports HTTP SQL queries via their REST endpoint

const CONN = 'postgresql://neondb_owner:npg_sqTk6A2evohU@ep-dry-shadow-ad443mnl-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

// Parse connection string
const url = new URL(CONN.replace('postgresql://', 'https://').split('?')[0]);
const user = url.username;
const pass = url.password;
const host = url.hostname;
const db   = url.pathname.slice(1);

const NEON_API = `https://${host}/sql`;

async function query(sql) {
    const resp = await fetch(NEON_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
            'Neon-Connection-String': CONN,
        },
        body: JSON.stringify({ query: sql }),
    });
    if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${txt}`);
    }
    return resp.json();
}

async function main() {
    console.log('Connecting to Neon via HTTP API...\n');

    // 1. Total April 2026 rows
    const tot = await query(`SELECT COUNT(*) AS total FROM payroll_transactions WHERE year=2026 AND month=4`);
    console.log(`April 2026 total rows: ${tot.rows[0].total}`);

    // 2. bonus_amount summary
    const bns = await query(`
        SELECT COUNT(*) AS cnt, SUM(bonus_amount) AS total_bonus
        FROM payroll_transactions WHERE year=2026 AND month=4 AND bonus_amount>0
    `);
    console.log(`\nRows with bonus_amount > 0: ${bns.rows[0].cnt}`);
    console.log(`Total bonus_amount in DB: Rs. ${Number(bns.rows[0].total_bonus||0).toLocaleString()}`);

    // 3. special_allowance remaining
    const spl = await query(`
        SELECT COUNT(*) AS cnt, SUM(special_allowance) AS total_spl
        FROM payroll_transactions WHERE year=2026 AND month=4 AND special_allowance>0
    `);
    console.log(`\nRows with special_allowance > 0 (should be 0 after migration): ${spl.rows[0].cnt}`);
    if (spl.rows[0].cnt > 0) {
        console.log(`  ⚠️  Migration has NOT run yet — total still in spl_allow: Rs. ${Number(spl.rows[0].total_spl||0).toLocaleString()}`);
    } else {
        console.log(`  ✅ Migration ran — all special_allowance correctly zeroed!`);
    }

    // 4. Per-employee detail
    const det = await query(`
        SELECT pt.employee_id, e.name, pt.bonus_amount, pt.special_allowance, pt.gross, pt.net, pt.locked
        FROM payroll_transactions pt
        LEFT JOIN employees e ON e.id=pt.employee_id
        WHERE pt.year=2026 AND pt.month=4
        ORDER BY pt.bonus_amount DESC, pt.special_allowance DESC
        LIMIT 30
    `);

    console.log(`\n=== Per-Employee (top 30) ===`);
    console.log(`${'Name'.padEnd(28)} ${'BonusAmt'.padStart(10)} ${'SplAllow'.padStart(10)} ${'Gross'.padStart(12)} ${'Net'.padStart(12)} Locked`);
    console.log('─'.repeat(80));
    det.rows.forEach(r => {
        const name = (r.name||r.employee_id||'?').slice(0,27).padEnd(28);
        const bon  = Number(r.bonus_amount||0).toLocaleString().padStart(10);
        const spl2 = Number(r.special_allowance||0).toLocaleString().padStart(10);
        const gr   = Number(r.gross||0).toLocaleString().padStart(12);
        const nt   = Number(r.net||0).toLocaleString().padStart(12);
        const lk   = r.locked ? '🔒' : '';
        console.log(`${name} ${bon} ${spl2} ${gr} ${nt} ${lk}`);
    });

    console.log('\nDone.');
}

main().catch(e => { console.error('Error:', e.message); });
