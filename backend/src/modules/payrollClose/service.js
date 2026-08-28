'use strict';

const { getPolicy } = require('../constraints/service');
const { isSoBillingModel, PSO_SERVICE_TYPE } = require('../serviceOrders/sitesMeta');

const PAYABLE_TYPES = [
    'salary',
    'eobi',
    'sessi',
    'pf',
    'wht',
    'gratuity',
    'bonus_accrual',
    'edu_cess',
    'life_insurance',
];

const PAYABLE_LABELS = {
    salary: 'Employee Net Salaries',
    eobi: 'EOBI Employer Contribution',
    sessi: 'SESSI Employer Contribution',
    pf: 'Provident Fund',
    wht: 'Withholding Tax (WHT)',
    gratuity: 'Gratuity Accrual',
    bonus_accrual: 'Bonus Accrual',
    edu_cess: 'Education Cess',
    life_insurance: 'Life Insurance',
};

function parseJsonField(val, fallback = {}) {
    if (val == null) return fallback;
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return fallback; }
    }
    return val;
}

function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

async function isFixedValueContract(pool, contractId) {
    const { rows } = await pool.query(
        `SELECT c.service_type, c.id FROM contracts c WHERE c.id = $1`,
        [contractId]
    );
    if (!rows.length) return false;
    const contract = rows[0];
    const policy = await getPolicy(pool, contract.id);
    const svcType = String(contract.service_type || '').trim();
    return isSoBillingModel(policy?.billing_model)
        || svcType === PSO_SERVICE_TYPE
        || /fixed value/i.test(svcType);
}

function aggregatePayablesFromRows(runRows) {
    const totals = {};
    for (const type of PAYABLE_TYPES) totals[type] = 0;

    for (const row of runRows) {
        const c = parseJsonField(row.computed, {});
        totals.salary += Number(c.netPay || 0);
        totals.eobi += Number(c.eobiEmployer || 0);
        totals.sessi += Number(c.sessiEmployer || 0);
        totals.pf += Number(c.pfDeduction || 0);
        totals.wht += Number(c.wht || 0);
        totals.gratuity += Number(c.gratuityAccrual || 0);
        totals.bonus_accrual += Number(c.bonusAccrual || 0);
        totals.edu_cess += Number(c.eduCess || 0);
        totals.life_insurance += Number(c.lifeInsurance || 0);
    }

    for (const type of PAYABLE_TYPES) {
        totals[type] = round2(totals[type]);
    }
    return totals;
}

async function allocateRunToCostsTx(client, run) {
    const { rows: prRows } = await client.query(
        `SELECT prr.*, e.project_id FROM payroll_run_rows prr
         JOIN employees e ON e.id = prr.employee_id
         WHERE prr.run_id = $1`,
        [run.id]
    );

    let inserted = 0;
    for (const row of prRows) {
        const computed = parseJsonField(row.computed, {});
        const amount = Number(computed.totalPayrollCost || computed.totalCost || 0);
        const sourceId = `${run.id}-${row.employee_id}`;
        const exists = await client.query(
            `SELECT 1 FROM cost_allocations WHERE source_type = 'payroll_run' AND source_id = $1 LIMIT 1`,
            [sourceId]
        );
        if (exists.rows.length) continue;
        await client.query(
            `INSERT INTO cost_allocations (source_type, source_id, contract_id, project_id, period_month, period_year, amount, created_by)
             VALUES ('payroll_run', $1, $2, $3, $4, $5, $6, 'system')`,
            [sourceId, run.contract_id, row.project_id, run.period_month, run.period_year, amount]
        );
        inserted += 1;
    }
    return { processed: prRows.length, inserted };
}

