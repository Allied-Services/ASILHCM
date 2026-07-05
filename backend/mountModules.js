'use strict';

const { registerConstraintRoutes } = require('./src/modules/constraints/routes');
const { registerIntakeRoutes } = require('./src/modules/intake/routes');
const { registerProjectRoutes } = require('./src/modules/projects/routes');
const { registerPnlRoutes } = require('./src/modules/pnl/routes');
const { registerClaimsRoutes } = require('./src/modules/claims/routes');
const { registerOnboardingRoutes } = require('./src/modules/onboarding/routes');
const { registerBizdevRoutes } = require('./src/modules/bizdev/routes');
const { runMigrations } = require('./src/core/runMigrations');
const { initJobs, registerWorkers, scheduleJob } = require('./src/core/jobs');
const { pollIntakeMailbox } = require('./src/intake/imapWatcher');
const { allocateFromLockedPayroll, getWeeklyCashflow } = require('./src/modules/pnl/service');

function mountRestructureModules(app, deps) {
    registerConstraintRoutes(app, deps);
    registerIntakeRoutes(app, deps);
    registerProjectRoutes(app, deps);
    registerPnlRoutes(app, deps);
    registerClaimsRoutes(app, deps);
    registerOnboardingRoutes(app, deps);
    registerBizdevRoutes(app, deps);
}

async function bootstrapRestructure(deps) {
    const { pool, sendAppEmail } = deps;
    if (process.env.NODE_ENV === 'test') return null;

    try {
        await runMigrations();
        console.log('[restructure] migrations complete');
    } catch (err) {
        console.warn('[restructure] migration warning:', err.message);
    }

    const boss = await initJobs();
    if (!boss) return null;

    await registerWorkers(boss, {
        'intake.poll': async () => pollIntakeMailbox(pool, { sendAppEmail }),
        'pnl.allocate': async data => allocateFromLockedPayroll(pool, data.month, data.year),
        'cashflow.snapshot': async () => getWeeklyCashflow(pool, 8),
    });

    await scheduleJob('intake.poll', {}, '*/5 * * * *').catch(() => {});
    await scheduleJob('cashflow.snapshot', {}, '0 6 * * 1').catch(() => {});

    return boss;
}

module.exports = { mountRestructureModules, bootstrapRestructure };
