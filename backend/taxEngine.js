/**
 * Tax Engine Module - Pakistan Compliance 2026
 * Contains logic for calculating EOBI, SESSI, Income Tax (WHT), and Gratuity.
 */

// Constant caps and bounds based on current regulations
const MIN_WAGE = 37000;

/**
 * Calculates EOBI employee and employer shares based on gross wage.
 * @param {number} grossWage
 * @returns {Object} { employeeShare, employerShare }
 */
function calculateEOBI(grossWage) {
    const applicableWage = Math.min(grossWage, MIN_WAGE);
    return {
        employeeShare: Number((applicableWage * 0.01).toFixed(2)),
        employerShare: Number((applicableWage * 0.05).toFixed(2)),
    };
}

/**
 * Calculates SESSI (Employer only) based on gross wage.
 * @param {number} grossWage
 * @returns {number} sessiEmployerShare
 */
function calculateSESSI(grossWage) {
    const applicableWage = Math.min(grossWage, MIN_WAGE);
    return Number((applicableWage * 0.06).toFixed(2));
}

/**
 * Calculates monthly Income Tax (Withholding Tax) based on FBR 2025-26 Salaried Tax Slabs.
 * @param {number} monthlyGross 
 * @returns {number} monthlyTax
 */
function calculateMonthlyIncomeTax(monthlyGross) {
    const annualSalary = monthlyGross * 12;
    let annualTax = 0;

    if (annualSalary <= 600000) {
        annualTax = 0;
    } else if (annualSalary <= 1200000) {
        annualTax = (annualSalary - 600000) * 0.05;
    } else if (annualSalary <= 2200000) {
        annualTax = 30000 + (annualSalary - 1200000) * 0.15;
    } else if (annualSalary <= 3200000) {
        annualTax = 180000 + (annualSalary - 2200000) * 0.25;
    } else if (annualSalary <= 4100000) {
        annualTax = 430000 + (annualSalary - 3200000) * 0.30;
    } else {
        annualTax = 700000 + (annualSalary - 4100000) * 0.35;
    }

    return Number((annualTax / 12).toFixed(2));
}

/**
 * Calculates Gratuity based on joining date, calculation date, and last gross salary.
 * Formula: (Last Drawn Gross Salary / 26) * 30 * Years of Service
 * @param {number} grossSalary 
 * @param {Date|string} joiningDate 
 * @param {Date|string} calcDate 
 * @returns {number} Gratuity amount
 */
function calculateGratuity(grossSalary, joiningDate, calcDate) {
    const join = new Date(joiningDate);
    const calc = new Date(calcDate);

    // Time delta in milliseconds, convert to years roughly
    const msPerYear = 31536000000; // 365 days
    const yearsOfService = (calc.getTime() - join.getTime()) / msPerYear;

    if (yearsOfService <= 0) return 0;

    const gratuity = (grossSalary / 26) * 30 * yearsOfService;
    return Number(gratuity.toFixed(2));
}

module.exports = {
    calculateEOBI,
    calculateSESSI,
    calculateMonthlyIncomeTax,
    calculateGratuity
};
