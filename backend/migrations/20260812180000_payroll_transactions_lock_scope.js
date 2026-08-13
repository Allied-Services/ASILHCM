'use strict';

/**
 * P1 — Freeze client / contract_name / locked_net onto payroll_transactions at lock time.
 * Additive only; net is never mutated. Downstream sessions (P2+) read these columns.
 *
 * Idempotent SQL: safe if a prior singleTransaction migrate rolled back mid-flight or
 * columns were applied manually.
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE payroll_transactions
            ADD COLUMN IF NOT EXISTS client text,
            ADD COLUMN IF NOT EXISTS contract_name text,
            ADD COLUMN IF NOT EXISTS locked_net numeric(12,2)
    `);
    pgm.sql(`
        CREATE INDEX IF NOT EXISTS payroll_transactions_scope_idx
        ON payroll_transactions (year, month, client, contract_name)
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DROP INDEX IF EXISTS payroll_transactions_scope_idx`);
    pgm.sql(`
        ALTER TABLE payroll_transactions
            DROP COLUMN IF EXISTS client,
            DROP COLUMN IF EXISTS contract_name,
            DROP COLUMN IF EXISTS locked_net
    `);
};
