'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    // MD Mandate §4 — calendar working days + sheet override
    pgm.sql(`
        ALTER TABLE contract_policies
            ADD COLUMN IF NOT EXISTS use_calendar_working_days BOOLEAN DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS working_days_override INTEGER,
            ADD COLUMN IF NOT EXISTS sales_tax_rate NUMERIC(6,4),
            ADD COLUMN IF NOT EXISTS sales_tax_exempt BOOLEAN DEFAULT FALSE;
    `);

    // MD Mandate §5 — payment status change audit for EOD email
    pgm.createTable('payment_status_change_log', {
        id: { type: 'serial', primaryKey: true },
        invoice_id: { type: 'integer' },
        invoice_number: { type: 'text' },
        from_status: { type: 'text' },
        to_status: { type: 'text', notNull: true },
        changed_by: { type: 'text' },
        changed_at: { type: 'timestamptz', default: pgm.func('NOW()') },
        summarized_at: { type: 'timestamptz' },
    }, { ifNotExists: true });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropTable('payment_status_change_log', { ifExists: true });
    pgm.sql(`
        ALTER TABLE contract_policies
            DROP COLUMN IF EXISTS use_calendar_working_days,
            DROP COLUMN IF EXISTS working_days_override,
            DROP COLUMN IF EXISTS sales_tax_rate,
            DROP COLUMN IF EXISTS sales_tax_exempt;
    `);
};
