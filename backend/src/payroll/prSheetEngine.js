'use strict';

const { calculateMonthlyIncomeTax, calculateEOBI } = require('../../taxEngine');

/**
 * Model A (30-day calendar basis):
 *   Absent Days (A) = explicit sheet absent when provided, else Expected − Present
 *   Basic payout   = Base Salary × ((30 − A) / 30)
 * Sundays/holidays are paid rest — only unexcused absences reduce Present Days.
 * Conservancy sheets carry Total Absent explicitly; do not invent A from calendar WD − present.
 *
 * OT (labor-law divisor):
 *   OT 2X rate = (Base / (26 × 8)) × 2
 *   OT 3X rate = (Base / (26 × 8)) × 3
 */
function computeModelABasis({ presentDays, expectedDays, calendarBasis = 30, absentDays: absentOverride } = {}) {
    const basis = Number(calendarBasis) || 30;
    const expected = Number(expectedDays != null ? expectedDays : basis);
    const present = presentDays == null || presentDays === ''
        ? expected
        : Number(presentDays);
    const safePresent = Number.isFinite(present) ? present : expected;
    const hasExplicitAbsent = absentOverride != null && absentOverride !== '';
    const absentDays = hasExplicitAbsent
        ? Math.max(0, Number(absentOverride) || 0)
        : Math.max(0, expected - safePresent);
    const modelAPaidDays = basis - absentDays;
    return {
        calendarBasis: basis,
        expectedDays: expected,
        presentDays: safePresent,
        absentDays,
        modelAPaidDays,
        paidFactor: basis ? modelAPaidDays / basis : 1,
        absentSource: hasExplicitAbsent ? 'explicit' : 'derived',
    };
}

function isFamilyName(name) {
    const s = name == null ? '' : String(name).trim();
    if (!s || s === '0') return false;
    return true; // includes placeholder "Name Missing" until real names are captured
}

/** Monthly medical coverage billed on payroll cost (self + spouse + up to 2 children). */
function computeMedicalCoverage(emp, costs = {}) {
    const medEE = Number(costs.medical_ee || 0);
    const medSP = Number(costs.medical_sp || 0);
    const medCh = Number(costs.medical_child || 0);
    const hasSpouse = isFamilyName(emp.spouse_name || emp.spouseName);
    const numChildren = [emp.child1_name || emp.child1Name, emp.child2_name || emp.child2Name]
        .filter(isFamilyName).length;
    const coveredChildren = Math.min(numChildren, 2);
    return medEE + (hasSpouse ? medSP : 0) + coveredChildren * medCh;
}

function computeOtRates(salary, policy = {}) {
    const otDivDays = policy.ot_divisor_days || 26;
    const otDivHours = policy.ot_divisor_hours || 8;
    const hourlyBase = salary / otDivDays / otDivHours;
    return {
        hourlyBase,
        otRate1x: hourlyBase,
        otRate2x: hourlyBase * 2,
        otRate3x: hourlyBase * 3,
        otDivDays,
        otDivHours,
    };
}

/**
 * Annual bonus lump-sum paid in disbursement month (contract costs JSON).
 * Mirrors frontend payrollUtils.js; bonus_min_months = 0 → always pro-rata.
 */
function computeBonusDisbursement({
    salary,
    doj,
    month,
    year,
    bonusMonths,
    bonusMinMonths,
    disbursementMonth,
    manualBonusAmount,
}) {
    if (manualBonusAmount != null && manualBonusAmount !== '') {
        return Math.round(Number(manualBonusAmount) || 0);
    }
    const bm = Number(bonusMonths || 0);
    const disbMo = Number(disbursementMonth || 0);
    const payMonth = Number(month);
    const payYear = Number(year);
    if (bm <= 0 || disbMo <= 0 || payMonth !== disbMo) {
        return 0;
    }
    const grossSalary = Number(salary) || 0;
    let monthsServed = 12;
    if (doj) {
        const joinDate = new Date(doj);
        if (!Number.isNaN(joinDate.getTime())) {
            const cycleStart = new Date(payYear - 1, disbMo - 1, 1);
            if (joinDate > cycleStart) {
                const cycleEnd = new Date(payYear, disbMo - 1, 28);
                monthsServed = Math.max(
                    0,
                    (cycleEnd.getFullYear() - joinDate.getFullYear()) * 12
                    + (cycleEnd.getMonth() - joinDate.getMonth()),
                );
            }
        }
    }
    const minMonths = bonusMinMonths != null ? Number(bonusMinMonths) : 12;
    if (minMonths === 0) {
        return monthsServed > 0
            ? Math.round(bm * grossSalary * Math.min(monthsServed, 12) / 12)
            : 0;
    }
    if (monthsServed >= minMonths) {
        return Math.round(bm * grossSalary);
    }
    if (monthsServed > 0) {
        return Math.round(bm * grossSalary * monthsServed / 12);
    }
    return 0;
}

/**
 * PR-sheet parity payroll cost engine (Wafi-style headcount contracts).
 * Prefer Model A when presentDays (or modelA:true) is supplied.
 */
