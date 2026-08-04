/**
 * Tax Engine Module - Pakistan Compliance FBR FY 2025-26
 * Corrected FBR salaried individual tax slabs per Finance Act 2024.
 * Taxable income = Gross - OPD Claims - Expense Reimbursements
 */

// EOBI statutory minimum wage cap (Rs. 40,000 as of 2025-26)
const EOBI_MIN_WAGE = 40000;

/**
 * Calculates EOBI employee and employer shares.
 * Flat rate against statutory minimum wage (Rs. 40,000 cap).
 * EE = 1% × 40,000 = Rs. 400 (flat for all employees)
 * ER = 5% × 40,000 = Rs. 2,000 (flat for all employees)
 */
function calculateEOBI() {
    return {
        employeeShare: 400,
        employerShare: 2000,
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
    calculateSESSI,
    calculateMonthlyIncomeTax,
    calculateMonthlyGratuity,
    calculateGratuitySettlement,
    calculatePF,
    // Legacy alias
    calculateGratuity: calculateGratuitySettlement,
};
