'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS claim_authority TEXT`);

    pgm.createTable('portal_claim_periods', {
        id: { type: 'serial', primaryKey: true },
        campaign_month: { type: 'integer', notNull: true },
        campaign_year: { type: 'integer', notNull: true },
        claim_month: { type: 'integer', notNull: true },
        claim_year: { type: 'integer', notNull: true },
        settlement_month: { type: 'integer', notNull: true },
        settlement_year: { type: 'integer', notNull: true },
        fill_open_at: { type: 'timestamptz', notNull: true },
        fill_close_at: { type: 'timestamptz', notNull: true },
        approve_close_at: { type: 'timestamptz', notNull: true },
        status: { type: 'text', notNull: true, default: 'open' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.addConstraint('portal_claim_periods', 'portal_claim_periods_campaign_uniq', {
        unique: ['campaign_month', 'campaign_year'],
    });

    pgm.createTable('portal_claim_batches', {
        id: { type: 'serial', primaryKey: true },
        period_id: { type: 'integer', notNull: true, references: 'portal_claim_periods', onDelete: 'CASCADE' },
        filler_email: { type: 'text', notNull: true },
        invite_token_hash: { type: 'text' },
        invite_sent_at: { type: 'timestamptz' },
        invite_opened_at: { type: 'timestamptz' },
        invite_delivered: { type: 'boolean', default: true },
        reminder_count: { type: 'integer', default: 0 },
        last_reminder_at: { type: 'timestamptz' },
        status: { type: 'text', notNull: true, default: 'invited' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.addConstraint('portal_claim_batches', 'portal_claim_batches_period_filler_uniq', {
        unique: ['period_id', 'filler_email'],
    });

    pgm.createTable('portal_claim_approver_packs', {
        id: { type: 'serial', primaryKey: true },
        period_id: { type: 'integer', notNull: true, references: 'portal_claim_periods', onDelete: 'CASCADE' },
        approver_email: { type: 'text', notNull: true },
        invite_token_hash: { type: 'text' },
        invite_sent_at: { type: 'timestamptz' },
        reminder_count: { type: 'integer', default: 0 },
        last_reminder_at: { type: 'timestamptz' },
        status: { type: 'text', notNull: true, default: 'pending' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.addConstraint('portal_claim_approver_packs', 'portal_claim_approver_packs_uniq', {
        unique: ['period_id', 'approver_email'],
    });

    pgm.createTable('portal_claim_submissions', {
        id: { type: 'serial', primaryKey: true },
        period_id: { type: 'integer', notNull: true, references: 'portal_claim_periods', onDelete: 'CASCADE' },
        batch_id: { type: 'integer', references: 'portal_claim_batches', onDelete: 'SET NULL' },
        employee_id: { type: 'text', notNull: true, references: 'employees', onDelete: 'CASCADE' },
        filler_email: { type: 'text', notNull: true },
        approver_email: { type: 'text' },
        status: { type: 'text', notNull: true, default: 'invited' },
        channel: { type: 'text', notNull: true, default: 'portal' },
        submitted_at: { type: 'timestamptz' },
        approved_at: { type: 'timestamptz' },
        rejected_at: { type: 'timestamptz' },
        approver_comment: { type: 'text' },
        approved_snapshot: { type: 'jsonb' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.addConstraint('portal_claim_submissions', 'portal_claim_submissions_period_emp_uniq', {
        unique: ['period_id', 'employee_id'],
    });
    pgm.createIndex('portal_claim_submissions', ['period_id', 'status']);
    pgm.createIndex('portal_claim_submissions', ['approver_email']);
    pgm.createIndex('portal_claim_submissions', ['channel']);

    pgm.createTable('portal_claim_items', {
        id: { type: 'serial', primaryKey: true },
        submission_id: { type: 'integer', notNull: true, references: 'portal_claim_submissions', onDelete: 'CASCADE' },
        claim_type: { type: 'text', notNull: true },
        claim_date: { type: 'date' },
        ot_hours: { type: 'numeric(8,2)' },
        ot_multiplier: { type: 'text' },
        ot_multiplier_factor: { type: 'numeric(4,2)' },
        amount: { type: 'numeric(12,2)' },
        description: { type: 'text' },
        expense_type: { type: 'text' },
        patient_name: { type: 'text' },
        time_from: { type: 'text' },
        time_to: { type: 'text' },
        nature: { type: 'text' },
        active: { type: 'boolean', default: true },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('portal_claim_items', ['submission_id']);

    pgm.createTable('portal_claim_attachments', {
        id: { type: 'serial', primaryKey: true },
        submission_id: { type: 'integer', notNull: true, references: 'portal_claim_submissions', onDelete: 'CASCADE' },
        item_id: { type: 'integer', references: 'portal_claim_items', onDelete: 'SET NULL' },
        filename: { type: 'text', notNull: true },
        mime_type: { type: 'text' },
        content_base64: { type: 'text' },
        byte_size: { type: 'integer' },
        uploaded_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        retain_until: { type: 'date', notNull: true },
    });
    pgm.createIndex('portal_claim_attachments', ['submission_id']);
    pgm.createIndex('portal_claim_attachments', ['retain_until']);

    pgm.createTable('claim_manual_overrides', {
        id: { type: 'serial', primaryKey: true },
        employee_id: { type: 'text', notNull: true, references: 'employees', onDelete: 'CASCADE' },
        period_month: { type: 'integer', notNull: true },
        period_year: { type: 'integer', notNull: true },
        ot1_hours: { type: 'numeric(8,2)', default: 0 },
        ot2_hours: { type: 'numeric(8,2)', default: 0 },
        ot3_hours: { type: 'numeric(8,2)', default: 0 },
        expense_amount: { type: 'numeric(12,2)', default: 0 },
        medical_amount: { type: 'numeric(12,2)', default: 0 },
        mode: { type: 'text', notNull: true },
        reason: { type: 'text', notNull: true },
        created_by: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        before_snapshot: { type: 'jsonb' },
        after_snapshot: { type: 'jsonb' },
        dry_run: { type: 'boolean', default: false },
        applied: { type: 'boolean', default: true },
    });
    pgm.createIndex('claim_manual_overrides', ['period_year', 'period_month', 'employee_id']);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropTable('claim_manual_overrides');
    pgm.dropTable('portal_claim_attachments');
    pgm.dropTable('portal_claim_items');
    pgm.dropTable('portal_claim_submissions');
    pgm.dropTable('portal_claim_approver_packs');
    pgm.dropTable('portal_claim_batches');
    pgm.dropTable('portal_claim_periods');
    pgm.sql(`ALTER TABLE employees DROP COLUMN IF EXISTS claim_authority`);
};
