'use strict';

/**
 * POST /api/portal-claims/people/bulk-update must honor Monthly Cycle EDIT
 * (roles + User Management monthly_cycle.edit), not a hard role list.
 * Sadia Komal is operations_team with monthly_cycle.edit — requireRole missed her.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const { registerPortalClaimsRoutes } = require('../src/modules/claims/portalRoutes');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-length-ok';

function makeToken(overrides = {}) {
    return jwt.sign({
        id: 'google-id-test-001',
        email: 'testuser@asil.com.pk',
        name: 'Test User',
        role: 'superadmin',
        ...overrides,
    }, process.env.JWT_SECRET, { expiresIn: '8h' });
}

function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token expired' });
    }
}

const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'superadmin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden: insufficient role', required: roles, got: req.user.role });
};

const PATH = '/api/portal-claims/people/bulk-update';
const BODY = {
    employee_ids: ['E1'],
    claim_authority: 'Wilayat.Qadri@wafi-energy.com',
    line_manager_email: 'Terence.Rodrigues@wafi-energy.com',
    line_manager_name: 'Terence',
};

function buildApp(pool) {
    const app = express();
    app.use(express.json());
    registerPortalClaimsRoutes(app, { pool, requireAuth, requireRole, sendAppEmail: jest.fn() });
    return app;
}

describe('POST /api/portal-claims/people/bulk-update — access', () => {
    const pool = { query: jest.fn() };
    let app;
    let request;

    beforeAll(() => {
        app = buildApp(pool);
        request = () => require('supertest')(app);
    });

    beforeEach(() => {
        pool.query.mockReset();
        pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test('401 without auth', async () => {
        const res = await request().post(PATH).send(BODY);
        expect(res.status).toBe(401);
    });

    test('403 for operations_team without monthly_cycle.edit', async () => {
        const token = makeToken({ role: 'operations_team', email: 'sadia.komal@asil.com.pk' });
        pool.query.mockResolvedValueOnce({
            rows: [{
                role: 'operations_team',
                permissions: { monthly_cycle: { access: true, subPerms: ['view'] } },
            }],
            rowCount: 1,
        });
        const res = await request().post(PATH).set('Authorization', `Bearer ${token}`).send(BODY);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/insufficient role/i);
    });

    test('operations_team with User Management monthly_cycle.edit can assign', async () => {
        const token = makeToken({ role: 'operations_team', email: 'sadia.komal@asil.com.pk' });
        pool.query.mockResolvedValueOnce({
            rows: [{
                role: 'operations_team',
                permissions: { monthly_cycle: { access: true, subPerms: ['view', 'edit'] } },
            }],
            rowCount: 1,
        });
        pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await request().post(PATH).set('Authorization', `Bearer ${token}`).send(BODY);
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(1);
        expect(res.body.employee_ids).toEqual(['E1']);
    });

    test('payroll_initiator can assign without custom permissions', async () => {
        const token = makeToken({ role: 'payroll_initiator' });
        pool.query.mockResolvedValueOnce({ rows: [], rowCount: 3 });

        const res = await request().post(PATH).set('Authorization', `Bearer ${token}`).send(BODY);
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(3);
    });
});
