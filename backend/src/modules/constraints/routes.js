'use strict';

const { handleRouteError, parseBody, requireFields } = require('../../core/validate');
const { getPolicy, upsertPolicy, validateAction } = require('./service');

function parsePolicyBody(body) {
    return requireFields(body, ['contract_id']);
}

function registerConstraintRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;

    app.get('/api/constraints/policies/:contractId', requireAuth, async (req, res) => {
        try {
            const policy = await getPolicy(pool, req.params.contractId, req.query.project_id || null);
            res.json(policy || {});
        } catch (err) {
            handleRouteError(res, 'constraints.getPolicy', err);
        }
    });

    app.post('/api/constraints/policies', requireAuth, requireRole('superadmin', 'finance_manager', 'operations'), async (req, res) => {
        try {
            const data = parseBody(parsePolicyBody, req.body);
            const row = await upsertPolicy(pool, data);
            res.json(row);
        } catch (err) {
            handleRouteError(res, 'constraints.upsertPolicy', err);
        }
    });

    app.post('/api/constraints/validate', requireAuth, async (req, res) => {
        try {
            const { action, context } = req.body;
            const result = await validateAction(pool, action, context || {});
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'constraints.validate', err);
        }
    });
}

module.exports = { registerConstraintRoutes };
