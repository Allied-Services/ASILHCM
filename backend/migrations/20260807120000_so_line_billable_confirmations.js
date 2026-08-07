'use strict';

/**
 * Monthly ops confirmation for non-manpower Fixed Value SO lines.
 * Invoice include rule: manpower always; non-manpower only when billable=true
 * for the period AND a period review row exists (even if all lines unchecked).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS so_billable_period_reviews (
            service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
            period_year INTEGER NOT NULL,
            period_month INTEGER NOT NULL,
            reviewed_by TEXT,
            reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (service_order_id, period_year, period_month)
        );

        CREATE TABLE IF NOT EXISTS so_line_billable_confirmations (
            id SERIAL PRIMARY KEY,
            service_order_id TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
            line_id INTEGER NOT NULL REFERENCES service_order_lines(id) ON DELETE CASCADE,
            period_year INTEGER NOT NULL,
            period_month INTEGER NOT NULL,
            billable BOOLEAN NOT NULL DEFAULT FALSE,
            confirmed_by TEXT,
            confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT so_line_billable_confirmations_uniq
                UNIQUE (service_order_id, line_id, period_year, period_month)
        );

        CREATE INDEX IF NOT EXISTS idx_so_line_billable_period
            ON so_line_billable_confirmations (service_order_id, period_year, period_month);

        CREATE INDEX IF NOT EXISTS idx_so_billable_reviews_period
            ON so_billable_period_reviews (period_year, period_month);
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        DROP INDEX IF EXISTS idx_so_billable_reviews_period;
        DROP INDEX IF EXISTS idx_so_line_billable_period;
        DROP TABLE IF EXISTS so_line_billable_confirmations;
        DROP TABLE IF EXISTS so_billable_period_reviews;
    `);
};
