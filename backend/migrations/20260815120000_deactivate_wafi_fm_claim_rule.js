'use strict';

/** Campaign audience is chosen on the send screen (client / contract / dept / location). */
/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        UPDATE claim_eligibility_rules
        SET active = FALSE,
            notes = COALESCE(notes, '') || ' — deactivated 2026-08-15; send-screen filters replace this gate',
            updated_at = NOW()
        WHERE name = 'Wafi BPO — exclude Facility Management'
          AND active = TRUE
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        UPDATE claim_eligibility_rules
        SET active = TRUE, updated_at = NOW()
        WHERE name = 'Wafi BPO — exclude Facility Management'
    `);
};
