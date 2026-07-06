'use strict';

const { registerConstraintRoutes } = require('./src/modules/constraints/routes');
const { registerIntakeRoutes } = require('./src/modules/intake/routes');
const { registerProjectRoutes } = require('./src/modules/projects/routes');
const { registerPnlRoutes } = require('./src/modules/pnl/routes');
const { registerClaimsRoutes } = require('./src/modules/claims/routes');
const { registerOnboardingRoutes } = require('./src/modules/onboarding/routes');
const { registerBizdevRoutes } = require('./src/modules/bizdev/routes');
const { registerAttendanceIntakeRoutes } = require('./src/modules/attendance/routes');
const { registerProcurementRoutes } = require('./src/modules/procurement/routes');
const { registerComplianceRoutes } = require('./src/modules/compliance/routes');
const { registerArRoutes } = require('./src/modules/ar/routes');
const { registerPayrollRunRoutes } = require('./src/modules/payrollrun/routes');
const { runMigrations } = require('./src/core/runMigrations');
const { initJobs, registerWorkers, scheduleJob } = require('./src/core/jobs');
const { pollIntakeMailbox } = require('./src/intake/imapWatcher');
const { routeIntakeToClaims } = require('./src/intake/claimRouter');
const { allocateFromLockedPayroll, getWeeklyCashflow } = require('./src/modules/pnl/service');
const { runAlertCheck } = require('./src/modules/attendance/service');
const { runDunningCheck } = require('./src/modules/ar/service');

function mountRestructureModules(app, deps) {
    registerConstraintRoutes(app, deps);
    registerIntakeRoutes(app, deps);
    registerProjectRoutes(app, deps);
    registerPnlRoutes(app, deps);
    registerClaimsRoutes(app, deps);
    registerOnboardingRoutes(app, deps);
    registerBizdevRoutes(app, deps);
    registerAttendanceIntakeRoutes(app, deps);
    registerProcurementRoutes(app, deps);
    registerComplianceRoutes(app, deps);
    registerArRoutes(app, deps);
    registerPayrollRunRoutes(app, deps);
}

async function bootstrapRestructure(deps) {
    const { pool, sendAppEmail, sendJazzSMS } = deps;
    if (process.env.NODE_ENV === 'test') return null;

    try {
        await runMigrations();
        console.log('[restructure] migrations complete');
    } catch (err) {
        console.warn('[restructure] migration warning:', err.message);
    }

    const jobsRunner = process.env.JOBS_RUNNER || 'web';
    const boss = await initJobs();
    if (!boss) return null;

    if (jobsRunner !== 'web') {
        console.log(`[restructure] JOBS_RUNNER=${jobsRunner} — skipping job registration in web service`);
        return boss;
    }

    const runPnlAllocateCron = async () => {
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const curYear = now.getFullYear();
        const prev = new Date(curYear, now.getMonth() - 1, 1);
        for (const [month, year] of [[curMonth, curYear], [prev.getMonth() + 1, prev.getFullYear()]]) {
            await allocateFromLockedPayroll(pool, month, year);
        }
    };

    await registerWorkers(boss, {
        'intake.poll': async () => {
            const result = await pollIntakeMailbox(pool, { sendAppEmail });
            await routeIntakeToClaims(pool);
            return result;
        },
        'pnl.allocate': async data => allocateFromLockedPayroll(pool, data.month, data.year),
        'pnl.allocate.cron': runPnlAllocateCron,
        'cashflow.snapshot': async () => getWeeklyCashflow(pool, 8),
        'attendance.alerts': async () => runAlertCheck(pool, { sendAppEmail, sendJazzSMS }),
        'ar.dunning': async () => runDunningCheck(pool, sendAppEmail),
        'bizdev.renewals': async () => {
            const { syncBizdevRenewals } = require('./src/modules/bizdev/service');
            return syncBizdevRenewals(pool);
        },
    });

    await scheduleJob('intake.poll', {}, '*/5 * * * *').catch(() => {});
    await scheduleJob('cashflow.snapshot', {}, '0 6 * * 1').catch(() => {});
    await scheduleJob('attendance.alerts', {}, '0 8 * * *').catch(() => {});
    await scheduleJob('ar.dunning', {}, '0 9 * * 1').catch(() => {});
    await scheduleJob('pnl.allocate.cron', {}, '0 2 * * *').catch(() => {});
    await scheduleJob('bizdev.renewals', {}, '0 3 * * *').catch(() => {});

    return boss;
}

module.exports = { mountRestructureModules, bootstrapRestructure };
