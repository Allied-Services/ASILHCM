'use strict';

/**
 * Calendar & pay timing is optional per contract.
 * Deadlines are added only when they apply, and may land in the
 * current claim month or the following month.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.addColumns('contract_claim_policies', {
        calendar_apply: {
            type: 'boolean',
            notNull: true,
            default: false,
        },
        submit_deadline_month: {
            type: 'text',
            notNull: true,
            default: 'following_month',
            check: "submit_deadline_month IN ('current_month', 'following_month')",
        },
        approve_deadline_month: {
            type: 'text',
            notNull: true,
            default: 'following_month',
            check: "approve_deadline_month IN ('current_month', 'following_month')",
        },
    });

    pgm.alterColumn('contract_claim_policies', 'submit_deadline_day', {
        notNull: false,
        default: null,
    });
    pgm.alterColumn('contract_claim_policies', 'approve_deadline_day', {
        notNull: false,
        default: null,
    });

    // Existing packs already have day defaults — keep them applied.
    pgm.sql(`
        UPDATE contract_claim_policies
        SET calendar_apply = TRUE,
            submit_deadline_month = CASE
                WHEN claims_pay_timing = 'same_month' THEN 'current_month'
                ELSE 'following_month'
            END,
            approve_deadline_month = CASE
                WHEN claims_pay_timing = 'same_month' THEN 'current_month'
                ELSE 'following_month'
            END,
            updated_at = NOW()
        WHERE submit_deadline_day IS NOT NULL
           OR approve_deadline_day IS NOT NULL
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        UPDATE contract_claim_policies
        SET submit_deadline_day = COALESCE(submit_deadline_day, 18),
            approve_deadline_day = COALESCE(approve_deadline_day, 22)
    `);
    pgm.alterColumn('contract_claim_policies', 'submit_deadline_day', {
        notNull: true,
        default: 18,
    });
    pgm.alterColumn('contract_claim_policies', 'approve_deadline_day', {
        notNull: true,
        default: 22,
    });
    pgm.dropColumns('contract_claim_policies', [
        'calendar_apply',
        'submit_deadline_month',
        'approve_deadline_month',
    ]);
};
