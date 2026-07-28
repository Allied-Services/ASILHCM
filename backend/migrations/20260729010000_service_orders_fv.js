'use strict';

/**
 * Thin extension for Fixed Value / Conservancy (PSO) service orders.
 * Base tables already exist from 20260705100400_pnl_billing.js.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE service_orders
            ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES client_locations(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS site_code TEXT,
            ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

        CREATE INDEX IF NOT EXISTS idx_service_orders_contract ON service_orders (contract_id);
        CREATE INDEX IF NOT EXISTS idx_service_orders_site ON service_orders (site_code);
        CREATE INDEX IF NOT EXISTS idx_so_deductions_period
            ON so_deductions (service_order_id, period_year, period_month);
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS idx_so_deductions_period;
        DROP INDEX IF EXISTS idx_service_orders_site;
        DROP INDEX IF EXISTS idx_service_orders_contract;
        ALTER TABLE service_orders
            DROP COLUMN IF EXISTS meta,
            DROP COLUMN IF EXISTS site_code,
            DROP COLUMN IF EXISTS location_id;
    `);
};
