'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('bd_leads', {
        id: { type: 'serial', primaryKey: true },
        company: { type: 'text', notNull: true },
        contact_name: { type: 'text' },
        email: { type: 'text' },
        phone: { type: 'text' },
        source: { type: 'text' },
        industry: { type: 'text' },
        est_headcount: { type: 'integer' },
        stage: { type: 'text', notNull: true, default: 'cold' },
        owner_email: { type: 'text' },
        next_action_date: { type: 'date' },
        notes: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('bd_outreach_log', {
        id: { type: 'serial', primaryKey: true },
        lead_id: { type: 'integer', references: 'bd_leads', onDelete: 'CASCADE' },
        channel: { type: 'text', notNull: true },
        direction: { type: 'text', default: 'outbound' },
        subject: { type: 'text' },
        sent_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        outcome: { type: 'text' },
    });

    pgm.createTable('bd_renewals', {
        id: { type: 'serial', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        renewal_date: { type: 'date', notNull: true },
        reminder_90_sent: { type: 'boolean', default: false },
        reminder_60_sent: { type: 'boolean', default: false },
        reminder_30_sent: { type: 'boolean', default: false },
        status: { type: 'text', default: 'upcoming' },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('onboarding_templates', {
        id: { type: 'serial', primaryKey: true },
        service_type: { type: 'text' },
        task_key: { type: 'text', notNull: true },
        task_label: { type: 'text', notNull: true },
        sort_order: { type: 'integer', default: 0 },
        blocking: { type: 'boolean', default: false },
        default_owner_role: { type: 'text' },
    });

    pgm.createTable('onboarding_runs', {
        id: { type: 'serial', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        lead_id: { type: 'integer', references: 'bd_leads', onDelete: 'SET NULL' },
        status: { type: 'text', default: 'in_progress' },
        started_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        completed_at: { type: 'timestamptz' },
    });

    pgm.createTable('onboarding_tasks', {
        id: { type: 'serial', primaryKey: true },
        run_id: { type: 'integer', notNull: true, references: 'onboarding_runs', onDelete: 'CASCADE' },
        task_key: { type: 'text', notNull: true },
        task_label: { type: 'text', notNull: true },
        blocking: { type: 'boolean', default: false },
        owner_email: { type: 'text' },
        due_date: { type: 'date' },
        status: { type: 'text', default: 'pending' },
        completed_at: { type: 'timestamptz' },
    });

    pgm.createTable('cashflow_snapshots', {
        id: { type: 'serial', primaryKey: true },
        week_start: { type: 'date', notNull: true },
        expected_inflows: { type: 'numeric(16,2)', default: 0 },
        committed_outflows: { type: 'numeric(16,2)', default: 0 },
        net_position: { type: 'numeric(16,2)', default: 0 },
        details: { type: 'jsonb', default: pgm.func("'{}'::jsonb") },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.sql(`
        INSERT INTO onboarding_templates (service_type, task_key, task_label, sort_order, blocking, default_owner_role)
        SELECT v.service_type, v.task_key, v.task_label, v.sort_order, v.blocking, v.default_owner_role
        FROM (VALUES
            ('default', 'policies', 'Define contract policies (billing, OT, medical caps)', 1, true, 'operations'),
            ('default', 'rate_cards', 'Set up rate cards and service charge %', 2, true, 'finance_manager'),
            ('default', 'budget_lines', 'Configure budget lines and spend caps', 3, true, 'finance_manager'),
            ('default', 'focals', 'Register client focals (invoice + location)', 4, true, 'operations'),
            ('default', 'projects', 'Create projects / sites', 5, true, 'operations'),
            ('default', 'attendance_profile', 'Configure attendance parser profile', 6, false, 'operations'),
            ('default', 'pos', 'Enter purchase orders', 7, false, 'finance_proposer'),
            ('default', 'invoice_schedule', 'Set invoice frequency and credit days', 8, true, 'finance_proposer'),
            ('default', 'challans', 'Configure required challan attachments', 9, false, 'finance_manager'),
            ('default', 'dry_run', 'First payroll dry-run parity check', 10, true, 'payroll_initiator')
        ) AS v(service_type, task_key, task_label, sort_order, blocking, default_owner_role)
        WHERE NOT EXISTS (SELECT 1 FROM onboarding_templates LIMIT 1);
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropTable('cashflow_snapshots');
    pgm.dropTable('onboarding_tasks');
    pgm.dropTable('onboarding_runs');
    pgm.dropTable('onboarding_templates');
    pgm.dropTable('bd_renewals');
    pgm.dropTable('bd_outreach_log');
    pgm.dropTable('bd_leads');
};