async function upsertClosePackTx(client, run, actor, runRows) {
    const totals = aggregatePayablesFromRows(runRows);

    const { rows: existing } = await client.query(
        `SELECT * FROM payroll_close_packs WHERE run_id = $1`,
        [run.id]
    );

    let pack;
    if (existing.length) {
        pack = existing[0];
        await client.query(
            `UPDATE payroll_close_packs SET status = 'closed', updated_at = NOW() WHERE id = $1`,
            [pack.id]
        );
    } else {
        const { rows: created } = await client.query(
            `INSERT INTO payroll_close_packs
                (run_id, contract_id, period_month, period_year, status, closed_at, closed_by)
             VALUES ($1, $2, $3, $4, 'closed', NOW(), $5)
             RETURNING *`,
            [run.id, run.contract_id, run.period_month, run.period_year, actor || null]
        );
        pack = created[0];
    }

    for (const payableType of PAYABLE_TYPES) {
        const amount = totals[payableType];
        if (amount <= 0) continue;
        await client.query(
            `INSERT INTO payroll_payables (pack_id, payable_type, amount, status)
             VALUES ($1, $2, $3, 'Payable')
             ON CONFLICT (pack_id, payable_type) DO UPDATE SET
                amount = EXCLUDED.amount,
                updated_at = NOW()
             WHERE payroll_payables.status = 'Payable'`,
            [pack.id, payableType, amount]
        );
    }

    return { pack, totals };
}

function derivePackStatus(payables) {
    if (!payables.length) return 'closed';
    const paid = payables.filter((p) => p.status === 'Paid').length;
    if (paid === 0) return 'closed';
    if (paid === payables.length) return 'paid';
    return 'partial';
}

async function refreshPackStatus(client, packId) {
    const { rows: payables } = await client.query(
        `SELECT * FROM payroll_payables WHERE pack_id = $1 AND amount > 0`,
        [packId]
    );
    const status = derivePackStatus(payables);
    await client.query(
        `UPDATE payroll_close_packs SET status = $2, updated_at = NOW() WHERE id = $1`,
        [packId, status]
    );
    return status;
}

/**
 * Atomic FV payroll close: lock run + P&L costs + AP close pack.
 */
async function closeFixedValueRun(pool, { runId, lockedBy }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: current } = await client.query(
            `SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE`,
            [runId]
        );
        if (!current.length) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'RUN_NOT_FOUND' };
        }
        const run = current[0];
        const from = run.status;
        if (!['draft', 'proposed'].includes(from)) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'RUN_NOT_LOCKABLE', status: run.status };
        }

        const fv = await isFixedValueContract(pool, run.contract_id);
        const { getRulebook } = require('../records/rulebook');
        let commercial = 'cost_plus';
        try {
            commercial = (await getRulebook(pool, run.contract_id)).commercial_type;
        } catch { /* keep default */ }
        if (!fv && commercial !== 'cost_plus' && commercial !== 'fixed_value') {
            await client.query('ROLLBACK');
            return { ok: false, code: 'NOT_CLOSABLE_CONTRACT' };
        }

        const { rows: locked } = await client.query(
            `UPDATE payroll_runs SET status = 'locked', locked_at = NOW(), locked_by = $2
             WHERE id = $1 RETURNING *`,
            [runId, lockedBy || null]
        );
        const lockedRun = locked[0];

        await allocateRunToCostsTx(client, lockedRun);

        const { rows: runRows } = await client.query(
            `SELECT prr.*, e.name AS employee_name, e.bank_name, e.bank_account
             FROM payroll_run_rows prr
             JOIN employees e ON e.id = prr.employee_id
             WHERE prr.run_id = $1`,
            [runId]
        );

        const { pack, totals } = await upsertClosePackTx(client, lockedRun, lockedBy, runRows);

        await client.query('COMMIT');
        return { ok: true, run: lockedRun, pack, totals };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function listClosePacks(pool, { year, month, contractId } = {}) {
    let sql = `
        SELECT pcp.*, c.contract_name, cl.name AS client_name,
               (SELECT COUNT(*)::int FROM payroll_payables pp WHERE pp.pack_id = pcp.id AND pp.amount > 0) AS payable_count,
               (SELECT COUNT(*)::int FROM payroll_payables pp WHERE pp.pack_id = pcp.id AND pp.status = 'Paid' AND pp.amount > 0) AS paid_count,
               (SELECT COALESCE(SUM(pp.amount), 0) FROM payroll_payables pp WHERE pp.pack_id = pcp.id) AS total_amount
        FROM payroll_close_packs pcp
        JOIN contracts c ON c.id = pcp.contract_id
        LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE 1=1`;
    const params = [];
    if (year) { params.push(year); sql += ` AND pcp.period_year = $${params.length}`; }
    if (month) { params.push(month); sql += ` AND pcp.period_month = $${params.length}`; }
    if (contractId) { params.push(contractId); sql += ` AND pcp.contract_id = $${params.length}`; }
    sql += ' ORDER BY pcp.period_year DESC, pcp.period_month DESC, c.contract_name';
    const { rows } = await pool.query(sql, params);
    return rows;
}

