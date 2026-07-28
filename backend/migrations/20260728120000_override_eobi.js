'use strict';

/** EOBI override per employee/month for Excel parity (PSO labor rows with eobi=0). */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
            ADD COLUMN IF NOT EXISTS eobi_employee NUMERIC(12,2);
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE monthly_attendance_overrides
            DROP COLUMN IF EXISTS eobi_employee;
    `);
};
