'use strict';

const { handleRouteError } = require('../../core/validate');
const { listRevisions, createRevision } = require('./service');

function registerSalaryRevisionRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;

    app.get('/api/employees/:id/salary-revisions', requireAuth, async (req, res) => {
        try {
            const revisions = await listRevisions(pool, req.params.id);
            res.json({ revisions });
        } catch (err) {
            handleRouteError(res, 'GET /api/employees/:id/salary-revisions', err);
        }
    });

    app.post(
        '/api/employees/:id/salary-revisions',
        requireAuth,
        requireRole('superadmin', 'operations', 'payroll_initiator', 'finance_manager'),
        async (req, res) => {
            try {
                const body = req.body || {};
                const result = await createRevision(pool, req.params.id, {
                    newSalary: body.newSalary ?? body.new_salary,
                    effectiveYear: body.effectiveYear ?? body.effective_year,
                    effectiveMonth: body.effectiveMonth ?? body.effective_month,
                    note: body.note,
                }, req.user || {});
                res.status(201).json(result);
            } catch (err) {
                handleRouteError(res, 'POST /api/employees/:id/salary-revisions', err);
            }
        },
    );
}

module.exports = { registerSalaryRevisionRoutes };
