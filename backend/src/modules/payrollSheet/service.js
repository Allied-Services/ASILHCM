'use strict';

/**
 * World A Payroll Sheet — server-only calculate.
 * Rebuilds pay from employee master + attendance + approved claims + input overrides,
 * computes via prSheetEngine, persists to payroll_transactions.
 */

const { getPolicy } = require('../constraints/service');
const {
    computePrSheetRow,
    computeMedicalCoverage,
    resolvePayrollSheetBonus,
} = require('../../payroll/prSheetEngine');
const { loadBonusWorkingMap, isWafiBpoJulyContext } = require('../../payroll/julyBonusAccrual');
const {
    aggregateClaimInputs,
    computeWorkingDays,
    derivePaidDays,
    deriveOtHours,
} = require('../payrollrun/service');
const {
    resolvePayrollSheetInputs,
    resolvePayrollSheetPaidDays,
} = require('./resolveInputs');
const cutover = require('../../core/cutover');

const DEFAULT_POLICY = {
    standard_month_days: 30,
    service_charge_pct: 0.18,
    edu_cess_enabled: false,
    ot_divisor_days: 26,
    ot_divisor_hours: 8,
    ot_allowed: true,
    attendance_input_mode: 'present_days',
};

function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function periodBounds(year, month) {
    const y = Number(year);
    const m = Number(month);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end, lastDay };
}

async function assertMonthUnlocked(pool, year, month) {
    const { rows } = await pool.query(
        `SELECT 1 FROM payroll_transactions
         WHERE year = $1 AND month = $2 AND locked = TRUE
         LIMIT 1`,
        [year, month],
    );
    if (rows.length) {
        const err = new Error('Payroll for this month is locked. Unlock before calculating.');
        err.code = 'PAYROLL_LOCKED';
        err.status = 403;
        throw err;
    }
}

async function loadAttendanceBatch(pool, empIds, startDate, endStr) {
    if (!empIds.length) return [];
    const params = [empIds, startDate, endStr];
    const where = `WHERE employee_id = ANY($1::text[]) AND date >= $2::date AND date <= $3::date`;
    try {
        const { rows } = await pool.query(
            `SELECT employee_id, date::text AS date, status, hours, ot_hours, ot_rate
             FROM attendance_records ${where}`,
            params,
        );
        return rows;
    } catch (err) {
        if (!/ot_rate/i.test(err.message || '')) throw err;
        const { rows } = await pool.query(
            `SELECT employee_id, date::text AS date, status, hours, ot_hours
             FROM attendance_records ${where}`,
            params,
        );
        return rows;
    }
}

function sheetCalcFromEngine(computed, ov, inputs) {
    const advanceDed = num(ov.advance_deduction);
    const loanDed = num(ov.loan_deduction);
    let netPay = num(computed.netPay);
    if (advanceDed || loanDed) netPay = Math.round(netPay - advanceDed - loanDed);

    const contractSalary = num(inputs.newSalary != null ? inputs.newSalary : inputs.salary);
    const basicPaid = num(computed.salaryForDays);
    const absentDays = computed.modelA && computed.modelA.absentDays != null
        ? num(computed.modelA.absentDays)
        : Math.max(0, num(computed.workingDays) - num(computed.paidDays));
    const absenceDeduction = Math.max(0, Math.round(contractSalary) - Math.round(basicPaid));

    return {
        // Prefer engine paid days (calendar/model-A factor) — never back-solve from money.
        pd: num(computed.paidDays, ov.paid_days),
        basicPaid,
        hraPaid: 0,
        convPaid: 0,
        medPaid: 0,
        otherPaid: num(ov.special_allowance),
        absentDays,
        absenceDeduction,
        ot2hrs: num(computed.ot2Hours != null ? computed.ot2Hours : ov.ot2_hrs),
        ot3hrs: num(computed.ot3Hours != null ? computed.ot3Hours : ov.ot3_hrs),
        ot2Amount: 0,
        ot3Amount: 0,
        otAmount: num(computed.overtimeAmount),
        opdClaim: num(inputs.opd != null ? inputs.opd : ov.opd_claim),
        reimb: num(inputs.expense != null ? inputs.expense : ov.reimbursement),
        arrears: num(inputs.arrears != null ? inputs.arrears : ov.arrears),
        splAllow: num(inputs.specialAllowance != null ? inputs.specialAllowance : ov.special_allowance),
        fuelMob: num(inputs.fuelMobile != null ? inputs.fuelMobile : ov.fuel_mobile),
        grossMonthly: num(computed.gross),
        taxableMonthly: Math.max(0, num(computed.gross) - num(computed.bonusDisbursed)),
        incomeTax: num(computed.wht),
        eobi_ee: num(computed.eobiEmployee),
        pfEE: num(computed.pfDeduction),
        advanceDed,
        loanDed,
        totalDeductions: num(computed.wht) + num(computed.eobiEmployee) + num(computed.pfDeduction) + advanceDed + loanDed,
        netPay,
        eobi_er: num(computed.eobiEmployer),
        sessi: num(computed.sessiEmployer),
        gratuity: num(computed.gratuityAccrual),
        lifeIns: num(computed.lifeInsurance != null ? computed.lifeInsurance : 0),
        medEE: num(ov.medical_ee),
        medSP: num(ov.medical_sp),
        medCh1: num(ov.medical_ch1),
        medCh2: num(ov.medical_ch2),
        pfER: num(computed.pfDeduction),
        bonusAccrual: num(computed.bonusAccrual),
        bonusAmount: num(computed.bonusDisbursed),
        bonusDisbursed: num(computed.bonusDisbursed),
        overhead: 0,
        totalPayrollCost: num(computed.totalPayrollCost),
        serviceCharges: num(computed.serviceCharges),
        salesTax: num(computed.salesTax),
        totalInvoice: num(computed.totalCost),
        serverComputed: true,
    };
}

