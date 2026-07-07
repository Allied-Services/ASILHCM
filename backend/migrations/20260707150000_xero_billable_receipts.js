'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.createTable('invoice_receipts', {
        id: { type: 'serial', primaryKey: true },
        client: { type: 'text', notNull: true },
        receipt_date: { type: 'date', notNull: true },
        bank_ref: { type: 'text' },
        total_cash: { type: 'numeric(14,2)', default: 0 },
        total_income_tax_wht: { type: 'numeric(14,2)', default: 0 },
        total_sales_tax_withheld: { type: 'numeric(14,2)', default: 0 },
        total_sales_tax_self_paid: { type: 'numeric(14,2)', default: 0 },
        posted_by: { type: 'text' },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });

    pgm.createTable('invoice_receipt_lines', {
        id: { type: 'serial', primaryKey: true },
        receipt_id: { type: 'integer', notNull: true, references: 'invoice_receipts', onDelete: 'CASCADE' },
        invoice_id: { type: 'integer', notNull: true },
        cash_received: { type: 'numeric(14,2)', default: 0 },
        income_tax_wht: { type: 'numeric(14,2)', default: 0 },
        sales_tax_withheld_by_client: { type: 'numeric(14,2)', default: 0 },
        sales_tax_self_paid: { type: 'numeric(14,2)', default: 0 },
    });

    pgm.sql(`ALTER TABLE contract_policies ADD COLUMN IF NOT EXISTS income_tax_wht_pct NUMERIC(5,2)`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.dropTable('invoice_receipt_lines');
    pgm.dropTable('invoice_receipts');
    pgm.sql(`ALTER TABLE contract_policies DROP COLUMN IF EXISTS income_tax_wht_pct`);
};
