'use strict';

/**
 * Leftover UNIQUE (batch_type, year, month) blocks a second contract's payroll
 * batch in the same month. P2 was supposed to drop it; re-drop idempotently.
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE payment_batches
        DROP CONSTRAINT IF EXISTS payment_batches_batch_type_year_month_key
    `);
    pgm.sql(`
        ALTER TABLE payment_batches
        DROP CONSTRAINT IF EXISTS payment_batches_batch_type_year_month_client_contract_name_key
    `);
    pgm.sql(`DROP INDEX IF EXISTS payment_batches_type_ym_client_contract_uniq`);
    pgm.sql(`
        CREATE UNIQUE INDEX IF NOT EXISTS payment_batches_scope_coalesce_uidx
        ON payment_batches (
            batch_type,
            year,
            month,
            (COALESCE(client, '')),
            (COALESCE(contract_name, ''))
        )
    `);
};

exports.down = () => {};
