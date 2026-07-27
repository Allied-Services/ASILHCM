'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
            ADD COLUMN IF NOT EXISTS working_days NUMERIC(6,2),
            ADD COLUMN IF NOT EXISTS pf_deduction NUMERIC(12,2) DEFAULT 0,
            ADD COLUMN IF NOT EXISTS income_tax NUMERIC(12,2),
            ADD COLUMN IF NOT EXISTS salary_override NUMERIC(12,2),
            ADD COLUMN IF NOT EXISTS ot1_hours NUMERIC(8,2) DEFAULT 0;
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
            DROP COLUMN IF EXISTS working_days,
            DROP COLUMN IF EXISTS pf_deduction,
            DROP COLUMN IF EXISTS income_tax,
            DROP COLUMN IF EXISTS salary_override,
            DROP COLUMN IF EXISTS ot1_hours;
    `);
};
