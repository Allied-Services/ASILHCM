'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`ALTER TABLE employee_claims ADD COLUMN IF NOT EXISTS focal_comment TEXT`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`ALTER TABLE employee_claims DROP COLUMN IF EXISTS focal_comment`);
};
