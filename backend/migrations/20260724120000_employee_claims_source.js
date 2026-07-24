'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE employee_claims ADD COLUMN IF NOT EXISTS source_kind TEXT`);
    pgm.sql(`ALTER TABLE employee_claims ADD COLUMN IF NOT EXISTS source_session_id INTEGER`);
    pgm.sql(`ALTER TABLE employee_claims ADD COLUMN IF NOT EXISTS source_ref TEXT`);
    pgm.sql(`
        CREATE UNIQUE INDEX IF NOT EXISTS employee_claims_wafi_source_uniq
        ON employee_claims (source_kind, source_session_id, employee_id, claim_type)
        WHERE source_kind IS NOT NULL
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql('DROP INDEX IF EXISTS employee_claims_wafi_source_uniq');
    pgm.sql('ALTER TABLE employee_claims DROP COLUMN IF EXISTS source_ref');
    pgm.sql('ALTER TABLE employee_claims DROP COLUMN IF EXISTS source_session_id');
    pgm.sql('ALTER TABLE employee_claims DROP COLUMN IF EXISTS source_kind');
};
