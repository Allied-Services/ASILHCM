/**
 * Tax Engine Module - Pakistan Compliance FBR FY 2025-26
 * Corrected FBR salaried individual tax slabs per Finance Act 2024.
 * Taxable income = Gross - OPD Claims - Expense Reimbursements
 */

const MIN_WAGE = 37000;

/**
 * Calculates EOBI employee and employer shares.
 * Capped at minimum wage (Rs. 37,000 / flat Rs. 400 EE / Rs. 1,850 ER based on 37,000)
 */
function calculateEOBI(grossWage) {
    const applicableWage = Math.min(grossWage, MIN_WAGE);
    return {
        employeeShare: Number((applicableWage * 0.01).toFixed(2)),
        employerShare: Number((applicableWage * 0.05).toFixed(2)),
    };
}

/**
 * Calculates SESSI (Employer only) — Sindh only, 6% of gross if gross < Rs. 45,000
 */
function calculateSESSI(grossWage) {
    if (grossWage >= 45000) return 0;
    const applicableWage = Math.min(grossWage, MIN_WAGE);
    return Number((applicableWage * 0.06).toFixed(2));
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
 */
function calculateMonthlyIncomeTax(monthlyGross, monthlyOPD = 0, monthlyReimb = 0) {
    const taxableMonthly = monthlyGross - (parseFloat(monthlyOPD) || 0) - (parseFloat(monthlyReimb) || 0);
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
 * Gratuity monthly accrual.
 * Formula: (Last Drawn Basic / 26) × 30 / 12  — per EOB Ordinance 1968
 * Note: Based on BASIC salary (not gross), 30 calendar days per year of service,
 * divided by 12 for monthly provision.
 */
function calculateGratuity(grossSalary, joiningDate, calcDate) {
    const join = new Date(joiningDate);
    const calc = new Date(calcDate);
    const msPerYear = 31536000000;
    const yearsOfService = (calc.getTime() - join.getTime()) / msPerYear;
    if (yearsOfService <= 0) return 0;
    // Monthly gratuity accrual: basic/26*30/12 × years (for full settlement use years directly)
    const basic = grossSalary * 0.60; // assume 60% basic if only gross provided
    const gratuity = (basic / 26) * 30 * yearsOfService;
    return Number(gratuity.toFixed(2));
}

module.exports = {
    calculateEOBI,
    calculateSESSI,
    calculateMonthlyIncomeTax,
    calculateGratuity
};
