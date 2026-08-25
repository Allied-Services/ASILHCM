'use strict';

/**
 * Monthly Cycle contract pack: enabled claim types, collection mode, optional reviewer.
 * Wafi contracts keep OT + Expense + Medical (attendance off until PSO phase).
 */

const WAFI_CONTRACT_IDS = [
    'CTR-1773048704450',
    'CTR-1773048523696',
    'CTR-1773046722553',
];

const WAFI_ENABLED = '{OT,EXPENSE,MEDICAL}';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.addColumns('contract_claim_policies', {
        enabled_types: {
            type: 'text[]',
            notNull: true,
            default: pgm.func(`'{OT,EXPENSE,MEDICAL}'::text[]`),
        },
        collection_mode: {
            type: 'text',
            notNull: true,
            default: 'monthly_form',
            check: "collection_mode IN ('monthly_form', 'machine_file', 'daily_marks', 'mixed')",
        },
        reviewer_required: {
            type: 'boolean',
            notNull: true,
            default: false,
        },
    });

    pgm.addColumns('employees', {
        claims_reviewer_email: { type: 'text' },
    });

    for (const cid of WAFI_CONTRACT_IDS) {
        pgm.sql(`
            UPDATE contract_claim_policies
            SET enabled_types = '${WAFI_ENABLED}'::text[],
                collection_mode = 'monthly_form',
                reviewer_required = FALSE,
                updated_at = NOW()
            WHERE contract_id = '${cid}'
        `);
        pgm.sql(`
            INSERT INTO contract_claim_policies
                (contract_id, claims_pay_timing, submit_deadline_day, approve_deadline_day,
                 enabled_types, collection_mode, reviewer_required)
            SELECT '${cid}', 'following_month', 18, 22,
                   '${WAFI_ENABLED}'::text[], 'monthly_form', FALSE
            WHERE EXISTS (SELECT 1 FROM contracts WHERE id = '${cid}')
            ON CONFLICT (contract_id) DO UPDATE SET
                enabled_types = EXCLUDED.enabled_types,
                collection_mode = EXCLUDED.collection_mode,
                reviewer_required = EXCLUDED.reviewer_required,
                updated_at = NOW()
        `);
    }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropColumns('employees', ['claims_reviewer_email']);
    pgm.dropColumns('contract_claim_policies', ['enabled_types', 'collection_mode', 'reviewer_required']);
};
