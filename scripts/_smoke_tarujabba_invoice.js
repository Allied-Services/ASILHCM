'use strict';
const { Pool } = require('../backend/node_modules/pg');
const { computeSoInvoice } = require('../backend/src/modules/serviceOrders/billing');

async function main() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });
    try {
        const so = await pool.query(
            `SELECT id FROM service_orders WHERE site_code = 'TARUJABBA' LIMIT 1`
        );
        if (!so.rows[0]) throw new Error('Tarujabba SO missing');
        const id = so.rows[0].id;
        const inv = await computeSoInvoice(pool, { serviceOrderId: id, month: 3, year: 2026 });
        const out = {
            soId: id,
            gross: inv.gross,
            provincialSt: inv.provincialSt,
            grandTotal: inv.grandTotal,
            pass: Number(inv.grandTotal) === 2479745,
        };
        console.log(JSON.stringify(out, null, 2));
        if (!out.pass) process.exit(2);
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
