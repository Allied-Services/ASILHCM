'use strict';

/** Distinguish filler-confirmed no claims vs deadline auto-close. */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE portal_claim_submissions
          ADD COLUMN IF NOT EXISTS no_claims_kind TEXT
    `);
    pgm.sql(`
        UPDATE portal_claim_submissions s
           SET no_claims_kind = 'auto_closed'
          FROM portal_claim_batches b
         WHERE s.batch_id = b.id
           AND s.status = 'no_claims'
           AND s.no_claims_kind IS NULL
           AND b.invite_opened_at IS NULL
    `);
    pgm.sql(`
        UPDATE portal_claim_submissions
           SET no_claims_kind = 'confirmed'
         WHERE status = 'no_claims'
           AND no_claims_kind IS NULL
    `);
};

exports.down = (pgm) => {
    pgm.sql(`
        ALTER TABLE portal_claim_submissions
          DROP COLUMN IF EXISTS no_claims_kind
    `);
};
