'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('contract_policies', {
        id: { type: 'serial', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        project_id: { type: 'text', references: 'projects', onDelete: 'CASCADE' },
        billing_model: { type: 'text', notNull: true, default: 'headcount_rate' },
        attendance_input_mode: { type: 'text', notNull: true, default: 'full_ledger' },
        standard_month_days: { type: 'integer', default: 30 },
        ot_allowed: { type: 'boolean', default: true },
        ot_monthly_cap_hours: { type: 'numeric(10,2)' },
        ot_client_managed: { type: 'boolean', default: false },
        ot_divisor_days: { type: 'integer', default: 26 },
        ot_divisor_hours: { type: 'integer', default: 8 },
        service_charge_pct: { type: 'numeric(6,4)', default: 0.18 },
        medical_annual_cap: { type: 'numeric(12,2)' },
        medical_cycle_anchor: { type: 'text', default: 'employment_date' },
        credit_days: { type: 'integer', default: 30 },
        invoice_frequency: { type: 'text', default: 'monthly' },
        invoice_day_of_month: { type: 'integer', default: 1 },
        po_required: { type: 'boolean', default: false },
        challans_required: { type: 'jsonb', default: pgm.func("'[]'::jsonb") },
        reminder_cadence: { type: 'jsonb', default: pgm.func("'[]'::jsonb") },
        edu_cess_enabled: { type: 'boolean', default: false },
        bonus_accrual_months: { type: 'integer', default: 12 },
        gratuity_accrual_months: { type: 'integer', default: 12 },
        effective_from: { type: 'date', notNull: true, default: pgm.func('CURRENT_DATE') },
        effective_to: { type: 'date' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('contract_policies', ['contract_id', 'project_id', 'effective_from']);

    pgm.createTable('benefit_policies', {
        id: { type: 'serial', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        benefit_type: { type: 'text', notNull: true },
        cap_amount: { type: 'numeric(12,2)' },
        cap_period: { type: 'text', default: 'annual' },
        cycle_anchor: { type: 'text', default: 'employment_date' },
        effective_from: { type: 'date', default: pgm.func('CURRENT_DATE') },
        effective_to: { type: 'date' },
    });

    pgm.sql(`
        ALTER TABLE contracts ADD COLUMN IF NOT EXISTS monthly_spend_cap NUMERIC(14,2);
        ALTER TABLE contracts ADD COLUMN IF NOT EXISTS total_liability_cap NUMERIC(14,2);
        ALTER TABLE contracts ADD COLUMN IF NOT EXISTS credit_days INTEGER DEFAULT 30;
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE contracts DROP COLUMN IF EXISTS monthly_spend_cap;
        ALTER TABLE contracts DROP COLUMN IF EXISTS total_liability_cap;
        ALTER TABLE contracts DROP COLUMN IF EXISTS credit_days;
    `);
    pgm.dropTable('benefit_policies');
    pgm.dropTable('contract_policies');
};
