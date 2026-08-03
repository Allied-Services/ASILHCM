'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.addColumns('payroll_transactions', {
        remarks: { type: 'text', notNull: false },
    });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropColumns('payroll_transactions', ['remarks']);
};
