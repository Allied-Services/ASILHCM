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

  describe('P2 â€” frozen scope, batch-scoped Paid', () => {
    async function lockMonth() {
      await request(app)
        .patch(lockPath())
        .set('Authorization', `Bearer ${makeToken({ role: 'finance_approver' })}`)
        .send({});
    }

    async function addContractBEmployees() {
      const clientB = 'World A Client B';
      const contractB = 'WA-CONTRACT-B';
      const contractIdB = '99101';
      const netsB = [30000, 31000];

      await pool.query(
        `INSERT INTO clients (id, name, is_active) VALUES ($1, $2, true) ON CONFLICT (id) DO NOTHING`,
        ['CLI-WA-B', clientB]
      );
      await pool.query(
        `INSERT INTO contracts (id, client_id, contract_name, status)
         VALUES ($1, $2, $3, 'Active') ON CONFLICT (id) DO NOTHING`,
        [contractIdB, 'CLI-WA-B', contractB]
      );

      const employeesB = [];
      for (let i = 0; i < netsB.length; i++) {
        const empId = `ASIL-WB-${String(i + 1).padStart(3, '0')}`;
        const net = netsB[i];
        const gross = Math.round(net * 1.15);
        await pool.query(
          `INSERT INTO employees
             (id, name, client, contract_name, contract_id, active, salary, bank_name, bank_account, account_title)
           VALUES ($1, $2, $3, $4, $5, 'Yes', $6, 'HBL', $7, $2)
           ON CONFLICT (id) DO NOTHING`,
          [empId, `World A Emp B${i + 1}`, clientB, contractB, contractIdB, gross, `PK00HABB${2000000 + i}`]
        );
        await pool.query(
          `INSERT INTO payroll_transactions
             (month, year, employee_id, paid_days, ot2_hrs, ot3_hrs, opd_claim,
              reimbursement, arrears, bonus_amount, special_allowance, fuel_mobile,
              other_deduction, advance_deduction, loan_deduction,
              medical_ee, medical_sp, medical_ch1, medical_ch2,
              gross, net, wht, eobi_ee, service_charges, sales_tax, total_invoice,
              created_by, locked)
           VALUES ($1,$2,$3,26,0,0,0,0,0,0,0,0,0,0,0,NULL,NULL,NULL,NULL,$4,$5,0,400,0,0,$4,'fixture',FALSE)
           ON CONFLICT (employee_id, month, year) DO UPDATE SET
             gross=EXCLUDED.gross, net=EXCLUDED.net, total_invoice=EXCLUDED.total_invoice, locked=FALSE`,
          [fixture.month, fixture.year, empId, gross, net]
        );
        employeesB.push({ id: empId, net });
      }
      return {
        clientName: clientB,
        contractName: contractB,
        employees: employeesB,
        totalNet: netsB.reduce((s, n) => s + n, 0),
      };
    }

    test('confirm contract A only marks A paid; B stays unpaid', async () => {
      const contractB = await addContractBEmployees();
      await lockMonth();

      const token = makeToken({ role: 'ap_team' });
      const res = await request(app)
        .post(confirmPath())
        .set('Authorization', `Bearer ${token}`)
        .send({
          bank_name: fixture.bank.name,
          payment_date: '2026-07-25',
          client_filter: fixture.clientName,
          contract_filter: fixture.contractName,
        });
      expect(res.status).toBe(200);
      expect(parseFloat(res.body.batch.total_amount)).toBeCloseTo(fixture.totalNet, 0);
      expect(res.body.batch.employee_count).toBe(fixture.employeeCount);

      const { rows: statuses } = await pool.query(
        `SELECT employee_id, status FROM payroll_transactions WHERE year=$1 AND month=$2`,
        [fixture.year, fixture.month]
      );
      const byId = Object.fromEntries(statuses.map((r) => [r.employee_id, r.status]));
      for (const emp of fixture.employees) {
        expect(byId[emp.id]).toBe('Paid');
      }
      for (const emp of contractB.employees) {
        expect(byId[emp.id]).not.toBe('Paid');
      }
    });

    test('roster rename after lock does not change AP queue scope or total', async () => {
      await lockMonth();
      const token = makeToken({ role: 'ap_team' });

      const before = await request(app)
        .get('/api/ap/payroll-queue')
        .set('Authorization', `Bearer ${token}`);
      expect(before.status).toBe(200);
      expect(before.body.queue).toHaveLength(1);
      const beforeRow = before.body.queue[0];
      expect(beforeRow.client).toBe(fixture.clientName);
      expect(beforeRow.contract_name).toBe(fixture.contractName);
      expect(parseFloat(beforeRow.total_net_pay)).toBeCloseTo(fixture.totalNet, 0);

      await pool.query(
        `UPDATE employees SET client='Renamed Client', contract_name='Renamed Contract'
         WHERE id = ANY($1::text[])`,
        [fixture.employees.map((e) => e.id)]
      );

      const after = await request(app)
        .get('/api/ap/payroll-queue')
        .set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(200);
      expect(after.body.queue).toHaveLength(1);
      expect(after.body.queue[0].client).toBe(fixture.clientName);
      expect(after.body.queue[0].contract_name).toBe(fixture.contractName);
      expect(parseFloat(after.body.queue[0].total_net_pay)).toBeCloseTo(fixture.totalNet, 0);
      expect(parseInt(after.body.queue[0].employee_count, 10)).toBe(fixture.employeeCount);
    });

    test('locked orphan (deleted employee) is still counted with null client', async () => {
      await lockMonth();
      const orphanId = fixture.employees[0].id;
      const orphanNet = fixture.employees[0].net;

      await pool.query(`ALTER TABLE payroll_transactions DROP CONSTRAINT IF EXISTS payroll_transactions_employee_id_fkey`);
      try {
        await pool.query(`DELETE FROM employees WHERE id=$1`, [orphanId]);
        await pool.query(
          `UPDATE payroll_transactions SET client=NULL, contract_name=NULL WHERE employee_id=$1 AND year=$2 AND month=$3`,
          [orphanId, fixture.year, fixture.month]
        );

        const token = makeToken({ role: 'ap_team' });
        const listRes = await request(app)
          .get('/api/ap/payroll-queue')
          .set('Authorization', `Bearer ${token}`);
        expect(listRes.status).toBe(200);

        const orphanGroup = listRes.body.queue.find((r) => r.client == null || r.client === '');
        expect(orphanGroup).toBeDefined();
        expect(parseInt(orphanGroup.employee_count, 10)).toBeGreaterThanOrEqual(1);
        expect(parseFloat(orphanGroup.total_net_pay)).toBeGreaterThanOrEqual(orphanNet);

        const detailRes = await request(app)
          .get(queuePath())
          .set('Authorization', `Bearer ${token}`);
        expect(detailRes.status).toBe(200);
        const orphanRow = detailRes.body.employees.find((e) => e.employee_id === orphanId);
        expect(orphanRow).toBeDefined();
        expect(orphanRow.client == null || orphanRow.client === '').toBe(true);
      } finally {
        // Restore stub employee + FK so later suites keep referential integrity
        await pool.query(
          `INSERT INTO employees (id, name, active) VALUES ($1, 'orphan-stub', 'No')
           ON CONFLICT (id) DO NOTHING`,
          [orphanId]
        );
        await pool.query(`
          DO $$ BEGIN
            ALTER TABLE payroll_transactions
              ADD CONSTRAINT payroll_transactions_employee_id_fkey
              FOREIGN KEY (employee_id) REFERENCES employees(id);
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `);
      }
    });

    test('fractional net with locked_net uses rounded figure for batch and ledger', async () => {
      const empId = fixture.employees[0].id;
      await pool.query(
        `UPDATE payroll_transactions
         SET net=45000.75, locked_net=45001, locked=TRUE, client=$3, contract_name=$4
         WHERE employee_id=$1 AND year=$2 AND month=$5`,
        [empId, fixture.year, fixture.clientName, fixture.contractName, fixture.month]
      );
      // Lock remaining rows so the confirm scope is complete
      await lockMonth();
      // Re-apply fractional+locked_net after lock refresh (lock sets locked_net=ROUND(net))
      await pool.query(
        `UPDATE payroll_transactions SET net=45000.75, locked_net=45001
         WHERE employee_id=$1 AND year=$2 AND month=$3`,
        [empId, fixture.year, fixture.month]
      );

      const token = makeToken({ role: 'ap_team' });
      const res = await request(app)
        .post(confirmPath())
        .set('Authorization', `Bearer ${token}`)
        .send({
          bank_name: fixture.bank.name,
          payment_date: '2026-07-25',
          client_filter: fixture.clientName,
          contract_filter: fixture.contractName,
        });
      expect(res.status).toBe(200);

      const expectedTotal =
        45001 + fixture.employees.slice(1).reduce((s, e) => s + Math.round(e.net), 0);
      expect(parseFloat(res.body.batch.total_amount)).toBe(expectedTotal);

      const { rows: ledger } = await pool.query(
        `SELECT amount FROM payment_ledger WHERE batch_id=$1 AND employee_id=$2`,
        [res.body.batch.id, empId]
      );
      expect(ledger).toHaveLength(1);
      expect(parseFloat(ledger[0].amount)).toBe(45001);

      const { rows: sumRows } = await pool.query(
        `SELECT SUM(amount)::float AS ledger_sum FROM payment_ledger WHERE batch_id=$1`,
        [res.body.batch.id]
      );
      expect(sumRows[0].ledger_sum).toBe(parseFloat(res.body.batch.total_amount));
    });

    test('blank-scope confirm twice yields one batch', async () => {
      await lockMonth();
      const token = makeToken({ role: 'ap_team' });
      const body = {
        bank_name: fixture.bank.name,
        payment_date: '2026-07-25',
        reference_no: 'BLANK-1',
        notes: 'blank first',
      };

      const first = await request(app).post(confirmPath()).set('Authorization', `Bearer ${token}`).send(body);
      expect(first.status).toBe(200);
      const firstId = first.body.batch.id;

      const second = await request(app)
        .post(confirmPath())
        .set('Authorization', `Bearer ${token}`)
        .send({ ...body, reference_no: 'BLANK-2', notes: 'blank second' });
      expect(second.status).toBe(200);

      const { rows: batches } = await pool.query(
        `SELECT id, notes, reference_no FROM payment_batches
         WHERE batch_type='PAYROLL' AND year=$1 AND month=$2
           AND COALESCE(client,'')='' AND COALESCE(contract_name,'')=''`,
        [fixture.year, fixture.month]
      );
      expect(batches).toHaveLength(1);
      expect(batches[0].id).toBe(firstId);
      expect(batches[0].notes).toBe('blank second');
      expect(batches[0].reference_no).toBe('BLANK-2');
    });
  });
});
