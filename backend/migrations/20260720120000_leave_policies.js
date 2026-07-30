'use strict';

/**
 * Contract-level leave entitlement overrides.
 *
 * Pakistan government-mandated defaults are CL=10, ML=8, EL=14 days/year
 * (enforced in code, see backend/src/modules/leave/service.js DEFAULTS).
 * Some client contracts negotiate different entitlements — a row here
 * overrides the default for that contract_id. Absence of a row means the
 * contract uses the government default.
 *
 * Actual per-employee usage is tracked in the existing `employee_leave_balances`
 * table (created by backend/phase2Service.js setupPhase2Tables — predates the
 * node-pg-migrate migration convention, already live in production). This
 * migration does not touch that table; it only adds the policy override table
 * and lets backend/src/modules/leave/service.js resolve entitled = override
 * or default when seeding/reading balances.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('contract_leave_policies', {
        id: { type: 'serial', primaryKey: true },
        // contracts.id is TEXT (CTR-…) in prod/staging — all other contract_id FKs are text.
        contract_id: { type: 'text', notNull: true, references: 'contracts', onDelete: 'CASCADE' },
        cl_days: { type: 'integer', notNull: true, default: 10 },
        ml_days: { type: 'integer', notNull: true, default: 8 },
        el_days: { type: 'integer', notNull: true, default: 14 },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        updated_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.createIndex('contract_leave_policies', ['contract_id'], { unique: true });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropTable('contract_leave_policies');
};
