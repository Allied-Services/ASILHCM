'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
    pgm.sql('CREATE INDEX IF NOT EXISTS employees_directory_active_bu_client_idx ON employees (active, bu, client)');
    pgm.sql('CREATE INDEX IF NOT EXISTS employees_directory_contract_id_idx ON employees (contract_id)');
    pgm.sql('CREATE INDEX IF NOT EXISTS employees_directory_location_idx ON employees (location)');
    pgm.sql('CREATE INDEX IF NOT EXISTS employees_directory_dept_idx ON employees (dept)');
    pgm.sql('CREATE INDEX IF NOT EXISTS employees_directory_client_bu_idx ON employees (client_bu)');
    pgm.sql('CREATE INDEX IF NOT EXISTS employees_directory_name_lower_idx ON employees (LOWER(name))');
    pgm.sql('CREATE INDEX IF NOT EXISTS employees_directory_id_idx ON employees (id)');
    pgm.sql('CREATE INDEX IF NOT EXISTS employees_directory_cnic_idx ON employees (cnic)');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
    pgm.sql('DROP INDEX IF EXISTS employees_directory_active_bu_client_idx');
    pgm.sql('DROP INDEX IF EXISTS employees_directory_contract_id_idx');
    pgm.sql('DROP INDEX IF EXISTS employees_directory_location_idx');
    pgm.sql('DROP INDEX IF EXISTS employees_directory_dept_idx');
    pgm.sql('DROP INDEX IF EXISTS employees_directory_client_bu_idx');
    pgm.sql('DROP INDEX IF EXISTS employees_directory_name_lower_idx');
    pgm.sql('DROP INDEX IF EXISTS employees_directory_id_idx');
    pgm.sql('DROP INDEX IF EXISTS employees_directory_cnic_idx');
};
