'use strict';

const { getRulebook } = require('./rulebook');
const { loadSheetProvenance } = require('./provenance');
const { getPayrollEngine } = require('./engineFlag');

async function getMonthClose(pool, contractId, year, month) {
    const rulebook = await getRulebook(pool, contractId);
    const engine = await getPayrollEngine(pool, contractId);
    const provenance = await loadSheetProvenance(pool, year, month, { contractId });

    const { rows: cycle } = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE s.status IN ('invited','draft','in_progress','submitted'))::int AS open_rows,
                COUNT(*)::int AS total
         FROM portal_claim_submissions s
         JOIN portal_claim_periods p ON p.id = s.period_id
         JOIN employees e ON e.id = s.employee_id
         WHERE e.contract_id::text = $1 AND p.settlement_year = $2 AND p.settlement_month = $3`,
        [contractId, year, month]
    ).catch(() => ({ rows: [{ open_rows: 0, total: 0 }] }));

    const sheetRows = provenance.rows.filter((r) => String(r.contract_id) === String(contractId));
    const lockedCount = sheetRows.filter((r) => r.locked).length;
    const overwriteCount = sheetRows.filter((r) => r.overwrite.ot2 || r.overwrite.ot3).length;

    const { rows: runs } = await pool.query(
        `SELECT id, status FROM payroll_runs
         WHERE contract_id = $1 AND period_year = $2 AND period_month = $3
         ORDER BY id DESC LIMIT 1`,
        [contractId, year, month]
    ).catch(() => ({ rows: [] }));

    const { rows: invoices } = await pool.query(
        `SELECT id, status, invoice_number, grand_total
         FROM client_invoices
         WHERE contract_id = $1 AND period_year = $2 AND period_month = $3`,
        [contractId, year, month]
    ).catch(() => ({ rows: [] }));

    const { rows: batches } = await pool.query(
        `SELECT id, status, total_amount FROM payment_batches
         WHERE year = $1 AND month = $2 AND batch_type = 'PAYROLL'`,
        [year, month]
    ).catch(() => ({ rows: [] }));

    const { rows: slips } = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE email_status IN ('sent','delivered'))::int AS email_sent
         FROM payslip_delivery_log
         WHERE year = $1 AND month = $2`,
        [year, month]
    ).catch(() => ({ rows: [{ email_sent: 0 }] }));

    const { rows: payables } = await pool.query(
        `SELECT pp.payable_type, pp.status, pp.amount
         FROM payroll_payables pp
         JOIN payroll_close_packs pk ON pk.id = pp.pack_id
         JOIN payroll_runs pr ON pr.id = pk.run_id
         WHERE pr.contract_id = $1 AND pr.period_year = $2 AND pr.period_month = $3`,
        [contractId, year, month]
    ).catch(() => ({ rows: [] }));

    const steps = [
        {
            key: 'cycle_closed',
            label: 'Cycle closed',
            done: Number(cycle[0]?.open_rows || 0) === 0,
            detail: `${cycle[0]?.open_rows || 0} open cycle rows`,
        },
        {
            key: 'conflicts_resolved',
            label: 'Conflicts resolved / pending imports decided',
            done: provenance.conflicts.length === 0 && provenance.pending.filter((p) => sheetRows.some((s) => s.employee_id === p.employee_id)).length === 0,
            detail: `${provenance.conflicts.length} conflicts, ${provenance.pending.length} pending imports`,
        },
        {
            key: 'calculated',
            label: 'Calculate',
            done: sheetRows.length > 0 || !!runs[0],
            detail: sheetRows.length ? `${sheetRows.length} sheet rows` : (runs[0] ? `run #${runs[0].id}` : 'not calculated'),
        },
        {
            key: 'overwrites_reviewed',
            label: 'Review overwrites',
            done: overwriteCount === 0,
            detail: `${overwriteCount} overwrite flags`,
        },
        {
            key: 'locked',
            label: 'Lock',
            done: (sheetRows.length > 0 && lockedCount === sheetRows.length) || runs[0]?.status === 'locked' || runs[0]?.status === 'invoiced' || runs[0]?.status === 'paid',
            detail: `${lockedCount}/${sheetRows.length} sheet locked`,
        },
        {
            key: 'invoiced',
            label: 'Raise invoice',
            done: invoices.some((i) => ['Finalized', 'Raised', 'Sent', 'Paid'].includes(i.status)),
            detail: invoices.length ? invoices.map((i) => `${i.invoice_number || i.id} ${i.status}`).join(', ') : 'none',
            writer: rulebook.commercial_type,
        },
        {
            key: 'paid',
            label: 'Disburse / AP confirm',
            done: batches.some((b) => ['Paid', 'Confirmed', 'FM Approved'].includes(b.status)),
            detail: `${batches.length} payroll batches`,
        },
        {
            key: 'payslips',
            label: 'Payslips',
            done: Number(slips[0]?.email_sent || 0) > 0,
            detail: `${slips[0]?.email_sent || 0} emails sent`,
        },
        {
            key: 'compliance',
            label: 'Settle compliance payables',
            done: payables.length > 0 && payables.every((p) => p.status === 'Paid'),
            detail: `${payables.filter((p) => p.status !== 'Paid').length} open payables`,
        },
    ];

    const doneCount = steps.filter((s) => s.done).length;
    return {
        contract: rulebook,
        year,
        month,
        engine,
        steps,
        progress: { done: doneCount, total: steps.length },
        provenance: {
            pending: provenance.pending.length,
            conflicts: provenance.conflicts.length,
            canLock: provenance.canLock,
        },
    };
}

module.exports = { getMonthClose };
