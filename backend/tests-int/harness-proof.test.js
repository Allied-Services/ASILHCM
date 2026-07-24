'use strict';

/**
 * Harness proof: the mocked Jest tier cannot catch column-name drift against a real schema.
 * S0A facts.md confirms prod still has legacy ot/opd/reimb columns on payroll_transactions.
 */
const { pool, truncateAll } = require('./setup');

describe('harness proof — legacy Wafi column drift', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  test('legacy ot/opd/reimb INSERT succeeds on prod-shaped schema (columns exist but are dead)', async () => {
    await pool.query(`
      INSERT INTO employees (id, name, active, salary)
      VALUES ('ASIL-HARNESS-1', 'Harness Emp', 'Yes', 40000)
      ON CONFLICT (id) DO NOTHING
    `);

    // Prod snapshot (S0A facts.md §2) still has ot/opd/reimb — insert succeeds but no reader consumes them.
    await expect(
      pool.query(`
        INSERT INTO payroll_transactions (employee_id, month, year, ot, reimb, opd)
        VALUES ('ASIL-HARNESS-1', 7, 2026, 100, 50, 25)
      `)
    ).resolves.toBeDefined();

    const { rows } = await pool.query(
      `SELECT ot, reimb, opd FROM payroll_transactions WHERE employee_id='ASIL-HARNESS-1'`
    );
    expect(parseFloat(rows[0].ot)).toBe(100);
    expect(parseFloat(rows[0].reimb)).toBe(50);
    expect(parseFloat(rows[0].opd)).toBe(25);
  });
});
