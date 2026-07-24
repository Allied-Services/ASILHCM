'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { Pool } = require('pg');
const { applyRuntimeDdl } = require('./helpers/runtimeDdl');

const execFileAsync = promisify(execFile);

async function runMigrationsOnClient(client) {
  let migrateFn;
  try {
    const mod = require('node-pg-migrate');
    migrateFn = mod.default || mod;
  } catch {
    return;
  }
  const migrationsDir = path.join(__dirname, '../migrations');
  await client.query('SET search_path TO public');
  await migrateFn({
    dbClient: client,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => {},
  });
}

/** Prod snapshot already includes DDL from applied migrations — mark them recorded. */
async function seedPgmigrations(client) {
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js')).sort();
  const skipFrom = '20260724120000_employee_claims_source.js';
  const skipIdx = files.indexOf(skipFrom);
  const toSeed = skipIdx >= 0 ? files.slice(0, skipIdx) : files;

  for (const file of toSeed) {
    const name = file.replace(/\.js$/, '');
    await client.query(
      `INSERT INTO pgmigrations (name, run_on)
       SELECT $1::varchar, NOW()
       WHERE NOT EXISTS (SELECT 1 FROM pgmigrations WHERE name = $1::varchar)`,
      [name]
    );
  }
}

async function runPendingMigrations(client) {
  await runMigrationsOnClient(client);
}

module.exports = async () => {
  try {
    require('dotenv').config({ path: path.join(__dirname, '../.env.local'), override: false });
  } catch (_) { /* optional */ }

  const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  const CI_TEST_MARKERS = ['ci-test', 'ep-jolly-fire-adc2ygxa'];
  if (!TEST_DATABASE_URL || !CI_TEST_MARKERS.some((m) => TEST_DATABASE_URL.includes(m))) {
    throw new Error('TEST_DATABASE_URL must target the Neon ci-test branch.');
  }

  const ssl = TEST_DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: true };
  const pool = new Pool({
    connectionString: TEST_DATABASE_URL,
    ssl,
    max: 2,
    connectionTimeoutMillis: 30000,
  });

  const schemaFile = path.join(__dirname, '../../database/schema.sql');
  const psql = process.env.PSQL_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';

  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('GRANT ALL ON SCHEMA public TO PUBLIC');
  await pool.query('SET search_path TO public');

  if (fs.existsSync(psql)) {
    await execFileAsync(psql, [TEST_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-f', schemaFile], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } else {
    const sql = fs.readFileSync(schemaFile, 'utf8').split('\n').filter((l) => !l.startsWith('\\')).join('\n');
    await pool.query(sql);
  }

  const prevUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO public');
    await seedPgmigrations(client);
    await runPendingMigrations(client);
    await applyRuntimeDdl(pool);
  } finally {
    client.release();
    process.env.DATABASE_URL = prevUrl;
  }

  await pool.end();
  process.env.INT_SCHEMA_BOOTSTRAPPED = '1';
};
