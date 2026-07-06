'use strict';

const { handleRouteError } = require('../../core/validate');
const {
    computeRunForContract,
    getPayrollRuns,
    patchRunRow,
    lockRun,
    generateInvoiceFromRun,
    listHolidays,
    saveHoliday,
    deleteHoliday,
} = require('./service');

function registerPayrollRunRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;
    const payrollRoles = requireRole('superadmin', 'payroll_initiator', 'finance_manager');

    app.post('/api/payroll-runs/compute', requireAuth, payrollRoles, async (req, res) => {
        try {
            const { contractId, month, year } = req.body;
            const result = await computeRunForContract(pool, {
                contractId,
                month: parseInt(month, 10),
                year: parseInt(year, 10),
            });
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'payrollrun.compute', err);
        }
    });

    app.get('/api/payroll-runs', requireAuth, async (req, res) => {
        try {
            res.json(await getPayrollRuns(pool, {
                contractId: req.query.contractId,
                month: req.query.month ? parseInt(req.query.month, 10) : null,
                year: req.query.year ? parseInt(req.query.year, 10) : null,
            }));
        } catch (err) {
            handleRouteError(res, 'payrollrun.list', err);
        }
    });

    app.post('/api/payroll-runs/:id/lock', requireAuth, payrollRoles, async (req, res) => {
        try {
            res.json(await lockRun(pool, { runId: parseInt(req.params.id, 10), lockedBy: req.user?.email }));
        } catch (err) {
            handleRouteError(res, 'payrollrun.lock', err);
        }
    });

    app.post('/api/payroll-runs/:id/invoice', requireAuth, payrollRoles, async (req, res) => {
        try {
            res.json(await generateInvoiceFromRun(pool, {
                runId: parseInt(req.params.id, 10),
                generatedBy: req.user?.email,
            }));
        } catch (err) {
            handleRouteError(res, 'payrollrun.invoice', err);
        }
    });

    app.patch('/api/payroll-runs/:id/rows/:rowId', requireAuth, payrollRoles, async (req, res) => {
        try {
            const row = await patchRunRow(pool, {
                runId: parseInt(req.params.id, 10),
                rowId: parseInt(req.params.rowId, 10),
                patch: req.body,
                overriddenBy: req.user?.email,
            });
            res.json(row);
        } catch (err) {
            handleRouteError(res, 'payrollrun.patchRow', err);
        }
    });

    app.get('/api/holidays', requireAuth, async (req, res) => {
        try {
            res.json(await listHolidays(pool));
        } catch (err) {
            handleRouteError(res, 'holidays.list', err);
        }
    });

    app.post('/api/holidays', requireAuth, payrollRoles, async (req, res) => {
        try {
            res.status(201).json(await saveHoliday(pool, req.body));
        } catch (err) {
            handleRouteError(res, 'holidays.save', err);
        }
    });

    app.delete('/api/holidays/:id', requireAuth, payrollRoles, async (req, res) => {
        try {
            await deleteHoliday(pool, req.params.id);
            res.json({ ok: true });
        } catch (err) {
            handleRouteError(res, 'holidays.delete', err);
        }
    });
}

module.exports = { registerPayrollRunRoutes };
