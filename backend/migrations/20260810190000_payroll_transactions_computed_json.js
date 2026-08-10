'use strict';

/** Persist full server payroll calc snapshot for Payroll Sheet display (no browser math). */
exports.up = (pgm) => {
    pgm.addColumns('payroll_transactions', {
        computed_json: { type: 'jsonb', notNull: false },
    });
};

exports.down = (pgm) => {
    pgm.dropColumns('payroll_transactions', ['computed_json']);
};
