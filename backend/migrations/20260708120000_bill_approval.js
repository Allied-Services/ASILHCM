'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS bill_approval_steps (
            id SERIAL PRIMARY KEY,
            bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
            step_number INTEGER NOT NULL,
            approver_email TEXT NOT NULL,
            approver_name TEXT,
            token_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            comment TEXT,
            decided_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (bill_id, step_number, approver_email)
        );
        CREATE INDEX IF NOT EXISTS bill_approval_steps_bill_id_idx ON bill_approval_steps (bill_id);
    `);

    pgm.sql(`
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'draft';
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS approval_submitted_by TEXT;
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS approval_submitted_at TIMESTAMPTZ;
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS approval_focal_account TEXT;
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS approval_completed_at TIMESTAMPTZ;
    `);

    pgm.sql(`
        INSERT INTO system_config (key, value) VALUES ('bill_approval_rules', '{"threshold_pkr":100000,"step2_under":{"name":"Asif Awan","email":"asif.awan@asil.com.pk"},"step2_over_equal":{"name":"Shezad Mumtaz","email":"shezad.mumtaz@asil.com.pk"},"focal_token_ttl_days":14,"site_rules":[{"site":"Bhakkar","account_code":"FM-106","focal_submitters":[{"email":"muhammad.anees@wafi-energy.com","name":"Muhammad Anees"},{"email":"laiba.mughal@asil.com.pk","name":"Laiba Mughal"}],"step1_approvers":[{"email":"fayyaz.f.ahmed@wafi-energy.com","name":"Fayyaz Ahmed"}]}]}'::jsonb)
        ON CONFLICT (key) DO NOTHING;
        INSERT INTO system_config (key, value) VALUES ('BILL_APPROVAL_DRY_RUN', 'true'::jsonb)
        ON CONFLICT (key) DO NOTHING;
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`DELETE FROM system_config WHERE key IN ('bill_approval_rules', 'BILL_APPROVAL_DRY_RUN');`);
    pgm.sql(`
        ALTER TABLE bills DROP COLUMN IF EXISTS approval_completed_at;
        ALTER TABLE bills DROP COLUMN IF EXISTS approval_focal_account;
        ALTER TABLE bills DROP COLUMN IF EXISTS approval_submitted_at;
        ALTER TABLE bills DROP COLUMN IF EXISTS approval_submitted_by;
        ALTER TABLE bills DROP COLUMN IF EXISTS approval_status;
    `);
    pgm.sql(`DROP TABLE IF EXISTS bill_approval_steps;`);
};