async function loadSheetEmployees(pool, { year, month, client, contractId, employeeIds }) {
    const params = [];
    const clauses = [
        `COALESCE(LOWER(TRIM(e.active)), 'yes') IN ('yes', 'true', '1')`,
    ];
    if (client) {
        params.push(client);
        clauses.push(`LOWER(TRIM(e.client)) = LOWER(TRIM($${params.length}))`);
    }
    if (contractId) {
        params.push(contractId);
        clauses.push(`e.contract_id = $${params.length}`);
    }
    if (employeeIds && employeeIds.length) {
        params.push(employeeIds);
        clauses.push(`e.id = ANY($${params.length}::text[])`);
    }

    // Prefer employees already on the sheet for this month; else active roster in filter.
    const { rows: onSheet } = await pool.query(
        `SELECT DISTINCT employee_id FROM payroll_transactions
         WHERE year = $1 AND month = $2`,
        [year, month],
    );
    if (onSheet.length && !(employeeIds && employeeIds.length) && !client && !contractId) {
        params.length = 0;
        params.push(onSheet.map((r) => r.employee_id));
        clauses.length = 0;
        clauses.push(`e.id = ANY($1::text[])`);
    }

    const { rows } = await pool.query(
        `SELECT e.id, e.name, e.salary, e.doj, e.contract_id, e.client, e.designation,
                e.spouse_name, e.child1_name, e.child2_name, e.location,
                c.costs AS contract_costs, c.financials AS contract_financials, c.contract_name AS contract_name
         FROM employees e
         LEFT JOIN contracts c ON c.id::text = e.contract_id::text
         WHERE ${clauses.join(' AND ')}
         ORDER BY e.name`,
        params,
    );
    return rows;
}

/**
 * Calculate payroll for a World A month and persist results.
 * @param {object} opts
 * @param {string} [opts.client] filter
 * @param {string} [opts.contractId] filter
 * @param {string[]} [opts.employeeIds] filter
 * @param {boolean} [opts.keepSheetClaimInputs=false] if true, sheet OT/OPD/reimb win over claims
 * @param {boolean} [opts.dryRun=false]
 */
