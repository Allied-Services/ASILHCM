'use strict';

const { handleRouteError } = require('../../core/validate');
const { backfillProjectsFromEmployees, listProjects } = require('./service');

function registerProjectRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;

    app.get('/api/projects', requireAuth, async (req, res) => {
        try {
            const rows = await listProjects(pool, {
                contractId: req.query.contract_id,
                clientId: req.query.client_id,
            });
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'projects.list', err);
        }
    });

    app.post('/api/projects/backfill', requireAuth, requireRole('superadmin'), async (req, res) => {
        try {
            const result = await backfillProjectsFromEmployees(pool);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'projects.backfill', err);
        }
    });
}

module.exports = { registerProjectRoutes };
