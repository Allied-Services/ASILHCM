'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS payslip_delivery_batches (
            id SERIAL PRIMARY KEY,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            sent_by TEXT,
            sent_at TIMESTAMPTZ,
            employee_count INTEGER DEFAULT 0,
            email_count INTEGER DEFAULT 0,
            sms_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (year, month)
        );

        CREATE TABLE IF NOT EXISTS payslip_documents (
            id SERIAL PRIMARY KEY,
            employee_id TEXT NOT NULL,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            pdf_bytes BYTEA NOT NULL,
            content_hash TEXT NOT NULL,
            batch_id INTEGER REFERENCES payslip_delivery_batches(id) ON DELETE SET NULL,
            generated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (employee_id, year, month)
        );
        CREATE INDEX IF NOT EXISTS payslip_documents_emp_period_idx
            ON payslip_documents (employee_id, year, month);

        CREATE TABLE IF NOT EXISTS payslip_access_tokens (
            id SERIAL PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            employee_id TEXT NOT NULL,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            document_id INTEGER REFERENCES payslip_documents(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            access_count INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS payslip_access_tokens_hash_idx ON payslip_access_tokens (token_hash);

        CREATE TABLE IF NOT EXISTS payslip_delivery_log (
            id SERIAL PRIMARY KEY,
            batch_id INTEGER REFERENCES payslip_delivery_batches(id) ON DELETE CASCADE,
            employee_id TEXT NOT NULL,
            email_status TEXT,
            sms_status TEXT,
            token_id INTEGER REFERENCES payslip_access_tokens(id) ON DELETE SET NULL,
            error_detail TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS payslip_support_cases (
            id SERIAL PRIMARY KEY,
            case_no TEXT NOT NULL UNIQUE,
            employee_id TEXT NOT NULL,
            year INTEGER,
            month INTEGER,
            channel TEXT NOT NULL DEFAULT 'portal',
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            resolved_by TEXT,
            resolution_note TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            resolved_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS payslip_support_cases_status_idx ON payslip_support_cases (status);
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        DROP TABLE IF EXISTS payslip_delivery_log;
        DROP TABLE IF EXISTS payslip_access_tokens;
        DROP TABLE IF EXISTS payslip_documents;
        DROP TABLE IF EXISTS payslip_support_cases;
        DROP TABLE IF EXISTS payslip_delivery_batches;
    `);
};