async function calculatePayrollSheet(pool, year, month, opts = {}, actor = {}) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!y || !m || m < 1 || m > 12) {
        const err = new Error('Invalid year/month');
        err.status = 400;
        err.code = 'INVALID_PERIOD';
        throw err;
    }

    const cut = await cutover.loadCutoverConfig(pool).catch(() => ({
        cutoverMonth: 7,
        cutoverYear: 2026,
        archiveVisible: false,
    }));
    if (!opts.allowArchive && !cutover.periodAtOrAfterCutover(m, y, cut.cutoverMonth, cut.cutoverYear)) {
        const err = new Error('Period is before cutover floor');
        err.status = 409;
        err.code = 'CUTOVER_BLOCKED';
        throw err;
    }

    await assertMonthUnlocked(pool, y, m);

    const employees = await loadSheetEmployees(pool, {
        year: y,
        month: m,
        client: opts.client,
        contractId: opts.contractId,
        employeeIds: opts.employeeIds,
    });
    if (!employees.length) {
        return { ok: true, year: y, month: m, updated: 0, rows: [], warnings: [{ code: 'NO_EMPLOYEES', message: 'No employees in scope' }] };
    }

    const empIds = employees.map((e) => e.id);
    const { start, end, lastDay } = periodBounds(y, m);
    const asOf = new Date(y, m - 1, 15);

    const [{ rows: existingTx }, { rows: claimRows }, attRows, { rows: monthlyOvs }, { rows: holidays }] = await Promise.all([
        pool.query(
            `SELECT * FROM payroll_transactions WHERE year = $1 AND month = $2 AND employee_id = ANY($3::text[])`,
            [y, m, empIds],
        ),
        pool.query(
            `SELECT * FROM employee_claims
             WHERE employee_id = ANY($1::text[])
               AND period_year = $2 AND period_month = $3
               AND status IN ('focal_approved', 'in_payroll_run')`,
            [empIds, y, m],
        ),
        loadAttendanceBatch(pool, empIds, start, end),
        pool.query(
            `SELECT * FROM monthly_attendance_overrides
             WHERE period_year = $1 AND period_month = $2
               AND employee_id = ANY($3::text[])`,
            [y, m, empIds],
        ).catch(() => ({ rows: [] })),
        pool.query(
            `SELECT holiday_date::text AS holiday_date FROM public_holidays
             WHERE holiday_date >= $1::date AND holiday_date <= $2::date`,
            [start, end],
        ).catch(() => ({ rows: [] })),
    ]);

    const txByEmp = new Map(existingTx.map((r) => [r.employee_id, r]));
    const claimsByEmp = new Map();
    for (const c of claimRows) {
        if (!claimsByEmp.has(c.employee_id)) claimsByEmp.set(c.employee_id, []);
        claimsByEmp.get(c.employee_id).push(c);
    }
    const attByEmp = new Map();
    for (const a of attRows) {
        if (!attByEmp.has(a.employee_id)) attByEmp.set(a.employee_id, []);
        attByEmp.get(a.employee_id).push(a);
    }
    const ovByEmp = new Map(monthlyOvs.map((r) => [r.employee_id, r]));
    const holidayDateSet = new Set(holidays.map((h) => String(h.holiday_date).slice(0, 10)));

    const warnings = [];
    let bonusMap = new Map();
    try {
        bonusMap = loadBonusWorkingMap() || new Map();
    } catch (err) {
        warnings.push({ code: 'BONUS_MAP_UNAVAILABLE', message: 'July bonus CSV unavailable — using contract/manual bonus only' });
        console.error('[payrollSheet.calculate] bonus map', err.message || err);
    }
    const policyCache = new Map();
    const payloads = [];

    for (const emp of employees) {
        const contractId = emp.contract_id;
        const costs = emp.contract_costs || {};
        const financials = emp.contract_financials || {};
        const sheet = txByEmp.get(emp.id) || {};

        let policy = DEFAULT_POLICY;
        if (contractId) {
            if (!policyCache.has(contractId)) {
                const p = await getPolicy(pool, contractId, null, asOf);
                policyCache.set(contractId, p);
            }
            const p = policyCache.get(contractId);
            if (p) {
                policy = {
                    ...DEFAULT_POLICY,
                    ...p,
                    service_charge_pct: p.service_charge_pct != null
                        ? Number(p.service_charge_pct)
                        : (Number(financials.service_charges_pct) || 18) / 100,
                    sales_tax_rate: p.sales_tax_rate != null
                        ? Number(p.sales_tax_rate)
                        : (Number(financials.sales_tax_pct) || 0) / 100,
                    ot_allowed: p.ot_allowed !== false,
                };
            } else {
                policy = {
                    ...DEFAULT_POLICY,
                    service_charge_pct: (Number(financials.service_charges_pct) || 18) / 100,
                    sales_tax_rate: (Number(financials.sales_tax_pct) || 0) / 100,
                };
            }
        }

        const workingDays = computeWorkingDays(y, m, holidayDateSet, {});

        const att = attByEmp.get(emp.id) || [];
        const monthlyOv = ovByEmp.get(emp.id);
        const attPaidDays = derivePaidDays(att, workingDays, policy.attendance_input_mode);
        const attOt = deriveOtHours(att, holidayDateSet);
        const empClaims = claimsByEmp.get(emp.id) || [];
        const claimAgg = aggregateClaimInputs(empClaims);
        // sourceMode:
        //  - sheet_inputs: recompute from current Payroll Sheet columns (idempotent)
        //  - canonical: sheet baseline + merge attendance/claims/hub OT upward (never wipe sheet with hub zeros)
        const sourceMode = opts.sourceMode === 'canonical' ? 'canonical' : 'sheet_inputs';

        const {
            paidDays,
            presentDaysForModelA,
            absentDaysForModelA,
        } = resolvePayrollSheetPaidDays({
            sheet,
            monthlyOv,
            attendancePaidDays: attPaidDays,
        });

        let { ot1, ot2, ot3, opd, expense } = resolvePayrollSheetInputs({
            sheet,
            attOt,
            monthlyOv,
            claimAgg,
            hasClaims: empClaims.length > 0,
            sourceMode,
        });

        if (!policy.ot_allowed) {
            if (ot1 + ot2 + ot3 > 0) {
                warnings.push({ employeeId: emp.id, code: 'OT_NOT_ALLOWED', message: `${emp.name}: OT cleared (not allowed)` });
            }
            ot1 = 0;
            ot2 = 0;
            ot3 = 0;
        }

        const arrears = num(sheet.arrears);
        const fuelMobile = num(sheet.fuel_mobile);
        // other_deduction only — advance/loan applied once in sheetCalcFromEngine
        const otherDeduction = num(sheet.other_deduction);
        let specialAllowance = num(sheet.special_allowance);

        const salary = num(emp.salary);
        // sheet_inputs: bonus_amount on the sheet is authoritative (including 0).
        // Do not re-fill from the July accrual CSV — that made re-Calculate invent pay.
        // canonical: may fill from July bonus map / contract when sheet bonus is empty.
        let bonusDisbursement;
        if (sourceMode === 'sheet_inputs') {
            bonusDisbursement = Math.round(num(sheet.bonus_amount));
        } else {
            bonusDisbursement = resolvePayrollSheetBonus({
                employeeId: emp.id,
                contractId,
                salary,
                doj: emp.doj,
                month: m,
                year: y,
                bonusMonths: costs.bonus_months,
                bonusMinMonths: costs.bonus_min_months,
                disbursementMonth: costs.bonus_disbursement_month,
                manualBonusAmount: sheet.bonus_amount,
                bonusMap,
            });
        }

        // July Wafi: Excel "Special Allowance" is stored in bonus_amount for WHT exclusion.
        // Do not also keep special_allowance when bonus already carries that amount.
        if (Number(m) === 7 && Number(y) === 2026
            && isWafiBpoJulyContext({ employeeId: emp.id, contractId })
            && bonusDisbursement > 0
            && specialAllowance > 0
            && Math.abs(specialAllowance - bonusDisbursement) < 1) {
            specialAllowance = 0;
        }

        const medicalCoverage = computeMedicalCoverage(emp, costs);
        const lifeInsurance = num(costs.life_insurance, 150);
        const salesTaxRate = policy.sales_tax_exempt
            ? 0
            : num(policy.sales_tax_rate, (Number(financials.sales_tax_pct) || 0) / 100);

        const excludeBonusFromWht = Number(m) === 7 && Number(y) === 2026
            && isWafiBpoJulyContext({ employeeId: emp.id, contractId });

        const computeInput = {
            newSalary: salary,
            ot1,
            ot2,
            ot3,
            opd,
            expense,
            arrears,
            fuelMobile,
            otherDeduction,
            specialAllowance,
            bonusDisbursement,
            medicalCoverage,
            lifeInsurance,
            contractBonusMonths: costs.bonus_months,
            salesTaxRate,
            excludeBonusFromWht,
            month: m,
            year: y,
        };

        // World A / Excel PR-sheet Model A uses a fixed 30-day month (policy),
        // not calendar days-in-month (31 in July). Using 31 rewrote partial-month
        // pay and made re-Calculate drift from Excel.
        const modelABasis = num(policy.standard_month_days, 30) || 30;
        const useModelA = absentDaysForModelA != null || paidDays >= workingDays || presentDaysForModelA != null
            || (sheet.paid_days != null && num(sheet.paid_days) >= modelABasis);
        if (useModelA) {
            computeInput.modelA = true;
            computeInput.expectedDays = modelABasis;
            computeInput.calendarBasis = modelABasis;
            computeInput.month = m;
            computeInput.year = y;
            if (absentDaysForModelA != null) {
                computeInput.absentDays = absentDaysForModelA;
                computeInput.presentDays = presentDaysForModelA != null
                    ? presentDaysForModelA
                    : Math.max(0, modelABasis - absentDaysForModelA);
            } else {
                computeInput.presentDays = presentDaysForModelA != null ? presentDaysForModelA : paidDays;
            }
        } else {
            computeInput.paidDays = paidDays;
            computeInput.workingDays = workingDays;
            computeInput.modelA = false;
        }

        const computed = computePrSheetRow(computeInput, {
            ...policy,
            service_charge_pct: num(policy.service_charge_pct, 0.18) > 1
                ? num(policy.service_charge_pct) / 100
                : num(policy.service_charge_pct, 0.18),
        });

        const ovOut = {
            paid_days: useModelA
                ? (computeInput.presentDays != null ? computeInput.presentDays : paidDays)
                : paidDays,
            ot2_hrs: ot2,
            ot3_hrs: ot3,
            opd_claim: opd,
            reimbursement: expense,
            arrears,
            bonus_amount: bonusDisbursement,
            special_allowance: specialAllowance,
            fuel_mobile: fuelMobile,
            other_deduction: num(sheet.other_deduction),
            advance_deduction: num(sheet.advance_deduction),
            loan_deduction: num(sheet.loan_deduction),
            medical_ee: num(sheet.medical_ee),
            medical_sp: num(sheet.medical_sp),
            medical_ch1: num(sheet.medical_ch1),
            medical_ch2: num(sheet.medical_ch2),
            remarks: sheet.remarks || null,
        };

        const calc = sheetCalcFromEngine(computed, ovOut, computeInput);
        payloads.push({
            employee_id: emp.id,
            ov: ovOut,
            calc,
            computed,
        });
    }

    if (!opts.dryRun && payloads.length) {
        await upsertPayrollTransactions(pool, y, m, payloads, actor.email || actor.id || 'payroll-sheet-calculate');
    }

    return {
        ok: true,
        year: y,
        month: m,
        updated: payloads.length,
        dryRun: !!opts.dryRun,
        warnings,
        rows: payloads.map((p) => ({
            employee_id: p.employee_id,
            paid_days: p.ov.paid_days,
            ot2_hrs: p.ov.ot2_hrs,
            ot3_hrs: p.ov.ot3_hrs,
            opd_claim: p.ov.opd_claim,
            reimbursement: p.ov.reimbursement,
            arrears: p.ov.arrears,
            bonus_amount: p.ov.bonus_amount,
            special_allowance: p.ov.special_allowance,
            fuel_mobile: p.ov.fuel_mobile,
            other_deduction: p.ov.other_deduction,
            advance_deduction: p.ov.advance_deduction,
            loan_deduction: p.ov.loan_deduction,
            medical_ee: p.ov.medical_ee,
            medical_sp: p.ov.medical_sp,
            medical_ch1: p.ov.medical_ch1,
            medical_ch2: p.ov.medical_ch2,
            remarks: p.ov.remarks,
            gross: p.calc.grossMonthly,
            net: p.calc.netPay,
            wht: p.calc.incomeTax,
            eobi_ee: p.calc.eobi_ee,
            service_charges: p.calc.serviceCharges,
            sales_tax: p.calc.salesTax,
            total_invoice: p.calc.totalInvoice,
            computed_json: p.calc,
            locked: false,
        })),
        anchors: Object.fromEntries(
            payloads
                .filter((p) => /SPL-208|SPL-91/i.test(p.employee_id))
                .map((p) => [p.employee_id, { net: p.calc.netPay, wht: p.calc.incomeTax, gross: p.calc.grossMonthly }]),
        ),
    };
}

