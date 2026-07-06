'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE employee_claims ADD COLUMN IF NOT EXISTS payroll_run_id INTEGER REFERENCES payroll_runs(id) ON DELETE SET NULL`);
    pgm.sql(`ALTER TABLE employee_claims ADD COLUMN IF NOT EXISTS contract_id TEXT`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`ALTER TABLE employee_claims DROP COLUMN IF EXISTS contract_id`);
    pgm.sql(`ALTER TABLE employee_claims DROP COLUMN IF EXISTS payroll_run_id`);
};
