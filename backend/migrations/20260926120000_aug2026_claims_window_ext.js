'use strict';

/**
 * August 2026 claims (September payroll) stay confirmable through 30 Sep 2026 23:59 PKT.
 * The screen uses the later of the contract calendar and these stored closes.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        UPDATE portal_claim_periods
           SET fill_close_at = GREATEST(fill_close_at, TIMESTAMPTZ '2026-09-30 18:59:59+00'),
               approve_close_at = GREATEST(approve_close_at, TIMESTAMPTZ '2026-09-30 18:59:59+00'),
               status = CASE WHEN status = 'fill_closed' THEN 'open' ELSE status END
         WHERE claim_month = 8
           AND claim_year = 2026
           AND COALESCE(campaign_mode, 'actual') <> 'sample'
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = () => {};
