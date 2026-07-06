'use strict';

// client_invoices.contract_id was created as INT by legacy self-migrations in
// server.js, but contract IDs are TEXT (e.g. CTR-1783331288580). That broke
// invoice generation from payroll runs and the v_contract_pnl_monthly join.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'client_invoices' AND column_name = 'contract_id'
                  AND data_type IN ('integer', 'bigint', 'smallint')
            ) THEN
                ALTER TABLE client_invoices ALTER COLUMN contract_id TYPE TEXT USING contract_id::text;
            END IF;
        END $$;
    `);
    pgm.sql(`ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS contract_id TEXT`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = () => {
    // Irreversible in practice: TEXT contract IDs cannot be cast back to INT.
};
