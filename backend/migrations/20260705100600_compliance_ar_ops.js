'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('tax_regulations', {
        id: { type: 'serial', primaryKey: true },
        authority: { type: 'text', notNull: true },
        rule_type: { type: 'text', notNull: true },
        jurisdiction: { type: 'text' },
        rules: { type: 'jsonb', notNull: true },
        effective_from: { type: 'date', notNull: true },
        effective_to: { type: 'date' },
        source_reference: { type: 'text' },
        created_by: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('holiday_calendar', {
        id: { type: 'serial', primaryKey: true },
        holiday_date: { type: 'date', notNull: true },
        name: { type: 'text', notNull: true },
        holiday_type: { type: 'text', notNull: true, default: 'gazetted' },
        province: { type: 'text' },
        ot_multiplier: { type: 'numeric(4,2)', default: 3.0 },
    });

    pgm.createTable('ot_rate_rules', {
        id: { type: 'serial', primaryKey: true },
        day_type: { type: 'text', notNull: true },
        multiplier: { type: 'numeric(4,2)', notNull: true },
        effective_from: { type: 'date', notNull: true },
        effective_to: { type: 'date' },
        source_reference: { type: 'text' },
    });

    pgm.createTable('statutory_ledger', {
        id: { type: 'serial', primaryKey: true },
        employee_id: { type: 'text', references: 'employees', onDelete: 'SET NULL' },
        period_month: { type: 'integer', notNull: true },
        period_year: { type: 'integer', notNull: true },
        authority: { type: 'text', notNull: true },
        employee_share: { type: 'numeric(12,2)', default: 0 },
        employer_share: { type: 'numeric(12,2)', default: 0 },
        taxable_base: { type: 'numeric(14,2)' },
        regulation_id: { type: 'integer', references: 'tax_regulations', onDelete: 'SET NULL' },
        payroll_transaction_id: { type: 'integer' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('statutory_filings', {
        id: { type: 'serial', primaryKey: true },
        authority: { type: 'text', notNull: true },
        period_month: { type: 'integer' },
        period_year: { type: 'integer' },
        status: { type: 'text', default: 'draft' },
        total_amount: { type: 'numeric(14,2)' },
        line_count: { type: 'integer' },
        cpr_reference: { type: 'text' },
        challan_file_id: { type: 'integer' },
        deposit_date: { type: 'date' },
        file_ref: { type: 'integer' },
        generated_by: { type: 'text' },
        filed_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('invoice_schedules', {
        id: { type: 'serial', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        period_month: { type: 'integer', notNull: true },
        period_year: { type: 'integer', notNull: true },
        due_to_generate_date: { type: 'date' },
        status: { type: 'text', default: 'upcoming' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('dunning_log', {
        id: { type: 'serial', primaryKey: true },
        invoice_id: { type: 'text' },
        stage: { type: 'text', notNull: true },
        sent_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        recipient: { type: 'text' },
    });

    pgm.createTable('invoice_attachments', {
        id: { type: 'serial', primaryKey: true },
        invoice_id: { type: 'text', notNull: true },
        attachment_type: { type: 'text', notNull: true },
        filing_id: { type: 'integer', references: 'statutory_filings', onDelete: 'SET NULL' },
        file_id: { type: 'integer' },
    });

    pgm.createTable('xero_connections', {
        id: { type: 'serial', primaryKey: true },
        tenant_id: { type: 'text', notNull: true },
        tenant_name: { type: 'text' },
        access_token: { type: 'text' },
        refresh_token: { type: 'text' },
        expires_at: { type: 'timestamptz' },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('xero_sync_log', {
        id: { type: 'serial', primaryKey: true },
        entity_type: { type: 'text', notNull: true },
        entity_id: { type: 'text', notNull: true },
        direction: { type: 'text', notNull: true },
        status: { type: 'text', notNull: true },
        xero_id: { type: 'text' },
        error: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('ops_inbox_events', {
        id: { type: 'serial', primaryKey: true },
        intake_message_id: { type: 'integer', references: 'intake_messages', onDelete: 'CASCADE' },
        event_type: { type: 'text', notNull: true },
        client_id: { type: 'text', references: 'clients', onDelete: 'SET NULL' },
        contract_id: { type: 'text', references: 'contracts', onDelete: 'SET NULL' },
        priority: { type: 'text', default: 'normal' },
        summary: { type: 'text' },
        linked_entity_type: { type: 'text' },
        linked_entity_id: { type: 'text' },
        status: { type: 'text', default: 'open' },
        actioned_by: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.sql(`
        ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS due_date DATE;
        ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
        ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS payment_received_at TIMESTAMPTZ;
        ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS dunning_stage TEXT;
    `);

    pgm.sql(`
        INSERT INTO ot_rate_rules (day_type, multiplier, effective_from, source_reference)
        SELECT v.day_type, v.multiplier, '2025-07-01'::date, v.source_reference
        FROM (VALUES
            ('normal', 2.0, 'Pakistan labour law — normal OT'),
            ('rest_day', 2.0, 'Sunday / weekly rest day'),
            ('gazetted_holiday', 3.0, 'Eid and gazetted holidays')
        ) AS v(day_type, multiplier, source_reference)
        WHERE NOT EXISTS (SELECT 1 FROM ot_rate_rules LIMIT 1);
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE client_invoices DROP COLUMN IF EXISTS due_date;
        ALTER TABLE client_invoices DROP COLUMN IF EXISTS sent_at;
        ALTER TABLE client_invoices DROP COLUMN IF EXISTS payment_received_at;
        ALTER TABLE client_invoices DROP COLUMN IF EXISTS dunning_stage;
    `);
    pgm.dropTable('ops_inbox_events');
    pgm.dropTable('xero_sync_log');
    pgm.dropTable('xero_connections');
    pgm.dropTable('invoice_attachments');
    pgm.dropTable('dunning_log');
    pgm.dropTable('invoice_schedules');
    pgm.dropTable('statutory_filings');
    pgm.dropTable('statutory_ledger');
    pgm.dropTable('ot_rate_rules');
    pgm.dropTable('holiday_calendar');
    pgm.dropTable('tax_regulations');
};
