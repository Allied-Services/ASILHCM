'use strict';

/**
 * P2 — Unique index on payment_batches scoped with COALESCE so blank client/contract
 * cannot create duplicate PAYROLL batches for the same month.
 *
 * If COALESCE-scope duplicates already exist (observed in prod), disambiguate older
 * rows by appending a stable suffix to contract_name. Ledger rows keep their batch_id;
 * no payment records are deleted.
 *
 * This file never successfully applied on prod (raised P2 BLOCKED and rolled back with
 * singleTransaction), so amending it in place is safe.
 */
exports.up = (pgm) => {
    // Keep newest row in each duplicate group; tag older ones so the unique index can apply.
    pgm.sql(`
        WITH ranked AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY batch_type, year, month,
                                 COALESCE(client, ''), COALESCE(contract_name, '')
                    ORDER BY created_at DESC NULLS LAST, id DESC
                ) AS rn
            FROM payment_batches
        )
        UPDATE payment_batches pb
        SET contract_name = COALESCE(pb.contract_name, '') || ' [legacy-dup:' || pb.id || ']'
        FROM ranked r
        WHERE pb.id = r.id
          AND r.rn > 1
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
