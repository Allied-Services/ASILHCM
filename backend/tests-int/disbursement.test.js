'use strict';

const { pool, truncateAll } = require('./setup');
const { buildWorldBFixture } = require('./fixtures/worldB');
const { buildWorldAFixture } = require('./fixtures/worldA');
const {
  computeRunForContract,
  lockRun,
} = require('../src/modules/payrollrun/service');
const { disburseRun } = require('../src/modules/disbursement/service');

async function ensureBank(pool) {
  const { rows } = await pool.query(
    `INSERT INTO banks (name, short_name, is_active)
     VALUES ('HBL Test Branch', 'HBL', true)
     ON CONFLICT (name) DO UPDATE SET short_name = 'HBL'
     RETURNING id, name`
  );
  return rows[0];
}

async function setEmployeeBankDetails(pool, employees, bankName = 'HBL') {
  for (let i = 0; i < employees.length; i++) {
    await pool.query(
      `UPDATE employees SET bank_name = $1, bank_account = $2 WHERE id = $3`,
      [bankName, `PK00HABB${1000000 + i}`, employees[i].id]
    );
    employees[i].bank_name = bankName;
    employees[i].bank_account = `PK00HABB${1000000 + i}`;
  }
}

async function computeAndLock(pool, fx) {
  const computed = await computeRunForContract(pool, {
    contractId: fx.contractId,
    month: fx.month,
    year: fx.year,
  });
  expect(computed.ok).toBe(true);
  const locked = await lockRun(pool, { runId: computed.run.id, lockedBy: 'int.test@asil.com.pk' });
  return { computed, locked, runId: computed.run.id };
}

