'use strict';

const { mockPool, makeToken } = require('./setup');

let app;
beforeAll(() => {
    jest.resetModules();
    app = require('../server');
});

afterAll(async () => {
    await mockPool.end();
});

const request = () => require('supertest')(app);

const ALLOWED_ROLES = ['ap_team', 'finance_manager', 'superadmin'];
const FORBIDDEN_ROLES = [
    'finance_approver',
    'finance_proposer',
    'ar_team',
    'payroll_initiator',
    'procurement_manager',
    'procurement_approver',
    'procurement_proposer',
    'operations',
];

const DISBURSE_PATH = '/api/payroll-runs/1/disburse';
const PAYLOAD = {
    bank_id: 1,
    bank_name: 'HBL',
    payment_date: '2026-06-25',
    reference_no: 'TEST-REF',
    notes: 'unit test',
};

describe('POST /api/payroll-runs/:id/disburse — role guards', () => {
    test('unauthenticated request → 401', async () => {
        const res = await request().post(DISBURSE_PATH).send(PAYLOAD);
        expect(res.status).toBe(401);
    });

    test.each(ALLOWED_ROLES)(
        'role "%s" may call disburse route (not blocked by 403)',
        async (role) => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });
            const token = makeToken({ role });
            const res = await request()
                .post(DISBURSE_PATH)
                .set('Authorization', `Bearer ${token}`)
                .send(PAYLOAD);
            expect(res.status).not.toBe(403);
        }
    );

    test.each(FORBIDDEN_ROLES)(
        'role "%s" is blocked from disburse → 403',
        async (role) => {
            const token = makeToken({ role });
            const res = await request()
                .post(DISBURSE_PATH)
                .set('Authorization', `Bearer ${token}`)
                .send(PAYLOAD);
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/Forbidden/i);
        }
    );
});

describe('POST /api/payroll-runs/:id/disburse — validation', () => {
    test('missing bank_name → 400', async () => {
        const token = makeToken({ role: 'ap_team' });
        const res = await request()
            .post(DISBURSE_PATH)
            .set('Authorization', `Bearer ${token}`)
            .send({ ...PAYLOAD, bank_name: '' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/bank_name/i);
    });
});
