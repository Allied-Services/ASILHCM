'use strict';

const { calculateMonthlyIncomeTax, calculateEOBI, calculateSESSI } = require('../../taxEngine');

/**
 * PR-sheet parity payroll cost engine (Wafi-style headcount contracts).
 * OT = salary / otDivisorDays / otDivisorHours * (1*OT1 + 2*OT2 + 3*OT3)
 * TPC = gross + employer burdens; SC = TPC * serviceChargePct; ST on (TPC+SC)
 *
 * MD Mandate §4 pillars: OT 1X, medical (OPD), previous dues, EOBI 400, PK tax.
 */
function computePrSheetRow(input, policy = {}) {
    const workingDays = input.workingDays || policy.standard_month_days || 30;
    const paidDays = input.paidDays ?? workingDays;
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

    const salaryForDays = workingDays ? Math.round(salary * paidDays / workingDays) : salary;
    const otDivDays = policy.ot_divisor_days || 26;
    const otDivHours = policy.ot_divisor_hours || 8;
    const hourlyBase = salary / otDivDays / otDivHours;
    const overtimeAmount = Math.round(hourlyBase * (1 * ot1 + 2 * ot2 + 3 * ot3));

    const gross = salaryForDays + overtimeAmount + opd + expense + arrears + previousDues
        + specialAllowance + fuelMobile - otherDeduction;

    const wht = input.wht != null
        ? Number(input.wht)
        : calculateMonthlyIncomeTax(gross, opd, expense);
    const eobi = calculateEOBI();
    const sessi = calculateSESSI(gross);
    const pfDeduction = Number(input.pfDeduction || 0);
    const totalDeductions = wht + pfDeduction + eobi.employeeShare;
    const netPay = gross - totalDeductions;

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
        previousDues,
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

module.exports = { computePrSheetRow };
