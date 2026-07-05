'use strict';

const { handleRouteError } = require('../../core/validate');
const { startOnboardingRun, getOnboardingStatus, completeOnboardingTask } = require('./service');

function registerOnboardingRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;

    app.post('/api/onboarding/start', requireAuth, requireRole('superadmin', 'operations', 'finance_manager'), async (req, res) => {
        try {
            const run = await startOnboardingRun(pool, req.body);
            res.json(run);
        } catch (err) {
            handleRouteError(res, 'onboarding.start', err);
        }
    });

    app.get('/api/onboarding/:contractId', requireAuth, async (req, res) => {
        try {
            const status = await getOnboardingStatus(pool, req.params.contractId);
            res.json(status || {});
        } catch (err) {
            handleRouteError(res, 'onboarding.status', err);
        }
    });

    app.patch('/api/onboarding/tasks/:id/complete', requireAuth, requireRole('superadmin', 'operations', 'finance_manager', 'payroll_initiator', 'finance_proposer'), async (req, res) => {
        try {
            const task = await completeOnboardingTask(pool, req.params.id, req.user?.email);
            res.json(task);
        } catch (err) {
            handleRouteError(res, 'onboarding.completeTask', err);
        }
    });
}

module.exports = { registerOnboardingRoutes };
