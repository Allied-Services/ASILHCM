#!/usr/bin/env node
'use strict';

/**
 * Dry-run by default. Idempotent backfill for July 2026 PSO North Zone close packs.
 *
 * Usage:
 *   DATABASE_URL=... node backend/scripts/repair_july_pso_close.js
 *   DATABASE_URL=... node backend/scripts/repair_july_pso_close.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Pool } = require('pg');
const {
    closeFixedValueRun,
    aggregatePayablesFromRows,
    finalizeInvoice,
} = require('../src/modules/payrollClose/service');

const CONTRACT_ID = 'CTR-PSO-NORTH-ZONE';
const MONTH = 7;
const YEAR = 2026;
const APPLY = process.argv.includes('--apply');

async function main() {
    const url = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL;
    if (!url) {
        console.error('DATABASE_URL or STAGING_DATABASE_URL required');
        process.exit(1);
    }

    const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: true } });

    try {
        const { rows: runs } = await pool.query(
            `SELECT * FROM payroll_runs WHERE contract_id = $1 AND period_month = $2 AND period_year = $3 ORDER BY id DESC LIMIT 1`,
            [CONTRACT_ID, MONTH, YEAR]
        );
        if (!runs.length) {
            console.log('No payroll run found for PSO July 2026');
            process.exit(1);
        }
        const run = runs[0];
        console.log(`Run #${run.id} status=${run.status}`);

        const { rows: packRows } = await pool.query(
            `SELECT * FROM payroll_close_packs WHERE run_id = $1`,
            [run.id]
        );
        console.log(`Close pack: ${packRows.length ? `#${packRows[0].id} status=${packRows[0].status}` : 'MISSING'}`);

        const { rows: prRows } = await pool.query(
            `SELECT computed FROM payroll_run_rows WHERE run_id = $1`,
            [run.id]
        );
        const totals = aggregatePayablesFromRows(prRows);
        console.log('Computed payables:', totals);

        const { rows: invoices } = await pool.query(
            `SELECT id, invoice_number, status, grand_total FROM client_invoices
             WHERE contract_id = $1 AND period_month = $2 AND period_year = $3`,
            [CONTRACT_ID, MONTH, YEAR]
        );
        console.log(`Invoices (${invoices.length}):`, invoices.map((i) => `${i.invoice_number}:${i.status}`).join(', '));

        const { rows: batches } = await pool.query(
            `SELECT id, status, total_amount FROM payment_batches
             WHERE batch_type = 'PAYROLL' AND year = $1 AND month = $2 AND source_run_id = $3`,
            [YEAR, MONTH, run.id]
        );
        console.log(`Salary batches: ${batches.length}`, batches);

        if (!APPLY) {
            console.log('\nDry run only. Re-run with --apply to create/link close pack and finalize Draft invoices.');
            return;
        }

        if (!packRows.length && ['locked', 'invoiced', 'paid'].includes(run.status)) {
            const { rows: runRowData } = await pool.query(
                `SELECT prr.*, e.name AS employee_name, e.bank_name, e.bank_account
                 FROM payroll_run_rows prr JOIN employees e ON e.id = prr.employee_id WHERE prr.run_id = $1`,
                [run.id]
            );
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const { upsertClosePackTx } = require('../src/modules/payrollClose/service');
                await upsertClosePackTx(client, run, 'repair-script', runRowData);
                if (batches.length && packRows.length === 0) {
                    const { rows: newPack } = await client.query(
                        `SELECT id FROM payroll_close_packs WHERE run_id = $1`,
                        [run.id]
                    );
                    if (newPack.length) {
                        await client.query(
                            `UPDATE payroll_close_packs SET salary_batch_id = $2 WHERE id = $1`,
                            [newPack[0].id, batches[0].id]
                        );
                        await client.query(
                            `UPDATE payroll_payables SET status = 'Paid', payment_batch_id = $2, paid_at = NOW()
                             WHERE pack_id = $1 AND payable_type = 'salary'`,
                            [newPack[0].id, batches[0].id]
                        );
                    }
                }
                await client.query('COMMIT');
                console.log('Close pack created/reconciled');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        }

        for (const inv of invoices) {
            if (String(inv.status).toLowerCase() === 'draft') {
                const r = await finalizeInvoice(pool, { invoiceId: inv.id, actor: 'repair-script' });
                console.log(`Finalized ${inv.invoice_number}:`, r.ok ? 'ok' : r.code);
            }
        }

        console.log('Apply complete');
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