function computePrSheetRow(input, policy = {}) {
    const salary = Number(input.newSalary || input.salary || 0);
    const ot1 = Number(input.ot1 || 0);
    const ot2 = Number(input.ot2 || 0);
    const ot3 = Number(input.ot3 || 0);
    const opd = Number(input.opd || 0);
    const expense = Number(input.expense || 0);
    const arrears = Number(input.arrears || 0);
    const previousDues = Number(input.previousDues || input.previous_dues || 0);
    const specialAllowance = Number(input.specialAllowance || 0);
    const fuelMobile = Number(input.fuelMobile || 0);
    const otherDeduction = Number(input.otherDeduction || 0);

    const useModelA = input.modelA === true
        || input.presentDays != null
        || input.present_days != null;

    let workingDays = input.workingDays || policy.standard_month_days || 30;
    let paidDays = input.paidDays ?? workingDays;
    let modelA = null;
    let salaryForDays;

    if (useModelA) {
        const expected = input.expectedDays
            ?? input.expected_days
            ?? input.workingDays
            ?? policy.standard_month_days
            ?? 30;
        modelA = computeModelABasis({
            presentDays: input.presentDays ?? input.present_days ?? paidDays,
            expectedDays: expected,
            calendarBasis: 30,
            absentDays: input.absentDays ?? input.absent_days,
        });
        workingDays = 30;
        paidDays = modelA.modelAPaidDays;
        salaryForDays = input.salaryForDays != null
            ? Math.round(Number(input.salaryForDays))
            : Math.round(salary * modelA.paidFactor);
    } else {
        salaryForDays = input.salaryForDays != null
            ? Math.round(Number(input.salaryForDays))
            : (workingDays ? Math.round(salary * paidDays / workingDays) : salary);
    }

    const rates = computeOtRates(salary, policy);
    const overtimeAmount = input.overtimeAmount != null
        ? Math.round(Number(input.overtimeAmount))
        : Math.round(
            rates.hourlyBase * (1 * ot1 + 2 * ot2 + 3 * ot3)
        );

    const grossComponents = Math.round(
        salaryForDays + overtimeAmount + opd + expense + arrears + previousDues
        + specialAllowance + fuelMobile,
    );
    const bonusDisbursed = Math.round(Number(input.bonusDisbursement ?? input.bonusDisbursed ?? 0));
    const grossForTPC = grossComponents;
    const gross = grossComponents + bonusDisbursed;

    const whtExact = input.wht != null
        ? Number(input.wht)
        : calculateMonthlyIncomeTax(gross, opd, expense);
    const wht = Math.round(whtExact);
    const eobi = input.eobiEmployee != null
        ? { employeeShare: Math.round(Number(input.eobiEmployee)), employerShare: calculateEOBI().employerShare }
        : calculateEOBI();
    // SESSI: flat Rs. 2,400 (6% × Rs. 40,000 min wage) when contractual salary < 45,000.
    const sessiEr = salary < 45000 ? 2400 : 0;
    const hasPfOverride = input.pfDeduction != null;
    const pfDeductionExact = hasPfOverride ? Number(input.pfDeduction) : 0;
    const pfDeduction = hasPfOverride ? Math.round(pfDeductionExact) : 0;
    const pfForNet = hasPfOverride ? pfDeductionExact : pfDeduction;
    const whtForNet = input.wht != null ? whtExact : wht;
    const totalDeductions = wht + pfDeduction + eobi.employeeShare + Math.round(otherDeduction);
    const netPay = Math.round(gross - whtForNet - pfForNet - eobi.employeeShare - otherDeduction);

    // Treat explicit 0 as "disabled" (|| would incorrectly fall through to 12).
    const policyBonusDivisor = policy.bonus_accrual_months != null
        ? Number(policy.bonus_accrual_months)
        : 12;
    const contractBonusMonths = input.contractBonusMonths != null
        ? Number(input.contractBonusMonths)
        : null;
    const gratuityMonths = policy.gratuity_accrual_months != null
        ? Number(policy.gratuity_accrual_months)
        : 12;
    const bonusAccrual = contractBonusMonths != null
        ? (contractBonusMonths > 0 ? Math.round(contractBonusMonths * salary / 12) : 0)
        : (policyBonusDivisor > 0 ? Math.round(salary / policyBonusDivisor) : 0);
    const gratuityAccrual = gratuityMonths > 0 ? Math.round(salary / gratuityMonths) : 0;
    const eobiEr = eobi.employerShare;
    const lifeInsurance = Number(input.lifeInsurance || 150);
    const medicalCoverage = Number(input.medicalCoverage || 0);
    const eduCess = policy.edu_cess_enabled ? Math.round(grossForTPC * 0.0833) : 0;

    // Bonus disbursement is in net pay (gross) but excluded from TPC — client provisioned via monthly accrual.
    const totalPayrollCost = grossForTPC + eduCess + sessiEr + eobiEr + bonusAccrual + gratuityAccrual + lifeInsurance;
    const scPct = Number(policy.service_charge_pct ?? 0.18);
    const serviceCharges = Math.round(totalPayrollCost * scPct);
    const stRate = Number(input.salesTaxRate ?? 0.18);
    const salesTax = Math.round((totalPayrollCost + serviceCharges) * stRate);
    const totalCost = totalPayrollCost + serviceCharges + salesTax;

    return {
        salaryForDays,
        overtimeAmount,
        ot1Hours: ot1,
        ot2Hours: ot2,
        ot3Hours: ot3,
        otRate2x: rates.otRate2x,
        otRate3x: rates.otRate3x,
        arrears: Math.round(arrears),
        otherDeduction: Math.round(otherDeduction),
        previousDues,
        modelA,
        paidDays,
        workingDays,
        gross,
        wht,
        pfDeduction,
        eobiEmployee: eobi.employeeShare,
        eobiEmployer: eobiEr,
        sessiEmployee: 0,
        sessiEmployer: sessiEr,
        eduCess,
        bonusAccrual,
        bonusDisbursed,
        gratuityAccrual,
        lifeInsurance,
        medicalCoverage,
        totalDeductions,
        netPay,
        totalPayrollCost,
        serviceCharges,
        salesTax,
        totalCost,
    };
}

module.exports = {
    computePrSheetRow,
    computeModelABasis,
    computeOtRates,
    computeMedicalCoverage,
    computeBonusDisbursement,
    isFamilyName,
};