async function getClosePackDetail(pool, packId) {
    const { rows: packs } = await pool.query(
        `SELECT pcp.*, c.contract_name, cl.name AS client_name, pr.status AS run_status
         FROM payroll_close_packs pcp
         JOIN contracts c ON c.id = pcp.contract_id
         LEFT JOIN clients cl ON cl.id = c.client_id
         LEFT JOIN payroll_runs pr ON pr.id = pcp.run_id
         WHERE pcp.id = $1`,
        [packId]
    );
    if (!packs.length) return null;
    const pack = packs[0];
    const { rows: payables } = await pool.query(
        `SELECT * FROM payroll_payables WHERE pack_id = $1 AND amount > 0 ORDER BY payable_type`,
        [packId]
    );
    return {
        ...pack,
        payables: payables.map((p) => ({
            ...p,
            label: PAYABLE_LABELS[p.payable_type] || p.payable_type,
        })),
    };
}

async function settlePayable(pool, { packId, payableType, paymentDate, referenceNo, actor, bankId, bankName }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: packs } = await client.query(
            `SELECT pcp.*, c.contract_name, cl.name AS client_name
             FROM payroll_close_packs pcp
             JOIN contracts c ON c.id = pcp.contract_id
             LEFT JOIN clients cl ON cl.id = c.client_id
             WHERE pcp.id = $1 FOR UPDATE`,
            [packId]
        );
        if (!packs.length) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'PACK_NOT_FOUND' };
        }
        const pack = packs[0];

        const { rows: payables } = await client.query(
            `SELECT * FROM payroll_payables WHERE pack_id = $1 AND payable_type = $2 FOR UPDATE`,
            [packId, payableType]
        );
        if (!payables.length) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'PAYABLE_NOT_FOUND' };
        }
        const payable = payables[0];
        if (payable.status === 'Paid') {
            await client.query('ROLLBACK');
            return { ok: false, code: 'ALREADY_PAID' };
        }

        if (payableType === 'salary') {
            const result = await settleSalaryPayable(client, pack, payable, {
                bankId, bankName, paymentDate, referenceNo, actor,
            });
            if (!result.ok) {
                await client.query('ROLLBACK');
                return result;
            }
        } else {
            await client.query(
                `UPDATE payroll_payables SET
                    status = 'Paid',
                    payment_date = $2,
                    reference_no = $3,
                    paid_at = NOW(),
                    paid_by = $4,
                    updated_at = NOW()
                 WHERE id = $1`,
                [payable.id, paymentDate || null, referenceNo || null, actor || null]
            );
        }

        const status = await refreshPackStatus(client, packId);

        const { rows: runRows } = await client.query(
            `SELECT status FROM payroll_runs WHERE id = $1`,
            [pack.run_id]
        );
        if (status === 'paid' && runRows[0]?.status !== 'paid') {
            await client.query(
                `UPDATE payroll_runs SET status = 'paid' WHERE id = $1`,
                [pack.run_id]
            );
        }

        await client.query('COMMIT');
        const detail = await getClosePackDetail(pool, packId);
        const salaryPayable = detail?.payables?.find((p) => p.payable_type === payableType);
        return {
            ok: true,
            pack_id: packId,
            payable_type: payableType,
            pack_status: status,
            batch_id: salaryPayable?.payment_batch_id || null,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

function bankSlug(bankName) {
    return (bankName || 'BANK').replace(/\s+/g, '').slice(0, 8);
}

function payrollReference(month, year, employeeId) {
    const monthName = new Date(2000, month - 1, 1).toLocaleString('en-US', { month: 'short' });
    const yr2 = String(year).slice(-2);
    return `PR${monthName}${yr2}-${employeeId}`;
}

async function settleSalaryPayable(client, pack, payable, opts) {
    const { bankId, bankName, paymentDate, referenceNo, actor } = opts;
    if (!bankName || String(bankName).trim() === '') {
        return { ok: false, code: 'BANK_NAME_REQUIRED' };
    }

    if (pack.salary_batch_id) {
        await client.query(
            `UPDATE payroll_payables SET
                status = 'Paid',
                payment_batch_id = $2,
                payment_date = $3,
                reference_no = $4,
                paid_at = NOW(),
                paid_by = $5,
                updated_at = NOW()
             WHERE id = $1`,
            [payable.id, pack.salary_batch_id, paymentDate || null, referenceNo || null, actor || null]
        );
        return { ok: true, batch_id: pack.salary_batch_id, linked: true };
    }

    const { rows: runRows } = await client.query(
        `SELECT prr.*, e.name AS employee_name, e.bank_name, e.bank_account
         FROM payroll_run_rows prr
         JOIN employees e ON e.id = prr.employee_id
         WHERE prr.run_id = $1
         ORDER BY e.name`,
        [pack.run_id]
    );

    const included = runRows.filter((r) => r.bank_account && String(r.bank_account).trim() !== '');
    if (!included.length) {
        return { ok: false, code: 'NO_DISBURSABLE_ROWS' };
    }

    let totalAmount = 0;
    const amounts = included.map((r) => {
        const computed = parseJsonField(r.computed, {});
        const netPay = Number(computed.netPay || 0);
        totalAmount += netPay;
        return netPay;
    });

    const batchId = `PB-${pack.period_year}-${String(pack.period_month).padStart(2, '0')}-${bankSlug(bankName)}-${Date.now()}`;
    const noteText = `FV close pack #${pack.id} salary | source: payroll_run #${pack.run_id}`;

    await client.query(
        `INSERT INTO payment_batches
            (id, batch_type, year, month, bank_id, bank_name, payment_date, reference_no,
             total_amount, employee_count, notes, status, created_by, client, contract_name, source_run_id)
         VALUES ($1, 'PAYROLL', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Confirmed', $11, $12, $13, $14)`,
        [
            batchId,
            pack.period_year,
            pack.period_month,
            bankId || null,
            bankName,
            paymentDate || null,
            referenceNo || null,
            totalAmount,
            included.length,
            noteText,
            actor || null,
            pack.client_name || null,
            pack.contract_name || null,
            pack.run_id,
        ]
    );

    const plBatch = included.map(() => batchId);
    const plEmpIds = included.map((r) => r.employee_id);
    const plNames = included.map((r) => r.employee_name);
    const plRefs = included.map((r) => payrollReference(pack.period_month, pack.period_year, r.employee_id));
    const plBanks = included.map((r) => r.bank_name || bankName || '');
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
        `UPDATE payroll_close_packs SET salary_batch_id = $2, updated_at = NOW() WHERE id = $1`,
        [pack.id, batchId]
    );

    await client.query(
        `UPDATE payroll_payables SET
            status = 'Paid',
            payment_batch_id = $2,
            payment_date = $3,
            reference_no = $4,
            paid_at = NOW(),
            paid_by = $5,
            updated_at = NOW()
         WHERE id = $1`,
        [payable.id, batchId, paymentDate || null, referenceNo || null, actor || null]
    );

    return { ok: true, batch_id: batchId };
}

