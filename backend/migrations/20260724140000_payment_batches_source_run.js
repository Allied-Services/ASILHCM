'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS source_run_id INTEGER`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql('ALTER TABLE payment_batches DROP COLUMN IF EXISTS source_run_id');
};
