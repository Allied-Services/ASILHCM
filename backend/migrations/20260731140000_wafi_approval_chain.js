'use strict';

/** P3 — Wafi focal → LM → HCM approval chain */
exports.up = (pgm) => {
    pgm.addColumns('wafi_claims_sessions', {
        approval_state: { type: 'text', default: null },
        routing_profile: { type: 'text', default: null },
        lm_email: { type: 'text', default: null },
        focal_email: { type: 'text', default: null },
        focal_token_hash: { type: 'text', default: null },
        lm_token_hash: { type: 'text', default: null },
        wafi_approval_chain_enabled: { type: 'boolean', default: true },
    });

    pgm.createTable('wafi_claims_approval_events', {
        id: 'id',
        session_id: { type: 'integer', notNull: true, references: 'wafi_claims_sessions', onDelete: 'CASCADE' },
        step: { type: 'text', notNull: true },
        actor_email: { type: 'text' },
        decision: { type: 'text', notNull: true },
        comment: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });

    pgm.createIndex('wafi_claims_approval_events', 'session_id');

    pgm.sql(`
        INSERT INTO system_config (key, value) VALUES
            ('wafi_approval_chain_enabled', 'true'::jsonb)
        ON CONFLICT (key) DO NOTHING;
    `);

    // Grandfather in-flight sessions at deploy
    pgm.sql(`
        UPDATE wafi_claims_sessions
        SET approval_state = 'legacy_bypass',
            routing_profile = 'legacy'
        WHERE approval_state IS NULL
          AND processing_status IN ('VERIFIED', 'PROCESSED_SUCCESSFULLY', 'PENDING_REVIEW', 'VALIDATION_FAILED');
    `);
};

exports.down = (pgm) => {
    pgm.dropTable('wafi_claims_approval_events');
    pgm.dropColumns('wafi_claims_sessions', [
        'approval_state', 'routing_profile', 'lm_email', 'focal_email',
        'focal_token_hash', 'lm_token_hash', 'wafi_approval_chain_enabled',
    ]);
    pgm.sql(`DELETE FROM system_config WHERE key = 'wafi_approval_chain_enabled';`);
};
