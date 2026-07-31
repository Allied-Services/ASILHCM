'use strict';

const crypto = require('crypto');
const { pool, truncateAll } = require('./setup');
const { getApp } = require('./helpers/appEnv');
const { makeToken } = require('./helpers/auth');
const wafiApproval = require('../src/modules/wafiClaims/approvalService');
const { hashToken } = require('../src/intake/autoAck');

describe('Wafi approval chain (integration)', () => {
    let app;

    beforeAll(() => {
        app = getApp();
    });

    async function seedSession({ approval_state, routing_profile, focal_hash, lm_hash, claim_month = '2026-07-01' }) {
        const { rows } = await pool.query(
            `INSERT INTO wafi_claims_sessions (received_at, sender_email, processing_status, claim_month, approval_state, routing_profile, focal_token_hash, lm_token_hash)
             VALUES (NOW(), 'test@wafi-energy.com', 'PENDING_REVIEW', $1::date, $2, $3, $4, $5) RETURNING id`,
            [claim_month, approval_state, routing_profile, focal_hash || null, lm_hash || null]
        );
        return rows[0].id;
    }

    beforeEach(async () => {
        await truncateAll();
    });

    test('verify returns 409 when focal approval pending', async () => {
        const sid = await seedSession({
            approval_state: 'pending_focal_input',
            routing_profile: 'focal_then_lm',
            focal_hash: hashToken('tok'),
        });
        const token = makeToken({ role: 'finance_manager', email: 'admin@asil.com.pk' });
        const request = require('supertest');
        const res = await request(app)
            .post(`/api/wafi-claims/sessions/${sid}/verify`)
            .set('Authorization', `Bearer ${token}`)
            .send({ month: 7, year: 2026 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('APPROVAL_PENDING');
    });

    test('focal approve advances focal_then_lm to pending_lm', async () => {
        const raw = crypto.randomBytes(16).toString('hex');
        const sid = await seedSession({
            approval_state: 'pending_focal_input',
            routing_profile: 'focal_then_lm',
            focal_hash: hashToken(raw),
        });
        await pool.query(`UPDATE wafi_claims_sessions SET lm_email = 'lm@wafi.com' WHERE id = $1`, [sid]);
        const result = await wafiApproval.handleFocalAction(pool, {
            sessionId: sid,
            token: raw,
            decision: 'approve',
            actorEmail: 'focal@wafi.com',
        });
        expect(result.ok).toBe(true);
        expect(result.state).toBe('pending_lm_approval');
    });

    test('lm approve sets ready_for_hcm', async () => {
        const raw = crypto.randomBytes(16).toString('hex');
        const sid = await seedSession({
            approval_state: 'pending_lm_approval',
            routing_profile: 'lm_only',
            lm_hash: hashToken(raw),
        });
        const result = await wafiApproval.handleLmAction(pool, {
            sessionId: sid,
            token: raw,
            decision: 'approve',
            actorEmail: 'lm@wafi.com',
        });
        expect(result.ok).toBe(true);
        expect(result.state).toBe('ready_for_hcm');
    });

    test('routing matrix profiles', () => {
        expect(wafiApproval.computeRoutingProfile('lm@x.com', 'f@x.com').profile).toBe('focal_then_lm');
        expect(wafiApproval.computeRoutingProfile('lm@x.com', 'N/A').profile).toBe('lm_only');
        expect(wafiApproval.computeRoutingProfile(null, 'f@x.com').profile).toBe('focal_only');
        expect(wafiApproval.computeRoutingProfile('N/A', '').profile).toBe('fallback_huzaifa');
    });
});
