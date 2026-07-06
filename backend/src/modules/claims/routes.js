'use strict';

const { handleRouteError } = require('../../core/validate');
const {
    createClaimFromIntake,
    validateOtClaim,
    getMedicalUtilization,
    assignClaimEmployee,
    verifyFocalToken,
    processFocalDecision,
} = require('./service');
const { validateAction } = require('../constraints/service');

function focalHtmlPage({ claim, employeeName, token, id, already, error }) {
    if (error) return `<!DOCTYPE html><html><body style="font-family:Arial;padding:2rem"><h2>Access denied</h2><p>${error}</p></body></html>`;
    if (already) return `<!DOCTYPE html><html><body style="font-family:Arial;padding:2rem"><h2>Already processed</h2><p>This claim has already been decided.</p></body></html>`;
    const items = typeof claim.claimed_items === 'string' ? JSON.parse(claim.claimed_items) : (claim.claimed_items || []);
    const itemsHtml = items.length
        ? `<ul>${items.map(i => `<li>${JSON.stringify(i)}</li>`).join('')}</ul>`
        : '<p><em>No line items yet — verify with employee.</em></p>';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Claim verification</title></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:2rem auto;padding:1rem;color:#222">
<h2>Claim verification required</h2>
<p><strong>Claim #${claim.id}</strong> — ${claim.claim_type}</p>
<p>Employee: <strong>${employeeName || claim.employee_id || 'Unassigned'}</strong></p>
${itemsHtml}
<form method="POST" action="/api/claims/focal-action" style="margin-top:1.5rem">
<input type="hidden" name="id" value="${id}" />
<input type="hidden" name="token" value="${token}" />
<label>Comment (optional)<br/><textarea name="comment" rows="3" style="width:100%"></textarea></label>
<div style="margin-top:1rem;display:flex;gap:0.5rem">
<button type="submit" name="decision" value="approved" style="background:#16a34a;color:#fff;border:none;padding:10px 16px;border-radius:6px;cursor:pointer">Approve</button>
<button type="submit" name="decision" value="rejected" style="background:#dc2626;color:#fff;border:none;padding:10px 16px;border-radius:6px;cursor:pointer">Reject</button>
</div>
</form>
</body></html>`;
}

function registerClaimsRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail } = deps;

    app.get('/api/claims/focal-action', async (req, res) => {
        try {
            const { token, id } = req.query;
            if (!token || !id) return res.status(400).send('Missing token or id');
            const check = await verifyFocalToken(pool, parseInt(id, 10), token);
            if (!check.ok) {
                return res.status(check.status).send(focalHtmlPage({ error: 'Invalid or expired link.' }));
            }
            const claim = check.claim;
            if (claim.focal_approved_at || claim.focal_rejected_at) {
                return res.send(focalHtmlPage({ already: true }));
            }
            let employeeName = null;
            if (claim.employee_id) {
                const { rows } = await pool.query(`SELECT name FROM employees WHERE id = $1`, [claim.employee_id]);
                employeeName = rows[0]?.name;
            }
            res.send(focalHtmlPage({ claim, employeeName, token, id }));
        } catch (err) {
            res.status(500).send('Error loading claim');
        }
    });

    app.post('/api/claims/focal-action', async (req, res) => {
        try {
            const id = parseInt(req.body.id, 10);
            const { token, decision, comment } = req.body;
            const result = await processFocalDecision(pool, { claimId: id, token, decision, comment });
            if (!result.ok) {
                if (result.status === 409) return res.send(focalHtmlPage({ already: true }));
                return res.status(result.status || 403).send(focalHtmlPage({ error: 'Invalid link.' }));
            }
            res.send(`<!DOCTYPE html><html><body style="font-family:Arial;padding:2rem"><h2>Thank you</h2><p>Claim #${id} has been <strong>${decision}</strong>.</p></body></html>`);
        } catch (err) {
            res.status(500).send('Error processing decision');
        }
    });

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

    app.patch('/api/claims/:id', requireAuth, requireRole('superadmin', 'operations', 'payroll_initiator'), async (req, res) => {
        try {
            const { employeeId } = req.body;
            if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
            res.json(await assignClaimEmployee(pool, parseInt(req.params.id, 10), employeeId));
        } catch (err) {
            handleRouteError(res, 'claims.assign', err);
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
