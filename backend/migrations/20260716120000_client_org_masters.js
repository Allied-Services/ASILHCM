/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
    pgm.addColumns('clients', {
        asil_bu: { type: 'text' },
    });
    pgm.createTable('client_locations', {
        id: { type: 'serial', primaryKey: true },
        client_id: { type: 'text', notNull: true, references: 'clients', onDelete: 'CASCADE' },
        contract_id: { type: 'text', references: 'contracts', onDelete: 'SET NULL' },
        name: { type: 'varchar(200)', notNull: true },
        province: { type: 'varchar(100)' },
        is_active: { type: 'boolean', default: true },
        sort_order: { type: 'integer', default: 0 },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.addConstraint('client_locations', 'client_locations_client_name_uniq', {
        unique: ['client_id', 'name'],
    });
    pgm.createIndex('client_locations', ['client_id']);

    pgm.createTable('client_departments', {
        id: { type: 'serial', primaryKey: true },
        client_id: { type: 'text', notNull: true, references: 'clients', onDelete: 'CASCADE' },
        bu_id: { type: 'integer', references: 'client_business_units', onDelete: 'SET NULL' },
        location_id: { type: 'integer', references: 'client_locations', onDelete: 'SET NULL' },
        name: { type: 'varchar(200)', notNull: true },
        is_active: { type: 'boolean', default: true },
        sort_order: { type: 'integer', default: 0 },
        created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    });
    pgm.addConstraint('client_departments', 'client_departments_client_name_uniq', {
        unique: ['client_id', 'name'],
    });
    pgm.createIndex('client_departments', ['client_id']);
};

exports.down = (pgm) => {
    pgm.dropTable('client_departments');
    pgm.dropTable('client_locations');
    pgm.dropColumns('clients', ['asil_bu']);
};
