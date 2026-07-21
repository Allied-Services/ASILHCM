'use strict';

const { computePrSheetRow } = require('../../payroll/prSheetEngine');
const { getPolicy } = require('../constraints/service');
const { parseConfigValue } = require('../../core/jsonConfig');
const { provinceSalesTaxRate } = require('../../core/regionTax');

const DEFAULT_OT_HOURS_PER_DAY = 8;

/** MD Mandate §4 — payroll run status cycle */
const PAYROLL_RUN_STATUSES = ['draft', 'proposed', 'locked', 'paid', 'revised'];
const PAYROLL_STATUS_TRANSITIONS = {
    draft: ['proposed'],
    proposed: ['locked', 'draft'],
    locked: ['paid', 'revised'],
    paid: ['revised'],
    revised: ['proposed', 'locked'],
};

function canTransitionStatus(from, to) {
    const allowed = PAYROLL_STATUS_TRANSITIONS[from];
    return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Working days = calendar days in month − Sundays − public holidays.
 * Manual sheet override (opts.override) wins when provided.
 */
function computeWorkingDays(year, month, holidayDateSet = new Set(), opts = {}) {
    if (opts.override != null && opts.override !== '') {
        return Number(opts.override);
    }
    const daysInMonth = new Date(year, month, 0).getDate();
    let sundays = 0;
    let holidayHits = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isSunday = date.getDay() === 0;
        const isHoliday = holidayDateSet instanceof Set
            ? holidayDateSet.has(key)
            : Array.isArray(holidayDateSet) && holidayDateSet.includes(key);
        if (isSunday) sundays += 1;
        else if (isHoliday) holidayHits += 1;
    }
    return daysInMonth - sundays - holidayHits;
}

function parseJsonField(val, fallback) {
    if (val == null) return fallback;
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return fallback; }
    }
    return val;
}

function aggregateClaimInputs(claims) {
    let ot1 = 0;
    let ot2 = 0;
    let ot3 = 0;
    let opd = 0;
    let expense = 0;
    const claimIds = [];
    for (const claim of claims || []) {
        claimIds.push(claim.id);
        const items = parseJsonField(claim.claimed_items, []);
        if (claim.claim_type === 'overtime') {
            for (const item of items) {
                ot1 += Number(item.ot1 || item.ot_1x || 0);
                ot2 += Number(item.ot2 || 0);
                ot3 += Number(item.ot3 || 0);
            }
        } else if (claim.claim_type === 'medical') {
            for (const item of items) {
                opd += Number(item.amount || 0);
            }
        } else if (claim.claim_type === 'expense') {
            for (const item of items) {
                expense += Number(item.amount || 0);
            }
        }
    }
    return { ot1, ot2, ot3, opd, expense, claimIds };
}

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
        `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '(\\d+)$') AS INT)), 0) AS max_seq
         FROM client_invoices WHERE invoice_number LIKE $1`,
        [`${prefix}-%`]
    );
    const seq = parseInt(rows[0].max_seq, 10) + 1;
    return `${prefix}-${String(seq).padStart(3, '0')}`;
}

function derivePaidDays(records, workingDays, inputMode) {
    // MD Mandate §4 pillar 3: default present = working days when no attendance ledger
    if (!records || !records.length) return workingDays;
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
    let ot1 = 0;
    let ot2 = 0;
    let ot3 = 0;
    for (const r of records) {
        if (r.status !== 'ot') continue;
        const hours = Number(r.ot_hours || r.hours || DEFAULT_OT_HOURS_PER_DAY);
        const rate = Number(r.ot_rate || r.otRate || 0);
        if (rate === 1) {
            ot1 += hours;
            continue;
        }
        const bucket = classifyOtDate(r.date, holidayDateSet);
        if (bucket === 'ot3') ot3 += hours;
        else ot2 += hours;
    }
    return { ot1, ot2, ot3 };
}

function buildRateCardMap(rateCards) {
    const map = new Map();
    for (const rc of rateCards || []) {
        if (rc.role_title) map.set(rc.role_title.toLowerCase().trim(), rc);
    }
    return map;
}

