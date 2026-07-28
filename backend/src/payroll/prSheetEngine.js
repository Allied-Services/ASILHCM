'use strict';

const { calculateMonthlyIncomeTax, calculateEOBI, calculateSESSI } = require('../../taxEngine');

/**
 * Model A (30-day calendar basis):
 *   Absent Days (A) = Expected Days − Present Days
 *   Basic payout   = Base Salary × ((30 − A) / 30)
 * Sundays/holidays are paid rest — only unexcused absences reduce Present Days.
 *
 * OT (labor-law divisor):
 *   OT 2X rate = (Base / (26 × 8)) × 2
 *   OT 3X rate = (Base / (26 × 8)) × 3
 */
function computeModelABasis({ presentDays, expectedDays, calendarBasis = 30 }) {
    const basis = Number(calendarBasis) || 30;
    const expected = Number(expectedDays != null ? expectedDays : basis);
    const present = presentDays == null || presentDays === ''
        ? expected
        : Number(presentDays);
    const safePresent = Number.isFinite(present) ? present : expected;
    const absentDays = Math.max(0, expected - safePresent);
    const modelAPaidDays = basis - absentDays;
    return {
        calendarBasis: basis,
        expectedDays: expected,
        presentDays: safePresent,
        absentDays,
        modelAPaidDays,
        paidFactor: basis ? modelAPaidDays / basis : 1,
    };
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
        });
        workingDays = 30;
        paidDays = modelA.modelAPaidDays;
        salaryForDays = Math.round(salary * modelA.paidFactor);
    } else {
        salaryForDays = workingDays ? Math.round(salary * paidDays / workingDays) : salary;
    }

    const rates = computeOtRates(salary, policy);
    const overtimeAmount = Math.round(
        rates.hourlyBase * (1 * ot1 + 2 * ot2 + 3 * ot3)
    );

    const gross = Math.round(
        salaryForDays + overtimeAmount + opd + expense + arrears + previousDues
        + specialAllowance + fuelMobile - otherDeduction,
    );

    const wht = input.wht != null
        ? Math.round(Number(input.wht))
        : Math.round(calculateMonthlyIncomeTax(gross, opd, expense));
    const eobi = input.eobiEmployee != null
        ? { employeeShare: Math.round(Number(input.eobiEmployee)), employerShare: calculateEOBI().employerShare }
        : calculateEOBI();
    const sessi = calculateSESSI(gross);
    const pfDeduction = Math.round(Number(input.pfDeduction || 0));
    const totalDeductions = wht + pfDeduction + eobi.employeeShare;
    const netPay = Math.round(gross - totalDeductions);

    const bonusMonths = policy.bonus_accrual_months || 12;
    const gratuityMonths = policy.gratuity_accrual_months || 12;
    const bonusAccrual = Math.round(salary / bonusMonths);
    const gratuityAccrual = Math.round(salary / gratuityMonths);
    const eobiEr = eobi.employerShare;
    const sessiEr = sessi;
    const lifeInsurance = Number(input.lifeInsurance || 150);
    const medicalCoverage = Number(input.medicalCoverage || 0);
    const eduCess = policy.edu_cess_enabled ? Math.round(gross * 0.0833) : 0;

    const totalPayrollCost = gross + eduCess + sessiEr + eobiEr + bonusAccrual + gratuityAccrual + lifeInsurance + medicalCoverage;
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

module.exports = { computePrSheetRow, computeModelABasis, computeOtRates };
