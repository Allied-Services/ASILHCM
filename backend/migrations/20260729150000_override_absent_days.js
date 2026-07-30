'use strict';

/** Explicit sheet absent days for FV/Conservancy monthly overrides (not derived from WD − present). */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
            ADD COLUMN IF NOT EXISTS absent_days NUMERIC(6,2);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
            DROP COLUMN IF EXISTS absent_days;
    `);
};
