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

const CREATE_PATH = '/api/fixed-value/contracts';
const UPDATE_PATH = '/api/fixed-value/contracts/CTR-TEST';

const ALLOWED_ROLES = ['superadmin', 'operations', 'finance_manager'];
const FORBIDDEN_ROLES = [
    'finance_approver',
    'finance_proposer',
    'ar_team',
    'ap_team',
    'payroll_initiator',
    'operations_supervisor',
    'operations_team',
    'procurement_manager',
];

describe('Fixed Value contract create/edit — role guards (SO lines live on this write path)', () => {
    test('unauthenticated POST → 401', async () => {
        const res = await request().post(CREATE_PATH).send({});
        expect(res.status).toBe(401);
    });

    test.each(ALLOWED_ROLES)(
        'role "%s" may create a Fixed Value contract (not blocked by 403)',
        async (role) => {
            mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
            const token = makeToken({
                role,
                email: role === 'finance_manager' ? 'huzaifa.rafaqat@asil.com.pk' : 'testuser@asil.com.pk',
            });
            const res = await request()
                .post(CREATE_PATH)
                .set('Authorization', `Bearer ${token}`)
                .send({ contract_name: 'Test' });
            expect(res.status).not.toBe(403);
        }
    );

    test.each(ALLOWED_ROLES)(
        'role "%s" may update a Fixed Value contract (not blocked by 403)',
        async (role) => {
            mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
            const token = makeToken({
                role,
                email: role === 'finance_manager' ? 'huzaifa.rafaqat@asil.com.pk' : 'testuser@asil.com.pk',
            });
            const res = await request()
                .put(UPDATE_PATH)
                .set('Authorization', `Bearer ${token}`)
                .send({ contract_name: 'Test' });
            expect(res.status).not.toBe(403);
        }
    );

    test.each(FORBIDDEN_ROLES)(
        'role "%s" is blocked from creating a Fixed Value contract → 403',
        async (role) => {
            const token = makeToken({ role });
            const res = await request()
                .post(CREATE_PATH)
                .set('Authorization', `Bearer ${token}`)
                .send({ contract_name: 'Test' });
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/Forbidden/i);
        }
    );

    test.each(FORBIDDEN_ROLES)(
        'role "%s" is blocked from updating a Fixed Value contract → 403',
        async (role) => {
            const token = makeToken({ role });
            const res = await request()
                .put(UPDATE_PATH)
                .set('Authorization', `Bearer ${token}`)
                .send({ contract_name: 'Test' });
            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/Forbidden/i);
        }
    );
});
