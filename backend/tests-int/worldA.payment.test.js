'use strict';

const request = require('supertest');
const { pool, truncateAll } = require('./setup');
const { getApp } = require('./helpers/appEnv');
const { makeToken } = require('./helpers/auth');
const { buildWorldAFixture, buildApprovedBill } = require('./fixtures/worldA');

describe('World A payment path (integration)', () => {
  let app;
  let fixture;

  beforeAll(() => {
    app = getApp();
  });

  beforeEach(async () => {
    await truncateAll();
    fixture = await buildWorldAFixture(pool);
  });

  const lockPath = () => `/api/payroll/${fixture.year}/${fixture.month}/lock`;
  const queuePath = () => `/api/ap/payroll-queue/${fixture.year}/${fixture.month}`;
  const confirmPath = () => `/api/ap/payroll-queue/${fixture.year}/${fixture.month}/confirm`;

  describe('PATCH /api/payroll/:year/:month/lock', () => {
    test('finance_approver can lock and rows flip locked=TRUE with accruals object', async () => {
      const token = makeToken({ role: 'finance_approver' });
      const res = await request(app)
        .patch(lockPath())
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.locked).toBe(true);
      expect(res.body.accruals).toEqual(expect.objectContaining({ ok: expect.any(Boolean) }));

      const { rows } = await pool.query(
        `SELECT locked FROM payroll_transactions WHERE year=$1 AND month=$2`,
        [fixture.year, fixture.month]
      );
      expect(rows.every(r => r.locked === true)).toBe(true);
    });

    test('superadmin can lock payroll', async () => {
      const token = makeToken({ role: 'superadmin' });
      const res = await request(app)
        .patch(lockPath())
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);
    });

    test('payroll_initiator is forbidden from locking', async () => {
      const token = makeToken({ role: 'payroll_initiator' });
      const res = await request(app)
        .patch(lockPath())
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  describe('AP payroll queue + confirm', () => {
    beforeEach(async () => {
      const token = makeToken({ role: 'finance_approver' });
      await request(app)
        .patch(lockPath())
        .set('Authorization', `Bearer ${token}`)
        .send({});
    });

    test('GET queue routes return locked rows with expected totals', async () => {
      const token = makeToken({ role: 'ap_team' });

      const listRes = await request(app)
        .get('/api/ap/payroll-queue')
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.queue).toHaveLength(1);
      expect(parseInt(listRes.body.queue[0].employee_count, 10)).toBe(fixture.employeeCount);
      expect(parseFloat(listRes.body.queue[0].total_net_pay)).toBeCloseTo(fixture.totalNet, 0);

      const detailRes = await request(app)
        .get(queuePath())
        .query({ client: fixture.clientName, contract: fixture.contractName })
        .set('Authorization', `Bearer ${token}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.employees).toHaveLength(fixture.employeeCount);
      expect(detailRes.body.batch).toBeNull();
    });

    test('POST confirm creates payment_batches and payment_ledger rows', async () => {
      const token = makeToken({ role: 'ap_team' });
      const monthName = new Date(2000, fixture.month - 1, 1).toLocaleString('en-US', { month: 'short' });
      const yr2 = String(fixture.year).slice(-2);

      const res = await request(app)
        .post(confirmPath())
        .set('Authorization', `Bearer ${token}`)
        .send({
          bank_id: fixture.bank.id,
          bank_name: fixture.bank.name,
          payment_date: '2026-07-25',
          reference_no: 'INT-REF-001',
          client_filter: fixture.clientName,
          contract_filter: fixture.contractName,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const { rows: batches } = await pool.query(
        `SELECT * FROM payment_batches WHERE batch_type='PAYROLL' AND year=$1 AND month=$2
         AND client=$3 AND contract_name=$4`,
        [fixture.year, fixture.month, fixture.clientName, fixture.contractName]
      );
      expect(batches).toHaveLength(1);
      const batch = batches[0];
      expect(batch.batch_type).toBe('PAYROLL');
      expect(batch.year).toBe(fixture.year);
      expect(batch.month).toBe(fixture.month);
      expect(batch.client).toBe(fixture.clientName);
      expect(batch.contract_name).toBe(fixture.contractName);
      expect(parseFloat(batch.total_amount)).toBeCloseTo(fixture.totalNet, 0);
      expect(batch.employee_count).toBe(fixture.employeeCount);
      expect(batch.status).toBe('Confirmed');

      const { rows: ledger } = await pool.query(
        `SELECT * FROM payment_ledger WHERE batch_id=$1 ORDER BY employee_id`,
        [batch.id]
      );
      expect(ledger).toHaveLength(fixture.employeeCount);

      for (const emp of fixture.employees) {
        const row = ledger.find(l => l.employee_id === emp.id);
        expect(row).toBeDefined();
        expect(row.payment_type).toBe('SALARY');
        expect(parseFloat(row.amount)).toBeCloseTo(emp.net, 0);
        expect(row.reference).toBe(`PR${monthName}${yr2}-${emp.id}`);
        expect(row.status).toBe('Paid');
        expect(row.bank_name).toBe(emp.bank_name);
        expect(row.bank_account).toBe(emp.bank_account);
      }
    });

    test('double confirm is idempotent: batch upserts, ledger does not duplicate', async () => {
      const token = makeToken({ role: 'ap_team' });
      const body = {
        bank_name: fixture.bank.name,
        payment_date: '2026-07-25',
        reference_no: 'INT-REF-DUP',
        client_filter: fixture.clientName,
        contract_filter: fixture.contractName,
        notes: 'first pass',
      };

      const first = await request(app).post(confirmPath()).set('Authorization', `Bearer ${token}`).send(body);
      expect(first.status).toBe(200);
      const firstBatchId = first.body.batch.id;

      const second = await request(app)
        .post(confirmPath())
        .set('Authorization', `Bearer ${token}`)
        .send({ ...body, notes: 'second pass', reference_no: 'INT-REF-DUP-2' });
      expect(second.status).toBe(200);

      const { rows: batches } = await pool.query(
        `SELECT * FROM payment_batches WHERE batch_type='PAYROLL' AND year=$1 AND month=$2
         AND client=$3 AND contract_name=$4`,
        [fixture.year, fixture.month, fixture.clientName, fixture.contractName]
      );
      expect(batches).toHaveLength(1);
      expect(batches[0].id).toBe(firstBatchId);
      expect(batches[0].notes).toBe('second pass');
      expect(batches[0].reference_no).toBe('INT-REF-DUP-2');

      const { rows: ledger } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM payment_ledger WHERE batch_id=$1`,
        [firstBatchId]
      );
      expect(ledger[0].cnt).toBe(fixture.employeeCount);
    });
  });

  describe('PATCH /api/ap/batches/:batchId/fm-approve', () => {
    let batchId;

    beforeEach(async () => {
      await request(app)
        .patch(lockPath())
        .set('Authorization', `Bearer ${makeToken({ role: 'finance_approver' })}`)
        .send({});

      const confirmRes = await request(app)
        .post(confirmPath())
        .set('Authorization', `Bearer ${makeToken({ role: 'ap_team' })}`)
        .send({
          bank_name: fixture.bank.name,
          client_filter: fixture.clientName,
          contract_filter: fixture.contractName,
        });
      batchId = confirmRes.body.batch.id;
    });

    test('finance_manager can FM-approve a Confirmed batch', async () => {
      const res = await request(app)
        .patch(`/api/ap/batches/${batchId}/fm-approve`)
        .set('Authorization', `Bearer ${makeToken({ role: 'finance_manager' })}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.batch.status).toBe('FM Approved');

      const { rows } = await pool.query(`SELECT status, fm_approved_by FROM payment_batches WHERE id=$1`, [batchId]);
      expect(rows[0].status).toBe('FM Approved');
      expect(rows[0].fm_approved_by).toBe('int.test@asil.com.pk');
    });

    test('ap_team cannot FM-approve', async () => {
      const res = await request(app)
        .patch(`/api/ap/batches/${batchId}/fm-approve`)
        .set('Authorization', `Bearer ${makeToken({ role: 'ap_team' })}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/ap/bills/:id/confirm', () => {
    test('happy path creates BILL batch and ledger row', async () => {
      const bill = await buildApprovedBill(pool);
      const token = makeToken({ role: 'ap_team' });

      const res = await request(app)
        .post(`/api/ap/bills/${bill.id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          bank_name: 'HBL',
          payment_date: '2026-07-25',
          reference_no: 'BILL-REF-001',
          billable: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.batch.batch_type).toBe('BILL');
      expect(parseFloat(res.body.batch.total_amount)).toBeCloseTo(bill.total, 0);

      const { rows: ledger } = await pool.query(
        `SELECT * FROM payment_ledger WHERE batch_id=$1`,
        [res.body.batch.id]
      );
      expect(ledger).toHaveLength(1);
      expect(ledger[0].payment_type).toBe('BILL');
      expect(parseFloat(ledger[0].amount)).toBeCloseTo(bill.total, 0);
      expect(ledger[0].status).toBe('Paid');

      const { rows: bills } = await pool.query(`SELECT status FROM bills WHERE id=$1`, [bill.id]);
      expect(bills[0].status).toBe('Posted');
    });
  });
});
