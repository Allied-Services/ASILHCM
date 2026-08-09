'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('claim_eligibility_rules', {
        id: { type: 'serial', primaryKey: true },
        name: { type: 'text', notNull: true },
        priority: { type: 'integer', notNull: true, default: 100 },
        active: { type: 'boolean', notNull: true, default: true },
        client_pattern: { type: 'text' },
        contract_id: { type: 'text' },
        dept_include: { type: 'text[]', default: '{}' },
        dept_exclude: { type: 'text[]', default: '{}' },
        eligible: { type: 'boolean', notNull: true, default: true },
        allowed_claim_types: { type: 'text[]', default: "{OT,EXPENSE,MEDICAL}" },
        effective_from: { type: 'date' },
        effective_to: { type: 'date' },
        notes: { type: 'text' },
        created_by: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('claim_eligibility_rules', ['active', 'priority']);

    pgm.sql(`
        INSERT INTO claim_eligibility_rules
            (name, priority, active, client_pattern, dept_exclude, eligible, allowed_claim_types, notes)
        SELECT 'Wafi BPO — exclude Facility Management', 10, TRUE, 'wafi', ARRAY['Facility Management']::text[], TRUE,
               ARRAY['OT','EXPENSE','MEDICAL']::text[],
               'Default August 2026 rollout: Wafi client employees except FM department'
        WHERE NOT EXISTS (
            SELECT 1 FROM claim_eligibility_rules WHERE name = 'Wafi BPO — exclude Facility Management'
        )
    `);

    pgm.sql(`ALTER TABLE portal_claim_periods ADD COLUMN IF NOT EXISTS campaign_mode TEXT NOT NULL DEFAULT 'actual'`);
    pgm.sql(`ALTER TABLE portal_claim_periods ADD COLUMN IF NOT EXISTS eligibility_snapshot JSONB`);
    pgm.sql(`ALTER TABLE portal_claim_batches ADD COLUMN IF NOT EXISTS routing_profile TEXT`);
    pgm.sql(`ALTER TABLE portal_claim_batches ADD COLUMN IF NOT EXISTS cohort_type TEXT DEFAULT 'focal'`);
    pgm.sql(`ALTER TABLE portal_claim_submissions ADD COLUMN IF NOT EXISTS routing_profile TEXT`);
    pgm.sql(`ALTER TABLE portal_claim_submissions ADD COLUMN IF NOT EXISTS submit_snapshot JSONB`);
    pgm.sql(`ALTER TABLE portal_claim_submissions ADD COLUMN IF NOT EXISTS submitted_locked_at TIMESTAMPTZ`);

    pgm.createTable('portal_claim_batch_attachments', {
        id: { type: 'serial', primaryKey: true },
        batch_id: { type: 'integer', notNull: true, references: 'portal_claim_batches', onDelete: 'CASCADE' },
        category: { type: 'text', notNull: true },
        filename: { type: 'text', notNull: true },
        mime_type: { type: 'text' },
        content_base64: { type: 'text' },
        byte_size: { type: 'integer' },
        uploaded_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.addConstraint('portal_claim_batch_attachments', 'portal_claim_batch_attachments_batch_cat_uniq', {
        unique: ['batch_id', 'category'],
    });

    pgm.sql(`
        INSERT INTO system_config (key, value) VALUES ('wafi_gmail_intake_enabled', 'false'::jsonb)
        ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`DELETE FROM system_config WHERE key = 'wafi_gmail_intake_enabled'`);
    pgm.dropTable('portal_claim_batch_attachments');
    pgm.sql(`ALTER TABLE portal_claim_submissions DROP COLUMN IF EXISTS submitted_locked_at`);
    pgm.sql(`ALTER TABLE portal_claim_submissions DROP COLUMN IF EXISTS submit_snapshot`);
    pgm.sql(`ALTER TABLE portal_claim_submissions DROP COLUMN IF EXISTS routing_profile`);
    pgm.sql(`ALTER TABLE portal_claim_batches DROP COLUMN IF EXISTS cohort_type`);
    pgm.sql(`ALTER TABLE portal_claim_batches DROP COLUMN IF EXISTS routing_profile`);
    pgm.sql(`ALTER TABLE portal_claim_periods DROP COLUMN IF EXISTS eligibility_snapshot`);
    pgm.sql(`ALTER TABLE portal_claim_periods DROP COLUMN IF EXISTS campaign_mode`);
    pgm.dropTable('claim_eligibility_rules');
};
