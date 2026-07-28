/**
 * Idempotent — staging already had asil_bu / client_locations / client_departments
 * applied outside pgmigrations (server DDL drift), which blocked startup migrate.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    pgm.sql(`
        ALTER TABLE clients ADD COLUMN IF NOT EXISTS asil_bu TEXT;

        CREATE TABLE IF NOT EXISTS client_locations (
            id SERIAL PRIMARY KEY,
            client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL,
            name VARCHAR(200) NOT NULL,
            province VARCHAR(100),
            is_active BOOLEAN DEFAULT TRUE,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        DO $$ BEGIN
            ALTER TABLE client_locations
                ADD CONSTRAINT client_locations_client_name_uniq UNIQUE (client_id, name);
        EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
        END $$;

        CREATE INDEX IF NOT EXISTS client_locations_client_id_idx ON client_locations (client_id);

        CREATE TABLE IF NOT EXISTS client_departments (
            id SERIAL PRIMARY KEY,
            client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
            bu_id INTEGER REFERENCES client_business_units(id) ON DELETE SET NULL,
            location_id INTEGER REFERENCES client_locations(id) ON DELETE SET NULL,
            name VARCHAR(200) NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        DO $$ BEGIN
            ALTER TABLE client_departments
                ADD CONSTRAINT client_departments_client_name_uniq UNIQUE (client_id, name);
        EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
        END $$;

        CREATE INDEX IF NOT EXISTS client_departments_client_id_idx ON client_departments (client_id);
    `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql(`
        DROP TABLE IF EXISTS client_departments;
        DROP TABLE IF EXISTS client_locations;
        ALTER TABLE clients DROP COLUMN IF EXISTS asil_bu;
    `);
};
