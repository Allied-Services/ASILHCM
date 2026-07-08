'use strict';

let PgBoss;
try {
    PgBoss = require('pg-boss');
} catch {
    PgBoss = null;
}

let boss;

async function initJobs(options = {}) {
    if (process.env.NODE_ENV === 'test') return null;
    if (!process.env.DATABASE_URL) return null;
    if (!PgBoss) {
        console.warn('[pg-boss] package not installed — background jobs disabled');
        return null;
    }

    if (!boss) {
        boss = new PgBoss({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL.includes('localhost')
                ? false
                : { rejectUnauthorized: false },
            schema: 'pgboss',
            ...options,
        });
        boss.on('error', err => console.error('[pg-boss]', err));
        await boss.start();
    }
    return boss;
}

async function scheduleJob(name, data, cronExpression) {
    if (!boss) return null;
    await boss.createQueue(name).catch(() => {});
    return boss.schedule(name, cronExpression, data || {});
}

async function registerWorkers(bossInstance, handlers) {
    if (!bossInstance) return;
    for (const [name, handler] of Object.entries(handlers)) {
        await bossInstance.createQueue(name).catch(() => {});
        await bossInstance.work(name, async job => {
            try {
                await handler(job.data || {}, job);
            } catch (err) {
                console.error(`[pg-boss worker ${name}]`, err);
                throw err;
            }
        });
    }
}

async function stopJobs() {
    if (boss) {
        await boss.stop({ graceful: true, timeout: 10000 });
        boss = null;
    }
}



async function enqueueJob(name, data) {
    if (!boss) return null;
    await boss.createQueue(name).catch(() => {});
    return boss.send(name, data || {});
}

module.exports = { initJobs, scheduleJob, registerWorkers, stopJobs, getBoss, enqueueJob };
