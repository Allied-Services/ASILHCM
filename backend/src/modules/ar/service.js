'use strict';

const { addDays, formatDate } = require('../../core/dates');

async function getPOBalance(pool, poId) {
    const { rows: poRows } = await pool.query(`SELECT * FROM purchase_orders WHERE id = $1`, [poId]);
    if (!poRows.length) return { ok: false, message: 'PO not found' };
    const po = poRows[0];
    const { rows: utilRows } = await pool.query(
        `SELECT COALESCE(SUM(grand_total), 0) AS utilized FROM client_invoices
         WHERE po_id = $1 AND status NOT IN ('Cancelled','Draft')`,
        [poId]
    );
    const utilized = Number(utilRows[0]?.utilized || 0);
    const poValue = Number(po.po_value || 0);
    return { po, poValue, utilized, balance: poValue - utilized };
}

async function validateInvoiceAgainstPO(pool, { invoiceId, poId, amount }) {
    const balance = await getPOBalance(pool, poId);
    if (!balance.ok && !balance.po) return { ok: false, code: 'PO_NOT_FOUND', message: 'PO not found' };
    const invoiceAmount = Number(amount || 0);
    if (invoiceAmount > balance.balance) {
        return {
            ok: false,
            code: 'PO_BALANCE_EXCEEDED',
            message: `Invoice amount ${invoiceAmount} exceeds PO balance ${balance.balance}`,
            balance,
        };
    }
    return { ok: true, balance };
}

async function runDunningCheck(pool, sendAppEmail) {
    const today = formatDate();
    const { rows: overdue } = await pool.query(
        `SELECT ci.*, c.contract_name, cl.name AS client_name, cl.email AS client_email
         FROM client_invoices ci
         LEFT JOIN contracts c ON c.id = ci.contract_id
         LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE ci.due_date < $1::date
           AND ci.payment_received_at IS NULL
           AND ci.status NOT IN ('Paid','Cancelled','Draft')
         ORDER BY ci.due_date`,
        [today]
    );

    const sent = [];
    for (const inv of overdue) {
        const daysOverdue = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000);
        let stage = 'reminder_1';
        if (daysOverdue > 30) stage = 'overdue_statement';
        else if (daysOverdue > 14) stage = 'reminder_2';

        const { rows: existing } = await pool.query(
            `SELECT id FROM dunning_log WHERE invoice_id = $1 AND stage = $2 AND sent_at > NOW() - INTERVAL '7 days'`,
            [inv.id, stage]
        );
        if (existing.length) continue;

        const recipient = inv.client_email || inv.client;
        if (sendAppEmail && recipient) {
            await sendAppEmail({
                to: recipient,
                subject: `[ASIL] Payment reminder — Invoice ${inv.invoice_no || inv.id}`,
                html: `<p>Dear ${inv.client_name || 'Client'},</p><p>Invoice ${inv.invoice_no || inv.id} for ${inv.contract_name || 'services'} was due on ${inv.due_date}. Outstanding: PKR ${Number(inv.grand_total || 0).toLocaleString()}.</p>`,
            }).catch(() => {});
        }

        await pool.query(
            `INSERT INTO dunning_log (invoice_id, stage, recipient) VALUES ($1,$2,$3)`,
            [inv.id, stage, recipient]
        );
        await pool.query(`UPDATE client_invoices SET dunning_stage = $1 WHERE id = $2`, [stage, inv.id]);
        sent.push({ invoiceId: inv.id, stage });
    }
    return { remindersSent: sent.length, details: sent };
}

async function logXeroSync(pool, { entityType, entityId, direction, status, xeroId, error }) {
    const { rows } = await pool.query(
        `INSERT INTO xero_sync_log (entity_type, entity_id, direction, status, xero_id, error)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [entityType, entityId, direction, status, xeroId || null, error || null]
    );
    return rows[0];
}

async function getInvoiceSchedules(pool, { contractId } = {}) {
    let sql = `SELECT ins.*, c.contract_name FROM invoice_schedules ins JOIN contracts c ON c.id = ins.contract_id`;
    const params = [];
    if (contractId) {
        params.push(contractId);
        sql += ` WHERE ins.contract_id = $1`;
    }
    sql += ` ORDER BY ins.period_year DESC, ins.period_month DESC LIMIT 50`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

async function syncInvoiceSchedules(pool) {
    const now = new Date();
    const periodMonth = now.getMonth() + 1;
    const periodYear = now.getFullYear();

    const { rows: policies } = await pool.query(
        `SELECT * FROM contract_policies WHERE invoice_frequency = 'monthly'`
    );

    let created = 0;
    for (const policy of policies) {
        const day = Math.min(Number(policy.invoice_day_of_month || 1), 28);
        const dueDate = `${periodYear}-${String(periodMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const { rowCount } = await pool.query(
            `INSERT INTO invoice_schedules (contract_id, period_month, period_year, due_to_generate_date, status)
             SELECT $1, $2, $3, $4::date, 'upcoming'
             WHERE NOT EXISTS (
               SELECT 1 FROM invoice_schedules WHERE contract_id = $1 AND period_month = $2 AND period_year = $3
             )`,
            [policy.contract_id, periodMonth, periodYear, dueDate]
        );
        created += rowCount || 0;
    }

    await pool.query(
        `UPDATE invoice_schedules ins SET status = 'generated'
         FROM client_invoices ci
         WHERE ci.contract_id = ins.contract_id
           AND ci.period_month = ins.period_month
           AND ci.period_year = ins.period_year
           AND ins.status = 'upcoming'`
    );

    await pool.query(
        `UPDATE invoice_schedules SET status = 'overdue_to_generate'
         WHERE status = 'upcoming' AND due_to_generate_date < CURRENT_DATE`
    );

    return { created };
}

async function getDunningLog(pool, limit = 50) {
    const { rows } = await pool.query(
        `SELECT dl.*, ci.invoice_number, ci.grand_total, ci.client
         FROM dunning_log dl
         LEFT JOIN client_invoices ci ON ci.id = dl.invoice_id
         ORDER BY dl.sent_at DESC NULLS LAST
         LIMIT $1`,
        [limit]
    );
    return rows;
}

module.exports = {
    getPOBalance,
    validateInvoiceAgainstPO,
    runDunningCheck,
    logXeroSync,
    getInvoiceSchedules,
    syncInvoiceSchedules,
    getDunningLog,
};
