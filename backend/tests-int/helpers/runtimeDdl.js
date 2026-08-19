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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll_close_packs (
      id serial PRIMARY KEY,
      run_id integer NOT NULL UNIQUE,
      contract_id text NOT NULL,
      period_month integer NOT NULL,
      period_year integer NOT NULL,
      status text NOT NULL DEFAULT 'closed',
      salary_batch_id text,
      closed_at timestamptz DEFAULT now(),
      closed_by text,
      reopened_at timestamptz,
      reopened_by text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS payroll_payables (
      id serial PRIMARY KEY,
      pack_id integer NOT NULL REFERENCES payroll_close_packs(id) ON DELETE CASCADE,
      payable_type text NOT NULL,
      amount numeric(14,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'Payable',
      payment_date date,
      reference_no text,
      payment_batch_id text,
      paid_at timestamptz,
      paid_by text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE (pack_id, payable_type)
    );
    CREATE TABLE IF NOT EXISTS month_close_revisions (
      id serial PRIMARY KEY,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      action text NOT NULL,
      actor text,
      snapshot jsonb,
      created_at timestamptz DEFAULT now()
    );
    ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS finalized_at timestamptz;
    ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS finalized_by text;
  `);
}

module.exports = { applyRuntimeDdl };
