/**
 * Tax Engine Module - Pakistan Compliance FBR FY 2025-26
 * Corrected FBR salaried individual tax slabs per Finance Act 2024.
 * Taxable income = Gross - OPD Claims - Expense Reimbursements
 */

// EOBI is a flat statutory amount (1% EE / 5% ER of the notified minimum wage).
// Through Jul 2026: min wage Rs. 40,000 → EE 400 / ER 2,000
// From Aug 2026:    min wage Rs. 43,000 → EE 430 / ER 2,150
const EOBI_RATES_PRE_AUG_2026 = { employeeShare: 400, employerShare: 2000, minWage: 40000 };
const EOBI_RATES_FROM_AUG_2026 = { employeeShare: 430, employerShare: 2150, minWage: 43000 };
const EOBI_MIN_WAGE = EOBI_RATES_FROM_AUG_2026.minWage;

function resolveEobiPeriod(period) {
    if (!period || typeof period !== 'object') return null;
    const year = Number(period.year ?? period.periodYear);
    const month = Number(period.month ?? period.periodMonth);
    if (!year || !month || month < 1 || month > 12) return null;
    return { year, month };
}

function eobiAppliesAug2026Revision(year, month) {
    return Number(year) > 2026 || (Number(year) === 2026 && Number(month) >= 8);
}

/**
 * Period-aware EOBI rates. No period (or a legacy numeric salary arg) keeps
 * the pre-Aug 2026 amounts so historical tests and July recalcs stay put.
 */
function eobiRatesForPeriod(period) {
    const p = resolveEobiPeriod(period);
    if (p && eobiAppliesAug2026Revision(p.year, p.month)) {
        return { ...EOBI_RATES_FROM_AUG_2026 };
    }
    return { ...EOBI_RATES_PRE_AUG_2026 };
}

/**
 * Calculates EOBI employee and employer shares.
 * @param {object} [period] - { year, month }. A number (legacy gross) is ignored.
 */
function calculateEOBI(period) {
    const rates = eobiRatesForPeriod(period);
    return {
        employeeShare: rates.employeeShare,
        employerShare: rates.employerShare,
    };
}

/**
 * Calculates SESSI (Employer only) — Sindh only.
 * 6% of gross, capped at Rs. 2,400 (min wage Rs. 40,000 × 6% = 2,400)
 * Exempt if grossWage > Rs. 40,000 (SESSI wage ceiling — inclusive at 40,000).
 */
function calculateSESSI(grossWage) {
    if (grossWage > 40000) return 0;
    return Math.min(2400, Math.round(grossWage * 0.06));
}

/**
 * FBR 2025-26 Salaried Individual Tax Slabs (Finance Act 2024)
 * Taxable annual income = (monthly gross - OPD - Reimbursements) × 12
 *
 * Slabs:
 *   ≤ 600,000           → 0%
 *   600,001 – 1,200,000 → 1% of amount above 600,000
 *   1,200,001–2,200,000 → 6,000 + 11% of amount above 1,200,000
 *   2,200,001–3,200,000 → 116,000 + 23% of amount above 2,200,000
 *   3,200,001–4,100,000 → 346,000 + 30% of amount above 3,200,000
 *   > 4,100,000         → 616,000 + 35% of amount above 4,100,000
 *
 * @param {number} monthlyGross - Full gross (before deducting OPD/reimb)
 * @param {number} [monthlyOPD=0] - OPD claim amount (non-taxable)
 * @param {number} [monthlyReimb=0] - Expense reimbursement (non-taxable)
 * @param {number} [monthlyArrears=0] - Back-pay arrears (non-taxable in payment month; trued up at year-end)
 */
function calculateMonthlyIncomeTax(monthlyGross, monthlyOPD = 0, monthlyReimb = 0, monthlyArrears = 0) {
    const taxableMonthly = monthlyGross
        - (parseFloat(monthlyOPD) || 0)
        - (parseFloat(monthlyReimb) || 0)
        - (parseFloat(monthlyArrears) || 0);
    const annualSalary = Math.max(0, taxableMonthly) * 12;
    let annualTax = 0;

    if (annualSalary <= 600000) {
        annualTax = 0;
    } else if (annualSalary <= 1200000) {
        annualTax = (annualSalary - 600000) * 0.01;
    } else if (annualSalary <= 2200000) {
        annualTax = 6000 + (annualSalary - 1200000) * 0.11;
    } else if (annualSalary <= 3200000) {
        annualTax = 116000 + (annualSalary - 2200000) * 0.23;
    } else if (annualSalary <= 4100000) {
        annualTax = 346000 + (annualSalary - 3200000) * 0.30;
    } else {
        annualTax = 616000 + (annualSalary - 4100000) * 0.35;
    }

    return Number((annualTax / 12).toFixed(2));
}

