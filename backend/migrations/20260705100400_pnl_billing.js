'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('contract_rate_cards', {
        id: { type: 'serial', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        project_id: { type: 'text', references: 'projects', onDelete: 'SET NULL' },
        role_title: { type: 'text' },
        billing_basis: { type: 'text', default: 'monthly' },
        bill_rate: { type: 'numeric(12,2)' },
        cost_rate: { type: 'numeric(12,2)' },
        effective_from: { type: 'date', notNull: true },
        effective_to: { type: 'date' },
    });

    pgm.createTable('contract_budget_lines', {
        id: { type: 'serial', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        project_id: { type: 'text', references: 'projects', onDelete: 'SET NULL' },
        category: { type: 'text', notNull: true },
        name: { type: 'text', notNull: true },
        monthly_cap: { type: 'numeric(14,2)' },
        annual_cap: { type: 'numeric(14,2)' },
        effective_from: { type: 'date' },
        effective_to: { type: 'date' },
        active: { type: 'boolean', default: true },
    });

    pgm.createTable('cost_allocations', {
        id: { type: 'serial', primaryKey: true },
        source_type: { type: 'text', notNull: true },
        source_id: { type: 'text', notNull: true },
        contract_id: { type: 'text', references: 'contracts', onDelete: 'SET NULL' },
        project_id: { type: 'text', references: 'projects', onDelete: 'SET NULL' },
        budget_line_id: { type: 'integer', references: 'contract_budget_lines', onDelete: 'SET NULL' },
        period_month: { type: 'integer', notNull: true },
        period_year: { type: 'integer', notNull: true },
        amount: { type: 'numeric(14,2)', notNull: true },
        created_by: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('cost_allocations', ['contract_id', 'period_year', 'period_month']);

    pgm.createTable('service_orders', {
        id: { type: 'text', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        project_id: { type: 'text', references: 'projects', onDelete: 'SET NULL' },
        so_number: { type: 'text' },
        name: { type: 'text', notNull: true },
        period_type: { type: 'text', default: 'monthly' },
        total_value: { type: 'numeric(14,2)' },
        status: { type: 'text', default: 'active' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('service_order_lines', {
        id: { type: 'serial', primaryKey: true },
        service_order_id: { type: 'text', notNull: true, references: 'service_orders', onDelete: 'CASCADE' },
        line_number: { type: 'text' },
        name: { type: 'text', notNull: true },
        unit: { type: 'text', default: 'MON' },
        quantity: { type: 'numeric(12,2)', default: 1 },
        rate: { type: 'numeric(14,2)' },
        total_amount: { type: 'numeric(14,2)' },
        is_manpower_dependent: { type: 'boolean', default: false },
        roles: { type: 'jsonb', default: pgm.func("'[]'::jsonb") },
    });

    pgm.createTable('so_deductions', {
        id: { type: 'serial', primaryKey: true },
        service_order_id: { type: 'text', notNull: true, references: 'service_orders', onDelete: 'CASCADE' },
        line_id: { type: 'integer', references: 'service_order_lines', onDelete: 'SET NULL' },
        period_month: { type: 'integer', notNull: true },
        period_year: { type: 'integer', notNull: true },
        type: { type: 'text', notNull: true },
        employee_id: { type: 'text', references: 'employees', onDelete: 'SET NULL' },
        days_absent: { type: 'numeric(6,2)' },
        amount: { type: 'numeric(14,2)', notNull: true },
        source: { type: 'text', default: 'attendance_ledger' },
        approved_by: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('service_log_entries', {
        id: { type: 'serial', primaryKey: true },
        project_id: { type: 'text', references: 'projects', onDelete: 'SET NULL' },
        service_order_id: { type: 'text', references: 'service_orders', onDelete: 'SET NULL' },
        line_id: { type: 'integer', references: 'service_order_lines', onDelete: 'SET NULL' },
        entry_date: { type: 'date', notNull: true },
        amount: { type: 'numeric(14,2)', notNull: true },
        description: { type: 'text' },
        status: { type: 'text', default: 'pending' },
        invoiced_month: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.sql(`
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS budget_line_id INTEGER REFERENCES contract_budget_lines(id) ON DELETE SET NULL;
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS match_status TEXT DEFAULT 'unmatched';
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS matched_by TEXT;
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ;
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE bills DROP COLUMN IF EXISTS budget_line_id;
        ALTER TABLE bills DROP COLUMN IF EXISTS match_status;
        ALTER TABLE bills DROP COLUMN IF EXISTS matched_by;
        ALTER TABLE bills DROP COLUMN IF EXISTS matched_at;
    `);
    pgm.dropTable('service_log_entries');
    pgm.dropTable('so_deductions');
    pgm.dropTable('service_order_lines');
    pgm.dropTable('service_orders');
    pgm.dropTable('cost_allocations');
    pgm.dropTable('contract_budget_lines');
    pgm.dropTable('contract_rate_cards');
};
