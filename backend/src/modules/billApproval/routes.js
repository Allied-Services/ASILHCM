'use strict';

const { handleRouteError } = require('../../core/validate');
const {
    getApprovalStatus,
    submitBillForApproval,
    verifyApproverToken,
    processApproverDecision,
} = require('./service');

function focalHtmlPage({ step, token, id, already, error }) {
    if (error) {
        return `<!DOCTYPE html><html><body style="font-family:Arial;padding:2rem"><h2>Access denied</h2><p>${error}</p></body></html>`;
    }
    if (already) {
        return `<!DOCTYPE html><html><body style="font-family:Arial;padding:2rem"><h2>Already processed</h2><p>This approval link has already been used.</p></body></html>`;
    }
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Bill approval</title></head>
<body style="font-family:Arial,sans-serif;max-width:520px;margin:2rem auto;padding:1rem;color:#222">
<h2>Bill approval required</h2>
<p><strong>Bill ${step.bill_id}</strong>${step.invoice_no ? ` — ${step.invoice_no}` : ''}</p>
<p>Site: <strong>${step.site || '—'}</strong></p>
<p>Vendor: ${step.vendor || '—'}</p>
<p>Amount (PKR): <strong>${step.total ?? step.amount ?? '—'}</strong></p>
<p>Step ${step.step_number} — ${step.approver_name || step.approver_email}</p>
<form method="POST" action="/api/bill-approval/focal-action" style="margin-top:1.5rem">
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

function registerBillApprovalRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail } = deps;

    app.get('/api/bill-approval/focal-action', async (req, res) => {
        try {
            const { token, id } = req.query;
            if (!token || !id) return res.status(400).send('Missing token or id');
            const check = await verifyApproverToken(pool, parseInt(id, 10), token);
            if (!check.ok) {
                const msg = check.expired
                    ? 'This approval link has expired — contact ASIL operations.'
                    : 'Invalid or expired link.';
                return res.status(check.status).send(focalHtmlPage({ error: msg }));
            }
            if (check.already) return res.send(focalHtmlPage({ already: true }));
            res.send(focalHtmlPage({ step: check.step, token, id }));
        } catch (err) {
            res.status(500).send('Error loading bill approval');
        }
    });

    app.post('/api/bill-approval/focal-action', async (req, res) => {
        try {
            const id = parseInt(req.body.id, 10);
            const { token, decision, comment } = req.body;
            const result = await processApproverDecision(pool, {
                stepId: id,
                token,
                decision,
                comment,
                sendAppEmail,
            });
            if (!result.ok) {
                if (result.status === 409) return res.send(focalHtmlPage({ already: true }));
                return res.status(result.status || 403).send(focalHtmlPage({ error: 'Invalid link.' }));
            }
            res.send(`<!DOCTYPE html><html><body style="font-family:Arial;padding:2rem"><h2>Thank you</h2><p>Bill approval step #${id} has been <strong>${result.decision}</strong>.</p></body></html>`);
        } catch (err) {
            res.status(500).send('Error processing decision');
        }
    });

    app.post('/api/bill-approval/:billId/submit', requireAuth, async (req, res) => {
        try {
            const result = await submitBillForApproval(pool, {
                billId: req.params.billId,
                submittedBy: req.user?.email,
                sendAppEmail,
            });
            if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
            res.json(result);
        } catch (err) {
            handleRouteError(res, 'billApproval.submit', err);
        }
    });

    app.get('/api/bill-approval/:billId/approval-status', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver', 'ap_team'), async (req, res) => {
        try {
            const status = await getApprovalStatus(pool, req.params.billId);
            if (!status.ok) return res.status(status.status || 404).json({ error: 'bill_not_found' });
            res.json(status);
        } catch (err) {
            handleRouteError(res, 'billApproval.status', err);
        }
    });
}

module.exports = { registerBillApprovalRoutes };