'use strict';

/**
 * P1 — Freeze client / contract_name / locked_net onto payroll_transactions at lock time.
 * Additive only; net is never mutated. Downstream sessions (P2+) read these columns.
 */
exports.up = (pgm) => {
    pgm.addColumns('payroll_transactions', {
        client: { type: 'text', notNull: false },
        contract_name: { type: 'text', notNull: false },
        locked_net: { type: 'numeric(12,2)', notNull: false },
    });
    pgm.createIndex('payroll_transactions', ['year', 'month', 'client', 'contract_name'], {
        name: 'payroll_transactions_scope_idx',
        ifNotExists: true,
    });
};

exports.down = (pgm) => {
    pgm.dropIndex('payroll_transactions', ['year', 'month', 'client', 'contract_name'], {
        name: 'payroll_transactions_scope_idx',
        ifExists: true,
    });
    pgm.dropColumns('payroll_transactions', ['client', 'contract_name', 'locked_net']);
};
