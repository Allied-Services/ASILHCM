'use strict';

const { computePrSheetRow } = require('../../payroll/prSheetEngine');
const { getPolicy } = require('../constraints/service');

const DEFAULT_OT_HOURS_PER_DAY = 8;

function classifyOtDate(date, holidayDateSet) {
    const d = date instanceof Date ? date : new Date(date);
    const key = d.toISOString().slice(0, 10);
    if (holidayDateSet.has(key)) return 'ot3';
    if (d.getDay() === 0) return 'ot2';
    return 'ot2';
}

async function generateInvoiceNumber(pool, year, month) {
    const monthAbbr = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yr2 = String(year).slice(-2);
    const prefix = `INV-${monthAbbr}${yr2}`;
    const { rows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM client_invoices WHERE invoice_number LIKE $1`,
        [`${prefix}-%`]
    );
    const seq = parseInt(rows[0].cnt, 10) + 1;
    return `${prefix}-${String(seq).padStart(3, '0')}`;
}

function derivePaidDays(records, workingDays, inputMode) {
    if (inputMode === 'absent_only') {
        const absences = records.filter(r => ['absent', 'unexcused'].includes(r.status)).length;
        return Math.max(0, workingDays - absences);
    }
    let paid = 0;
    for (const r of records) {
        if (['present', 'ot'].includes(r.status)) paid += 1;
        else if (r.status === 'half_day') paid += 0.5;
        else if (r.status === 'leave') paid += 1;
    }
    return paid;
}

function deriveOtHours(records, holidayDateSet) {
    let ot2 = 0;
    let ot3 = 0;
    for (const r of records) {
        if (r.status !== 'ot') continue;
        const hours = Number(r.ot_hours || r.hours || DEFAULT_OT_HOURS_PER_DAY);
        const bucket = classifyOtDate(r.date, holidayDateSet);
        if (bucket === 'ot3') ot3 += hours;
        else ot2 += hours;
    }
    return { ot2, ot3 };
}

async function computeRunForContract(pool, { contractId, month, year }) {
    const policy = await getPolicy(pool, contractId);
    if (!policy) return { ok: false, code: 'NO_POLICY', message: 'No contract policy configured.' };

    const workingDays = Number(policy.standard_month_days || 30);
    const { rows: employees } = await pool.query(
        `SELECT id, name, salary, doj FROM employees WHERE contract_id = $1 OR contract_name = $1`,
        [contractId]
    );

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0);
    const endStr = endDate.toISOString().slice(0, 10);

    const { rows: holidays } = await pool.query(
        `SELECT holiday_date::text AS d FROM public_holidays WHERE holiday_date >= $1::date AND holiday_date <= $2::date`,
        [startDate, endStr]
    );
    const holidayDateSet = new Set(holidays.map(h => h.d.slice(0, 10)));

    const warnings = [];
    const rowPayloads = [];
    let totalNetPay = 0;
    let totalPayrollCost = 0;
    let totalServiceCharges = 0;
    let totalSalesTax = 0;
    let totalInvoice = 0;

    for (const emp of employees) {
        const { rows: att } = await pool.query(
            `SELECT date::text AS date, status, hours, ot_hours FROM attendance_records
             WHERE employee_id = $1 AND date >= $2::date AND date <= $3::date`,
            [emp.id, startDate, endStr]
        );

        if (!att.length) warnings.push({ employeeId: emp.id, code: 'NO_ATTENDANCE', message: `${emp.name}: no attendance for period` });

        const paidDays = derivePaidDays(att, workingDays, policy.attendance_input_mode);
        let { ot2, ot3 } = deriveOtHours(att, holidayDateSet);
        const inputs = {};

        if (!policy.ot_allowed) {
            if (ot2 + ot3 > 0) warnings.push({ employeeId: emp.id, code: 'OT_NOT_ALLOWED', message: `${emp.name}: OT not allowed on contract` });
            ot2 = 0;
            ot3 = 0;
        } else if (policy.ot_monthly_cap_hours != null) {
            const cap = Number(policy.ot_monthly_cap_hours);
            const totalOt = ot2 + ot3;
            if (totalOt > cap) {
                const ratio = cap / totalOt;
                ot2 = Math.round(ot2 * ratio * 100) / 100;
                ot3 = Math.round(ot3 * ratio * 100) / 100;
                warnings.push({ employeeId: emp.id, code: 'OT_CAPPED', message: `${emp.name}: OT capped to ${cap}h` });
            }
        }

        const computed = computePrSheetRow({
            newSalary: Number(emp.salary || 0),
            paidDays,
            workingDays,
            ot2,
            ot3,
            salesTaxRate: 0.18,
            ...inputs,
        }, policy);

        totalNetPay += Number(computed.netPay || 0);
        totalPayrollCost += Number(computed.totalPayrollCost || 0);
        totalServiceCharges += Number(computed.serviceCharges || 0);
        totalSalesTax += Number(computed.salesTax || 0);
        totalInvoice += Number(computed.totalCost || 0);

        rowPayloads.push({
            employee_id: emp.id,
            employee_name: emp.name,
            paid_days: paidDays,
            working_days: workingDays,
            ot2_hours: ot2,
            ot3_hours: ot3,
            inputs,
            computed,
            source: att.length ? 'attendance' : 'default',
        });
    }

    const { rows: runRows } = await pool.query(
        `INSERT INTO payroll_runs (contract_id, period_month, period_year, status, computed_at)
         VALUES ($1, $2, $3, 'draft', NOW())
         ON CONFLICT (contract_id, period_month, period_year)
         DO UPDATE SET computed_at = NOW(), status = CASE WHEN payroll_runs.status = 'invoiced' THEN payroll_runs.status ELSE 'draft' END
         RETURNING *`,
        [contractId, month, year]
    );
    const run = runRows[0];
    if (run.status === 'locked' || run.status === 'invoiced') {
        return { ok: false, code: 'RUN_LOCKED', message: `Run is ${run.status} and cannot be recomputed.` };
    }

    await pool.query(`DELETE FROM payroll_run_rows WHERE run_id = $1`, [run.id]);
    for (const row of rowPayloads) {
        await pool.query(
            `INSERT INTO payroll_run_rows (run_id, employee_id, paid_days, working_days, ot2_hours, ot3_hours, inputs, computed)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [run.id, row.employee_id, row.paid_days, row.working_days, row.ot2_hours, row.ot3_hours,
                JSON.stringify(row.inputs), JSON.stringify(row.computed)]
        );
    }

    return {
        ok: true,
        run,
        rows: rowPayloads,
        headcount: rowPayloads.length,
        totalNetPay,
        totalPayrollCost,
        totalServiceCharges,
        totalSalesTax,
        totalInvoice,
        warnings,
    };
}

