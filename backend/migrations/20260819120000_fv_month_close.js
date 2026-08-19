'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('payroll_close_packs', {
        id: { type: 'serial', primaryKey: true },
        run_id: { type: 'integer', notNull: true, unique: true },
        contract_id: { type: 'text', notNull: true },
        period_month: { type: 'integer', notNull: true },
        period_year: { type: 'integer', notNull: true },
        status: { type: 'text', notNull: true, default: 'closed' },
        salary_batch_id: { type: 'text' },
        closed_at: { type: 'timestamptz', default: pgm.func('now()') },
        closed_by: { type: 'text' },
        reopened_at: { type: 'timestamptz' },
        reopened_by: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', default: pgm.func('now()') },
    });

    pgm.createTable('payroll_payables', {
        id: { type: 'serial', primaryKey: true },
        pack_id: { type: 'integer', notNull: true, references: 'payroll_close_packs', onDelete: 'CASCADE' },
        payable_type: { type: 'text', notNull: true },
        amount: { type: 'numeric', precision: 14, scale: 2, notNull: true, default: 0 },
        status: { type: 'text', notNull: true, default: 'Payable' },
        payment_date: { type: 'date' },
        reference_no: { type: 'text' },
        payment_batch_id: { type: 'text' },
        paid_at: { type: 'timestamptz' },
        paid_by: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('now()') },
        updated_at: { type: 'timestamptz', default: pgm.func('now()') },
    });

    pgm.addConstraint('payroll_payables', 'payroll_payables_pack_type_unique', {
        unique: ['pack_id', 'payable_type'],
    });

    pgm.createIndex('payroll_close_packs', ['contract_id', 'period_year', 'period_month']);
    pgm.createIndex('payroll_payables', ['pack_id']);

    pgm.createTable('month_close_revisions', {
        id: { type: 'serial', primaryKey: true },
        entity_type: { type: 'text', notNull: true },
        entity_id: { type: 'text', notNull: true },
        action: { type: 'text', notNull: true },
        actor: { type: 'text' },
        snapshot: { type: 'jsonb' },
        created_at: { type: 'timestamptz', default: pgm.func('now()') },
    });

    pgm.sql(`
        ALTER TABLE client_invoices
        ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
        ADD COLUMN IF NOT EXISTS finalized_by text
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE client_invoices
        DROP COLUMN IF EXISTS finalized_at,
        DROP COLUMN IF EXISTS finalized_by
    `);
    pgm.dropTable('month_close_revisions');
    pgm.dropTable('payroll_payables');
    pgm.dropTable('payroll_close_packs');
};
