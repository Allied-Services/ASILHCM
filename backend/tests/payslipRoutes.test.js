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
    frontendBase: () => 'https://example.test',
}));

jest.mock('../src/modules/payslip/testRun', () => ({
    runJulyPayslipTestDelivery: jest.fn().mockResolvedValue({
        ok: true,
        emailed: 5,
        smsed: 5,
        results: [],
    }),
}));

const { registerPayslipRoutes } = require('../src/modules/payslip/routes');
const { runJulyPayslipTestDelivery } = require('../src/modules/payslip/testRun');

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
    const { sendPayslips, getPayslipReadiness } = require('../src/modules/payslip/service');

    beforeEach(() => {
        sendPayslips.mockClear();
        getPayslipReadiness.mockClear();
        sendPayslips.mockResolvedValue({ ok: true, sent: 1, total: 1 });
    });

    test('finance_approver can send payslips', async () => {
        const app = buildApp();
        const token = makeToken({ role: 'finance_approver', email: 'a@asil.com.pk' });
        const res = await request(app)
            .post('/api/payroll/2026/7/send-payslips')
            .set('Authorization', `Bearer ${token}`)
            .send({ confirm: true, employeeIds: ['E1'], sendAll: false });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(sendPayslips).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ employeeIds: ['E1'], sendAll: false, confirm: true })
        );
    });

    test('forwards sendAll when sending all locked', async () => {
        const app = buildApp();
        const token = makeToken({ role: 'superadmin', email: 's@asil.com.pk' });
        const res = await request(app)
            .post('/api/payroll/2026/7/send-payslips')
            .set('Authorization', `Bearer ${token}`)
            .send({ confirm: true, employeeIds: [], sendAll: true });
        expect(res.status).toBe(200);
        expect(sendPayslips).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ sendAll: true, employeeIds: [] })
        );
    });

    test('readiness forwards employeeIds query', async () => {
        const app = buildApp();
        const token = makeToken({ role: 'payroll_initiator', email: 'p@asil.com.pk' });
        const res = await request(app)
            .get('/api/payroll/2026/7/payslip-readiness?employeeIds=E1,E2')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(getPayslipReadiness).toHaveBeenCalledWith(
            expect.anything(),
            '2026',
            '7',
            ['E1', 'E2']
        );
    });

    test('payroll_initiator can send payslips', async () => {
        const app = buildApp();
        const token = makeToken({ role: 'payroll_initiator', email: 'p@asil.com.pk' });
        const res = await request(app)
            .post('/api/payroll/2026/7/send-payslips')
            .set('Authorization', `Bearer ${token}`)
            .send({ confirm: true });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    test('operations cannot send payslips', async () => {
        const app = buildApp();
        const token = makeToken({ role: 'operations', email: 'o@asil.com.pk' });
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

    test('finance_manager cannot trigger payslip test-run', async () => {
        const app = buildApp();
        const token = makeToken({ role: 'finance_manager', email: 'h@asil.com.pk' });
        const res = await request(app)
            .post('/api/payslip/test-run')
            .set('Authorization', `Bearer ${token}`)
            .send({ email: 'shezad.mumtaz@asil.com.pk', phone: '03008275688' });
        expect(res.status).toBe(403);
    });

    test('superadmin can trigger payslip test-run', async () => {
        const app = buildApp();
        const token = makeToken({ role: 'superadmin', email: 's@asil.com.pk' });
        const res = await request(app)
            .post('/api/payslip/test-run')
            .set('Authorization', `Bearer ${token}`)
            .send({ email: 'shezad.mumtaz@asil.com.pk', phone: '03008275688' });
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(runJulyPayslipTestDelivery).toHaveBeenCalled();
    });
});
