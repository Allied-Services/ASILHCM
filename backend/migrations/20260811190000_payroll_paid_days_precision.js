'use strict';

/** Model A days need >2 decimal places so salary × days/30 matches Excel salary-for-days. */
exports.up = async (pgm) => {
    pgm.sql('ALTER TABLE payroll_transactions ALTER COLUMN paid_days TYPE numeric(12,6)');
    pgm.sql(`
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'monthly_attendance_overrides' AND column_name = 'present_days'
            ) THEN
                ALTER TABLE monthly_attendance_overrides ALTER COLUMN present_days TYPE numeric(12,6);
            END IF;
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'monthly_attendance_overrides' AND column_name = 'absent_days'
            ) THEN
                ALTER TABLE monthly_attendance_overrides ALTER COLUMN absent_days TYPE numeric(12,6);
            END IF;
        END $$;
    `);
};

exports.down = async (pgm) => {
    pgm.sql('ALTER TABLE payroll_transactions ALTER COLUMN paid_days TYPE numeric(5,2)');
};
