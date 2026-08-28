'use strict';

/**
 * POST /api/employees/:id/salary-revisions must use Payroll Sheet edit access
 * (roles + User Management payroll.edit), not a hard role list.
 * Sadia Komal is operations_team with payroll.edit — requireRole missed her.
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
const PATH = '/api/employees/E1/salary-revisions';
const BODY = { newSalary: 43000, effectiveYear: 2026, effectiveMonth: 9, note: 'test' };
const SADIA_PERMS = {
    role: 'operations_team',
    permissions: { payroll: { access: true, subPerms: ['view', 'edit', 'lock', 'export'] } },
};

function mockCreateRevisionQueries() {
    mockPool.query.mockResolvedValueOnce({ rows: [{ salary: 40000 }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockPool.query.mockResolvedValueOnce({
        rows: [{
            id: 1,
            employee_id: 'E1',
            old_salary: 40000,
            new_salary: 43000,
            effective_year: 2026,
            effective_month: 9,
            changed_by: 'sadia.komal@asil.com.pk',
            changed_at: '2026-08-28T00:00:00.000Z',
            note: 'test',
        }],
        rowCount: 1,
    });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
}

describe('POST /api/employees/:id/salary-revisions — access', () => {
    beforeEach(() => {
        mockPool.query.mockReset();
        mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test('401 without auth', async () => {
        const res = await request().post(PATH).send(BODY);
        expect(res.status).toBe(401);
    });

    test('403 for operations_team without payroll.edit', async () => {
        const token = makeToken({ role: 'operations_team', email: 'sadia.komal@asil.com.pk' });
        mockPool.query.mockResolvedValueOnce({
            rows: [{ role: 'operations_team', permissions: { payroll: { access: true, subPerms: ['view'] } } }],
            rowCount: 1,
        });
        const res = await request().post(PATH).set('Authorization', `Bearer ${token}`).send(BODY);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/insufficient role/i);
    });

    test('operations_team with User Management payroll.edit can revise', async () => {
        const token = makeToken({ role: 'operations_team', email: 'sadia.komal@asil.com.pk' });
        mockPool.query.mockResolvedValueOnce({ rows: [SADIA_PERMS], rowCount: 1 });
        mockCreateRevisionQueries();

        const res = await request().post(PATH).set('Authorization', `Bearer ${token}`).send(BODY);
        expect(res.status).toBe(201);
        expect(res.body.revision).toBeDefined();
        expect(Number(res.body.revision.new_salary)).toBe(43000);
    });

    test('payroll_initiator can revise without custom permissions', async () => {
        const token = makeToken({ role: 'payroll_initiator' });
        mockCreateRevisionQueries();

        const res = await request().post(PATH).set('Authorization', `Bearer ${token}`).send(BODY);
        expect(res.status).toBe(201);
        expect(res.body.revision).toBeDefined();
    });
});
