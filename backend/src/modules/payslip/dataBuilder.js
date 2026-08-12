'use strict';

const { calculateMonthlyIncomeTax } = require('../../../taxEngine');

const WORK_DAYS = 26;

function fmt(v) {
    return Math.round(parseFloat(v) || 0).toLocaleString('en-PK');
}

function normalizeCnic(cnic) {
    return String(cnic || '').replace(/\D/g, '');
}

function buildWorldAPayslipData(emp, pay, contractEosbType) {
    const grossSalary = parseFloat(emp.salary) || 0;
    const paidDays = parseFloat(pay?.paid_days ?? WORK_DAYS);
    const ratio = paidDays / WORK_DAYS;
    const grossProrated = Math.round(grossSalary * ratio);

    const ot2Hrs = Math.round((parseFloat(pay?.ot2_hrs || 0) || 0) * 100) / 100;
    const ot3Hrs = Math.round((parseFloat(pay?.ot3_hrs || 0) || 0) * 100) / 100;
    const hourlyRate = grossSalary / WORK_DAYS / 8;
    const ot2Amount = Math.round(ot2Hrs * 2 * hourlyRate);
    const ot3Amount = Math.round(ot3Hrs * 3 * hourlyRate);
    const otAmount = ot2Amount + ot3Amount;

    const medicalReimb = Math.round(parseFloat(pay?.opd_claim || 0) || 0);
    const expenseReimb = Math.round(parseFloat(pay?.reimbursement || 0) || 0);
    const arrears = Math.round(parseFloat(pay?.arrears || 0) || 0);
    const specialAllow = Math.round(parseFloat(pay?.special_allowance || 0) || 0);
    const fuelMobile = Math.round(parseFloat(pay?.fuel_mobile || 0) || 0);
    const bonus = Math.round(parseFloat(pay?.bonus_amount || 0) || 0);

    const additions = [
        { label: 'Gross Salary', amount: grossProrated, kind: 'salary' },
        ot2Hrs > 0 ? { label: `Overtime 2X (${ot2Hrs} hrs)`, amount: ot2Amount, kind: 'ot2' } : null,
        ot3Hrs > 0 ? { label: `Overtime 3X (${ot3Hrs} hrs)`, amount: ot3Amount, kind: 'ot3' } : null,
        medicalReimb > 0 ? { label: 'Medical Reimbursement (OPD)', amount: medicalReimb, kind: 'medical' } : null,
        expenseReimb > 0 ? { label: 'Expense Reimbursement', amount: expenseReimb, kind: 'expense' } : null,
        arrears > 0 ? { label: 'Arrears', amount: arrears, kind: 'other' } : null,
        specialAllow > 0 ? { label: 'Special Allowance', amount: specialAllow, kind: 'other' } : null,
        fuelMobile > 0 ? { label: 'Fuel / Mobile Allowance', amount: fuelMobile, kind: 'other' } : null,
        bonus > 0 ? { label: 'Bonus', amount: bonus, kind: 'other' } : null,
    ].filter(Boolean);

    const grossTotal = additions.reduce((s, r) => s + r.amount, 0);
    // Stored sheet WHT is authoritative — including explicit 0 (bonus-excluded months).
    const wht = (pay != null && pay.wht != null && pay.wht !== '')
        ? Math.round(parseFloat(pay.wht) || 0)
        : calculateMonthlyIncomeTax(grossTotal, medicalReimb, expenseReimb);
    const eobi = Math.round(parseFloat(pay?.eobi_ee || 0)) || 400;
    const pf = contractEosbType === 'Provident Fund' ? Math.round(grossSalary / 24) : 0;
    const advance = Math.round(parseFloat(pay?.advance_deduction || 0) || 0);
    const loan = Math.round(parseFloat(pay?.loan_deduction || 0) || 0);
    const other = Math.round(parseFloat(pay?.other_deduction || 0) || 0);

    const deductions = [
        { label: 'Income Tax (WHT)', amount: wht, kind: 'tax' },
        { label: 'EOBI (Employee Share)', amount: eobi, kind: 'statutory' },
        pf > 0 ? { label: 'Provident Fund (Employee)', amount: pf, kind: 'statutory' } : null,
        advance > 0 ? { label: 'Advance Recovery', amount: advance, kind: 'recovery' } : null,
        loan > 0 ? { label: 'Loan Installment', amount: loan, kind: 'recovery' } : null,
        other > 0 ? { label: 'Other Deductions', amount: other, kind: 'recovery' } : null,
    ].filter(Boolean);

    const totalDeductions = deductions.reduce((s, r) => s + r.amount, 0);
    const taxDeductions = deductions.filter(d => d.kind === 'tax').reduce((s, r) => s + r.amount, 0);
    const otherDeductions = totalDeductions - taxDeductions;
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
        taxDeductions,
        otherDeductions,
        netPay,
        overtime: {
            ot2Hrs,
            ot3Hrs,
            ot2Amount,
            ot3Amount,
            otAmount,
            hourlyRate: Math.round(hourlyRate * 100) / 100,
        },
        reimbursements: {
            medical: medicalReimb,
            expense: expenseReimb,
            total: medicalReimb + expenseReimb,
        },
        fmt,
    };
}

module.exports = {
    WORK_DAYS,
    fmt,
    normalizeCnic,
    buildWorldAPayslipData,
};
