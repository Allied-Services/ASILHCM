'use strict';

const { calculateMonthlyIncomeTax } = require('../../../taxEngine');
const { readPayrollSnapshot } = require('../../payroll/snapshotView');

const WORK_DAYS = 26;

function fmt(v) {
    return Math.round(parseFloat(v) || 0).toLocaleString('en-PK');
}

function normalizeCnic(cnic) {
    return String(cnic || '').replace(/\D/g, '');
}

const round = (v) => Math.round(parseFloat(v) || 0);

/**
 * Payslip rendered from the Payroll Sheet snapshot (payroll_transactions.computed_json).
 * The snapshot is what the sheet shows and what the bank file pays, so the payslip must
 * restate it rather than recompute it. Totals come from the snapshot; the itemised rows
 * are reconciled to those totals so the document always adds up.
 */
function payslipFromSnapshot(emp, pay, snap) {
    const ot2Hrs = parseFloat(snap.ot2hrs) || 0;
    const ot3Hrs = parseFloat(snap.ot3hrs) || 0;
    const grossTotal = round(snap.grossMonthly);
    const netPay = round(snap.netPay);

    const additions = [
        { label: 'Gross Salary', amount: round(snap.basicPaid) },
        ot2Hrs > 0 || ot3Hrs > 0
            ? { label: `Overtime (${ot2Hrs}h OT2 + ${ot3Hrs}h OT3)`, amount: round(snap.otAmount) }
            : null,
        round(snap.opdClaim) > 0 ? { label: 'OPD / Medical Claim', amount: round(snap.opdClaim) } : null,
        round(snap.reimb) > 0 ? { label: 'Expense Reimbursement', amount: round(snap.reimb) } : null,
        round(snap.arrears) > 0 ? { label: 'Arrears', amount: round(snap.arrears) } : null,
        round(snap.splAllow) > 0 ? { label: 'Special Allowance', amount: round(snap.splAllow) } : null,
        round(snap.fuelMob) > 0 ? { label: 'Fuel / Mobile Allowance', amount: round(snap.fuelMob) } : null,
        round(snap.bonusDisbursed) > 0 ? { label: 'Bonus', amount: round(snap.bonusDisbursed) } : null,
    ].filter(Boolean);

    const itemisedEarnings = additions.reduce((s, r) => s + r.amount, 0);
    if (itemisedEarnings !== grossTotal) {
        additions.push({ label: 'Other Earnings', amount: grossTotal - itemisedEarnings });
    }

    const pf = round(snap.pfEE);
    const advance = round(snap.advanceDed);
    const loan = round(snap.loanDed);
    const other = round(pay?.other_deduction);
    const deductions = [
        { label: 'Income Tax (WHT)', amount: round(snap.incomeTax) },
        { label: 'EOBI (Employee Share)', amount: round(snap.eobi_ee) },
        pf > 0 ? { label: 'Provident Fund (Employee)', amount: pf } : null,
        advance > 0 ? { label: 'Advance Recovery', amount: advance } : null,
        loan > 0 ? { label: 'Loan Installment', amount: loan } : null,
        other > 0 ? { label: 'Other Deductions', amount: other } : null,
    ].filter(Boolean);

    // Net pay is what actually leaves the bank account, so deductions are reconciled to it.
    const totalDeductions = grossTotal - netPay;
    const itemisedDeductions = deductions.reduce((s, r) => s + r.amount, 0);
    if (itemisedDeductions !== totalDeductions) {
        deductions.push({ label: 'Other Adjustments', amount: totalDeductions - itemisedDeductions });
    }

    return {
        emp,
        pay,
        paidDays: parseFloat(snap.pd) || 0,
        workingDays: WORK_DAYS,
        additions,
        deductions,
        grossTotal,
        totalDeductions,
        netPay,
        fmt,
    };
}

