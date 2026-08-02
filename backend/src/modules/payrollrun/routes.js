'use strict';

const { handleRouteError } = require('../../core/validate');
const { getInvoiceChallanStatus } = require('../compliance/service');
const { renderPayslipHtml, renderInvoiceHtml } = require('./payslip');
const {
    computeRunForContract,
    getPayrollRuns,
    patchRunRow,
    lockRun,
    generateInvoiceFromRun,
    listRateCards,
    saveRateCard,
    deleteRateCard,
    listHolidays,
    saveHoliday,
    deleteHoliday,
    importHistoricRun,
} = require('./service');

function parseJsonField(val, fallback) {
    if (val == null) return fallback;
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return fallback; }
    }
    return val;
}

function registerPayrollRunRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail } = deps;
    const payrollRoles = requireRole('superadmin', 'payroll_initiator', 'finance_manager');
    const rateCardRoles = requireRole('superadmin', 'finance_manager');

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
            console.error('[payrollrun.compute]', err);
            if (err.status === 400) {
                return res.status(400).json({ error: err.message, code: err.code });
            }
            return res.status(500).json({
                error: 'Internal server error',
                code: 'COMPUTE_FAILED',
                detail: err.message,
            });
        }
    });

    app.get('/api/payroll-runs', requireAuth, async (req, res) => {
        try {
            const cutover = require('../../core/cutover');
            const { archive } = await cutover.resolveArchiveMode(req, pool);
            res.json(await getPayrollRuns(pool, {
                contractId: req.query.contractId,
                month: req.query.month ? parseInt(req.query.month, 10) : null,
                year: req.query.year ? parseInt(req.query.year, 10) : null,
                archive,
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

    app.post('/api/admin/import-payroll-history', requireAuth, requireRole('superadmin'), async (req, res) => {
        try {
            const { contractId, month, year, rows } = req.body;
            const result = await importHistoricRun(pool, {
                contractId,
                month: parseInt(month, 10),
                year: parseInt(year, 10),
                rows: rows || [],
                importedBy: `excel_import:${req.user?.email || 'system'}`,
            });
            if (!result.ok) return res.status(400).json(result);
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'payrollrun.importHistory', err);
        }
    });

    app.get('/api/payroll-runs/:id/payslip/:employeeId', requireAuth, payrollRoles, async (req, res) => {
        try {
            const runId = parseInt(req.params.id, 10);
            const employeeId = decodeURIComponent(req.params.employeeId);
            const { rows: runRows } = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
            if (!runRows.length) return res.status(404).json({ error: 'Run not found' });
            const run = runRows[0];
            if (run.status === 'draft') return res.status(400).json({ error: 'Payslips available only after lock' });

            const { rows: rowRows } = await pool.query(
                `SELECT * FROM payroll_run_rows WHERE run_id = $1 AND employee_id = $2`,
                [runId, employeeId]
            );
            if (!rowRows.length) return res.status(404).json({ error: 'Employee not in this run' });

            const { rows: empRows } = await pool.query(`SELECT * FROM employees WHERE id = $1`, [employeeId]);
            if (!empRows.length) return res.status(404).json({ error: 'Employee not found' });

            const row = rowRows[0];
            const computed = parseJsonField(row.computed, {});
            const html = renderPayslipHtml({
                emp: empRows[0],
                computed,
                month: run.period_month,
                year: run.period_year,
                paidDays: row.paid_days,
                workingDays: row.working_days,
            });
            res.setHeader('Content-Type', 'text/html');
            if (req.query.download === '1') {
                const safeName = (empRows[0].name || 'Employee').replace(/[^a-zA-Z0-9 ]/g, '_').trim();
                res.setHeader('Content-Disposition', `attachment; filename="PaySlip_${safeName}_${run.period_month}_${run.period_year}.html"`);
            }
            res.send(html);
        } catch (err) {
            handleRouteError(res, 'payrollrun.payslip', err);
        }
    });

    app.post('/api/payroll-runs/:id/send-payslips', requireAuth, payrollRoles, async (req, res) => {
        try {
            const runId = parseInt(req.params.id, 10);
            const { rows: runRows } = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
            if (!runRows.length) return res.status(404).json({ error: 'Run not found' });
            const run = runRows[0];
            if (run.status === 'draft') return res.status(400).json({ error: 'Payslips available only after lock' });

            const { rows: prRows } = await pool.query(
                `SELECT prr.*, e.* FROM payroll_run_rows prr JOIN employees e ON e.id = prr.employee_id WHERE prr.run_id = $1`,
                [runId]
            );
            let sent = 0;
            let skipped = 0;
            for (const row of prRows) {
                if (!row.email) { skipped += 1; continue; }
                const computed = parseJsonField(row.computed, {});
                const html = renderPayslipHtml({
                    emp: row,
                    computed,
                    month: run.period_month,
                    year: run.period_year,
                    paidDays: row.paid_days,
                    workingDays: row.working_days,
                });
                if (sendAppEmail) {
                    await sendAppEmail({
                        to: row.email,
                        subject: `Salary slip — ${run.period_month}/${run.period_year}`,
                        html,
                    }).catch(() => { skipped += 1; return; });
                }
                sent += 1;
            }
            res.json({ sent, skipped });
        } catch (err) {
            handleRouteError(res, 'payrollrun.sendPayslips', err);
        }
    });

    app.get('/api/payroll-runs/:id/invoice-html', requireAuth, async (req, res) => {
        try {
            const runId = parseInt(req.params.id, 10);
            const { rows: runRows } = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
            if (!runRows.length) return res.status(404).json({ error: 'Run not found' });
            const run = runRows[0];
            if (run.status !== 'invoiced' || !run.invoice_id) {
                return res.status(400).json({ error: 'Invoice not generated for this run' });
            }

            const { rows: invRows } = await pool.query(`SELECT * FROM client_invoices WHERE id = $1`, [run.invoice_id]);
            if (!invRows.length) return res.status(404).json({ error: 'Invoice not found' });
            const invoice = invRows[0];

            const { rows: contractRows } = await pool.query(`SELECT * FROM contracts WHERE id = $1`, [run.contract_id]);
            const { rows: policyRows } = await pool.query(`SELECT * FROM contract_policies WHERE contract_id = $1`, [run.contract_id]);
            const challanStatus = await getInvoiceChallanStatus(pool, run.invoice_id);

            const html = renderInvoiceHtml({
                invoice,
                contract: contractRows[0] || {},
                policy: policyRows[0] || {},
                challanStatus,
            });
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        } catch (err) {
            handleRouteError(res, 'payrollrun.invoiceHtml', err);
        }
    });

    app.get('/api/rate-cards/:contractId', requireAuth, async (req, res) => {
        try {
            res.json(await listRateCards(pool, req.params.contractId));
        } catch (err) {
            handleRouteError(res, 'ratecards.list', err);
        }
    });

    app.post('/api/rate-cards', requireAuth, rateCardRoles, async (req, res) => {
        try {
            res.status(201).json(await saveRateCard(pool, req.body));
        } catch (err) {
            handleRouteError(res, 'ratecards.save', err);
        }
    });

    app.delete('/api/rate-cards/:id', requireAuth, rateCardRoles, async (req, res) => {
        try {
            res.json(await deleteRateCard(pool, parseInt(req.params.id, 10)));
        } catch (err) {
            handleRouteError(res, 'ratecards.delete', err);
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
