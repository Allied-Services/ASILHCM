'use strict';

const { handleRouteError } = require('../../core/validate');
const { pollIntakeMailbox } = require('../../intake/imapWatcher');
const { routeIntakeToClaims } = require('../../intake/claimRouter');

function registerIntakeRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail } = deps;

    app.get('/api/intake/messages', requireAuth, requireRole('superadmin', 'operations', 'finance_manager'), async (req, res) => {
        try {
            const status = req.query.status || null;
            const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
            let sql = `SELECT id, channel, mailbox, from_address, subject, received_at, classification, status, ack_reference, created_at
                       FROM intake_messages`;
            const params = [];
            if (status) {
                params.push(status);
                sql += ` WHERE status = $1`;
            }
            sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
            params.push(limit);
            const { rows } = await pool.query(sql, params);
            res.json(rows);
        } catch (err) {
            handleRouteError(res, 'intake.list', err);
        }
    });

    app.post('/api/intake/trigger-poll', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const result = await pollIntakeMailbox(pool, { sendAppEmail });
            const routed = await routeIntakeToClaims(pool);
            res.json({ ...result, claimsRouted: routed.routed });
        } catch (err) {
            handleRouteError(res, 'intake.poll', err);
        }
    });

    app.patch('/api/intake/messages/:id/retry', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const { rows } = await pool.query(
                `UPDATE intake_messages SET status = 'new', error = NULL WHERE id = $1 RETURNING *`,
                [req.params.id]
            );
            if (!rows.length) return res.status(404).json({ error: 'Not found' });
            res.json(rows[0]);
        } catch (err) {
            handleRouteError(res, 'intake.retry', err);
        }
    });
}

module.exports = { registerIntakeRoutes };
