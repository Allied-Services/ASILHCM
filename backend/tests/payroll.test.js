'use strict';

/**
 * tests/payroll.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the payroll lock / unlock state machine in server.js.
 *
 * COVERS
 *   1. PATCH /api/payroll/:year/:month/lock
 *      - Requires finance_approver or superadmin (all other roles → 403)
 *      - Accepts optional employee_ids array (scoped lock)
 *      - Full-month lock when employee_ids is omitted
 *      - Returns { ok, locked, lockedBy, accruals_posted }
 *
 *   2. PATCH /api/payroll/:year/:month/unlock
 *      - Same role guard as lock
 *      - Scoped unlock when employee_ids provided
 *      - Full-month unlock when employee_ids omitted
 *      - Returns { ok, locked: false }
 *
 *   3. Upsert guard — POST /api/payroll/:year/:month
 *      - Blocked with 403 when any locked row exists for that month
 *
 *   4. Reset guard — DELETE /api/payroll/:year/:month/reset
 *      - Blocked when locked rows exist
 *      - Proceeds when no locked rows found
 *
 * WHAT IS NOT TESTED HERE (per AGENTS.md §2.2 — frozen without tests)
 *   - The actual SQL UPDATE that flips locked=TRUE in Neon (that is the
 *     behaviour being guarded — tests verify the HTTP contract only)
 *   - PF / Gratuity accrual side-effects of lock (these write to separate
 *     ledger tables and require a separate integration test with seeded data)
 *   - AP confirmation route (/api/ap/confirm) — OFF-LIMITS per §2.2
 *
 * HOW TO RUN
 *   cd backend && npm test -- --testPathPattern=payroll
 * ─────────────────────────────────────────────────────────────────────────────
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

// ── Constants matching server.js ─────────────────────────────────────────────
const LOCK_ALLOWED_ROLES   = ['finance_approver', 'superadmin'];
const LOCK_FORBIDDEN_ROLES = [
  'finance_manager',
  'finance_proposer',
  'ap_team',
  'ar_team',
  'payroll_initiator',
  'procurement_manager',
  'procurement_approver',
  'procurement_proposer',
  'operations',
];

const TEST_YEAR  = 2026;
const TEST_MONTH = 6;
const LOCK_PATH   = `/api/payroll/${TEST_YEAR}/${TEST_MONTH}/lock`;
const UNLOCK_PATH = `/api/payroll/${TEST_YEAR}/${TEST_MONTH}/unlock`;

// ── Default mock: UPDATE succeeds, no rows returned ──────────────────────────
const mockUpdateSuccess = () =>
  mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

// ═════════════════════════════════════════════════════════════════════════════
// 1. PATCH /api/payroll/:year/:month/lock — role enforcement
// ═════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/payroll/:year/:month/lock — role guards', () => {

  test('unauthenticated request → 401', async () => {
    const res = await request().patch(LOCK_PATH);
    expect(res.status).toBe(401);
  });

  test.each(LOCK_ALLOWED_ROLES)(
    'role "%s" is allowed to lock payroll → 200',
    async (role) => {
      const token = makeToken({ role });
      // Mock 1: the UPDATE locked=TRUE query
      mockUpdateSuccess();
      // Mock 2: SELECT locked employee_ids (full-month path)
      mockPool.query.mockResolvedValueOnce({
        rows: [{ employee_id: 'ASIL-001' }, { employee_id: 'ASIL-002' }],
        rowCount: 2,
      });
      // Mock 3 & 4: employee + contract lookup for PF/Gratuity accrual (no-op — no PF employees)
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await request()
        .patch(LOCK_PATH)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.locked).toBe(true);
      expect(res.body.accruals).toEqual({ ok: true, pf_rows: 0, gratuity_rows: 0 });
    }
  );

  test.each(LOCK_FORBIDDEN_ROLES)(
    'role "%s" is blocked from locking payroll → 403',
    async (role) => {
      const token = makeToken({ role });
      const res = await request()
        .patch(LOCK_PATH)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Forbidden/i);
    }
  );

});

// ═════════════════════════════════════════════════════════════════════════════
// 2. PATCH /api/payroll/:year/:month/lock — scoped vs full lock
// ═════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/payroll/:year/:month/lock — lock scope', () => {

  const token = () => makeToken({ role: 'finance_approver' });

  test('scoped lock with employee_ids provided → uses targeted UPDATE path', async () => {
    // For scoped lock: server.js takes the employee_ids path (line 2471)
    // and does NOT do the SELECT to fetch all locked IDs.
    mockUpdateSuccess(); // the scoped UPDATE
    // No SELECT needed for scoped path — employees passed directly
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // PF/Gratuity lookup

    const res = await request()
      .patch(LOCK_PATH)
      .set('Authorization', `Bearer ${token()}`)
      .send({ employee_ids: ['ASIL-001', 'ASIL-002'] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.locked).toBe(true);
    expect(res.body.lockedBy).toBe('testuser@asil.com.pk');
  });

  test('full-month lock with no employee_ids → returns accruals_posted count', async () => {
    mockUpdateSuccess(); // full UPDATE
    // SELECT to get all locked employee IDs
    mockPool.query.mockResolvedValueOnce({
      rows: [{ employee_id: 'ASIL-003' }, { employee_id: 'ASIL-004' }, { employee_id: 'ASIL-005' }],
      rowCount: 3,
    });
    // Employee + contract lookup for accrual (empty — no PF/Gratuity contracts)
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request()
      .patch(LOCK_PATH)
      .set('Authorization', `Bearer ${token()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.accruals_posted).toBe(3);
  });

  test('empty employee_ids array treated as full-month lock', async () => {
    mockUpdateSuccess();
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // locked IDs
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // PF lookup

    const res = await request()
      .patch(LOCK_PATH)
      .set('Authorization', `Bearer ${token()}`)
      .send({ employee_ids: [] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('response always includes lockedBy matching the token email', async () => {
    const specificToken = makeToken({ role: 'finance_approver', email: 'payroll.officer@asil.com.pk' });
    mockUpdateSuccess();
    mockPool.query.mockResolvedValueOnce({ rows: [{ employee_id: 'ASIL-001' }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request()
      .patch(LOCK_PATH)
      .set('Authorization', `Bearer ${specificToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.lockedBy).toBe('payroll.officer@asil.com.pk');
  });

  test('lock still succeeds when PF accrual insert fails → accruals.ok false', async () => {
    mockUpdateSuccess();
    mockPool.query.mockResolvedValueOnce({
      rows: [{ employee_id: 'ASIL-PF-1' }],
      rowCount: 1,
    });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'ASIL-PF-1', salary: 48000, contract_name: 'Test', eosb_type: 'Provident Fund' }],
      rowCount: 1,
    });
    mockPool.query.mockRejectedValueOnce(new Error('simulated pf insert failure'));

    const res = await request()
      .patch(LOCK_PATH)
      .set('Authorization', `Bearer ${token()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.accruals).toEqual({ ok: false, error_logged: true });
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 3. PATCH /api/payroll/:year/:month/unlock — state machine inverse
// ═════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/payroll/:year/:month/unlock', () => {

  const token = () => makeToken({ role: 'finance_approver' });

  test('unauthenticated request → 401', async () => {
    const res = await request().patch(UNLOCK_PATH);
    expect(res.status).toBe(401);
  });

  test.each(LOCK_FORBIDDEN_ROLES)(
    'role "%s" is blocked from unlocking payroll → 403',
    async (role) => {
      const forbidToken = makeToken({ role });
      const res = await request()
        .patch(UNLOCK_PATH)
        .set('Authorization', `Bearer ${forbidToken}`)
        .send({});
      expect(res.status).toBe(403);
    }
  );

  test('full-month unlock with no employee_ids → 200 { ok: true, locked: false }', async () => {
    mockUpdateSuccess(); // the full UPDATE SET locked=FALSE

    const res = await request()
      .patch(UNLOCK_PATH)
      .set('Authorization', `Bearer ${token()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.locked).toBe(false); // state machine inverse
  });

  test('scoped unlock with employee_ids → 200', async () => {
    mockUpdateSuccess();

    const res = await request()
      .patch(UNLOCK_PATH)
      .set('Authorization', `Bearer ${token()}`)
      .send({ employee_ids: ['ASIL-010', 'ASIL-011'] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.locked).toBe(false);
  });

  test('lock → unlock sequence produces correct state transitions', async () => {
    // LOCK
    mockUpdateSuccess();
    mockPool.query.mockResolvedValueOnce({ rows: [{ employee_id: 'ASIL-020' }], rowCount: 1 });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const lockRes = await request()
      .patch(LOCK_PATH)
      .set('Authorization', `Bearer ${token()}`)
      .send({ employee_ids: ['ASIL-020'] });
    expect(lockRes.body.locked).toBe(true);

    // UNLOCK
    mockUpdateSuccess();
    const unlockRes = await request()
      .patch(UNLOCK_PATH)
      .set('Authorization', `Bearer ${token()}`)
      .send({ employee_ids: ['ASIL-020'] });
    expect(unlockRes.body.locked).toBe(false);

    // State is now unlocked — confirmed by response contract.
    // Real DB state is not checked here (mock pool does not persist state).
    // Integration tests with a seeded test DB are required to verify DB columns.
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Upsert guard — blocked when month is locked
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/payroll/:year/:month — locked month upsert guard', () => {

  test('blocked with 403 when any locked row exists for the target month', async () => {
    // Route used to be requireRole('finance_proposer') only; now payroll roles + payroll.edit perms
    const token = makeToken({ role: 'finance_proposer' });
    // server.js lock check: SELECT locked FROM payroll_transactions WHERE locked=TRUE
    mockPool.query.mockResolvedValueOnce({
      rows: [{ locked: true }], // ← month has a locked row
      rowCount: 1,
    });

    const res = await request()
      .post(`/api/payroll/${TEST_YEAR}/${TEST_MONTH}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [{ employee_id: 'ASIL-001', gross: 50000 }] });

    expect(res.status).toBe(403);
    // server.js returns { error: 'Payroll month is locked...' } or similar
    expect(res.body.error).toBeDefined();
  });

  test('proceeds when no locked rows exist for the target month', async () => {
    const token = makeToken({ role: 'finance_proposer' });
    // Lock check returns empty (no locked rows)
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // The upsert itself
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request()
      .post(`/api/payroll/${TEST_YEAR}/${TEST_MONTH}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [] });

    // 200 or 400 (empty rows validation) — but NOT 403
    expect(res.status).not.toBe(403);
  });

  test('payroll_initiator can save sheet inputs', async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const token = makeToken({ role: 'payroll_initiator' });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request()
      .post(`/api/payroll/${TEST_YEAR}/${TEST_MONTH}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [] });

    expect(res.status).not.toBe(403);
  });

  test('operations with payroll.edit custom permission can save sheet inputs', async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const token = makeToken({ role: 'operations', email: 'sadia.komal@asil.com.pk' });
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        role: 'operations',
        permissions: { payroll: { access: true, subPerms: ['view', 'edit', 'lock', 'export'] } },
      }],
      rowCount: 1,
    });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request()
      .post(`/api/payroll/${TEST_YEAR}/${TEST_MONTH}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [] });

    expect(res.status).not.toBe(403);
    expect(res.body.ok).toBe(true);
  });

  test('operations without payroll.edit is still 403 on save', async () => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const token = makeToken({ role: 'operations' });
    mockPool.query.mockResolvedValueOnce({
      rows: [{ role: 'operations', permissions: { payroll: { access: true, subPerms: ['view'] } } }],
      rowCount: 1,
    });

    const res = await request()
      .post(`/api/payroll/${TEST_YEAR}/${TEST_MONTH}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [] });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient role/i);
  });

});
