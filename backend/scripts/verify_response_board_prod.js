/**
 * Read-only + resync verification for Portal Claims Response board (July work / Aug pay ACTUAL).
 * Usage: node -r dotenv/config scripts/verify_response_board_prod.js [--resync]
 */
require('dotenv').config();
const { Pool } = require('pg');
const { listResponseBoard } = require('../src/modules/claims/claimsResponse');
const { countEligibleEmployees } = require('../src/modules/claims/claimsEligibility');
const { resyncActuaPeriodSubmissionEmails } = require('../src/modules/claims/portalService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const ACTUAL_PERIOD_ID = 3;
const FOCAL = 'sufaamir@gmail.com';
const ALI_ID = 'ASIL/SPL-412/21';

async function sqlChecks() {
    const batch = await pool.query(
        `SELECT id, filler_email, invite_delivered, invite_sent_at, last_reminder_at, reminder_count
         FROM portal_claim_batches WHERE period_id = $1 AND LOWER(filler_email) = $2`,
        [ACTUAL_PERIOD_ID, FOCAL]
    );
    console.log('\n=== sufaamir batch ===');
    console.log(JSON.stringify(batch.rows, null, 2));

    const aliSub = await pool.query(
        `SELECT s.id, s.filler_email, s.status, e.email, e.claim_authority
         FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.period_id = $1 AND s.employee_id = $2`,
        [ACTUAL_PERIOD_ID, ALI_ID]
    );
    console.log('\n=== Ali Sheikh submission ===');
    console.log(JSON.stringify(aliSub.rows, null, 2));

    const delivered = await pool.query(
        `SELECT COUNT(DISTINCT e.id)::int AS emp_count
         FROM portal_claim_batches b
         JOIN employees e ON LOWER(e.claim_authority) = LOWER(b.filler_email)
            OR (e.claim_authority IS NULL AND LOWER(e.email) = LOWER(b.filler_email))
         WHERE b.period_id = $1 AND b.invite_delivered = TRUE`,
        [ACTUAL_PERIOD_ID]
    );
    console.log('\n=== employees linked to delivered batches (rough) ===', delivered.rows[0]);
}

async function boardChecks() {
    const board = await listResponseBoard(pool, countEligibleEmployees, {
        workMonth: 7, workYear: 2026, payMonth: 8, payYear: 2026,
        client: 'wafi',
    });
    const sufaPeople = (board.people || []).filter(
        (p) => String(p.mailed_to || '').toLowerCase() === FOCAL
            || String(p.filler_email || '').toLowerCase() === FOCAL
    );
    const sufaViaFocal = (board.people || []).filter((p) => {
        const fe = String(p.mailed_to || '').toLowerCase();
        return fe === FOCAL;
    });
    console.log('\n=== board: sufaamir focal rows (mailed_to) ===');
    console.log('count', sufaViaFocal.length);
    const bad = sufaViaFocal.filter((p) => p.status === 'not_invited');
    console.log('not_invited among sufaamir', bad.length);
    if (bad.length) console.log('BAD', bad.slice(0, 3).map((p) => ({ id: p.employee_id, status: p.status, batch_id: p.batch_id })));

    const sample = sufaViaFocal.filter((p) => p.status === 'invite_sent' || p.status.startsWith('waiting'));
    console.log('invite_sent+ among sufaamir', sample.length);
    if (sample[0]) {
        console.log('sample row', {
            id: sample[0].employee_id,
            status: sample[0].status,
            now_label: sample[0].now_label,
            sent_at: sample[0].sent_at,
            reminder: sample[0].last_reminder_at,
        });
    }

    const ali = (board.people || []).find((p) => p.employee_id === ALI_ID);
    console.log('\n=== board: Ali Sheikh ===');
    console.log(ali ? {
        mailed_to: ali.mailed_to,
        status: ali.status,
        now_label: ali.now_label,
        sample: ali.sample,
    } : 'NOT IN AUDIENCE');

    const notInvitedDelivered = (board.people || []).filter((p) => {
        return p.status === 'not_invited' && p.batch_id;
    });
    console.log('\n=== board summary ===');
    console.log('audience', board.audience_count);
    console.log('not_invited with batch_id (should be 0)', notInvitedDelivered.length);
    console.log('counts', board.counts);
}

(async () => {
    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL required');
        process.exit(1);
    }
    if (process.argv.includes('--resync')) {
        const r = await resyncActuaPeriodSubmissionEmails(pool, ACTUAL_PERIOD_ID);
        console.log('resync', r);
    }
    await sqlChecks();
    await boardChecks();
    await pool.end();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
