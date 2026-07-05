'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('projects', {
        id: { type: 'text', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        client_id: { type: 'text', notNull: true, references: 'clients', onDelete: 'CASCADE' },
        name: { type: 'text', notNull: true },
        site_code: { type: 'text' },
        city: { type: 'text' },
        province: { type: 'text' },
        is_critical_fm: { type: 'boolean', default: false },
        status: { type: 'text', notNull: true, default: 'active' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('projects', 'contract_id');
    pgm.createIndex('projects', 'client_id');

    pgm.sql(`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS intake_message_id INTEGER;
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS hours NUMERIC(8,2);
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS ot_hours NUMERIC(8,2);
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS raw_row JSONB;
        ALTER TABLE bills ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
    `);

    pgm.sql(`
        ALTER TABLE purchase_orders
        ALTER COLUMN contract_id TYPE TEXT USING contract_id::TEXT;
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE employees DROP COLUMN IF EXISTS project_id;
        ALTER TABLE attendance_records DROP COLUMN IF EXISTS project_id;
        ALTER TABLE attendance_records DROP COLUMN IF EXISTS source;
        ALTER TABLE attendance_records DROP COLUMN IF EXISTS intake_message_id;
        ALTER TABLE attendance_records DROP COLUMN IF EXISTS hours;
        ALTER TABLE attendance_records DROP COLUMN IF EXISTS ot_hours;
        ALTER TABLE attendance_records DROP COLUMN IF EXISTS raw_row;
        ALTER TABLE bills DROP COLUMN IF EXISTS project_id;
    `);
    pgm.dropTable('projects');
};
