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
    ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS ot_rate NUMERIC;
  `);

  await pool.query(`
    ALTER TABLE payment_batches DROP CONSTRAINT IF EXISTS payment_batches_batch_type_year_month_key;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS payment_batches_type_ym_client_contract_uniq
    ON payment_batches (batch_type, year, month, client, contract_name);
  `);
}

module.exports = { applyRuntimeDdl };
