'use strict';

/**
 * Old invoice-adjustment UI stored positive amounts as reductions.
 * New convention: + adds to the invoice, − deducts.
 * Flip any leftover positive manual rows so reprints stay credits.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE so_deductions
            ADD COLUMN IF NOT EXISTS note TEXT;

        UPDATE so_deductions
           SET amount = -amount
         WHERE source = 'manual'
           AND type IN ('adjustment', 'manual')
           AND amount > 0;
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        UPDATE so_deductions
           SET amount = -amount
         WHERE source = 'manual'
           AND type IN ('adjustment', 'manual')
           AND amount < 0;
    `);
};
