'use strict';

require('dotenv').config();

const { getPool, closePool } = require('./src/core/db');
const { runMigrations } = require('./src/core/runMigrations');
const { initJobs, registerWorkers, stopJobs } = require('./src/core/jobs');
const { sendAppEmail } = require('./src/core/mailer');
const { pollIntakeMailbox } = require('./src/intake/imapWatcher');
const { allocateFromLockedPayroll, getWeeklyCashflow } = require('./src/modules/pnl/service');
const { runAlertCheck } = require('./src/modules/attendance/service');
const { runDunningCheck } = require('./src/modules/ar/service');

let sendJazzSMS = async () => ({ ok: false });
try {
    ({ sendJazzSMS } = require('./lib/sms'));
} catch {
    sendJazzSMS = async () => ({ ok: false });
}

async function main() {
    console.log('[worker] ASIL restructure background worker starting');
    const pool = getPool();

    await runMigrations();

    const boss = await initJobs();
    if (!boss) {
        console.error('[worker] pg-boss failed to start');
        process.exit(1);
    }

    await registerWorkers(boss, {
        'intake.poll': async () => {
            const result = await pollIntakeMailbox(pool, { sendAppEmail });
            console.log('[worker intake.poll]', result);
        },
        'pnl.allocate': async data => {
            const result = await allocateFromLockedPayroll(pool, data.month, data.year);
            console.log('[worker pnl.allocate]', result);
        },
        'cashflow.snapshot': async () => {
            const buckets = await getWeeklyCashflow(pool, 8);
            console.log('[worker cashflow.snapshot] weeks=', buckets.length);
        },
        'attendance.alerts': async () => {
            const result = await runAlertCheck(pool, { sendAppEmail, sendJazzSMS });
            console.log('[worker attendance.alerts]', result);
        },
        'ar.dunning': async () => {
            const result = await runDunningCheck(pool, sendAppEmail);
            console.log('[worker ar.dunning]', result);
        },
    });

    await boss.schedule('intake.poll', {}, { cron: '*/5 * * * *' });
    await boss.schedule('cashflow.snapshot', {}, { cron: '0 6 * * 1' });
    await boss.schedule('attendance.alerts', {}, { cron: '0 8 * * *' });
    await boss.schedule('ar.dunning', {}, { cron: '0 9 * * 1' });

    console.log('[worker] scheduled jobs registered');
}

main().catch(err => {
    console.error('[worker] fatal', err);
    process.exit(1);
});

process.on('SIGTERM', async () => {
    await stopJobs();
    await closePool();
    process.exit(0);
});
