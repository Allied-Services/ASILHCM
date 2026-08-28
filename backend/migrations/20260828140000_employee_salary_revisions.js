'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('employee_salary_revisions', {
        id: { type: 'serial', primaryKey: true },
        employee_id: { type: 'text', notNull: true },
        old_salary: { type: 'numeric', notNull: true },
        new_salary: { type: 'numeric', notNull: true },
        effective_year: { type: 'integer', notNull: true },
        effective_month: { type: 'integer', notNull: true },
        changed_by: { type: 'text' },
        changed_at: { type: 'timestamptz', default: pgm.func('now()') },
        note: { type: 'text' },
    });

    pgm.addConstraint('employee_salary_revisions', 'employee_salary_revisions_month_check', {
        check: 'effective_month >= 1 AND effective_month <= 12',
    });

    pgm.addConstraint('employee_salary_revisions', 'employee_salary_revisions_emp_period_unique', {
        unique: ['employee_id', 'effective_year', 'effective_month'],
    });

    pgm.createIndex('employee_salary_revisions', ['employee_id', 'effective_year', 'effective_month']);

    pgm.sql(`
        ALTER TABLE payroll_transactions
        ADD COLUMN IF NOT EXISTS salary_used numeric
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE payroll_transactions
        DROP COLUMN IF EXISTS salary_used
    `);
    pgm.dropTable('employee_salary_revisions');
};
