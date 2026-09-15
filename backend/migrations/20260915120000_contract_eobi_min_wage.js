'use strict';

/**
 * Contract Rulebook EOBI minimum wage.
 * Employee share = 1% of min wage; employer share = 5%.
 * Null falls back to Rs. 40,000 (Punjab / KPK). Sindh-ish contracts seed to 43,000.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE contract_policies
            ADD COLUMN IF NOT EXISTS eobi_min_wage NUMERIC(12,2)
    `);

    pgm.sql(`
        UPDATE contract_policies p
        SET eobi_min_wage = 43000
        FROM contracts c
        WHERE c.id = p.contract_id
          AND p.eobi_min_wage IS NULL
          AND (
            LOWER(COALESCE(c.region_province, '')) LIKE '%sindh%'
            OR LOWER(COALESCE(c.region_province, '')) LIKE '%karachi%'
            OR LOWER(COALESCE(c.location, '')) LIKE '%sindh%'
            OR LOWER(COALESCE(c.location, '')) LIKE '%karachi%'
            OR LOWER(COALESCE(c.contract_name, '')) LIKE '%wafi%'
          )
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`ALTER TABLE contract_policies DROP COLUMN IF EXISTS eobi_min_wage`);
};
