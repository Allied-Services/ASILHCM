'use strict';

/**
 * tests/payrollLockScope.test.js
 * P1 — lock route freezes client / contract_name / locked_net in one UPDATE…FROM statement.
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

const TEST_YEAR = 2026;
const TEST_MONTH = 7;
const LOCK_PATH = `/api/payroll/${TEST_YEAR}/${TEST_MONTH}/lock`;

function findLockUpdateCall() {
    const calls = mockPool.query.mock.calls;
    return calls.find(([sql]) =>
        typeof sql === 'string'
        && sql.includes('UPDATE payroll_transactions')
        && sql.includes('locked_net')
        && sql.includes('FROM employees')
    );
}

describe('PATCH /api/payroll/:year/:month/lock — freeze lock scope (P1)', () => {
    const token = () => makeToken({ role: 'finance_approver' });

    beforeEach(() => {
        mockPool.query.mockClear();
        mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test('scoped lock UPDATE sets client, contract_name, locked_net via employees join', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 2 }); // lock UPDATE
        mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // PF/Gratuity lookup

        const res = await request()
            .patch(LOCK_PATH)
            .set('Authorization', `Bearer ${token()}`)
            .send({ employee_ids: ['ASIL-001', 'ASIL-002'] });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.locked).toBe(true);
        expect(res.body.accruals).toEqual({ ok: true, pf_rows: 0, gratuity_rows: 0 });

        const lockCall = findLockUpdateCall();
        expect(lockCall).toBeTruthy();
        const [sql, params] = lockCall;
        expect(sql).toMatch(/client\s*=\s*e\.client/i);
        expect(sql).toMatch(/contract_name\s*=\s*e\.contract_name/i);
        expect(sql).toMatch(/locked_net\s*=\s*ROUND\s*\(\s*pt\.net\s*\)/i);
        expect(sql).toMatch(/FROM\s+employees\s+e/i);
        expect(sql).toMatch(/e\.id\s*=\s*pt\.employee_id/i);
        expect(sql).toMatch(/employee_id\s*=\s*ANY/i);
        expect(sql).not.toMatch(/\bSET\s+net\s*=/i);
        expect(params).toEqual([
            'testuser@asil.com.pk',
            TEST_YEAR,
            TEST_MONTH,
            ['ASIL-001', 'ASIL-002'],
        ]);
    });

    test('full-month lock UPDATE sets the same three frozen columns without employee_ids filter', async () => {
        mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 3 }); // lock UPDATE
        mockPool.query.mockResolvedValueOnce({
            rows: [{ employee_id: 'ASIL-003' }, { employee_id: 'ASIL-004' }],
            rowCount: 2,
        }); // locked IDs SELECT
        mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // PF lookup

        const res = await request()
            .patch(LOCK_PATH)
            .set('Authorization', `Bearer ${token()}`)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.accruals_posted).toBe(2);

        const lockCall = findLockUpdateCall();
        expect(lockCall).toBeTruthy();
        const [sql, params] = lockCall;
        expect(sql).toMatch(/client\s*=\s*e\.client/i);
        expect(sql).toMatch(/contract_name\s*=\s*e\.contract_name/i);
        expect(sql).toMatch(/locked_net\s*=\s*ROUND\s*\(\s*pt\.net\s*\)/i);
        expect(sql).toMatch(/FROM\s+employees\s+e/i);
        expect(sql).not.toMatch(/employee_id\s*=\s*ANY/i);
        expect(sql).not.toMatch(/\bSET\s+net\s*=/i);
        expect(params).toEqual(['testuser@asil.com.pk', TEST_YEAR, TEST_MONTH]);
    });
});
