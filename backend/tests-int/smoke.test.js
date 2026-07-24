'use strict';

const { pool, truncateAll } = require('./setup');

describe('integration smoke', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test('payroll_runs table exists after schema + migrations', async () => {
    const { rows } = await pool.query(`SELECT to_regclass('public.payroll_runs') AS reg`);
    expect(rows[0].reg).not.toBeNull();
  });

  test('insert and read employee + contract', async () => {
    await pool.query(`
      INSERT INTO clients (id, name, status)
      VALUES ('CLI-INT-1', 'Integration Client', 'Active')
      ON CONFLICT (id) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO contracts (id, client_id, contract_name, status)
      VALUES (99001, 'CLI-INT-1', 'INT-TEST-CONTRACT', 'Active')
      ON CONFLICT (id) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO employees (id, name, client, contract_name, contract_id, active, salary)
      VALUES ('ASIL-INT-1', 'Integration Emp', 'Integration Client', 'INT-TEST-CONTRACT', '99001', 'Yes', 50000)
      ON CONFLICT (id) DO NOTHING
    `);

    const { rows } = await pool.query(
      `SELECT e.id, e.name, c.contract_name
       FROM employees e
       JOIN contracts c ON c.id::text = e.contract_id
       WHERE e.id = 'ASIL-INT-1'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].contract_name).toBe('INT-TEST-CONTRACT');
  });
});

afterAll(async () => {
  await pool.end();
});