async function reopenPayrollRun(pool, { runId, actor, snapshot }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            `SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE`,
            [runId]
        );
        if (!rows.length) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'RUN_NOT_FOUND' };
        }
        const run = rows[0];
        if (!['locked', 'invoiced', 'paid'].includes(String(run.status))) {
            await client.query('ROLLBACK');
            return { ok: false, code: 'RUN_NOT_REOPENABLE', status: run.status };
        }

        await client.query(
            `INSERT INTO month_close_revisions (entity_type, entity_id, action, actor, snapshot)
             VALUES ('payroll_run', $1, 'reopen', $2, $3)`,
            [String(runId), actor || null, JSON.stringify(snapshot || { status: run.status })]
        );

        await client.query(
            `UPDATE payroll_runs SET status = 'revised' WHERE id = $1`,
            [runId]
        );

        await client.query(
            `UPDATE payroll_close_packs SET status = 'revised', reopened_at = NOW(), reopened_by = $2, updated_at = NOW()
             WHERE run_id = $1`,
            [runId, actor || null]
        );

        await client.query('COMMIT');
        return { ok: true, run_id: runId, status: 'revised' };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function finalizeInvoice(pool, { invoiceId, actor }) {
    const { rows: prev } = await pool.query(
        `SELECT * FROM client_invoices WHERE id = $1`,
        [invoiceId]
    );
    if (!prev.length) return { ok: false, code: 'NOT_FOUND' };
    const inv = prev[0];
    if (String(inv.status).toLowerCase() !== 'draft') {
        return { ok: false, code: 'NOT_DRAFT', status: inv.status };
    }
    const { rows } = await pool.query(
        `UPDATE client_invoices SET status = 'Finalized', finalized_at = NOW(), finalized_by = $2, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [invoiceId, actor || null]
    );
    return { ok: true, invoice: rows[0] };
}

const INVOICE_LOCKED_STATUSES = new Set(['finalized', 'raised', 'sent', 'paid', 'voided']);

function isInvoiceLocked(status) {
    return INVOICE_LOCKED_STATUSES.has(String(status || '').toLowerCase());
}

async function reopenInvoice(pool, { invoiceId, actor }) {
    const { rows: prev } = await pool.query(
        `SELECT * FROM client_invoices WHERE id = $1`,
        [invoiceId]
    );
    if (!prev.length) return { ok: false, code: 'NOT_FOUND' };
    const inv = prev[0];
    if (!isInvoiceLocked(inv.status) || String(inv.status).toLowerCase() === 'voided') {
        return { ok: false, code: 'NOT_REOPENABLE', status: inv.status };
    }

    await pool.query(
        `INSERT INTO month_close_revisions (entity_type, entity_id, action, actor, snapshot)
         VALUES ('client_invoice', $1, 'reopen', $2, $3)`,
        [String(invoiceId), actor || null, JSON.stringify({ status: inv.status, grand_total: inv.grand_total })]
    );

    const { rows } = await pool.query(
        `UPDATE client_invoices SET status = 'Draft', finalized_at = NULL, finalized_by = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [invoiceId]
    );
    return { ok: true, invoice: rows[0] };
}

