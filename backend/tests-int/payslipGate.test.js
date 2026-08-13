'use strict';

const request = require('supertest');
const { pool, truncateAll } = require('./setup');
const { getApp } = require('./helpers/appEnv');
const { makeToken } = require('./helpers/auth');
const { buildWorldAFixture } = require('./fixtures/worldA');

describe('Payslip paid gate (P3)', () => {
  let app;
  let fixture;
  let paidEmp;
  let unpaidEmp;

  beforeAll(() => {
    app = getApp();
  });

  beforeEach(async () => {
    await truncateAll();
    fixture = await buildWorldAFixture(pool, {
      employeeCount: 2,
      nets: [45000, 52000],
    });
    paidEmp = fixture.employees[0];
    unpaidEmp = fixture.employees[1];

    await pool.query(
      `UPDATE employees SET contract_name = $2 WHERE id = $1`,
      [unpaidEmp.id, 'WA-UNPAID-CONTRACT']
    );

    const lockToken = makeToken({ role: 'finance_approver' });
    const lockRes = await request(app)
      .patch(`/api/payroll/${fixture.year}/${fixture.month}/lock`)
      .set('Authorization', `Bearer ${lockToken}`)
      .send({});
    expect(lockRes.status).toBe(200);

    const apToken = makeToken({ role: 'ap_team' });
    const confirmRes = await request(app)
      .post(`/api/ap/payroll-queue/${fixture.year}/${fixture.month}/confirm`)
      .set('Authorization', `Bearer ${apToken}`)
      .send({
        bank_id: fixture.bank.id,
        bank_name: fixture.bank.name,
        payment_date: '2026-07-25',
        reference_no: 'P3-GATE-001',
        client_filter: fixture.clientName,
        contract_filter: fixture.contractName,
      });
    expect(confirmRes.status).toBe(200);
  });

  test('readiness reports one paid / one not after a batch covering only one employee', async () => {
    const token = makeToken({ role: 'payroll_initiator' });
    const res = await request(app)
      .get(`/api/payroll/${fixture.year}/${fixture.month}/payslip-readiness`)
      .query({ employeeIds: `${paidEmp.id},${unpaidEmp.id}` })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.allLocked).toBe(true);
    expect(res.body.paidCount).toBe(1);
    expect(res.body.paid).toBe(false);
    expect(res.body.canSend).toBe(false);
    expect(res.body.notPaid).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: unpaidEmp.id })])
    );
    expect(res.body.notPaid).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: paidEmp.id })])
    );
    const paidRow = (res.body.employees || []).find((e) => e.id === paidEmp.id);
    const unpaidRow = (res.body.employees || []).find((e) => e.id === unpaidEmp.id);
    expect(paidRow?.paid).toBe(true);
    expect(unpaidRow?.paid).toBe(false);
  });

  test('send scoped to the unpaid employee is refused with NOT_PAID', async () => {
    const token = makeToken({ role: 'finance_manager' });
    const res = await request(app)
      .post(`/api/payroll/${fixture.year}/${fixture.month}/send-payslips`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        confirm: true,
        employeeIds: [unpaidEmp.id],
        sendAll: false,
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_PAID');
    expect(res.body.error).toMatch(/Accounts Payable/);
    expect(res.body.detail.unpaid).toEqual([unpaidEmp.id]);
  });
});
