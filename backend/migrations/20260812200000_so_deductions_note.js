'use strict';

/**
 * Persist free-text comments on Fixed Value invoice adjustments
 * (manual so_deductions). Shown on print under LESS: Adjustments.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE so_deductions
            ADD COLUMN IF NOT EXISTS note TEXT;
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE so_deductions
            DROP COLUMN IF EXISTS note;
    `);
};
