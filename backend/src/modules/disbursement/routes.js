'use strict';

const { disburseRun } = require('./service');

function mapDisburseResult(res, result) {
    if (result.ok) return res.json(result);

    const code = result.code;
    if (code === 'RUN_NOT_FOUND' || code === 'CONTRACT_NOT_FOUND') {
        return res.status(404).json({ error: 'Not found', code });
    }
    if (['BATCH_EXISTS', 'LEGACY_PAYROLL_LOCKED', 'RUN_NOT_DISBURSABLE'].includes(code)) {
        return res.status(409).json(result);
    }
    if (['MISSING_BANK_DETAILS', 'NO_DISBURSABLE_ROWS'].includes(code)) {
        return res.status(422).json(result);
    }
    return res.status(400).json(result);
}

function registerDisbursementRoutes(app, deps) {
    const { pool, requireAuth, requireRole, logAudit } = deps;
    const disburseRoles = requireRole('ap_team', 'finance_manager', 'superadmin');

    app.post('/api/payroll-runs/:id/disburse', requireAuth, disburseRoles, async (req, res) => {
        try {
            const runId = parseInt(req.params.id, 10);
            if (!Number.isFinite(runId)) {
                return res.status(400).json({ error: 'Invalid run id' });
            }

            const {
                bank_id,
                bank_name,
                payment_date,
                reference_no,
                notes,
                allow_missing_bank,
            } = req.body || {};

            if (!bank_name || String(bank_name).trim() === '') {
                return res.status(400).json({ error: 'bank_name is required' });
            }

            const result = await disburseRun(
                pool,
                runId,
                {
                    bank_id,
                    bank_name,
                    payment_date,
                    reference_no,
                    notes,
                    allow_missing_bank: !!allow_missing_bank,
                },
                req.user?.email
            );

            if (result.ok) {
                if (logAudit) logAudit(req, 'DISBURSE', 'payroll_run', String(runId));
                return res.json(result);
            }
            return mapDisburseResult(res, result);
        } catch (err) {
            console.error('[POST /api/payroll-runs/:id/disburse]', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });
}

module.exports = { registerDisbursementRoutes };
