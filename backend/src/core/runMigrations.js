'use strict';

const path = require('path');

async function runMigrations(direction = 'up') {
    if (!process.env.DATABASE_URL) {
        console.warn('[migrate] DATABASE_URL not set — skipping migrations');
        return;
    }

    let migrateFn;
    try {
        const mod = require('node-pg-migrate');
        migrateFn = mod.default || mod;
    } catch {
        console.warn('[migrate] node-pg-migrate not installed — running SQL bootstrap only');
        await runSqlBootstrap();
        return;
    }

    const migrationsDir = path.join(__dirname, '../../migrations');
    const ssl = process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false };

    await migrateFn({
        databaseUrl: {
            connectionString: process.env.DATABASE_URL,
            ssl,
        },
        dir: migrationsDir,
        direction,
        migrationsTable: 'pgmigrations',
        log: console.log,
    });
}

async function runSqlBootstrap() {
    const { getPool } = require('./db');
    const pool = getPool();
    const fs = require('fs');
    const dir = path.join(__dirname, '../../migrations');
    if (!fs.existsSync(dir)) return;
    console.warn('[migrate] Fallback bootstrap skipped — install node-pg-migrate for full schema');
}

if (require.main === module) {
    const direction = process.argv[2] === 'down' ? 'down' : 'up';
    runMigrations(direction)
        .then(() => {
            console.log(`[migrate] ${direction} complete`);
            process.exit(0);
        })
        .catch(err => {
            console.error('[migrate] failed', err);
            process.exit(1);
        });
}

module.exports = { runMigrations };
