'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`CREATE TABLE IF NOT EXISTS invoice_receipts (
        id SERIAL PRIMARY KEY,
        client TEXT NOT NULL,
        receipt_date DATE NOT NULL,
        bank_ref TEXT,
        total_cash NUMERIC(14,2) DEFAULT 0,
        total_income_tax_wht NUMERIC(14,2) DEFAULT 0,
        total_sales_tax_withheld NUMERIC(14,2) DEFAULT 0,
        total_sales_tax_self_paid NUMERIC(14,2) DEFAULT 0,
        posted_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`);

    pgm.sql(`CREATE TABLE IF NOT EXISTS invoice_receipt_lines (
        id SERIAL PRIMARY KEY,
        receipt_id INTEGER NOT NULL REFERENCES invoice_receipts(id) ON DELETE CASCADE,
        invoice_id INTEGER NOT NULL,
        cash_received NUMERIC(14,2) DEFAULT 0,
        income_tax_wht NUMERIC(14,2) DEFAULT 0,
        sales_tax_withheld_by_client NUMERIC(14,2) DEFAULT 0,
        sales_tax_self_paid NUMERIC(14,2) DEFAULT 0
    )`);

    pgm.sql(`ALTER TABLE contract_policies ADD COLUMN IF NOT EXISTS income_tax_wht_pct NUMERIC(5,2)`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`DROP TABLE IF EXISTS invoice_receipt_lines`);
    pgm.sql(`DROP TABLE IF EXISTS invoice_receipts`);
    pgm.sql(`ALTER TABLE contract_policies DROP COLUMN IF EXISTS income_tax_wht_pct`);
};
