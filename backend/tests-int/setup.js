'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { runMigrations } = require('../src/core/runMigrations');

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Use the Neon ci-test branch connection string (must contain "ci-test").'
  );
}
if (!TEST_DATABASE_URL.includes('ci-test')) {
  throw new Error(
    'Refusing to run integration tests: connection string must contain "ci-test" (never prod or staging).'
  );
}

const ssl = TEST_DATABASE_URL.includes('localhost')
  ? false
  : { rejectUnauthorized: true };

const pool = new Pool({
  connectionString: TEST_DATABASE_URL,
  ssl,
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

let schemaReady = false;

async function applySchemaProd() {
  const schemaPath = path.join(__dirname, '../../audit/groundtruth/schema_prod.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Missing schema snapshot: ${schemaPath}`);
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query(sql);
}

async function ensureSchema() {
  if (schemaReady) return;
  await applySchemaProd();
  const prevUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  try {
    await runMigrations('up');
  } finally {
    process.env.DATABASE_URL = prevUrl;
  }
  schemaReady = true;
}

async function truncateAll() {
  const { rows } = await pool.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'pgmigrations'
  `);
  if (!rows.length) return;
  const names = rows.map(r => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

beforeAll(async () => {
  await ensureSchema();
}, 120000);

module.exports = {
  pool,
  truncateAll,
  TEST_DATABASE_URL,
};
