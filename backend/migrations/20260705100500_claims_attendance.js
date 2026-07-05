'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('attendance_parser_profiles', {
        id: { type: 'serial', primaryKey: true },
        client_id: { type: 'text', references: 'clients', onDelete: 'CASCADE' },
        contract_id: { type: 'text', references: 'contracts', onDelete: 'SET NULL' },
        name: { type: 'text', notNull: true },
        format_type: { type: 'text', notNull: true, default: 'csv' },
        input_mode: { type: 'text', notNull: true, default: 'full_ledger' },
        column_map: { type: 'jsonb', default: pgm.func("'{}'::jsonb") },
        date_format: { type: 'text', default: 'DD/MM/YYYY' },
        employee_match_strategy: { type: 'text', default: 'exact_id' },
        sender_pattern: { type: 'text' },
        active: { type: 'boolean', default: true },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('attendance_alert_rules', {
        id: { type: 'serial', primaryKey: true },
        project_id: { type: 'text', references: 'projects', onDelete: 'CASCADE' },
        rule_type: { type: 'text', notNull: true },
        threshold: { type: 'numeric(10,2)' },
        recipients: { type: 'jsonb', default: pgm.func("'[]'::jsonb") },
        channels: { type: 'jsonb', default: pgm.func("'[\"email\"]'::jsonb") },
        active: { type: 'boolean', default: true },
    });

    pgm.createTable('attendance_alerts_log', {
        id: { type: 'serial', primaryKey: true },
        rule_id: { type: 'integer', references: 'attendance_alert_rules', onDelete: 'SET NULL' },
        employee_id: { type: 'text' },
        project_id: { type: 'text' },
        alert_date: { type: 'date' },
        channel: { type: 'text' },
        sent_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('employee_claims', {
        id: { type: 'serial', primaryKey: true },
        intake_message_id: { type: 'integer', references: 'intake_messages', onDelete: 'SET NULL' },
        employee_id: { type: 'text', references: 'employees', onDelete: 'SET NULL' },
        claim_type: { type: 'text', notNull: true },
        period_month: { type: 'integer' },
        period_year: { type: 'integer' },
        claimed_items: { type: 'jsonb', default: pgm.func("'[]'::jsonb") },
        status: { type: 'text', notNull: true, default: 'received' },
        focal_email: { type: 'text' },
        focal_token_hash: { type: 'text' },
        focal_approved_at: { type: 'timestamptz' },
        focal_rejected_at: { type: 'timestamptz' },
        compliance_notes: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('benefit_utilization', {
        id: { type: 'serial', primaryKey: true },
        employee_id: { type: 'text', notNull: true, references: 'employees', onDelete: 'CASCADE' },
        contract_id: { type: 'text', references: 'contracts', onDelete: 'SET NULL' },
        benefit_type: { type: 'text', notNull: true, default: 'medical' },
        cycle_start: { type: 'date', notNull: true },
        cycle_end: { type: 'date', notNull: true },
        cap_amount: { type: 'numeric(12,2)', notNull: true },
        used_amount: { type: 'numeric(12,2)', notNull: true, default: 0 },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('benefit_utilization', ['employee_id', 'benefit_type', 'cycle_start'], { unique: true });

    pgm.createTable('ot_utilization', {
        id: { type: 'serial', primaryKey: true },
        project_id: { type: 'text', references: 'projects', onDelete: 'CASCADE' },
        contract_id: { type: 'text', references: 'contracts', onDelete: 'SET NULL' },
        period_month: { type: 'integer', notNull: true },
        period_year: { type: 'integer', notNull: true },
        ot_hours: { type: 'numeric(10,2)', default: 0 },
        ot_amount: { type: 'numeric(14,2)', default: 0 },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('ot_utilization', ['project_id', 'period_year', 'period_month'], { unique: true });

    pgm.createTable('procurement_requests', {
        id: { type: 'serial', primaryKey: true },
        intake_message_id: { type: 'integer', references: 'intake_messages', onDelete: 'SET NULL' },
        client_id: { type: 'text', references: 'clients', onDelete: 'SET NULL' },
        contract_id: { type: 'text', references: 'contracts', onDelete: 'SET NULL' },
        project_id: { type: 'text', references: 'projects', onDelete: 'SET NULL' },
        description: { type: 'text' },
        requested_items: { type: 'jsonb', default: pgm.func("'[]'::jsonb") },
        status: { type: 'text', default: 'new' },
        linked_bill_id: { type: 'text', references: 'bills', onDelete: 'SET NULL' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('bill_documents', {
        id: { type: 'serial', primaryKey: true },
        bill_id: { type: 'text', notNull: true, references: 'bills', onDelete: 'CASCADE' },
        file_id: { type: 'integer' },
        ocr_status: { type: 'text', default: 'pending' },
        ocr_json: { type: 'jsonb' },
        ocr_confidence: { type: 'numeric(5,4)' },
        verified_by: { type: 'text' },
        verified_at: { type: 'timestamptz' },
    });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropTable('bill_documents');
    pgm.dropTable('procurement_requests');
    pgm.dropTable('ot_utilization');
    pgm.dropTable('benefit_utilization');
    pgm.dropTable('employee_claims');
    pgm.dropTable('attendance_alerts_log');
    pgm.dropTable('attendance_alert_rules');
    pgm.dropTable('attendance_parser_profiles');
};
