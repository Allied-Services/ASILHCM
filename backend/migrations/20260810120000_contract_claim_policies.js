'use strict';

/**
 * Per-contract claims calendar and payroll settlement rules.
 * Wafi default: following_month pay, submit by 17th, LM approve by 22nd of claim month.
 */

const WAFI_CONTRACT_IDS = [
    'CTR-1773048704450',
    'CTR-1773048523696',
];

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('contract_claim_policies', {
        id: { type: 'serial', primaryKey: true },
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        claims_pay_timing: {
            type: 'text',
            notNull: true,
            default: 'following_month',
            check: "claims_pay_timing IN ('following_month', 'same_month')",
        },
        submit_deadline_day: { type: 'integer', notNull: true, default: 17 },
        approve_deadline_day: { type: 'integer', notNull: true, default: 22 },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('contract_claim_policies', ['contract_id'], { unique: true });

    for (const cid of WAFI_CONTRACT_IDS) {
        pgm.sql(`
            INSERT INTO contract_claim_policies (contract_id, claims_pay_timing, submit_deadline_day, approve_deadline_day)
            SELECT '${cid}', 'following_month', 17, 22
            WHERE EXISTS (SELECT 1 FROM contracts WHERE id = '${cid}')
            ON CONFLICT (contract_id) DO NOTHING
        `);
    }
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropTable('contract_claim_policies');
};
