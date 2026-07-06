'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('public_holidays', {
        id: { type: 'serial', primaryKey: true },
        holiday_date: { type: 'date', notNull: true, unique: true },
        name: { type: 'text', notNull: true },
        multiplier: { type: 'numeric(3,1)', notNull: true, default: 3.0 },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('payroll_runs', {
        id: { type: 'serial', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        period_month: { type: 'integer', notNull: true },
        period_year: { type: 'integer', notNull: true },
        status: { type: 'text', notNull: true, default: 'draft' },
        computed_at: { type: 'timestamptz' },
        locked_at: { type: 'timestamptz' },
        locked_by: { type: 'text' },
        invoice_id: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('payroll_runs', ['contract_id', 'period_month', 'period_year'], { unique: true });

    pgm.createTable('payroll_run_rows', {
        id: { type: 'serial', primaryKey: true },
        run_id: { type: 'integer', notNull: true, references: 'payroll_runs', onDelete: 'CASCADE' },
        employee_id: { type: 'text', notNull: true },
        paid_days: { type: 'numeric(8,2)' },
        working_days: { type: 'numeric(8,2)' },
        ot2_hours: { type: 'numeric(8,2)', default: 0 },
        ot3_hours: { type: 'numeric(8,2)', default: 0 },
        inputs: { type: 'jsonb', default: pgm.func("'{}'::jsonb") },
        computed: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('payroll_run_rows', ['run_id', 'employee_id'], { unique: true });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropTable('payroll_run_rows');
    pgm.dropTable('payroll_runs');
    pgm.dropTable('public_holidays');
};
