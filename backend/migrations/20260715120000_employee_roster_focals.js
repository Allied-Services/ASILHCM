'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE employees
            ADD COLUMN IF NOT EXISTS supervisor_email VARCHAR(255),
            ADD COLUMN IF NOT EXISTS client_focal_emails TEXT;
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE employees
            DROP COLUMN IF EXISTS client_focal_emails,
            DROP COLUMN IF EXISTS supervisor_email;
    `);
};
