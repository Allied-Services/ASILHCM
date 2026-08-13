'use strict';

/**
 * tests/payrollReconciliation.test.js
 * P4 — GET /api/payroll/:year/:month/reconciliation aggregation + role guards.
 */

const { mockPool, makeToken } = require('./setup');
const { getPayrollReconciliation, RECONCILIATION_SQL } = require('../src/modules/payrollReconciliation/service');

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
const RECON_PATH = `/api/payroll/${TEST_YEAR}/${TEST_MONTH}/reconciliation`;

const ALLOWED_ROLES = [
    'finance_manager',
    'finance_approver',
    'payroll_initiator',
    'ap_team',
    'superadmin',
];
const FORBIDDEN_ROLES = [
    'finance_proposer',
    'ar_team',
    'procurement_manager',
    'procurement_approver',
    'procurement_proposer',
    'operations',
];

const EMPTY_AGG = {
    sheet_total: 0,
    locked_total: 0,
    ap_total: 0,
    paid_total: 0,
    unlocked: [],
    orphans: [],
    blank_scope: [],
    excluded_by_dates: [],
    locked_not_paid: [],
    paid_not_locked: [],
};

function mockAgg(overrides = {}) {
    mockPool.query.mockResolvedValue({ rows: [{ ...EMPTY_AGG, ...overrides }], rowCount: 1 });
}

describe('GET /api/payroll/:year/:month/reconciliation — role guards', () => {
    beforeEach(() => {
        mockPool.query.mockReset();
        mockAgg();
    });

    test('unauthenticated request → 401', async () => {
        const res = await request().get(RECON_PATH);
        expect(res.status).toBe(401);
    });

    test.each(ALLOWED_ROLES)('role "%s" may read reconciliation (not 403)', async (role) => {
        const token = makeToken({ role });
        const res = await request()
            .get(RECON_PATH)
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).not.toBe(403);
        expect(res.status).toBe(200);
    });

    test.each(FORBIDDEN_ROLES)('role "%s" is blocked → 403', async (role) => {
        const token = makeToken({ role });
        const res = await request()
            .get(RECON_PATH)
            .set('Authorization', `Bearer ${token}`)
            .send();
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Forbidden/i);
    });
});

describe('GET /api/payroll/:year/:month/reconciliation — period validation', () => {
    test('invalid month → 400', async () => {
        const token = makeToken({ role: 'finance_manager' });
        const res = await request()
            .get('/api/payroll/2026/13/reconciliation')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_PERIOD');
    });
});

