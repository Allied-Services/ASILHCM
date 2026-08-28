'use strict';

const { listRulebooks } = require('./rulebook');

function isBlank(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return !s || s === 'n/a' || s === 'na' || s === 'none';
}

function isWorkMail(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s.includes('@')) return false;
    const domain = s.split('@')[1] || '';
    return domain === 'wafi-energy.com' || domain.endsWith('.wafi-energy.com')
        || domain === 'asil.com.pk' || domain.endsWith('.asil.com.pk');
}

async function buildContractDigest(pool, rulebook, year, month) {
    const issues = {
        missing_employee_data: [],
        stuck_cycle: [],
        payroll_exceptions: [],
        invoices_not_raised: [],
        open_payables: [],
    };

    const { rows: emps } = await pool.query(
        `SELECT id, name, email, bank_name, bank_account, cnic, claim_authority, line_manager_email, active
         FROM employees
         WHERE contract_id::text = $1
           AND LOWER(TRIM(COALESCE(active::text,''))) IN ('','yes','true','1','active')`,
        [rulebook.contract_id]
    );
    for (const e of emps) {
        const missing = [];
        if (isBlank(e.bank_account) || isBlank(e.bank_name)) missing.push('bank');
        if (isBlank(e.cnic)) missing.push('cnic');
        if (!isWorkMail(e.email)) missing.push('work_mailbox');
        if (isBlank(e.claim_authority)) missing.push('focal');
        if (isBlank(e.line_manager_email)) missing.push('lm');
        if (missing.length) {
            issues.missing_employee_data.push({ id: e.id, name: e.name, missing });
        }
    }

    try {
        const { rows: stuck } = await pool.query(
            `SELECT s.employee_id, e.name, s.status, s.approver_email
             FROM portal_claim_submissions s
             JOIN portal_claim_periods p ON p.id = s.period_id
             JOIN employees e ON e.id = s.employee_id
             WHERE e.contract_id::text = $1
               AND p.settlement_year = $2 AND p.settlement_month = $3
               AND s.status IN ('invited','draft','in_progress','submitted')
             LIMIT 200`,
            [rulebook.contract_id, year, month]
        );
        issues.stuck_cycle = stuck;
    } catch {
        // portal tables may be absent in some test DBs
    }

    const { rows: sheet } = await pool.query(
        `SELECT pt.employee_id, e.name, pt.locked, pt.ot2_hrs, pt.ot3_hrs, pt.opd_claim, pt.reimbursement
         FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE e.contract_id::text = $1 AND pt.year = $2 AND pt.month = $3
         LIMIT 400`,
        [rulebook.contract_id, year, month]
    );
    for (const r of sheet) {
        if (!r.locked) {
            issues.payroll_exceptions.push({
                employee_id: r.employee_id,
                name: r.name,
                kind: 'unlocked',
            });
        }
    }

    const { rows: inv } = await pool.query(
        `SELECT id, invoice_number, status, grand_total
         FROM client_invoices
         WHERE contract_id = $1 AND period_year = $2 AND period_month = $3`,
        [rulebook.contract_id, year, month]
    ).catch(() => ({ rows: [] }));
    const lockedMonth = sheet.some((r) => r.locked);
    if (lockedMonth && !inv.some((i) => ['Finalized', 'Raised', 'Sent', 'Paid'].includes(i.status))) {
        issues.invoices_not_raised.push({
            contract_id: rulebook.contract_id,
            month,
            year,
            existing: inv.map((i) => ({ id: i.id, status: i.status })),
        });
    }

    const { rows: payables } = await pool.query(
        `SELECT pp.id, pp.payable_type, pp.amount, pp.status
         FROM payroll_payables pp
         JOIN payroll_close_packs pk ON pk.id = pp.pack_id
         JOIN payroll_runs pr ON pr.id = pk.run_id
         WHERE pr.contract_id = $1 AND pr.period_year = $2 AND pr.period_month = $3
           AND pp.status IS DISTINCT FROM 'Paid'`,
        [rulebook.contract_id, year, month]
    ).catch(() => ({ rows: [] }));
    issues.open_payables = payables;

    const counts = Object.fromEntries(Object.entries(issues).map(([k, v]) => [k, v.length]));
    return { contract: rulebook, counts, issues };
}

function digestHtml(focalEmail, items, year, month) {
    const blocks = items.map((d) => {
        const c = d.counts;
        return `<h3>${d.contract.contract_name || d.contract.contract_id}</h3>
        <ul>
          <li>Missing employee data: ${c.missing_employee_data}</li>
          <li>Stuck cycle rows: ${c.stuck_cycle}</li>
          <li>Payroll exceptions: ${c.payroll_exceptions}</li>
          <li>Invoices not raised: ${c.invoices_not_raised}</li>
          <li>Open compliance payables: ${c.open_payables}</li>
        </ul>`;
    }).join('');
    return `<div style="font-family:sans-serif">
      <p>Daily Contract Focal digest for ${month}/${year}.</p>
      ${blocks || '<p>No contracts assigned.</p>'}
      <p>Open Monthly Cycle and Payroll Sheet to clear these.</p>
    </div>`;
}

async function buildFocalDigests(pool, year, month) {
    const books = await listRulebooks(pool);
    const byFocal = new Map();
    for (const rb of books) {
        const focal = String(rb.allied_contract_focal_email || '').trim().toLowerCase();
        if (!focal.includes('@')) continue;
        const digest = await buildContractDigest(pool, rb, year, month);
        if (!byFocal.has(focal)) byFocal.set(focal, []);
        byFocal.get(focal).push(digest);
    }
    return [...byFocal.entries()].map(([email, contracts]) => ({ email, contracts }));
}

async function sendFocalDigests(pool, sendAppEmail, { year, month } = {}) {
    const now = new Date();
    const y = year || now.getFullYear();
    const m = month || (now.getMonth() + 1);
    const groups = await buildFocalDigests(pool, y, m);
    const sent = [];
    for (const g of groups) {
        const total = g.contracts.reduce((n, c) => n + Object.values(c.counts).reduce((a, b) => a + b, 0), 0);
        if (!total) continue;
        const html = digestHtml(g.email, g.contracts, y, m);
        if (typeof sendAppEmail === 'function') {
            await sendAppEmail({
                to: g.email,
                subject: `ASIL HCM — daily digest ${m}/${y}`,
                html,
            });
        }
        sent.push({ email: g.email, contracts: g.contracts.length, issues: total });
    }
    return { year: y, month: m, sent };
}

module.exports = { buildContractDigest, buildFocalDigests, sendFocalDigests };
