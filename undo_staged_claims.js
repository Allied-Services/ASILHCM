'use strict';
/**
 * One-time script: undo the 3 staged Wafi Claims sessions.
 * Run with: node undo_staged_claims.js  (from root OR backend dir)
 */

const path = require('path');
// Resolve deps from backend/node_modules
const backendDir = path.join(__dirname, 'backend');
require(path.join(backendDir, 'node_modules', 'dotenv')).config({ path: path.join(backendDir, '.env') });
const { Pool } = require(path.join(backendDir, 'node_modules', 'pg'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function undoSession(client, sessionId) {
    const { rows: sessionRows } = await client.query(
        'SELECT * FROM wafi_claims_sessions WHERE id = $1', [sessionId]
    );
    if (!sessionRows.length) { console.log(`  Session ${sessionId}: NOT FOUND`); return; }
    const session = sessionRows[0];

    if (!session.pushed_to_payroll || !session.payroll_month) {
        console.log(`  Session ${sessionId}: not staged (pushed_to_payroll=${session.pushed_to_payroll}) — skipping`);
        return;
    }

    const payrollMonth = new Date(session.payroll_month);
    const month = payrollMonth.getMonth() + 1;
    const year  = payrollMonth.getFullYear();

    console.log(`  Session ${sessionId}: ${session.sender_email} | ${session.attachment_filename}`);
    console.log(`    Staged for ${year}-${String(month).padStart(2,'0')} | OT:${session.total_ot_rows} Exp:${session.total_expense_rows} Med:${session.total_medical_rows}`);

    const { rows: items } = await client.query(
        `SELECT wci.*, e.salary
         FROM wafi_claims_items wci
         LEFT JOIN employees e ON e.id = wci.employee_id
         WHERE wci.session_id = $1 AND wci.active = TRUE`,
        [sessionId]
    );

    const otMap = {}, expMap = {}, medMap = {};
    for (const item of items) {
        const empId = item.employee_id;
        if (!empId) continue;
        const salary = parseFloat(item.salary) || 0;
        const hourlyRate = salary / 26 / 8;
        if (item.claim_type === 'OT') {
            const hrs    = parseFloat(item.ot_hours)             || 0;
            const factor = parseFloat(item.ot_multiplier_factor) || 1;
            otMap[empId] = (otMap[empId] || 0) + hrs * factor * hourlyRate;
        } else if (item.claim_type === 'EXPENSE') {
            expMap[empId] = (expMap[empId] || 0) + (parseFloat(item.raw_amount) || 0);
        } else if (item.claim_type === 'MEDICAL') {
            medMap[empId] = (medMap[empId] || 0) + (parseFloat(item.raw_amount) || 0);
        }
    }

    const allEmps = new Set([...Object.keys(otMap), ...Object.keys(expMap), ...Object.keys(medMap)]);
    for (const empId of allEmps) {
        const otAmt  = parseFloat((otMap[empId]  || 0).toFixed(2));
        const expAmt = parseFloat((expMap[empId] || 0).toFixed(2));
        const medAmt = parseFloat((medMap[empId] || 0).toFixed(2));
        const r = await client.query(`
            UPDATE payroll_transactions
            SET ot    = GREATEST(0, ot    - $4),
                reimb = GREATEST(0, reimb - $5),
                opd   = GREATEST(0, opd   - $6)
            WHERE employee_id = $1 AND month = $2 AND year = $3
        `, [empId, month, year, otAmt, expAmt, medAmt]);
        console.log(`    Employee ${empId}: reversed OT=${otAmt} Exp=${expAmt} Med=${medAmt} (rows updated: ${r.rowCount})`);
    }

    await client.query(`
        UPDATE wafi_claims_sessions
        SET pushed_to_payroll = FALSE,
            payroll_month     = NULL,
            processing_status = CASE
                WHEN processing_status = 'VERIFIED' THEN 'PENDING_REVIEW'
                ELSE 'PROCESSED_SUCCESSFULLY'
            END
        WHERE id = $1
    `, [sessionId]);

    console.log(`  ✓ Session ${sessionId} undo complete (${allEmps.size} employees reversed)`);
}

async function main() {
    console.log('=== Wafi Claims: Undo Staged Sessions ===\n');
    const client = await pool.connect();
    try {
        // Find all staged sessions
        const { rows: staged } = await client.query(
            `SELECT id, sender_email, attachment_filename, payroll_month, total_ot_rows, total_expense_rows, total_medical_rows
             FROM wafi_claims_sessions
             WHERE pushed_to_payroll = TRUE
             ORDER BY received_at ASC`
        );

        if (!staged.length) {
            console.log('No staged sessions found. Nothing to undo.');
            return;
        }

        console.log(`Found ${staged.length} staged session(s):\n`);
        staged.forEach(s => console.log(`  #${s.id} | ${s.sender_email} | ${s.attachment_filename} | month: ${s.payroll_month}`));
        console.log();

        await client.query('BEGIN');
        for (const sess of staged) {
            await undoSession(client, sess.id);
        }
        await client.query('COMMIT');

        console.log('\n=== All staged sessions reversed successfully ===');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('ROLLBACK — error:', e.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(e => { console.error(e); process.exit(1); });