async function createClosePackFromSheet(pool, { contractId, year, month, actor }) {
    const { rows: sheet } = await pool.query(
        `SELECT pt.* FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE e.contract_id::text = $1 AND pt.year = $2 AND pt.month = $3 AND pt.locked = TRUE`,
        [contractId, year, month]
    );
    if (!sheet.length) {
        return { ok: false, code: 'SHEET_NOT_LOCKED' };
    }
    const runRows = sheet.map((r) => ({
        employee_id: r.employee_id,
        computed: r.computed_json || {
            netPay: r.net,
            eobiEmployer: 0,
            sessiEmployer: 0,
            pfDeduction: 0,
            wht: r.wht,
            gratuityAccrual: 0,
            bonusAccrual: 0,
        },
    }));

    const { rows: existingRun } = await pool.query(
        `SELECT * FROM payroll_runs
         WHERE contract_id = $1 AND period_month = $2 AND period_year = $3
         ORDER BY id DESC LIMIT 1`,
        [contractId, month, year]
    );
    let run = existingRun[0];
    if (!run) {
        const { rows: created } = await pool.query(
            `INSERT INTO payroll_runs (contract_id, period_month, period_year, status, locked_at, locked_by)
             VALUES ($1,$2,$3,'locked',NOW(),$4)
             RETURNING *`,
            [contractId, month, year, actor || null]
        );
        run = created[0];
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await upsertClosePackTx(client, run, actor, runRows);
        await client.query('COMMIT');
        return { ok: true, run, ...result };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    PAYABLE_TYPES,
    PAYABLE_LABELS,
    INVOICE_LOCKED_STATUSES,
    isFixedValueContract,
    isInvoiceLocked,
    aggregatePayablesFromRows,
    closeFixedValueRun,
    createClosePackFromSheet,
    listClosePacks,
    getClosePackDetail,
    settlePayable,
    reopenPayrollRun,
    finalizeInvoice,
    reopenInvoice,
    allocateRunToCostsTx,
    upsertClosePackTx,
};