function applyBillingAmount(computed, { billRate, paidDays, workingDays, ot1 = 0, ot2 = 0, ot3 = 0, policy, rateCardMatch }) {
    if (!rateCardMatch) {
        computed.billAmount = computed.totalCost;
        computed.billOtAmount = 0;
        computed.billSource = 'cost_plus';
        return computed;
    }
    const billRateNum = Number(billRate || 0);
    const billBase = workingDays ? billRateNum * paidDays / workingDays : billRateNum;
    const otDivDays = policy.ot_divisor_days || 26;
    const otDivHours = policy.ot_divisor_hours || 8;
    const billHourly = billRateNum / otDivDays / otDivHours;
    const billOtAmount = Math.round(billHourly * (1 * ot1 + 2 * ot2 + 3 * ot3));
    computed.billAmount = Math.round(billBase) + billOtAmount;
    computed.billOtAmount = billOtAmount;
    computed.billSource = 'rate_card';
    return computed;
}

async function listRateCards(pool, contractId) {
    const { rows } = await pool.query(
        `SELECT * FROM contract_rate_cards
         WHERE contract_id = $1 AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         ORDER BY role_title`,
        [contractId]
    );
    return rows;
}

async function saveRateCard(pool, data) {
    const { rows } = await pool.query(
        `INSERT INTO contract_rate_cards (contract_id, role_title, billing_basis, bill_rate, cost_rate, effective_from)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE))
         RETURNING *`,
        [
            data.contract_id || data.contractId,
            data.role_title || data.roleTitle,
            data.billing_basis || data.billingBasis || 'monthly',
            data.bill_rate != null ? data.bill_rate : data.billRate,
            data.cost_rate != null ? data.cost_rate : data.costRate,
            data.effective_from || data.effectiveFrom || null,
        ]
    );
    return rows[0];
}

async function deleteRateCard(pool, id) {
    const { rows } = await pool.query(
        `UPDATE contract_rate_cards SET effective_to = CURRENT_DATE WHERE id = $1 RETURNING *`,
        [id]
    );
    if (!rows.length) throw new Error('Rate card not found');
    return rows[0];
}

async function allocateRunToCosts(pool, runId) {
    const { rows: runRows } = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
    if (!runRows.length) return { processed: 0, inserted: 0 };
    const run = runRows[0];

    const { rows: prRows } = await pool.query(
        `SELECT prr.*, e.project_id FROM payroll_run_rows prr
         JOIN employees e ON e.id = prr.employee_id
         WHERE prr.run_id = $1`,
        [runId]
    );

    let inserted = 0;
    for (const row of prRows) {
        const computed = parseJsonField(row.computed, {});
        const amount = Number(computed.totalPayrollCost || computed.totalCost || 0);
        const sourceId = `${runId}-${row.employee_id}`;
        const exists = await pool.query(
            `SELECT 1 FROM cost_allocations WHERE source_type = 'payroll_run' AND source_id = $1 LIMIT 1`,
            [sourceId]
        );
        if (exists.rows.length) continue;
        await pool.query(
            `INSERT INTO cost_allocations (source_type, source_id, contract_id, project_id, period_month, period_year, amount, created_by)
             VALUES ('payroll_run', $1, $2, $3, $4, $5, $6, 'system')`,
            [sourceId, run.contract_id, row.project_id, run.period_month, run.period_year, amount]
        );
        inserted += 1;
    }
    return { processed: prRows.length, inserted };
}

