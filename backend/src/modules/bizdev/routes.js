'use strict';

const { handleRouteError, parseBody, requireFields } = require('../../core/validate');
const { startOnboardingRun } = require('../onboarding/service');

function parseLeadBody(body) {
    return requireFields(body, ['company']);
}

function registerBizdevRoutes(app, deps) {
    const { pool, requireAuth, requireRole } = deps;

    app.get('/api/bizdev/leads', requireAuth, requireRole('superadmin', 'finance_manager', 'operations'), async (req, res) => {
        try {
            const { rows } = await pool.query(`SELECT * FROM bd_leads ORDER BY created_at DESC`);
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'bizdev.leads', err);
        }
    });

    app.post('/api/bizdev/leads', requireAuth, requireRole('superadmin', 'finance_manager', 'operations'), async (req, res) => {
        try {
            const data = parseBody(parseLeadBody, req.body);
            const { rows } = await pool.query(
                `INSERT INTO bd_leads (company, contact_name, email, phone, source, industry, est_headcount, stage, owner_email, notes)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
                [data.company, data.contact_name, data.email || null, data.phone, data.source, data.industry,
                    data.est_headcount, data.stage || 'cold', data.owner_email, data.notes]
            );
            res.json(rows[0]);
        } catch (err) {
            handleRouteError(res, 'bizdev.createLead', err);
        }
    });

    app.patch('/api/bizdev/leads/:id/stage', requireAuth, requireRole('superadmin', 'finance_manager', 'operations'), async (req, res) => {
        try {
            const { stage, contractId } = req.body;
            const { rows } = await pool.query(
                `UPDATE bd_leads SET stage = $1 WHERE id = $2 RETURNING *`,
                [stage, req.params.id]
            );
            if (stage === 'won' && contractId) {
                await startOnboardingRun(pool, { contractId, leadId: parseInt(req.params.id, 10) });
            }
            res.json(rows[0]);
        } catch (err) {
            handleRouteError(res, 'bizdev.stage', err);
        }
    });

    app.get('/api/bizdev/renewals', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            const { rows } = await pool.query(
                `SELECT br.*, c.contract_name, cl.name AS client_name
                 FROM bd_renewals br
                 JOIN contracts c ON c.id = br.contract_id
                 JOIN clients cl ON cl.id = c.client_id
                 ORDER BY br.renewal_date`
            );
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'bizdev.renewals', err);
        }
    });
}

module.exports = { registerBizdevRoutes };
