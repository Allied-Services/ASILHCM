'use strict';

/**
 * Fixed Value contract-level meta (external SO refs, SLA/retention text, fv_product).
 * service_orders.meta already exists — do not re-add there.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE contracts
            ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;
        CREATE INDEX IF NOT EXISTS idx_contracts_meta_gin ON contracts USING gin (meta);
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS idx_contracts_meta_gin;
        ALTER TABLE contracts DROP COLUMN IF EXISTS meta;
    `);
};
