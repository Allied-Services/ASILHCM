'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('intake_messages', {
        id: { type: 'serial', primaryKey: true },
        channel: { type: 'text', notNull: true, default: 'imap' },
        mailbox: { type: 'text' },
        message_uid: { type: 'text' },
        from_address: { type: 'text' },
        subject: { type: 'text' },
        received_at: { type: 'timestamptz' },
        body_text: { type: 'text' },
        attachments: { type: 'jsonb', default: pgm.func("'[]'::jsonb") },
        classification: { type: 'text', default: 'unknown' },
        status: { type: 'text', notNull: true, default: 'new' },
        error: { type: 'text' },
        ack_sent_at: { type: 'timestamptz' },
        ack_reference: { type: 'text' },
        processed_at: { type: 'timestamptz' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    });
    pgm.createIndex('intake_messages', 'status');
    pgm.createIndex('intake_messages', 'classification');
    pgm.createIndex('intake_messages', ['mailbox', 'message_uid'], { unique: true, where: 'message_uid IS NOT NULL' });

    pgm.createTable('inbox_rules', {
        id: { type: 'serial', primaryKey: true },
        sender_pattern: { type: 'text', notNull: true },
        subject_pattern: { type: 'text' },
        event_type: { type: 'text', notNull: true },
        client_id: { type: 'text', references: 'clients', onDelete: 'SET NULL' },
        priority: { type: 'text', default: 'normal' },
        auto_action: { type: 'text', default: 'log_only' },
        active: { type: 'boolean', notNull: true, default: true },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('response_sla_tracker', {
        id: { type: 'serial', primaryKey: true },
        intake_message_id: { type: 'integer', references: 'intake_messages', onDelete: 'CASCADE' },
        category: { type: 'text', notNull: true },
        sla_hours: { type: 'integer', notNull: true, default: 48 },
        owner_email: { type: 'text' },
        first_response_at: { type: 'timestamptz' },
        resolved_at: { type: 'timestamptz' },
        status: { type: 'text', notNull: true, default: 'within_sla' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropTable('response_sla_tracker');
    pgm.dropTable('inbox_rules');
    pgm.dropTable('intake_messages');
};