async function getPayrollRuns(pool, { contractId, month, year } = {}) {
    const params = [];
    let sql = `SELECT * FROM payroll_runs WHERE 1=1`;
    if (contractId) { params.push(contractId); sql += ` AND contract_id = $${params.length}`; }
    if (month) { params.push(month); sql += ` AND period_month = $${params.length}`; }
    if (year) { params.push(year); sql += ` AND period_year = $${params.length}`; }
    sql += ` ORDER BY period_year DESC, period_month DESC`;
    const { rows: runs } = await pool.query(sql, params);
    if (!runs.length) return { runs: [], rows: [] };
    const run = runs[0];
    const { rows: runRows } = await pool.query(
        `SELECT prr.*, e.name AS employee_name FROM payroll_run_rows prr
         LEFT JOIN employees e ON e.id = prr.employee_id
         WHERE prr.run_id = $1 ORDER BY e.name`,
        [run.id]
    );
    return {
        run,
        rows: runRows.map(r => ({
            ...r,
            computed: typeof r.computed === 'string' ? JSON.parse(r.computed) : r.computed,
            inputs: typeof r.inputs === 'string' ? JSON.parse(r.inputs) : r.inputs,
            source: (r.inputs?.overridden_by ? 'override' : (r.inputs?.source || 'attendance')),
        })),
    };
}

