'use strict';

/** OT rate tier on daily attendance rows (engine SELECT expects this column). */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE attendance_records
        ADD COLUMN IF NOT EXISTS ot_rate NUMERIC(6,2) DEFAULT 0
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE attendance_records
        DROP COLUMN IF EXISTS ot_rate
    `);
};
