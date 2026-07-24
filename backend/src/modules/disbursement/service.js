'use strict';

const { canTransitionStatus } = require('../payrollrun/service');

function parseJsonField(val, fallback = {}) {
    if (val == null) return fallback;
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return fallback; }
    }
    return val;
}

function bankSlug(bankName) {
    return (bankName || '').replace(/\s+/g, '').slice(0, 8);
}

function payrollReference(month, year, employeeId) {
    const monthName = new Date(2000, month - 1, 1).toLocaleString('en-US', { month: 'short' });
    const yr2 = String(year).slice(-2);
    return `PR${monthName}${yr2}-${employeeId}`;
}

/**
 * Bridge a locked/invoiced World B payroll run into payment_batches + payment_ledger
 * (mirrors World A AP confirm artifacts for downstream AP/bank screens).
 */
async function disburseRun(pool, runId, opts = {}, actor) {
    const {
        bank_id,
        bank_name,
        payment_date,
        reference_no,
        notes,
        allow_missing_bank = false,
    } = opts;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: runRows } = await client.query(
            `SELECT * FROM payroll_runs WHERE id = $1`,
            [runId]
        );
        if (!runRows.length) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'RUN_NOT_FOUND' };
        }
        const run = runRows[0];
        const status = String(run.status || '').toLowerCase();

        if (!['locked', 'invoiced'].includes(status)) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'RUN_NOT_DISBURSABLE', status: run.status };
        }
        if (!canTransitionStatus(status, 'paid')) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'RUN_NOT_DISBURSABLE', status: run.status };
        }

        const { rows: contractRows } = await client.query(
            `SELECT c.contract_name, cl.name AS client_name
             FROM contracts c
             LEFT JOIN clients cl ON cl.id = c.client_id
             WHERE c.id = $1`,
            [run.contract_id]
        );
        if (!contractRows.length) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'CONTRACT_NOT_FOUND' };
        }
        const clientName = contractRows[0].client_name || null;
        const contractName = contractRows[0].contract_name || null;

        const { rows: existingBatches } = await client.query(
            `SELECT id FROM payment_batches
             WHERE batch_type = 'PAYROLL'
               AND year = $1 AND month = $2
               AND COALESCE(client, '') = COALESCE($3::text, '')
               AND COALESCE(contract_name, '') = COALESCE($4::text, '')`,
            [run.period_year, run.period_month, clientName, contractName]
        );
        if (existingBatches.length) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'BATCH_EXISTS', batch_id: existingBatches[0].id };
        }

        const { rows: legacyRows } = await client.query(
            `SELECT COUNT(*)::int AS cnt
             FROM payroll_transactions pt
             JOIN employees e ON e.id = pt.employee_id
             WHERE pt.year = $1 AND pt.month = $2 AND pt.locked = TRUE
               AND (e.contract_id = $3::text OR e.contract_name = $4::text)`,
            [run.period_year, run.period_month, String(run.contract_id), contractName]
        );
        if (legacyRows[0].cnt > 0) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'LEGACY_PAYROLL_LOCKED' };
        }

        const { rows: runRowRows } = await client.query(
            `SELECT prr.*, e.name AS employee_name, e.bank_name, e.bank_account
             FROM payroll_run_rows prr
             JOIN employees e ON e.id = prr.employee_id
             WHERE prr.run_id = $1
             ORDER BY e.name`,
            [runId]
        );

        const missingBank = runRowRows
            .filter((r) => !r.bank_account || String(r.bank_account).trim() === '')
            .map((r) => ({ id: r.employee_id, name: r.employee_name }));

        if (missingBank.length && !allow_missing_bank) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'MISSING_BANK_DETAILS', employees: missingBank };
        }

        const excluded = missingBank.map((e) => ({ ...e }));
        const included = runRowRows.filter(
            (r) => r.bank_account && String(r.bank_account).trim() !== ''
        );

        if (!included.length) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'NO_DISBURSABLE_ROWS' };
        }

        let totalAmount = 0;
        const amounts = included.map((r) => {
            const computed = parseJsonField(r.computed, {});
            const netPay = Number(computed.netPay || 0);
            totalAmount += netPay;
            return netPay;
        });

        const batchId = `PB-${run.period_year}-${String(run.period_month).padStart(2, '0')}-${bankSlug(bank_name)}-${Date.now()}`;
        const noteText = `${notes || ''} | source: payroll_run #${runId}`.trim();

        await client.query(
            `INSERT INTO payment_batches
                (id, batch_type, year, month, bank_id, bank_name, payment_date, reference_no,
                 total_amount, employee_count, notes, status, created_by, client, contract_name, source_run_id)
             VALUES ($1, 'PAYROLL', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Confirmed', $11, $12, $13, $14)`,
            [
                batchId,
                run.period_year,
                run.period_month,
                bank_id || null,
                bank_name || null,
                payment_date || null,
                reference_no || null,
                totalAmount,
                included.length,
                noteText,
                actor || null,
                clientName,
                contractName,
                runId,
            ]
        );

        const plBatch = included.map(() => batchId);
        const plEmpIds = included.map((r) => r.employee_id);
        const plNames = included.map((r) => r.employee_name);
        const plRefs = included.map((r) => payrollReference(run.period_month, run.period_year, r.employee_id));
        const plBanks = included.map((r) => r.bank_name || bank_name || '');
        const plAccts = included.map((r) => r.bank_account || '');

        await client.query(
            `INSERT INTO payment_ledger
                (batch_id, employee_id, employee_name, payment_type, amount, reference,
                 bank_name, bank_account, billable, xero_account_code, status)
             SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]),
                    'SALARY', unnest($4::numeric[]), unnest($5::text[]),
                    unnest($6::text[]), unnest($7::text[]), TRUE, '200', 'Paid'
             ON CONFLICT (batch_id, employee_id) DO NOTHING`,
            [plBatch, plEmpIds, plNames, amounts, plRefs, plBanks, plAccts]
        );

        await client.query(
            `UPDATE payroll_runs SET status = 'paid' WHERE id = $1`,
            [runId]
        );

        await client.query('COMMIT');

        return {
            ok: true,
            batch_id: batchId,
            employee_count: included.length,
            total_amount: totalAmount,
            excluded,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    disburseRun,
    bankSlug,
    payrollReference,
    parseJsonField,
};
