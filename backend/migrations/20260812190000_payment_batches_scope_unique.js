'use strict';

/**
 * P2 — Unique index on payment_batches scoped with COALESCE so blank client/contract
 * cannot create duplicate PAYROLL batches for the same month.
 *
 * Detects pre-existing COALESCE-duplicates and REFUSES to proceed (no destructive deletes).
 */
exports.up = (pgm) => {
    pgm.sql(`
        DO $$
        DECLARE
            dup_count int;
        BEGIN
            SELECT COUNT(*) INTO dup_count FROM (
                SELECT 1
                FROM payment_batches
                GROUP BY batch_type, year, month, COALESCE(client, ''), COALESCE(contract_name, '')
                HAVING COUNT(*) > 1
            ) d;
            IF dup_count > 0 THEN
                RAISE EXCEPTION
                    'P2 BLOCKED: payment_batches has % COALESCE-scope duplicate group(s). Resolve manually — do not delete payment records automatically.',
                    dup_count;
            END IF;
        END $$;
    `);

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

    pgm.sql(`DROP INDEX IF EXISTS payment_batches_type_ym_client_contract_uniq`);
    pgm.sql(`
        ALTER TABLE payment_batches
        DROP CONSTRAINT IF EXISTS payment_batches_batch_type_year_month_client_contract_name_key
    `);
    pgm.sql(`
        ALTER TABLE payment_batches
        DROP CONSTRAINT IF EXISTS payment_batches_batch_type_year_month_key
    `);
};

exports.down = (pgm) => {
    pgm.sql(`DROP INDEX IF EXISTS payment_batches_scope_coalesce_uidx`);
    pgm.sql(`
        CREATE UNIQUE INDEX IF NOT EXISTS payment_batches_type_ym_client_contract_uniq
        ON payment_batches (batch_type, year, month, client, contract_name)
    `);
};