function buildWorldAPayslipData(emp, pay, contractEosbType) {
    const snap = readPayrollSnapshot(pay);
    if (snap) return payslipFromSnapshot(emp, pay, snap);
    // Legacy path: months calculated before computed_json existed (pre 2026-08-10).
    const grossSalary = parseFloat(emp.salary) || 0;
    const paidDays = parseFloat(pay?.paid_days ?? WORK_DAYS);
    const ratio = paidDays / WORK_DAYS;
    const grossProrated = Math.round(grossSalary * ratio);

    const ot2Hrs = parseFloat(pay?.ot2_hrs || 0);
    const ot3Hrs = parseFloat(pay?.ot3_hrs || 0);
    const hourlyRate = grossSalary / WORK_DAYS / 8;
    const otAmount = Math.round(ot2Hrs * 2 * hourlyRate + ot3Hrs * 3 * hourlyRate);

    const additions = [
        { label: 'Gross Salary', amount: grossProrated },
        ot2Hrs > 0 || ot3Hrs > 0 ? { label: `Overtime (${ot2Hrs}h OT2 + ${ot3Hrs}h OT3)`, amount: otAmount } : null,
        parseFloat(pay?.opd_claim || 0) > 0 ? { label: 'OPD / Medical Claim', amount: Math.round(parseFloat(pay.opd_claim)) } : null,
        parseFloat(pay?.reimbursement || 0) > 0 ? { label: 'Expense Reimbursement', amount: Math.round(parseFloat(pay.reimbursement)) } : null,
        parseFloat(pay?.arrears || 0) > 0 ? { label: 'Arrears', amount: Math.round(parseFloat(pay.arrears)) } : null,
        parseFloat(pay?.special_allowance || 0) > 0 ? { label: 'Special Allowance', amount: Math.round(parseFloat(pay.special_allowance)) } : null,
        parseFloat(pay?.fuel_mobile || 0) > 0 ? { label: 'Fuel / Mobile Allowance', amount: Math.round(parseFloat(pay.fuel_mobile)) } : null,
        parseFloat(pay?.bonus_amount || 0) > 0 ? { label: 'Bonus', amount: Math.round(parseFloat(pay.bonus_amount)) } : null,
    ].filter(Boolean);

    const grossTotal = additions.reduce((s, r) => s + r.amount, 0);
    const opd = Math.round(parseFloat(pay?.opd_claim || 0));
    const reimb = Math.round(parseFloat(pay?.reimbursement || 0));
    // Stored sheet WHT is authoritative — including explicit 0 (bonus-excluded months).
    const wht = (pay != null && pay.wht != null && pay.wht !== '')
        ? Math.round(parseFloat(pay.wht) || 0)
        : calculateMonthlyIncomeTax(grossTotal, opd, reimb);
    const eobi = Math.round(parseFloat(pay?.eobi_ee || 0)) || 400;
    const pf = contractEosbType === 'Provident Fund' ? Math.round(grossSalary / 24) : 0;
    const advance = Math.round(parseFloat(pay?.advance_deduction || 0));
    const loan = Math.round(parseFloat(pay?.loan_deduction || 0));
    const other = Math.round(parseFloat(pay?.other_deduction || 0));

    const deductions = [
        { label: 'Income Tax (WHT)', amount: wht },
        { label: 'EOBI (Employee Share)', amount: eobi },
        pf > 0 ? { label: 'Provident Fund (Employee)', amount: pf } : null,
        advance > 0 ? { label: 'Advance Recovery', amount: advance } : null,
        loan > 0 ? { label: 'Loan Installment', amount: loan } : null,
        other > 0 ? { label: 'Other Deductions', amount: other } : null,
    ].filter(Boolean);

    const totalDeductions = deductions.reduce((s, r) => s + r.amount, 0);
    const netPay = pay?.net != null && parseFloat(pay.net) > 0
        ? Math.round(parseFloat(pay.net))
        : grossTotal - totalDeductions;

    return {
        emp,
        pay,
        paidDays,
        workingDays: WORK_DAYS,
        additions,
        deductions,
        grossTotal,
        totalDeductions,
        netPay,
        fmt,
    };
}

module.exports = {
    WORK_DAYS,
    fmt,
    normalizeCnic,
    buildWorldAPayslipData,
};