async function computeRunForContract(pool, { contractId, month, year, workingDaysOverride }) {
    const policy = await getPolicy(pool, contractId);
    if (!policy) return { ok: false, code: 'NO_POLICY', message: 'No contract policy configured.' };

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0);
    const endStr = endDate.toISOString().slice(0, 10);

    const { rows: holidays } = await pool.query(
        `SELECT holiday_date::text AS d FROM public_holidays WHERE holiday_date >= $1::date AND holiday_date <= $2::date`,
        [startDate, endStr]
    );
    const holidayDateSet = new Set(holidays.map(h => h.d.slice(0, 10)));

    // Pillar 2: calendar working days (Sundays + holidays excluded), with sheet/policy override
    const override = workingDaysOverride != null
        ? workingDaysOverride
        : (policy.working_days_override != null ? policy.working_days_override : null);
    const workingDays = override != null
        ? computeWorkingDays(year, month, holidayDateSet, { override })
        : (policy.use_calendar_working_days === false
            ? Number(policy.standard_month_days || 30)
            : computeWorkingDays(year, month, holidayDateSet));

    const { rows: employees } = await pool.query(
        `SELECT id, name, salary, doj, designation FROM employees WHERE contract_id = $1 OR contract_name = $1`,
        [contractId]
    );

    const rateCards = await listRateCards(pool, contractId);
    const rateCardMap = buildRateCardMap(rateCards);

    const { rows: runRows } = await pool.query(
        `INSERT INTO payroll_runs (contract_id, period_month, period_year, status, computed_at)
         VALUES ($1, $2, $3, 'draft', NOW())
         ON CONFLICT (contract_id, period_month, period_year)
         DO UPDATE SET computed_at = NOW(), status = CASE
             WHEN payroll_runs.status IN ('invoiced', 'locked', 'paid') THEN payroll_runs.status
             ELSE 'draft' END
         RETURNING *`,
        [contractId, month, year]
    );
    const run = runRows[0];
    if (['locked', 'invoiced', 'paid'].includes(run.status)) {
        return { ok: false, code: 'RUN_LOCKED', message: `Run is ${run.status} and cannot be recomputed.` };
    }

    await pool.query(
        `UPDATE employee_claims SET status = 'focal_approved', payroll_run_id = NULL
         WHERE payroll_run_id = $1 AND status = 'in_payroll_run'`,
        [run.id]
    );

    const warnings = [];
    const rowPayloads = [];
    let totalNetPay = 0;
    let totalPayrollCost = 0;
    let totalServiceCharges = 0;
    let totalSalesTax = 0;
    let totalInvoice = 0;
    let totalBillable = 0;
    let hasRateCardBilling = false;

    for (const emp of employees) {
        const { rows: att } = await pool.query(
            `SELECT date::text AS date, status, hours, ot_hours, ot_rate FROM attendance_records
             WHERE employee_id = $1 AND date >= $2::date AND date <= $3::date`,
            [emp.id, startDate, endStr]
        );

        if (!att.length) warnings.push({ employeeId: emp.id, code: 'NO_ATTENDANCE', message: `${emp.name}: no attendance — defaulting present days to ${workingDays}` });

        let paidDays = derivePaidDays(att, workingDays, policy.attendance_input_mode);
        let { ot1, ot2, ot3 } = deriveOtHours(att, holidayDateSet);

        // 15-column monthly hub overrides (Model A present days + OT) take precedence
        const { rows: overrideRows } = await pool.query(
            `SELECT present_days, ot2_hours, ot3_hours, opd, expense, arrears,
                    special_allowance, fuel_mobile, other_deduction
             FROM monthly_attendance_overrides
             WHERE employee_id = $1 AND period_month = $2 AND period_year = $3`,
            [emp.id, month, year]
        ).catch(() => ({ rows: [] }));
        const ov = overrideRows[0];
        let presentDaysForModelA = null;
        if (ov) {
            if (ov.present_days != null) {
                presentDaysForModelA = Number(ov.present_days);
                paidDays = presentDaysForModelA;
            }
            if (ov.ot2_hours != null) ot2 = Number(ov.ot2_hours) || 0;
            if (ov.ot3_hours != null) ot3 = Number(ov.ot3_hours) || 0;
        }

        const { rows: claimRows } = await pool.query(
            `SELECT * FROM employee_claims
             WHERE employee_id = $1 AND status = 'focal_approved'
               AND period_month = $2 AND period_year = $3`,
            [emp.id, month, year]
        );
        const claimAgg = aggregateClaimInputs(claimRows);
        ot1 += claimAgg.ot1;
        ot2 += claimAgg.ot2;
        ot3 += claimAgg.ot3;

        const inputs = {};
        if (claimAgg.opd) inputs.opd = claimAgg.opd;
        if (claimAgg.expense) inputs.expense = claimAgg.expense;
        if (ov) {
            if (ov.opd != null) inputs.opd = Number(ov.opd) || 0;
            if (ov.expense != null) inputs.expense = Number(ov.expense) || 0;
            if (ov.arrears != null) inputs.arrears = Number(ov.arrears) || 0;
            if (ov.special_allowance != null) inputs.specialAllowance = Number(ov.special_allowance) || 0;
            if (ov.fuel_mobile != null) inputs.fuelMobile = Number(ov.fuel_mobile) || 0;
            if (ov.other_deduction != null) inputs.otherDeduction = Number(ov.other_deduction) || 0;
        }

        if (!policy.ot_allowed) {
            if (ot1 + ot2 + ot3 > 0) warnings.push({ employeeId: emp.id, code: 'OT_NOT_ALLOWED', message: `${emp.name}: OT not allowed on contract` });
            ot1 = 0;
            ot2 = 0;
            ot3 = 0;
        } else if (policy.ot_monthly_cap_hours != null) {
            const cap = Number(policy.ot_monthly_cap_hours);
            const totalOt = ot1 + ot2 + ot3;
            if (totalOt > cap) {
                const ratio = cap / totalOt;
                ot1 = Math.round(ot1 * ratio * 100) / 100;
                ot2 = Math.round(ot2 * ratio * 100) / 100;
                ot3 = Math.round(ot3 * ratio * 100) / 100;
                warnings.push({ employeeId: emp.id, code: 'OT_CAPPED', message: `${emp.name}: OT capped to ${cap}h` });
            }
        }

        const salesTaxRate = policy.sales_tax_exempt
            ? 0
            : Number(policy.sales_tax_rate != null ? policy.sales_tax_rate : 0.18);
        let computed = computePrSheetRow({
            newSalary: Number(emp.salary || 0),
            paidDays,
            workingDays,
            // Model A: Expected = calendar working days (Sundays/holidays already excluded from expected)
            presentDays: presentDaysForModelA != null ? presentDaysForModelA : paidDays,
            expectedDays: workingDays,
            modelA: true,
            ot1,
            ot2,
            ot3,
            salesTaxRate,
            ...inputs,
        }, policy);

        const designation = (emp.designation || '').toLowerCase().trim();
        const rateCard = designation ? rateCardMap.get(designation) : null;
        computed = applyBillingAmount(computed, {
            billRate: rateCard?.bill_rate,
            paidDays,
            workingDays,
            ot1,
            ot2,
            ot3,
            policy,
            rateCardMatch: !!rateCard,
        });
        if (computed.billSource === 'rate_card') hasRateCardBilling = true;

        totalNetPay += Number(computed.netPay || 0);
        totalPayrollCost += Number(computed.totalPayrollCost || 0);
        totalServiceCharges += Number(computed.serviceCharges || 0);
        totalSalesTax += Number(computed.salesTax || 0);
        totalInvoice += Number(computed.totalCost || 0);
        totalBillable += Number(computed.billAmount || computed.totalCost || 0);

        rowPayloads.push({
            employee_id: emp.id,
            employee_name: emp.name,
            paid_days: paidDays,
            working_days: workingDays,
            ot1_hours: ot1,
            ot2_hours: ot2,
            ot3_hours: ot3,
            inputs,
            computed,
            source: att.length ? 'attendance' : 'default',
            claimsApplied: claimAgg.claimIds.length,
            claimIds: claimAgg.claimIds,
        });
    }

    await pool.query(`DELETE FROM payroll_run_rows WHERE run_id = $1`, [run.id]);
    for (const row of rowPayloads) {
        await pool.query(
            `INSERT INTO payroll_run_rows (run_id, employee_id, paid_days, working_days, ot2_hours, ot3_hours, inputs, computed)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [run.id, row.employee_id, row.paid_days, row.working_days, row.ot2_hours, row.ot3_hours,
                JSON.stringify({ ...row.inputs, ot1_hours: row.ot1_hours, source: row.source }), JSON.stringify(row.computed)]
        );
        if (row.claimIds?.length) {
            await pool.query(
                `UPDATE employee_claims SET status = 'in_payroll_run', payroll_run_id = $1, updated_at = NOW()
                 WHERE id = ANY($2::int[])`,
                [run.id, row.claimIds]
            );
        }
    }

    const margin = totalBillable - totalPayrollCost;

    return {
        ok: true,
        run,
        rows: rowPayloads,
        headcount: rowPayloads.length,
        workingDays,
        totalNetPay,
        totalPayrollCost,
        totalServiceCharges,
        totalSalesTax,
        totalInvoice,
        totalBillable,
        margin,
        hasRateCardBilling,
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
        `SELECT prr.*, e.name AS employee_name,
                (SELECT COUNT(*)::int FROM employee_claims ec
                 WHERE ec.payroll_run_id = $2 AND ec.employee_id = prr.employee_id AND ec.status = 'in_payroll_run') AS claims_applied
         FROM payroll_run_rows prr
         LEFT JOIN employees e ON e.id = prr.employee_id
         WHERE prr.run_id = $1 ORDER BY e.name`,
        [run.id, run.id]
    );
    return {
        run,
        rows: runRows.map(r => ({
            ...r,
            computed: parseJsonField(r.computed, {}),
            inputs: parseJsonField(r.inputs, {}),
            claimsApplied: Number(r.claims_applied || 0),
            source: (parseJsonField(r.inputs, {})?.overridden_by ? 'override' : (parseJsonField(r.inputs, {})?.source || 'attendance')),
        })),
    };
}

async function patchRunRow(pool, { runId, rowId, patch, overriddenBy }) {
    const { rows: runRows } = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
    if (!runRows.length) throw new Error('Run not found');
    if (!['draft', 'proposed', 'revised'].includes(runRows[0].status)) {
        throw new Error('Cannot edit a locked, paid, or invoiced run');
    }

    const { rows: rowRows } = await pool.query(
        `SELECT prr.*, e.salary, e.designation FROM payroll_run_rows prr JOIN employees e ON e.id = prr.employee_id WHERE prr.id = $1 AND prr.run_id = $2`,
        [rowId, runId]
    );
    if (!rowRows.length) throw new Error('Row not found');
    const row = rowRows[0];
    const policy = await getPolicy(pool, runRows[0].contract_id);
    const prevInputs = parseJsonField(row.inputs, {});
    const inputs = { ...prevInputs, ...patch, overridden_by: overriddenBy, source: 'override' };
    const paidDays = patch.paidDays != null ? Number(patch.paidDays) : Number(row.paid_days);
    const ot1 = patch.ot1 != null ? Number(patch.ot1) : Number(prevInputs.ot1_hours || prevInputs.ot1 || 0);
    const ot2 = patch.ot2 != null ? Number(patch.ot2) : Number(row.ot2_hours);
    const ot3 = patch.ot3 != null ? Number(patch.ot3) : Number(row.ot3_hours);
    const workingDays = patch.workingDays != null
        ? Number(patch.workingDays)
        : Number(row.working_days || policy?.standard_month_days || 30);
    let computed = computePrSheetRow({
        newSalary: Number(row.salary || 0),
        paidDays,
        workingDays,
        presentDays: patch.presentDays != null ? Number(patch.presentDays) : paidDays,
        expectedDays: workingDays,
        modelA: true,
        ot1,
        ot2,
        ot3,
        salesTaxRate: 0.18,
        ...inputs,
    }, policy || {});

    const rateCards = await listRateCards(pool, runRows[0].contract_id);
    const rateCardMap = buildRateCardMap(rateCards);
    const designation = (row.designation || '').toLowerCase().trim();
    const rateCard = designation ? rateCardMap.get(designation) : null;
    computed = applyBillingAmount(computed, {
        billRate: rateCard?.bill_rate,
        paidDays,
        workingDays,
        ot1,
        ot2,
        ot3,
        policy: policy || {},
        rateCardMatch: !!rateCard,
    });

    inputs.ot1_hours = ot1;
    const { rows: updated } = await pool.query(
        `UPDATE payroll_run_rows SET paid_days=$1, working_days=$2, ot2_hours=$3, ot3_hours=$4, inputs=$5, computed=$6 WHERE id=$7 RETURNING *`,
        [paidDays, workingDays, ot2, ot3, JSON.stringify(inputs), JSON.stringify(computed), rowId]
    );
    return updated[0];
}

async function lockRun(pool, { runId, lockedBy }) {
    const { rows: current } = await pool.query(`SELECT status FROM payroll_runs WHERE id = $1`, [runId]);
    if (!current.length) throw new Error('Run not found');
    const from = current[0].status;
    // Accept draft or proposed → locked (legacy draft→locked still allowed for UX)
    if (!['draft', 'proposed'].includes(from)) {
        throw new Error('Run not found or already locked/invoiced');
    }
    const { rows } = await pool.query(
        `UPDATE payroll_runs SET status = 'locked', locked_at = NOW(), locked_by = $2
         WHERE id = $1 RETURNING *`,
        [runId, lockedBy]
    );
    await allocateRunToCosts(pool, runId);
    return rows[0];
}

async function transitionRunStatus(pool, { runId, toStatus, actor }) {
    const to = String(toStatus || '').toLowerCase();
    if (!PAYROLL_RUN_STATUSES.includes(to)) {
        throw new Error(`Invalid status '${toStatus}'. Allowed: ${PAYROLL_RUN_STATUSES.join(', ')}`);
    }
    const { rows: current } = await pool.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
    if (!current.length) throw new Error('Run not found');
    const from = current[0].status;
    // Allow legacy draft→locked shortcut
    const ok = canTransitionStatus(from, to) || (from === 'draft' && to === 'locked');
    if (!ok) throw new Error(`Cannot transition payroll run from '${from}' to '${to}'`);

    const extras = [];
    const params = [runId, to];
    if (to === 'locked') {
        extras.push(`, locked_at = NOW(), locked_by = $${params.length + 1}`);
        params.push(actor || null);
    }
    const { rows } = await pool.query(
        `UPDATE payroll_runs SET status = $2 ${extras.join('')} WHERE id = $1 RETURNING *`,
        params
    );
    if (to === 'locked') await allocateRunToCosts(pool, runId);
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
    let hasRateCardBilling = false;
    for (const r of prRows) {
        const c = parseJsonField(r.computed, {});
        if (c.billSource === 'rate_card') hasRateCardBilling = true;
        subtotal += Number(c.totalPayrollCost || 0);
        serviceCharges += Number(c.serviceCharges || 0);
        salesTax += Number(c.salesTax || 0);
        grandTotal += Number(c.billAmount || c.totalCost || 0);
    }

    const policy = await getPolicy(pool, contract.id);
    const creditDays = Number(policy?.credit_days) || 30;

    let invoiceNotes = `Generated from payroll run #${runId}`;

    if (hasRateCardBilling) {
        subtotal = grandTotal;
        serviceCharges = 0;
        salesTax = 0;

        const { rows: taxCfg } = await pool.query(`SELECT value FROM system_config WHERE key = 'region_tax'`);
        const regionRatesRaw = taxCfg.length ? parseConfigValue(taxCfg[0].value) : [];
        const regionRates = Array.isArray(regionRatesRaw) ? regionRatesRaw : [];

        const { rows: provinceRows } = await pool.query(
            `SELECT e.province, COUNT(*) AS cnt
             FROM payroll_run_rows prr
             JOIN employees e ON e.id = prr.employee_id
             WHERE prr.run_id = $1 AND e.province IS NOT NULL AND TRIM(e.province) <> ''
             GROUP BY e.province
             ORDER BY cnt DESC
             LIMIT 1`,
            [runId]
        );
        const majorityProvince = provinceRows[0]?.province || null;

        if (majorityProvince) {
            const rate = provinceSalesTaxRate(majorityProvince, regionRates);
            salesTax = Math.round(grandTotal * rate);
            grandTotal += salesTax;
        } else {
            invoiceNotes += ' No employee province — sales tax not applied.';
        }
    }

    const invNo = await generateInvoiceNumber(pool, run.period_year, run.period_month);
    const lineDesc = hasRateCardBilling
        ? `Manpower services (per contract rate card) — ${run.period_month}/${run.period_year} — ${prRows.length} staff`
        : `Manpower services — ${run.period_month}/${run.period_year} — ${prRows.length} staff`;
    const lineItems = [{ description: lineDesc, amount: grandTotal }];

    const { rows: invRows } = await pool.query(
        `INSERT INTO client_invoices
         (invoice_number, client, contract, contract_id, period_month, period_year,
          line_items, subtotal, service_charges, sales_tax, wht, grand_total, notes, status, created_by, due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,'Draft',$13,(CURRENT_DATE + ($14 || ' days')::interval)::date) RETURNING *`,
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
            invoiceNotes,
            generatedBy,
            String(creditDays),
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

async function importHistoricRun(pool, { contractId, month, year, rows, importedBy }) {
    if (!contractId || !month || !year || !Array.isArray(rows) || !rows.length) {
        return { ok: false, code: 'INVALID_PAYLOAD', message: 'contractId, month, year, and rows required' };
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: runRows } = await client.query(
            `INSERT INTO payroll_runs (contract_id, period_month, period_year, status, computed_at, locked_at, locked_by)
             VALUES ($1, $2, $3, 'locked', NOW(), NOW(), $4)
             ON CONFLICT (contract_id, period_month, period_year)
             DO UPDATE SET computed_at = NOW(), locked_at = NOW(), locked_by = $4,
                           status = CASE WHEN payroll_runs.status = 'invoiced' THEN payroll_runs.status ELSE 'locked' END
             RETURNING *`,
            [contractId, month, year, importedBy || 'excel_import']
        );
        const run = runRows[0];
        await client.query(`DELETE FROM payroll_run_rows WHERE run_id = $1`, [run.id]);

        let inserted = 0;
        for (const row of rows) {
            const employeeId = row.employee_id || row.employeeId;
            if (!employeeId) continue;
            const inputs = { ...(row.inputs || {}), source: 'excel_import' };
            const computed = row.computed || {};
            await client.query(
                `INSERT INTO payroll_run_rows
                 (run_id, employee_id, paid_days, working_days, ot2_hours, ot3_hours, inputs, computed)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (run_id, employee_id)
                 DO UPDATE SET paid_days = EXCLUDED.paid_days, working_days = EXCLUDED.working_days,
                               ot2_hours = EXCLUDED.ot2_hours, ot3_hours = EXCLUDED.ot3_hours,
                               inputs = EXCLUDED.inputs, computed = EXCLUDED.computed`,
                [
                    run.id,
                    employeeId,
                    row.paid_days ?? row.paidDays ?? null,
                    row.working_days ?? row.workingDays ?? null,
                    row.ot2_hours ?? row.ot2Hours ?? 0,
                    row.ot3_hours ?? row.ot3Hours ?? 0,
                    JSON.stringify(inputs),
                    JSON.stringify(computed),
                ]
            );
            inserted += 1;
        }
        await client.query('COMMIT');
        if (run.status !== 'invoiced') {
            await allocateRunToCosts(pool, run.id);
        }
        return { ok: true, runId: run.id, rowsInserted: inserted, status: run.status };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    PAYROLL_RUN_STATUSES,
    canTransitionStatus,
    computeWorkingDays,
    aggregateClaimInputs,
    classifyOtDate,
    derivePaidDays,
    deriveOtHours,
    applyBillingAmount,
    allocateRunToCosts,
    computeRunForContract,
    getPayrollRuns,
    patchRunRow,
    lockRun,
    transitionRunStatus,
    generateInvoiceFromRun,
    generateInvoiceNumber,
    listRateCards,
    saveRateCard,
    deleteRateCard,
    listHolidays,
    saveHoliday,
    deleteHoliday,
    importHistoricRun,
};
