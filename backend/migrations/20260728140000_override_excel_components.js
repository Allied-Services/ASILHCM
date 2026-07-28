'use strict';

/** Excel-authoritative salary-for-days and overtime amount overrides (June-26 cols U/X). */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
            ADD COLUMN IF NOT EXISTS salary_for_days NUMERIC(12,2),
            ADD COLUMN IF NOT EXISTS overtime_amount NUMERIC(12,2);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
            DROP COLUMN IF EXISTS salary_for_days,
            DROP COLUMN IF EXISTS overtime_amount;
    `);
};
