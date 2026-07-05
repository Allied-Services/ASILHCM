'use strict';

const { handleRouteError } = require('../../core/validate');
const { createClaimFromIntake, validateOtClaim, getMedicalUtilization } = require('./service');
const { validateAction } = require('../constraints/service');

function registerClaimsRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail } = deps;

    app.get('/api/claims/employee', requireAuth, requireRole('superadmin', 'operations', 'payroll_initiator', 'finance_manager'), async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT ec.*, e.name AS employee_name FROM employee_claims ec
                 LEFT JOIN employees e ON e.id = ec.employee_id
                 ORDER BY ec.created_at DESC LIMIT 100`
            );
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'claims.list', err);
        }
    });

    app.post('/api/claims', requireAuth, requireRole('superadmin', 'operations', 'payroll_initiator'), async (req, res) => {
        try {
            const { employeeId, claimType, items, contractId, projectId, focalEmail, intakeMessageId } = req.body;
            if (claimType === 'overtime') {
                const ot2 = (items || []).reduce((s, i) => s + Number(i.ot2 || 0), 0);
                const ot3 = (items || []).reduce((s, i) => s + Number(i.ot3 || 0), 0);
                const check = await validateOtClaim(pool, { contractId, projectId, ot2, ot3 });
                if (!check.ok) return res.status(400).json(check);
            }
            if (claimType === 'medical') {
                const util = await getMedicalUtilization(pool, employeeId, contractId);
                const amount = (items || []).reduce((s, i) => s + Number(i.amount || 0), 0);
                const check = await validateAction(pool, 'medical_claim', {
                    contractId,
                    claimAmount: amount,
                    usedAmount: util.used_amount,
                });
                if (!check.ok) return res.status(400).json(check);
            }
            const { claim, focalToken } = await createClaimFromIntake(pool, {
                intakeMessageId,
                employeeId,
                claimType,
                items,
                focalEmail,
            });
            if (focalEmail && sendAppEmail) {
                const link = `${process.env.APP_BASE_URL || process.env.BACKEND_URL}/api/claims/focal-action?token=${focalToken}&id=${claim.id}`;
                await sendAppEmail({
                    to: focalEmail,
                    subject: `Claim verification required — ${claim.claim_type}`,
                    html: `<p>Please verify employee claim #${claim.id}. <a href="${link}">Approve or reject</a></p>`,
                }).catch(() => {});
            }
            res.json(claim);
        } catch (err) {
            handleRouteError(res, 'claims.create', err);
        }
    });

    app.get('/api/claims/medical-utilization/:employeeId', requireAuth, async (req, res) => {
        try {
            const util = await getMedicalUtilization(pool, req.params.employeeId, req.query.contract_id);
            res.json(util);
        } catch (err) {
            handleRouteError(res, 'claims.medicalUtil', err);
        }
    });
}

module.exports = { registerClaimsRoutes };