/**
 * Payroll Sheet monthly WHT — owner rule (Wafi BPO / headcount contracts).
 * Annualize recurring monthly pay only: salary (prorated) + OT + allowances in gross,
 * but exclude the bonus disbursement lump (taxed at FY-end or separation on YTD).
 * OPD, reimbursements, and arrears remain non-taxable in the payment month.
 *
 * @param {number} grossMonthly - Full cash gross including bonus lump
 * @param {number} [bonusDisbursement=0] - July/annual bonus paid this month (excluded from WHT base)
 * @param {number} [opd=0]
 * @param {number} [expense=0]
 * @param {number} [arrears=0]
 */
function calculatePayrollSheetMonthlyIncomeTax(grossMonthly, bonusDisbursement = 0, opd = 0, expense = 0, arrears = 0) {
    const recurringGross = Math.max(
        0,
        (parseFloat(grossMonthly) || 0) - (parseFloat(bonusDisbursement) || 0),
    );
    return Math.round(calculateMonthlyIncomeTax(recurringGross, opd, expense, arrears));
}

/** @deprecated Use calculatePayrollSheetMonthlyIncomeTax */
const calculateJuly2026WafiMonthlyIncomeTax = calculatePayrollSheetMonthlyIncomeTax;

/**
 * Gratuity MONTHLY accrual (Employer cost only — no employee deduction).
 * Formula: Gross Salary / 12  (1/12th = 8.33% — per EOB Ordinance 1968)
 * @param {number} grossSalary - Employee's monthly gross salary
 * @returns {number} Monthly gratuity provision amount
 */
function calculateMonthlyGratuity(grossSalary) {
    return Math.round(parseFloat(grossSalary || 0) / 12);
}

/**
 * Gratuity FINAL SETTLEMENT calculation.
 * Formula: (Basic / 26) × 30 × Years of Service
 * @param {number} basicSalary - Last drawn basic salary
 * @param {string|Date} joiningDate - Date of joining
 * @param {string|Date} calcDate - Date of calculation
 */
function calculateGratuitySettlement(basicSalary, joiningDate, calcDate) {
    const join = new Date(joiningDate);
    const calc = new Date(calcDate);
    const msPerYear = 31536000000;
    const yearsOfService = (calc.getTime() - join.getTime()) / msPerYear;
    if (yearsOfService <= 0) return 0;
    const basic = parseFloat(basicSalary) || 0;
    return Number(((basic / 26) * 30 * yearsOfService).toFixed(2));
}

/**
 * Provident Fund — Employee and Employer contribution.
 * Both EE and ER = 1/24th of Gross Salary (4.166%)
 * @param {number} grossSalary - Employee's monthly gross salary
 * @param {boolean} enrolled - Whether employee is enrolled in PF scheme
 */
function calculatePF(grossSalary, enrolled = false) {
    if (!enrolled) return { employeeShare: 0, employerShare: 0 };
    const contribution = Math.round(parseFloat(grossSalary || 0) / 24);
    return { employeeShare: contribution, employerShare: contribution };
}

module.exports = {
    calculateEOBI,
    eobiRatesForPeriod,
    eobiAppliesAug2026Revision,
    EOBI_RATES_PRE_AUG_2026,
    EOBI_RATES_FROM_AUG_2026,
    EOBI_MIN_WAGE,
    calculateSESSI,
    calculateMonthlyIncomeTax,
    calculatePayrollSheetMonthlyIncomeTax,
    calculateJuly2026WafiMonthlyIncomeTax,
    calculateMonthlyGratuity,
    calculateGratuitySettlement,
    calculatePF,
    // Legacy alias
    calculateGratuity: calculateGratuitySettlement,
};
