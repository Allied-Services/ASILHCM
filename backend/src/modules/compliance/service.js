'use strict';

const { calculateEOBI, calculateSESSI, calculateMonthlyIncomeTax } = require('../../../taxEngine');

async function computeStatutoryForMonth(pool, month, year) {
    const { rows: payroll } = await pool.query(
        `SELECT pt.*, e.province, e.contract_id
         FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE pt.month = $1 AND pt.year = $2 AND pt.locked = true`,
        [month, year]
    );

    const { rows: runRows } = await pool.query(
        `SELECT prr.computed, prr.employee_id, e.province
         FROM payroll_run_rows prr
         JOIN payroll_runs pr ON pr.id = prr.run_id
         JOIN employees e ON e.id = prr.employee_id
         WHERE pr.period_month = $1 AND pr.period_year = $2 AND pr.status IN ('locked','invoiced')
           AND prr.employee_id NOT IN (
             SELECT employee_id FROM payroll_transactions WHERE month = $1 AND year = $2 AND locked = true
           )`,
        [month, year]
    );

    let eobiEmployee = 0;
    let eobiEmployer = 0;
    let sessiEmployee = 0;
    let sessiEmployer = 0;
    let incomeTax = 0;
    const byRegion = {};
    let headcount = payroll.length;

    for (const row of payroll) {
        const salary = Number(row.gross || 0);
        const eobi = calculateEOBI({ year, month });
        const sessi = calculateSESSI(salary);
        const tax = calculateMonthlyIncomeTax(salary, row.province || 'Sindh');
        eobiEmployee += Number(eobi?.employeeShare || 0);
        eobiEmployer += Number(eobi?.employerShare || 0);
        sessiEmployee += 0;
        sessiEmployer += Number(sessi || 0);
        incomeTax += Number(tax || 0);
        const region = row.province || 'Sindh';
        byRegion[region] = (byRegion[region] || 0) + Number(tax || 0);
    }

    for (const row of runRows) {
        const c = typeof row.computed === 'string' ? JSON.parse(row.computed) : row.computed;
        eobiEmployee += Number(c.eobiEmployee || 0);
        eobiEmployer += Number(c.eobiEmployer || 0);
        sessiEmployee += Number(c.sessiEmployee || 0);
        sessiEmployer += Number(c.sessiEmployer || 0);
        incomeTax += Number(c.wht || 0);
        const region = row.province || 'Sindh';
        byRegion[region] = (byRegion[region] || 0) + Number(c.wht || 0);
        headcount += 1;
    }

    return {
        period: { month, year },
        headcount,
        eobi: { employee: eobiEmployee, employer: eobiEmployer, total: eobiEmployee + eobiEmployer },
        sessi: { employee: sessiEmployee, employer: sessiEmployer, total: sessiEmployee + sessiEmployer },
        incomeTax,
        incomeTaxByRegion: byRegion,
    };
}

async function upsertStatutoryLedger(pool, month, year, computed) {
    const entries = [
        { authority: 'EOBI', employee_share: computed.eobi.employee, employer_share: computed.eobi.employer },
        { authority: 'SESSI', employee_share: computed.sessi.employee, employer_share: computed.sessi.employer },
        { authority: 'FBR', employee_share: computed.incomeTax, employer_share: 0, taxable_base: computed.incomeTax },
    ];
    const saved = [];
    for (const e of entries) {
        await pool.query(
            `DELETE FROM statutory_ledger WHERE period_month = $1 AND period_year = $2 AND authority = $3 AND employee_id IS NULL`,
            [month, year, e.authority]
        );
        const { rows } = await pool.query(
            `INSERT INTO statutory_ledger (period_month, period_year, authority, employee_share, employer_share, taxable_base)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [month, year, e.authority, e.employee_share, e.employer_share, e.taxable_base || null]
        );
        saved.push(rows[0]);
    }
    return saved;
}

async function getStatutoryLedger(pool, { month, year } = {}) {
    let sql = `SELECT * FROM statutory_ledger WHERE employee_id IS NULL`;
    const params = [];
    if (month && year) {
        params.push(month, year);
        sql += ` AND period_month = $1 AND period_year = $2`;
    }
    sql += ` ORDER BY period_year DESC, period_month DESC, authority`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

async function generateFilingPreview(pool, month, year) {
    const computed = await computeStatutoryForMonth(pool, month, year);
    await upsertStatutoryLedger(pool, month, year, computed);

    const filing = {
        period: `${year}-${String(month).padStart(2, '0')}`,
        generatedAt: new Date().toISOString(),
        eobiChallan: { amount: computed.eobi.total, employees: computed.headcount, status: 'ready' },
        sessiChallan: { amount: computed.sessi.total, employees: computed.headcount, status: 'ready' },
        incomeTaxReturn: { amount: computed.incomeTax, regions: computed.incomeTaxByRegion, status: 'ready' },
        incomeTaxByProvince: Object.entries(computed.incomeTaxByRegion).map(([region, amount]) => ({
            authority: 'FBR',
            region,
            amount,
            status: 'ready',
        })),
    };

    const totalAmount = computed.eobi.total + computed.sessi.total + computed.incomeTax;
    const { rows } = await pool.query(
        `INSERT INTO statutory_filings (authority, period_month, period_year, status, total_amount, line_count, generated_by)
         VALUES ('monthly_compliance', $1, $2, 'draft', $3, $4, 'system') RETURNING *`,
        [month, year, totalAmount, computed.headcount]
    );
    return { filing, record: rows[0] };
}

async function getInvoiceChallanStatus(pool, invoiceId) {
    const { rows } = await pool.query(
        `SELECT ci.*, cp.challans_required
         FROM client_invoices ci
         LEFT JOIN contract_policies cp ON cp.contract_id = ci.contract_id
         WHERE ci.id = $1
         ORDER BY cp.effective_from DESC NULLS LAST, cp.id DESC
         LIMIT 1`,
        [invoiceId]
    );
    if (!rows.length) return { ok: false, message: 'Invoice not found' };
    const inv = rows[0];
    const required = Array.isArray(inv.challans_required) ? inv.challans_required : (inv.challans_required ? JSON.parse(inv.challans_required) : []);
    const { rows: attachments } = await pool.query(
        `SELECT attachment_type FROM invoice_attachments WHERE invoice_id = $1`, [invoiceId]
    );
    const present = attachments.map(a => a.attachment_type);
    const missing = required.filter(c => !present.includes(c));
    return { ok: missing.length === 0, required, present, missing };
}

async function attachInvoiceChallan(pool, invoiceId, attachmentType) {
    const invId = String(invoiceId);
    const type = String(attachmentType || '').trim();
    if (!type) throw new Error('attachment_type is required');

    const { rows: inv } = await pool.query(`SELECT id FROM client_invoices WHERE id = $1`, [invId]);
    if (!inv.length) throw new Error('Invoice not found');

    await pool.query(
        `DELETE FROM invoice_attachments WHERE invoice_id = $1 AND attachment_type = $2`,
        [invId, type]
    );
    const { rows } = await pool.query(
        `INSERT INTO invoice_attachments (invoice_id, attachment_type)
         VALUES ($1, $2) RETURNING *`,
        [invId, type]
    );
    return rows[0];
}

module.exports = {
    computeStatutoryForMonth,
    upsertStatutoryLedger,
    getStatutoryLedger,
    generateFilingPreview,
    getInvoiceChallanStatus,
    attachInvoiceChallan,
};
