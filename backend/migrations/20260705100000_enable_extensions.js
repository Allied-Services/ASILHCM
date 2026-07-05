'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql('CREATE EXTENSION IF NOT EXISTS pg_trgm');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql('DROP EXTENSION IF EXISTS pg_trgm');
};
