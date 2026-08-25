'use strict';

/** Portal Claims control desk — reopen audit + payroll push idempotency. */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE portal_claim_submissions
          ADD COLUMN IF NOT EXISTS lm_reopen_count INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS lm_reopen_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS lm_reopen_email_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS payroll_pushed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS payroll_pushed_by TEXT
    `);
    pgm.sql(`
        ALTER TABLE portal_claim_periods
          ADD COLUMN IF NOT EXISTS august_reopen_ran_at TIMESTAMPTZ
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE portal_claim_submissions
          DROP COLUMN IF EXISTS payroll_pushed_by,
          DROP COLUMN IF EXISTS payroll_pushed_at,
          DROP COLUMN IF EXISTS lm_reopen_email_at,
          DROP COLUMN IF EXISTS lm_reopen_at,
          DROP COLUMN IF EXISTS lm_reopen_count
    `);
    pgm.sql(`
        ALTER TABLE portal_claim_periods
          DROP COLUMN IF EXISTS august_reopen_ran_at
    `);
};