describe('getPayrollReconciliation — aggregation shape', () => {
    const fakePool = { query: jest.fn() };

    beforeEach(() => {
        fakePool.query.mockReset();
    });

    test('SQL uses frozen COALESCE(locked_net, ROUND(net)), LEFT JOIN employees, PAYROLL batches, SALARY ledger', () => {
        expect(RECONCILIATION_SQL).toMatch(/COALESCE\s*\(\s*pt\.locked_net\s*,\s*ROUND\s*\(\s*pt\.net\s*\)\s*\)/i);
        expect(RECONCILIATION_SQL).toMatch(/LEFT\s+JOIN\s+employees/i);
        expect(RECONCILIATION_SQL).toMatch(/batch_type\s*=\s*'PAYROLL'/i);
        expect(RECONCILIATION_SQL).toMatch(/payment_type\s*=\s*'SALARY'/i);
        expect(RECONCILIATION_SQL).toMatch(/pl\.status\s*=\s*'Paid'/i);
        expect(RECONCILIATION_SQL).not.toMatch(/\bUPDATE\b/i);
        expect(RECONCILIATION_SQL).not.toMatch(/\bINSERT\b/i);
    });

    test('empty month returns zeros and empty lists', async () => {
        fakePool.query.mockResolvedValueOnce({ rows: [EMPTY_AGG], rowCount: 1 });
        const result = await getPayrollReconciliation(fakePool, TEST_YEAR, TEST_MONTH);
        expect(fakePool.query).toHaveBeenCalledWith(RECONCILIATION_SQL, [TEST_YEAR, TEST_MONTH]);
        expect(result).toEqual({
            year: TEST_YEAR,
            month: TEST_MONTH,
            sheetTotal: 0,
            lockedTotal: 0,
            apTotal: 0,
            paidTotal: 0,
            unlocked: [],
            orphans: [],
            blankScope: [],
            excludedByDates: [],
            lockedNotPaid: [],
            paidNotLocked: [],
        });
    });

    test('partial lock: sheetTotal − lockedTotal equals sum of unlocked.net', async () => {
        fakePool.query.mockResolvedValueOnce({
            rows: [{
                sheet_total: '100000',
                locked_total: '70000',
                ap_total: '70000',
                paid_total: '45000',
                unlocked: [{ id: 'ASIL-003', name: 'Unlocked Emp', net: 30000 }],
                orphans: [{ employee_id: 'GONE-1', net: 1200 }],
                blank_scope: [{ id: 'ASIL-001', name: 'Blank Scope' }],
                excluded_by_dates: [{
                    id: 'ASIL-009',
                    name: 'Left Early',
                    doj: '2020-01-01',
                    lwd: '2026-06-15',
                }],
                locked_not_paid: [{ id: 'ASIL-002', name: 'Locked Unpaid' }],
                paid_not_locked: [{ id: 'ASIL-088', name: 'Paid Unlocked' }],
            }],
            rowCount: 1,
        });

        const result = await getPayrollReconciliation(fakePool, '2026', '7');
        expect(result.sheetTotal).toBe(100000);
        expect(result.lockedTotal).toBe(70000);
        expect(result.apTotal).toBe(70000);
        expect(result.paidTotal).toBe(45000);
        expect(result.unlocked).toEqual([{ id: 'ASIL-003', name: 'Unlocked Emp', net: 30000 }]);
        expect(result.orphans).toEqual([{ employee_id: 'GONE-1', net: 1200 }]);
        expect(result.blankScope).toEqual([{ id: 'ASIL-001', name: 'Blank Scope' }]);
        expect(result.excludedByDates).toEqual([{
            id: 'ASIL-009',
            name: 'Left Early',
            doj: '2020-01-01',
            lwd: '2026-06-15',
        }]);
        expect(result.lockedNotPaid).toEqual([{ id: 'ASIL-002', name: 'Locked Unpaid' }]);
        expect(result.paidNotLocked).toEqual([{ id: 'ASIL-088', name: 'Paid Unlocked' }]);

        const unlockedSum = result.unlocked.reduce((s, r) => s + r.net, 0);
        expect(result.sheetTotal - result.lockedTotal).toBe(unlockedSum);
    });

    test('pg numeric strings and json text are coerced to numbers / arrays', async () => {
        fakePool.query.mockResolvedValueOnce({
            rows: [{
                sheet_total: '10.00',
                locked_total: '10.00',
                ap_total: '10.00',
                paid_total: '10.00',
                unlocked: '[]',
                orphans: '[]',
                blank_scope: '[]',
                excluded_by_dates: '[]',
                locked_not_paid: '[]',
                paid_not_locked: '[]',
            }],
            rowCount: 1,
        });
        const result = await getPayrollReconciliation(fakePool, 2026, 7);
        expect(result.sheetTotal).toBe(10);
        expect(result.unlocked).toEqual([]);
        expect(result.orphans).toEqual([]);
    });
});

describe('GET /api/payroll/:year/:month/reconciliation — HTTP body', () => {
    beforeEach(() => {
        mockPool.query.mockReset();
        mockAgg({
            sheet_total: 50000,
            locked_total: 50000,
            ap_total: 50000,
            paid_total: 50000,
        });
    });

    test('returns the named totals and list keys', async () => {
        const res = await request()
            .get(RECON_PATH)
            .set('Authorization', `Bearer ${makeToken({ role: 'ap_team' })}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            sheetTotal: 50000,
            lockedTotal: 50000,
            apTotal: 50000,
            paidTotal: 50000,
            unlocked: [],
            orphans: [],
            blankScope: [],
            excludedByDates: [],
            lockedNotPaid: [],
            paidNotLocked: [],
        }));
    });
});
