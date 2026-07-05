'use strict';

const { Pool } = require('pg');

let pool;

function getPoolConfig() {
    return {
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
            ? { rejectUnauthorized: false }
            : undefined,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    };
}

function getPool(existingPool) {
    if (existingPool) return existingPool;
    if (!pool) {
        if (!process.env.DATABASE_URL) {
            throw new Error('FATAL: DATABASE_URL is not set.');
        }
        pool = new Pool(getPoolConfig());
    }
    return pool;
}

async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = { getPool, getPoolConfig, closePool };
