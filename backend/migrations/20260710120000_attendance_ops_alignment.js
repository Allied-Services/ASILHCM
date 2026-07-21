'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE attendance_records
            ADD COLUMN IF NOT EXISTS hours NUMERIC(6,2),
            ADD COLUMN IF NOT EXISTS ot_hours NUMERIC(6,2) DEFAULT 0;

        CREATE TABLE IF NOT EXISTS project_client_focals (
            id              SERIAL PRIMARY KEY,
            project_id      TEXT,
            site            TEXT,
            department      TEXT,
            client          TEXT,
            contract_id     TEXT,
            focal_emails    TEXT[] NOT NULL DEFAULT '{}',
            supervisor_email TEXT,
            active          BOOLEAN DEFAULT TRUE,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_pcf_site ON project_client_focals (site);
        CREATE INDEX IF NOT EXISTS idx_pcf_contract ON project_client_focals (contract_id);
        CREATE INDEX IF NOT EXISTS idx_pcf_supervisor ON project_client_focals (supervisor_email);

        CREATE TABLE IF NOT EXISTS monthly_attendance_overrides (
            id              SERIAL PRIMARY KEY,
            employee_id     TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            period_month    INT NOT NULL,
            period_year     INT NOT NULL,
            present_days    NUMERIC(6,2),
            ot2_hours       NUMERIC(8,2) DEFAULT 0,
            ot3_hours       NUMERIC(8,2) DEFAULT 0,
            opd             NUMERIC(12,2) DEFAULT 0,
            expense         NUMERIC(12,2) DEFAULT 0,
            arrears         NUMERIC(12,2) DEFAULT 0,
            special_allowance NUMERIC(12,2) DEFAULT 0,
            fuel_mobile     NUMERIC(12,2) DEFAULT 0,
            other_deduction NUMERIC(12,2) DEFAULT 0,
            source          TEXT DEFAULT 'monthly_hub_import',
            updated_by      TEXT,
            updated_at      TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (employee_id, period_month, period_year)
        );
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        DROP TABLE IF EXISTS monthly_attendance_overrides;
        DROP TABLE IF EXISTS project_client_focals;
        ALTER TABLE attendance_records
            DROP COLUMN IF EXISTS hours,
            DROP COLUMN IF EXISTS ot_hours;
    `);
};
