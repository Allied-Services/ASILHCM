'use strict';

/**
 * DDL that server.js applies on listen() but is skipped when require()'d by Jest.
 * Keeps ci-test schema aligned with what production routes expect.
 */
async function applyRuntimeDdl(pool) {
  await pool.query(`
    ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS fm_approved_by TEXT;
    ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS fm_approved_at TIMESTAMPTZ;
    ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS client TEXT;
    ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS contract_name TEXT;
    ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS source_run_id INTEGER;
    ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS ot_rate NUMERIC;
    ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS client TEXT;
    ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS contract_name TEXT;
    ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS locked_net NUMERIC(12,2);
  `);

  await pool.query(`
    ALTER TABLE payment_batches DROP CONSTRAINT IF EXISTS payment_batches_batch_type_year_month_key;
  `);
  await pool.query(`
    ALTER TABLE payment_batches
    DROP CONSTRAINT IF EXISTS payment_batches_batch_type_year_month_client_contract_name_key;
  `);

  // P2: replace bare (client, contract_name) uniqueness with COALESCE-scoped unique index
  // so blank-scope confirms cannot create duplicate PAYROLL batches for one month.
  await pool.query(`
    DROP INDEX IF EXISTS payment_batches_type_ym_client_contract_uniq;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS payment_batches_scope_coalesce_uidx
    ON payment_batches (
      batch_type,
      year,
      month,
      (COALESCE(client, '')),
      (COALESCE(contract_name, ''))
    );
  `);
}

module.exports = { applyRuntimeDdl };
