'use strict';

/**
 * Typed payroll input ledger. Writers still keep their current tables;
 * the Review Desk, Excel, and Push read this.
 */
exports.up = async (pgm) => {
    pgm.sql(`
        CREATE TABLE IF NOT EXISTS payroll_input_ledger (
            id              SERIAL PRIMARY KEY,
            employee_id     TEXT NOT NULL,
            contract_id     TEXT,
            work_month      INT NOT NULL,
            work_year       INT NOT NULL,
            pay_month       INT NOT NULL,
            pay_year        INT NOT NULL,
            item_type       TEXT NOT NULL,
            present_days    NUMERIC(8,2),
            absent_days     NUMERIC(8,2),
            hours           NUMERIC(10,2),
            amount          NUMERIC(14,2),
            status          TEXT NOT NULL DEFAULT 'approved',
            source          TEXT NOT NULL,
            source_ref      TEXT,
            approved_by     TEXT,
            approved_via    TEXT,
            reason          TEXT,
            created_by      TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT payroll_input_ledger_type_chk CHECK (
                item_type IN (
                    'ATTENDANCE', 'OT', 'EXPENSE', 'MEDICAL',
                    'DEDUCTION', 'ARREARS', 'SPECIAL_ALLOWANCE'
                )
            ),
            CONSTRAINT payroll_input_ledger_status_chk CHECK (
                status IN (
                    'draft', 'submitted', 'approved', 'rejected',
                    'pushed', 'locked'
                )
            )
        )
    `);
    pgm.sql(`
        CREATE UNIQUE INDEX IF NOT EXISTS payroll_input_ledger_uniq
        ON payroll_input_ledger (employee_id, work_year, work_month, item_type, source)
    `);
    pgm.sql(`
        CREATE INDEX IF NOT EXISTS payroll_input_ledger_contract_idx
        ON payroll_input_ledger (contract_id, work_year, work_month)
    `);
    pgm.sql(`
        CREATE INDEX IF NOT EXISTS payroll_input_ledger_pay_idx
        ON payroll_input_ledger (pay_year, pay_month, employee_id)
    `);
};

exports.down = async (pgm) => {
    pgm.sql('DROP TABLE IF EXISTS payroll_input_ledger');
};
