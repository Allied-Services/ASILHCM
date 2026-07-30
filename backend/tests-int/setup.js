'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

try {
  require('dotenv').config({ path: path.join(__dirname, '../.env.local'), override: false });
} catch (_) { /* optional */ }

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const CI_TEST_MARKERS = ['ci-test', 'ep-jolly-fire-adc2ygxa'];

if (!TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Use the Neon ci-test branch connection string.'
  );
}
if (!CI_TEST_MARKERS.some((m) => TEST_DATABASE_URL.includes(m))) {
  throw new Error(
    'Refusing to run integration tests: connection string must target the ci-test branch (never prod or staging).'
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
  connectionTimeoutMillis: 30000,
});

async function truncateAll() {
  const { rows } = await pool.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'pgmigrations'
  `);
  if (!rows.length) return;
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

beforeAll(async () => {
  if (!process.env.INT_SCHEMA_BOOTSTRAPPED) {
    throw new Error('Schema bootstrap did not run — check tests-int/globalSetup.js');
  }
}, 30000);

afterAll(async () => {
  await pool.end();
});

module.exports = {
  pool,
  truncateAll,
  TEST_DATABASE_URL,
};