async function patchRunRow(pool, { runId, rowId, patch, overriddenBy }) {
    const { rows: runRows } = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
    if (!runRows.length) throw new Error('Run not found');
    if (runRows[0].status !== 'draft') throw new Error('Cannot edit a locked or invoiced run');

    const { rows: rowRows } = await pool.query(
        `SELECT prr.*, e.salary FROM payroll_run_rows prr JOIN employees e ON e.id = prr.employee_id WHERE prr.id = $1 AND prr.run_id = $2`,
        [rowId, runId]
    );
    if (!rowRows.length) throw new Error('Row not found');
    const row = rowRows[0];
    const policy = await getPolicy(pool, runRows[0].contract_id);
    const inputs = { ...(typeof row.inputs === 'string' ? JSON.parse(row.inputs) : row.inputs), ...patch, overridden_by: overriddenBy, source: 'override' };
    const paidDays = patch.paidDays != null ? Number(patch.paidDays) : Number(row.paid_days);
    const ot2 = patch.ot2 != null ? Number(patch.ot2) : Number(row.ot2_hours);
    const ot3 = patch.ot3 != null ? Number(patch.ot3) : Number(row.ot3_hours);
    const computed = computePrSheetRow({
        newSalary: Number(row.salary || 0),
        paidDays,
        workingDays: Number(row.working_days || policy?.standard_month_days || 30),
        ot2,
        ot3,
        salesTaxRate: 0.18,
        ...inputs,
    }, policy || {});

    const { rows: updated } = await pool.query(
        `UPDATE payroll_run_rows SET paid_days=$1, ot2_hours=$2, ot3_hours=$3, inputs=$4, computed=$5 WHERE id=$6 RETURNING *`,
        [paidDays, ot2, ot3, JSON.stringify(inputs), JSON.stringify(computed), rowId]
    );
    return updated[0];
}

async function lockRun(pool, { runId, lockedBy }) {
    const { rows } = await pool.query(
        `UPDATE payroll_runs SET status = 'locked', locked_at = NOW(), locked_by = $2
         WHERE id = $1 AND status = 'draft' RETURNING *`,
        [runId, lockedBy]
    );
    if (!rows.length) throw new Error('Run not found or already locked/invoiced');
    return rows[0];
}

async function generateInvoiceFromRun(pool, { runId, generatedBy }) {
    const { rows: runRows } = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
    if (!runRows.length) throw new Error('Run not found');
    const run = runRows[0];
    if (run.status !== 'locked') throw new Error('Run must be locked before invoicing');

    const { rows: contractRows } = await pool.query(
        `SELECT c.*, cl.name AS client_name FROM contracts c
         LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`,
        [run.contract_id]
    );
    const contract = contractRows[0];
    if (!contract) throw new Error('Contract not found');

    const { rows: prRows } = await pool.query(`SELECT computed FROM payroll_run_rows WHERE run_id = $1`, [runId]);
    let subtotal = 0;
    let serviceCharges = 0;
    let salesTax = 0;
    let grandTotal = 0;
    for (const r of prRows) {
        const c = typeof r.computed === 'string' ? JSON.parse(r.computed) : r.computed;
        subtotal += Number(c.totalPayrollCost || 0);
        serviceCharges += Number(c.serviceCharges || 0);
        salesTax += Number(c.salesTax || 0);
        grandTotal += Number(c.totalCost || 0);
    }

    const invNo = await generateInvoiceNumber(pool, run.period_year, run.period_month);
    const lineItems = [{
        description: `Manpower services — ${run.period_month}/${run.period_year} — ${prRows.length} staff`,
        amount: grandTotal,
    }];

    const { rows: invRows } = await pool.query(
        `INSERT INTO client_invoices
         (invoice_number, client, contract, contract_id, period_month, period_year,
          line_items, subtotal, service_charges, sales_tax, wht, grand_total, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,'Draft',$13) RETURNING *`,
        [
            invNo,
            contract.client_name || contract.contract_name,
            contract.contract_name,
            contract.id,
            run.period_month,
            run.period_year,
            JSON.stringify(lineItems),
            subtotal,
            serviceCharges,
            salesTax,
            grandTotal,
            `Generated from payroll run #${runId}`,
            generatedBy,
        ]
    );

    await pool.query(
        `UPDATE payroll_runs SET status = 'invoiced', invoice_id = $2 WHERE id = $1`,
        [runId, String(invRows[0].id)]
    );

    return { invoice: invRows[0], runId };
}

async function listHolidays(pool) {
    const { rows } = await pool.query(`SELECT * FROM public_holidays ORDER BY holiday_date`);
    return rows;
}

async function saveHoliday(pool, { holiday_date, name, multiplier }) {
    const { rows } = await pool.query(
        `INSERT INTO public_holidays (holiday_date, name, multiplier) VALUES ($1,$2,$3)
         ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name, multiplier = EXCLUDED.multiplier
         RETURNING *`,
        [holiday_date, name, multiplier != null ? Number(multiplier) : 3.0]
    );
    return rows[0];
}

async function deleteHoliday(pool, id) {
    await pool.query(`DELETE FROM public_holidays WHERE id = $1`, [id]);
}

module.exports = {
    classifyOtDate,
    computeRunForContract,
    getPayrollRuns,
    patchRunRow,
    lockRun,
    generateInvoiceFromRun,
    listHolidays,
    saveHoliday,
    deleteHoliday,
};