describe('World B disbursement bridge (integration)', () => {
  let fx;
  let bank;

  beforeEach(async () => {
    await truncateAll();
    fx = await buildWorldBFixture(pool);
    bank = await ensureBank(pool);
    await setEmployeeBankDetails(pool, fx.employees);
  });

  test('happy path: compute → lock → disburse creates batch and ledger rows', async () => {
    const { runId, computed } = await computeAndLock(pool, fx);
    const monthName = new Date(2000, fx.month - 1, 1).toLocaleString('en-US', { month: 'short' });
    const yr2 = String(fx.year).slice(-2);

    const result = await disburseRun(
      pool,
      runId,
      {
        bank_id: bank.id,
        bank_name: bank.name,
        payment_date: '2026-06-25',
        reference_no: 'DISB-REF-001',
        notes: 'World B int test',
      },
      'int.test@asil.com.pk'
    );

    expect(result.ok).toBe(true);
    expect(result.employee_count).toBe(2);
    expect(result.excluded).toEqual([]);

    const { rows: batches } = await pool.query(`SELECT * FROM payment_batches WHERE id = $1`, [result.batch_id]);
    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch.batch_type).toBe('PAYROLL');
    expect(batch.year).toBe(fx.year);
    expect(batch.month).toBe(fx.month);
    expect(batch.client).toBe(fx.clientName);
    expect(batch.contract_name).toBe(fx.contractName);
    expect(batch.status).toBe('Confirmed');
    expect(batch.source_run_id).toBe(runId);
    expect(batch.bank_name).toBe(bank.name);
    expect(batch.reference_no).toBe('DISB-REF-001');
    expect(batch.notes).toContain(`source: payroll_run #${runId}`);

    let expectedTotal = 0;
    for (const row of computed.rows) {
      expectedTotal += Number(row.computed.netPay || 0);
    }
    expect(parseFloat(batch.total_amount)).toBeCloseTo(expectedTotal, 2);
    expect(batch.employee_count).toBe(2);

    const { rows: ledger } = await pool.query(
      `SELECT * FROM payment_ledger WHERE batch_id = $1 ORDER BY employee_id`,
      [result.batch_id]
    );
    expect(ledger).toHaveLength(2);

    for (const emp of fx.employees) {
      const row = ledger.find((l) => l.employee_id === emp.id);
      const computedRow = computed.rows.find((r) => r.employee_id === emp.id);
      expect(row).toBeDefined();
      expect(row.payment_type).toBe('SALARY');
      expect(parseFloat(row.amount)).toBeCloseTo(Number(computedRow.computed.netPay || 0), 2);
      expect(row.reference).toBe(`PR${monthName}${yr2}-${emp.id}`);
      expect(row.status).toBe('Paid');
      expect(row.bank_name).toBe(emp.bank_name);
      expect(row.bank_account).toBe(emp.bank_account);
      expect(row.billable).toBe(true);
      expect(row.xero_account_code).toBe('200');
    }

    const { rows: runStatus } = await pool.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runId]);
    expect(runStatus[0].status).toBe('paid');
  });

  test('Guard A: existing batch for same scope returns BATCH_EXISTS', async () => {
    const { runId } = await computeAndLock(pool, fx);

    await pool.query(
      `INSERT INTO payment_batches
         (id, batch_type, year, month, client, contract_name, status, total_amount, employee_count)
       VALUES ('PB-EXISTING-TEST', 'PAYROLL', $1, $2, $3, $4, 'Confirmed', 0, 0)`,
      [fx.year, fx.month, fx.clientName, fx.contractName]
    );

    const beforeLedger = await pool.query(`SELECT COUNT(*)::int AS cnt FROM payment_ledger`);
    const result = await disburseRun(pool, runId, { bank_name: bank.name }, 'int.test@asil.com.pk');

    expect(result.ok).toBe(false);
    expect(result.code).toBe('BATCH_EXISTS');
    expect(result.batch_id).toBe('PB-EXISTING-TEST');

    const afterLedger = await pool.query(`SELECT COUNT(*)::int AS cnt FROM payment_ledger`);
    expect(afterLedger.rows[0].cnt).toBe(beforeLedger.rows[0].cnt);

    const { rows: runStatus } = await pool.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runId]);
    expect(runStatus[0].status).toBe('locked');
  });

  test('Guard B: locked legacy payroll_transactions returns LEGACY_PAYROLL_LOCKED', async () => {
    await truncateAll();
    const waFx = await buildWorldAFixture(pool);
    await pool.query(
      `UPDATE payroll_transactions SET locked = TRUE WHERE year = $1 AND month = $2`,
      [waFx.year, waFx.month]
    );

    await pool.query(
      `INSERT INTO contract_policies
         (contract_id, ot_allowed, ot_monthly_cap_hours, ot_divisor_days, ot_divisor_hours,
          service_charge_pct, medical_annual_cap, use_calendar_working_days, effective_from)
       VALUES ($1, false, 40, 26, 8, 0.18, 50000, true, '2020-01-01')`,
      [waFx.contractId]
    );

    const computed = await computeRunForContract(pool, {
      contractId: waFx.contractId,
      month: waFx.month,
      year: waFx.year,
    });
    expect(computed.ok).toBe(true);
    const locked = await lockRun(pool, { runId: computed.run.id, lockedBy: 'int.test@asil.com.pk' });
    expect(locked.status).toBe('locked');

    const result = await disburseRun(
      pool,
      computed.run.id,
      { bank_id: waFx.bank.id, bank_name: waFx.bank.name },
      'int.test@asil.com.pk'
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('LEGACY_PAYROLL_LOCKED');

    const { rows: batches } = await pool.query(
      `SELECT * FROM payment_batches WHERE year = $1 AND month = $2 AND client = $3`,
      [waFx.year, waFx.month, waFx.clientName]
    );
    expect(batches).toHaveLength(0);
  });

  test('missing bank details returns MISSING_BANK_DETAILS; allow_missing_bank excludes them', async () => {
    await pool.query(`UPDATE employees SET bank_account = NULL WHERE id = $1`, [fx.employees[0].id]);

    const { runId, computed } = await computeAndLock(pool, fx);

    const blocked = await disburseRun(pool, runId, { bank_name: bank.name }, 'int.test@asil.com.pk');
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('MISSING_BANK_DETAILS');
    expect(blocked.employees).toEqual(
      expect.arrayContaining([{ id: fx.employees[0].id, name: fx.employees[0].name }])
    );

    const allowed = await disburseRun(
      pool,
      runId,
      { bank_name: bank.name, allow_missing_bank: true },
      'int.test@asil.com.pk'
    );
    expect(allowed.ok).toBe(true);
    expect(allowed.employee_count).toBe(1);
    expect(allowed.excluded).toEqual([
      { id: fx.employees[0].id, name: fx.employees[0].name },
    ]);

    const includedRow = computed.rows.find((r) => r.employee_id === fx.employees[1].id);
    expect(allowed.total_amount).toBeCloseTo(Number(includedRow.computed.netPay || 0), 2);

    const { rows: ledger } = await pool.query(
      `SELECT employee_id FROM payment_ledger WHERE batch_id = $1`,
      [allowed.batch_id]
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].employee_id).toBe(fx.employees[1].id);
  });

  test('second disburse of same run returns RUN_NOT_DISBURSABLE', async () => {
    const { runId } = await computeAndLock(pool, fx);

    const first = await disburseRun(pool, runId, { bank_name: bank.name }, 'int.test@asil.com.pk');
    expect(first.ok).toBe(true);

    const second = await disburseRun(pool, runId, { bank_name: bank.name }, 'int.test@asil.com.pk');
    expect(second.ok).toBe(false);
    expect(second.code).toBe('RUN_NOT_DISBURSABLE');
    expect(second.status).toBe('paid');

    const { rows: batches } = await pool.query(
      `SELECT * FROM payment_batches WHERE source_run_id = $1`,
      [runId]
    );
    expect(batches).toHaveLength(1);
  });

  test('atomicity: mid-write failure rolls back batch, ledger, and run status', async () => {
    const { runId } = await computeAndLock(pool, fx);
    const fixedTs = 9876543210123;
    const slug = (bank.name || '').replace(/\s+/g, '').slice(0, 8);
    const predictedId = `PB-${fx.year}-${String(fx.month).padStart(2, '0')}-${slug}-${fixedTs}`;

    await pool.query(
      `INSERT INTO payment_batches (id, batch_type, year, month, status, client, contract_name)
       VALUES ($1, 'BILL', $2, $3, 'Confirmed', 'other-client', 'other-contract')`,
      [predictedId, fx.year, fx.month]
    );

    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedTs);

    await expect(
      disburseRun(pool, runId, { bank_name: bank.name }, 'int.test@asil.com.pk')
    ).rejects.toThrow();

    dateSpy.mockRestore();

    const { rows: runStatus } = await pool.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runId]);
    expect(runStatus[0].status).toBe('locked');

    const { rows: payrollLedger } = await pool.query(
      `SELECT pl.* FROM payment_ledger pl
       JOIN payment_batches pb ON pb.id = pl.batch_id
       WHERE pb.source_run_id = $1`,
      [runId]
    );
    expect(payrollLedger).toHaveLength(0);

    const { rows: newBatches } = await pool.query(
      `SELECT * FROM payment_batches WHERE source_run_id = $1`,
      [runId]
    );
    expect(newBatches).toHaveLength(0);
  });
});
