'use strict';

/**
 * Records spine: contract rulebook fields, contacts, region compliance,
 * machine-file drafts, input conflicts. Defaults reproduce current behaviour.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE contract_policies
            ADD COLUMN IF NOT EXISTS commercial_type TEXT,
            ADD COLUMN IF NOT EXISTS payroll_engine TEXT NOT NULL DEFAULT 'legacy',
            ADD COLUMN IF NOT EXISTS allied_contract_focal_email TEXT,
            ADD COLUMN IF NOT EXISTS dedicated_payroll_resource_email TEXT,
            ADD COLUMN IF NOT EXISTS routing_mode TEXT NOT NULL DEFAULT 'auto',
            ADD COLUMN IF NOT EXISTS overhead_per_employee NUMERIC(12,2),
            ADD COLUMN IF NOT EXISTS medical_in_cost BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS employer_pf_in_cost BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS sessi_basis TEXT NOT NULL DEFAULT 'salary_45k',
            ADD COLUMN IF NOT EXISTS proration_basis TEXT NOT NULL DEFAULT 'calendar_30',
            ADD COLUMN IF NOT EXISTS ot_applicable_tiers TEXT[] NOT NULL DEFAULT '{2x,3x}'
    `);

    pgm.sql(`
        UPDATE contract_policies SET commercial_type = CASE
            WHEN LOWER(COALESCE(billing_model, '')) IN ('service_order_deduction', 'fixed_value') THEN 'fixed_value'
            ELSE 'cost_plus'
        END
        WHERE commercial_type IS NULL
    `);

    pgm.sql(`
        UPDATE contract_policies p
        SET commercial_type = 'fixed_value'
        FROM contracts c
        WHERE c.id = p.contract_id
          AND p.commercial_type IS DISTINCT FROM 'fixed_value'
          AND (
            LOWER(COALESCE(c.service_type, '')) LIKE '%fixed value%'
            OR LOWER(COALESCE(c.service_type, '')) LIKE '%conservancy%'
            OR c.id LIKE 'CTR-PSO-%'
          )
    `);

    pgm.sql(`UPDATE contract_policies SET commercial_type = 'cost_plus' WHERE commercial_type IS NULL`);

    pgm.sql(`
        UPDATE contract_policies p
        SET allied_contract_focal_email = NULLIF(TRIM(c.allied_focal_email), '')
        FROM contracts c
        WHERE c.id = p.contract_id
          AND p.allied_contract_focal_email IS NULL
          AND c.allied_focal_email IS NOT NULL
    `);

    pgm.sql(`
        UPDATE contract_policies
        SET dedicated_payroll_resource_email = COALESCE(
            NULLIF(TRIM(dedicated_payroll_resource_email), ''),
            NULLIF(TRIM(allied_contract_focal_email), ''),
            'sadia.komal@asil.com.pk'
        )
        WHERE contract_id IN (
            'CTR-1773048704450', 'CTR-1773048523696', 'CTR-1773046722553'
        )
    `);

    pgm.sql(`
        ALTER TABLE contracts
            ADD COLUMN IF NOT EXISTS dedicated_payroll_resource_email TEXT,
            ADD COLUMN IF NOT EXISTS business_unit_id INTEGER
    `);

    pgm.sql(`
        CREATE TABLE IF NOT EXISTS region_compliance (
            id SERIAL PRIMARY KEY,
            region TEXT NOT NULL,
            effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
            effective_to DATE,
            min_wage NUMERIC(12,2),
            sales_tax_rate NUMERIC(6,4) NOT NULL,
            sessi_scheme TEXT NOT NULL DEFAULT 'sessi',
            eobi_flat NUMERIC(12,2) NOT NULL DEFAULT 400,
            notes TEXT,
            UNIQUE (region, effective_from)
        )
    `);

    pgm.sql(`
        INSERT INTO region_compliance (region, effective_from, min_wage, sales_tax_rate, sessi_scheme, eobi_flat)
        VALUES
            ('punjab', '2024-07-01', 37000, 0.16, 'sessi', 400),
            ('sindh', '2024-07-01', 37000, 0.15, 'sessi', 400),
            ('kpk', '2024-07-01', 37000, 0.15, 'sessi', 400),
            ('balochistan', '2024-07-01', 37000, 0.15, 'sessi', 400)
        ON CONFLICT (region, effective_from) DO NOTHING
    `);

    pgm.sql(`
        ALTER TABLE client_locations
            ADD COLUMN IF NOT EXISTS region TEXT
    `);

    pgm.sql(`
        UPDATE client_locations SET region = CASE
            WHEN LOWER(COALESCE(province, '')) LIKE '%punjab%' THEN 'punjab'
            WHEN LOWER(COALESCE(province, '')) LIKE '%sindh%' THEN 'sindh'
            WHEN LOWER(COALESCE(province, '')) LIKE '%kpk%'
              OR LOWER(COALESCE(province, '')) LIKE '%khyber%' THEN 'kpk'
            WHEN LOWER(COALESCE(province, '')) LIKE '%baloch%' THEN 'balochistan'
            ELSE region
        END
        WHERE region IS NULL
    `);

    pgm.sql(`
        CREATE TABLE IF NOT EXISTS org_contacts (
            id SERIAL PRIMARY KEY,
            name TEXT,
            email TEXT NOT NULL,
            phone TEXT,
            role TEXT NOT NULL,
            client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
            contract_id TEXT REFERENCES contracts(id) ON DELETE CASCADE,
            bu_id INTEGER,
            location_id INTEGER REFERENCES client_locations(id) ON DELETE SET NULL,
            employee_id TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    pgm.sql(`CREATE INDEX IF NOT EXISTS org_contacts_contract_idx ON org_contacts (contract_id, role)`);
    pgm.sql(`CREATE INDEX IF NOT EXISTS org_contacts_email_idx ON org_contacts (LOWER(email))`);

    pgm.sql(`
        CREATE TABLE IF NOT EXISTS cycle_file_imports (
            id SERIAL PRIMARY KEY,
            contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
            period_month INTEGER NOT NULL,
            period_year INTEGER NOT NULL,
            input_mode TEXT NOT NULL DEFAULT 'full_ledger',
            file_name TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            created_by TEXT,
            submitted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (contract_id, period_month, period_year, status)
        )
    `);

    pgm.sql(`
        CREATE TABLE IF NOT EXISTS cycle_file_rows (
            id SERIAL PRIMARY KEY,
            import_id INTEGER NOT NULL REFERENCES cycle_file_imports(id) ON DELETE CASCADE,
            employee_id TEXT,
            employee_name TEXT,
            present_days NUMERIC(8,2),
            absent_days NUMERIC(8,2),
            hours NUMERIC(8,2),
            ot2_hours NUMERIC(8,2),
            ot3_hours NUMERIC(8,2),
            notes TEXT,
            source_line INTEGER,
            matched BOOLEAN NOT NULL DEFAULT FALSE
        )
    `);

    pgm.sql(`
        CREATE TABLE IF NOT EXISTS payroll_input_conflicts (
            id SERIAL PRIMARY KEY,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            employee_id TEXT NOT NULL,
            field TEXT NOT NULL,
            source_a TEXT,
            value_a TEXT,
            source_b TEXT,
            value_b TEXT,
            resolved BOOLEAN NOT NULL DEFAULT FALSE,
            resolved_by TEXT,
            resolved_at TIMESTAMPTZ,
            UNIQUE (year, month, employee_id, field)
        )
    `);

    pgm.sql(`
        CREATE TABLE IF NOT EXISTS claim_import_batches (
            id SERIAL PRIMARY KEY,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            imported_by TEXT,
            employee_ids TEXT[],
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    pgm.sql(`
        ALTER TABLE employee_claims
            ADD COLUMN IF NOT EXISTS import_state TEXT,
            ADD COLUMN IF NOT EXISTS imported_by TEXT,
            ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS import_batch_id INTEGER
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`ALTER TABLE employee_claims DROP COLUMN IF EXISTS import_state`);
    pgm.sql(`ALTER TABLE employee_claims DROP COLUMN IF EXISTS imported_by`);
    pgm.sql(`ALTER TABLE employee_claims DROP COLUMN IF EXISTS imported_at`);
    pgm.sql(`ALTER TABLE employee_claims DROP COLUMN IF EXISTS import_batch_id`);
    pgm.sql(`DROP TABLE IF EXISTS claim_import_batches`);
    pgm.sql(`DROP TABLE IF EXISTS payroll_input_conflicts`);
    pgm.sql(`DROP TABLE IF EXISTS cycle_file_rows`);
    pgm.sql(`DROP TABLE IF EXISTS cycle_file_imports`);
    pgm.sql(`DROP TABLE IF EXISTS org_contacts`);
    pgm.sql(`DROP TABLE IF EXISTS region_compliance`);
    pgm.sql(`
        ALTER TABLE contract_policies
            DROP COLUMN IF EXISTS commercial_type,
            DROP COLUMN IF EXISTS payroll_engine,
            DROP COLUMN IF EXISTS allied_contract_focal_email,
            DROP COLUMN IF EXISTS dedicated_payroll_resource_email,
            DROP COLUMN IF EXISTS routing_mode,
            DROP COLUMN IF EXISTS overhead_per_employee,
            DROP COLUMN IF EXISTS medical_in_cost,
            DROP COLUMN IF EXISTS employer_pf_in_cost,
            DROP COLUMN IF EXISTS sessi_basis,
            DROP COLUMN IF EXISTS proration_basis,
            DROP COLUMN IF EXISTS ot_applicable_tiers
    `);
};
