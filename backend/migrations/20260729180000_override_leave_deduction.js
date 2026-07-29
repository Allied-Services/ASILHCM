'use strict';

/** Monetary "Deduction against Leaves" on monthly_attendance_overrides (World B / FV hub). */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
        ADD COLUMN IF NOT EXISTS leave_deduction NUMERIC(12,2) DEFAULT 0
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
        DROP COLUMN IF EXISTS leave_deduction
    `);
};
