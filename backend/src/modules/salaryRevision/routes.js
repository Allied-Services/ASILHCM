'use strict';

const { handleRouteError } = require('../../core/validate');
const { listRevisions, createRevision } = require('./service');
const { requirePayrollSheet } = require('../payrollSheet/access');

function registerSalaryRevisionRoutes(app, deps) {
    const { pool, requireAuth } = deps;
    // Same gate as Payroll Sheet save/Calculate: payroll roles OR User Management
    // payroll.edit (Sadia is operations_team with custom payroll.edit — not in requireRole).
    const canRevise = requirePayrollSheet(pool, 'edit');

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
        canRevise,
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