async function upsertPayrollTransactions(pool, year, month, payloads, createdBy) {
    const CHUNK = 40;
    for (let i = 0; i < payloads.length; i += CHUNK) {
        const chunk = payloads.slice(i, i + CHUNK);
        const months = chunk.map(() => month);
        const years = chunk.map(() => year);
        const employeeIds = chunk.map((r) => r.employee_id);
        const paidDays = chunk.map((r) => r.ov.paid_days);
        const ot2 = chunk.map((r) => r.ov.ot2_hrs);
        const ot3 = chunk.map((r) => r.ov.ot3_hrs);
        const opd = chunk.map((r) => r.ov.opd_claim);
        const reimb = chunk.map((r) => r.ov.reimbursement);
        const arrears = chunk.map((r) => r.ov.arrears);
        const bonus = chunk.map((r) => r.ov.bonus_amount);
        const spl = chunk.map((r) => r.ov.special_allowance);
        const fuel = chunk.map((r) => r.ov.fuel_mobile);
        const other = chunk.map((r) => r.ov.other_deduction);
        const adv = chunk.map((r) => r.ov.advance_deduction);
        const loan = chunk.map((r) => r.ov.loan_deduction);
        const medEe = chunk.map((r) => r.ov.medical_ee);
        const medSp = chunk.map((r) => r.ov.medical_sp);
        const medCh1 = chunk.map((r) => r.ov.medical_ch1);
        const medCh2 = chunk.map((r) => r.ov.medical_ch2);
        const gross = chunk.map((r) => r.calc.grossMonthly);
        const net = chunk.map((r) => r.calc.netPay);
        const wht = chunk.map((r) => r.calc.incomeTax);
        const eobi = chunk.map((r) => r.calc.eobi_ee);
        const sc = chunk.map((r) => r.calc.serviceCharges);
        const st = chunk.map((r) => r.calc.salesTax);
        const inv = chunk.map((r) => r.calc.totalInvoice);
        const remarks = chunk.map((r) => r.ov.remarks);
        const computedJson = chunk.map((r) => r.calc);
        const creators = chunk.map(() => createdBy);

        try {
            await pool.query(
                `INSERT INTO payroll_transactions (
                    month, year, employee_id, paid_days, ot2_hrs, ot3_hrs, opd_claim,
                    reimbursement, arrears, bonus_amount, special_allowance, fuel_mobile,
                    other_deduction, advance_deduction, loan_deduction,
                    medical_ee, medical_sp, medical_ch1, medical_ch2,
                    gross, net, wht, eobi_ee, service_charges, sales_tax, total_invoice,
                    remarks, computed_json, created_by, updated_at
                 )
                 SELECT
                    u.month, u.year, u.employee_id, u.paid_days, u.ot2_hrs, u.ot3_hrs, u.opd_claim,
                    u.reimbursement, u.arrears, u.bonus_amount, u.special_allowance, u.fuel_mobile,
                    u.other_deduction, u.advance_deduction, u.loan_deduction,
                    u.medical_ee, u.medical_sp, u.medical_ch1, u.medical_ch2,
                    u.gross, u.net, u.wht, u.eobi_ee, u.service_charges, u.sales_tax, u.total_invoice,
                    u.remarks, u.computed_json, u.created_by, NOW()
                 FROM unnest(
                    $1::int[], $2::int[], $3::text[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[],
                    $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[],
                    $13::numeric[], $14::numeric[], $15::numeric[],
                    $16::numeric[], $17::numeric[], $18::numeric[], $19::numeric[],
                    $20::numeric[], $21::numeric[], $22::numeric[], $23::numeric[], $24::numeric[], $25::numeric[], $26::numeric[],
                    $27::text[], $28::jsonb[], $29::text[]
                 ) AS u(
                    month, year, employee_id, paid_days, ot2_hrs, ot3_hrs, opd_claim,
                    reimbursement, arrears, bonus_amount, special_allowance, fuel_mobile,
                    other_deduction, advance_deduction, loan_deduction,
                    medical_ee, medical_sp, medical_ch1, medical_ch2,
                    gross, net, wht, eobi_ee, service_charges, sales_tax, total_invoice,
                    remarks, computed_json, created_by
                 )
                 ON CONFLICT (employee_id, month, year) DO UPDATE SET
                    paid_days = EXCLUDED.paid_days,
                    ot2_hrs = EXCLUDED.ot2_hrs,
                    ot3_hrs = EXCLUDED.ot3_hrs,
                    opd_claim = EXCLUDED.opd_claim,
                    reimbursement = EXCLUDED.reimbursement,
                    arrears = EXCLUDED.arrears,
                    bonus_amount = EXCLUDED.bonus_amount,
                    special_allowance = EXCLUDED.special_allowance,
                    fuel_mobile = EXCLUDED.fuel_mobile,
                    other_deduction = EXCLUDED.other_deduction,
                    advance_deduction = EXCLUDED.advance_deduction,
                    loan_deduction = EXCLUDED.loan_deduction,
                    medical_ee = EXCLUDED.medical_ee,
                    medical_sp = EXCLUDED.medical_sp,
                    medical_ch1 = EXCLUDED.medical_ch1,
                    medical_ch2 = EXCLUDED.medical_ch2,
                    gross = EXCLUDED.gross,
                    net = EXCLUDED.net,
                    wht = EXCLUDED.wht,
                    eobi_ee = EXCLUDED.eobi_ee,
                    service_charges = EXCLUDED.service_charges,
                    sales_tax = EXCLUDED.sales_tax,
                    total_invoice = EXCLUDED.total_invoice,
                    remarks = EXCLUDED.remarks,
                    computed_json = EXCLUDED.computed_json,
                    updated_at = NOW()`,
                [
                    months, years, employeeIds, paidDays, ot2, ot3, opd,
                    reimb, arrears, bonus, spl, fuel,
                    other, adv, loan,
                    medEe, medSp, medCh1, medCh2,
                    gross, net, wht, eobi, sc, st, inv,
                    remarks, computedJson, creators,
                ],
            );
        } catch (err) {
            // Pre-migration fallback: column computed_json missing
            if (!/computed_json/i.test(err.message || '')) throw err;
            for (const p of chunk) {
                await pool.query(`
                    INSERT INTO payroll_transactions
                        (month, year, employee_id, paid_days, ot2_hrs, ot3_hrs, opd_claim,
                         reimbursement, arrears, bonus_amount, special_allowance, fuel_mobile,
                         other_deduction, advance_deduction, loan_deduction,
                         medical_ee, medical_sp, medical_ch1, medical_ch2,
                         gross, net, wht, eobi_ee, service_charges, sales_tax, total_invoice,
                         remarks, created_by, updated_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,NOW())
                    ON CONFLICT (employee_id, month, year) DO UPDATE SET
                        paid_days=$4, ot2_hrs=$5, ot3_hrs=$6, opd_claim=$7,
                        reimbursement=$8, arrears=$9, bonus_amount=$10, special_allowance=$11,
                        fuel_mobile=$12, other_deduction=$13, advance_deduction=$14, loan_deduction=$15,
                        medical_ee=$16, medical_sp=$17, medical_ch1=$18, medical_ch2=$19,
                        gross=$20, net=$21, wht=$22, eobi_ee=$23, service_charges=$24,
                        sales_tax=$25, total_invoice=$26, remarks=$27, updated_at=NOW()`,
                [
                    month, year, p.employee_id,
                    p.ov.paid_days, p.ov.ot2_hrs, p.ov.ot3_hrs, p.ov.opd_claim,
                    p.ov.reimbursement, p.ov.arrears, p.ov.bonus_amount, p.ov.special_allowance,
                    p.ov.fuel_mobile, p.ov.other_deduction, p.ov.advance_deduction, p.ov.loan_deduction,
                    p.ov.medical_ee, p.ov.medical_sp, p.ov.medical_ch1, p.ov.medical_ch2,
                    p.calc.grossMonthly, p.calc.netPay, p.calc.incomeTax, p.calc.eobi_ee,
                    p.calc.serviceCharges, p.calc.salesTax, p.calc.totalInvoice,
                    p.ov.remarks, createdBy,
                ]);
            }
        }
    }
}

module.exports = {
    calculatePayrollSheet,
    assertMonthUnlocked,
    sheetCalcFromEngine,
    resolvePayrollSheetInputs: require('./resolveInputs').resolvePayrollSheetInputs,
    resolvePayrollSheetPaidDays: require('./resolveInputs').resolvePayrollSheetPaidDays,
};
