'use strict';

const express = require('express');
const request = require('supertest');
const { makeToken } = require('./setup');

jest.mock('../src/modules/payslip/service', () => ({
    getPayslipReadiness: jest.fn().mockResolvedValue({ canSend: true, paid: true }),
    sendPayslips: jest.fn().mockResolvedValue({ ok: true, sent: 1, total: 1 }),
    getStoredDocument: jest.fn(),
    createSupportCase: jest.fn(),
    resolveSupportCase: jest.fn(),
}));

const { registerPayslipRoutes } = require('../src/modules/payslip/routes');

function buildApp() {
    const app = express();
    app.use(express.json());
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const requireAuth = (req, res, next) => {
        const auth = req.headers.authorization;
        if (!auth) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const jwt = require('jsonwebtoken');
            req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
            next();
        } catch {
            res.status(401).json({ error: 'Token expired' });
        }
    };
    const requireRole = (...roles) => (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        if (req.user.role === 'superadmin' || roles.includes(req.user.role)) return next();
        return res.status(403).json({ error: 'Forbidden' });
    };
    registerPayslipRoutes(app, { pool, requireAuth, requireRole, sendAppEmail: jest.fn(), sendJazzSMS: jest.fn() });
    return app;
}

describe('payslip routes role guards', () => {
    test('finance_approver cannot send payslips', async () => {
        const app = buildApp();
        const token = makeToken({ role: 'finance_approver', email: 'a@asil.com.pk' });
        const res = await request(app)
            .post('/api/payroll/2026/7/send-payslips')
            .set('Authorization', `Bearer ${token}`)
            .send({ confirm: true });
        expect(res.status).toBe(403);
    });

    test('finance_manager can send payslips', async () => {
        const app = buildApp();
        const token = makeToken({ role: 'finance_manager', email: 'h@asil.com.pk' });
        const res = await request(app)
            .post('/api/payroll/2026/7/send-payslips')
            .set('Authorization', `Bearer ${token}`)
            .send({ confirm: true });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });
});
