'use strict';

/**
 * Contract tests for POST /api/payroll/:year/:month/calculate
 */
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
const PATH = '/api/payroll/2026/7/calculate';

describe('POST /api/payroll/:year/:month/calculate — role guards', () => {
    beforeEach(() => {
        mockPool.query.mockReset();
        mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test('401 without auth', async () => {
        const res = await request().post(PATH).send({});
        expect(res.status).toBe(401);
    });

    test('403 for operations role without payroll.edit permission', async () => {
        const token = makeToken({ role: 'operations' });
        mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const res = await request().post(PATH).set('Authorization', `Bearer ${token}`).send({});
        expect(res.status).toBe(403);
    });

    test('operations with User Management payroll.edit can calculate', async () => {
        const token = makeToken({ role: 'operations', email: 'sadia.komal@asil.com.pk' });
        mockPool.query.mockResolvedValueOnce({
            rows: [{
                role: 'operations',
                permissions: { payroll: { access: true, subPerms: ['view', 'edit', 'lock', 'export'] } },
            }],
            rowCount: 1,
        });
        mockPool.query.mockResolvedValueOnce({
            rows: [
                { key: 'cutover_period', value: JSON.stringify({ month: 7, year: 2026 }) },
                { key: 'show_pre_cutover_archive', value: 'false' },
            ],
        });
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        mockPool.query.mockResolvedValueOnce({ rows: [] });

        const res = await request()
            .post(PATH)
            .set('Authorization', `Bearer ${token}`)
            .send({ client: 'Wafi Energy Pakistan Pvt Ltd' });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
    });

    test('403 when month locked', async () => {
        const token = makeToken({ role: 'finance_proposer' });
        // cutover loadCutoverConfig
        mockPool.query.mockResolvedValueOnce({
            rows: [
                { key: 'cutover_period', value: JSON.stringify({ month: 7, year: 2026 }) },
                { key: 'show_pre_cutover_archive', value: 'false' },
            ],
        });
        // assertMonthUnlocked → locked row exists
        mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

        const res = await request()
            .post(PATH)
            .set('Authorization', `Bearer ${token}`)
            .send({ client: 'Wafi Energy Pakistan Pvt Ltd' });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('PAYROLL_LOCKED');
    });

    test('finance_proposer allowed when unlocked and no employees', async () => {
        const token = makeToken({ role: 'finance_proposer' });
        mockPool.query.mockResolvedValueOnce({
            rows: [
                { key: 'cutover_period', value: JSON.stringify({ month: 7, year: 2026 }) },
                { key: 'show_pre_cutover_archive', value: 'false' },
            ],
        });
        // unlocked
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        // onSheet distinct
        mockPool.query.mockResolvedValueOnce({ rows: [] });
        // loadSheetEmployees
        mockPool.query.mockResolvedValueOnce({ rows: [] });

        const res = await request()
            .post(PATH)
            .set('Authorization', `Bearer ${token}`)
            .send({ client: 'Wafi Energy Pakistan Pvt Ltd' });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.updated).toBe(0);
    });
});
