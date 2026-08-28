'use strict';

const { calculateMonthlyIncomeTax, calculateEOBI } = require('../../../taxEngine');
const { readPayrollSnapshot } = require('../../payroll/snapshotView');
const { calendarDaysInMonth } = require('../../payroll/prSheetEngine');

const WORK_DAYS = 26;

function fmt(v) {
    return Math.round(parseFloat(v) || 0).toLocaleString('en-PK');
}

function normalizeCnic(cnic) {
    return String(cnic || '').replace(/\D/g, '');
}

const round = (v) => Math.round(parseFloat(v) || 0);

function round2(v) {
    return Math.round((parseFloat(v) || 0) * 100) / 100;
}

function resolveCalendarDays(pay) {
    const fromPeriod = calendarDaysInMonth(pay?.month, pay?.year);
    if (fromPeriod) return fromPeriod;
    return WORK_DAYS;
}

/**
 * Payslip attendance presentation — does NOT change bank/net figures.
 * Gross line shows contractual salary; absence is an explicit deduction.
 */
function resolveAbsencePresentation(emp, pay, snap) {
    const fullSalary = round(emp?.salary ?? emp?.gross ?? 0);
    const calendarDays = resolveCalendarDays(pay);
    const paidDaysRaw = parseFloat(pay?.paid_days);
    const basicPaid = snap
        ? round(snap.basicPaid)
        : (Number.isFinite(paidDaysRaw) && calendarDays > 0
            ? round(fullSalary * paidDaysRaw / calendarDays)
            : fullSalary);

    let absentDays = snap && snap.absentDays != null ? parseFloat(snap.absentDays) : NaN;
    if (!Number.isFinite(absentDays) || absentDays < 0) {
        const fromSnapDed = snap && snap.absenceDeduction != null ? parseFloat(snap.absenceDeduction) : NaN;
        if (Number.isFinite(fromSnapDed) && fromSnapDed > 0 && fullSalary > 0) {
            absentDays = Math.round((fromSnapDed / fullSalary) * calendarDays);
        } else if (fullSalary > 0 && basicPaid < fullSalary) {
            absentDays = Math.round(((fullSalary - basicPaid) / fullSalary) * calendarDays);
        } else {
            absentDays = 0;
        }
    }
    absentDays = Math.max(0, Math.round(absentDays * 100) / 100);

    // Prefer exact calendar fraction (e.g. 3/31 × 40,000 = 3,870.97) when days known;
    // fall back to integer gap between contractual salary and paid basic.
    let absenceDeduction = 0;
    if (absentDays > 0 && fullSalary > 0 && calendarDays > 0) {
        absenceDeduction = round2(fullSalary * absentDays / calendarDays);
    } else if (fullSalary > basicPaid) {
        absenceDeduction = round2(fullSalary - basicPaid);
        if (absentDays <= 0 && fullSalary > 0) {
            absentDays = Math.round((absenceDeduction / fullSalary) * calendarDays);
        }
    }

    const paidDays = Math.max(0, round2(calendarDays - absentDays));
    return {
        fullSalary,
        basicPaid,
        calendarDays,
        absentDays,
        absenceDeduction,
        paidDays,
    };
}

/**
 * Payslip rendered from the Payroll Sheet snapshot (payroll_transactions.computed_json).
 * Net pay and cash totals stay locked to the snapshot (what the bank pays). Presentation
 * shows full contractual gross with an explicit Absent Deductions line when applicable.
 */
function payslipFromSnapshot(emp, pay, snap) {
    const ot2Hrs = parseFloat(snap.ot2hrs) || 0;
    const ot3Hrs = parseFloat(snap.ot3hrs) || 0;
    const netPay = round(snap.netPay);
    const att = resolveAbsencePresentation(emp, pay, snap);

    const additions = [
        { label: 'Gross Salary', amount: att.fullSalary },
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

    const grossTotal = round2(additions.reduce((s, r) => s + r.amount, 0));

    const pf = round(snap.pfEE);
    const advance = round(snap.advanceDed);
    const loan = round(snap.loanDed);
    const other = round(pay?.other_deduction);
    const absentLabel = Number.isInteger(att.absentDays)
        ? `Absent Deductions (${att.absentDays} days)`
        : `Absent Deductions (${att.absentDays} days)`;
    const deductions = [
        att.absenceDeduction > 0 ? { label: absentLabel, amount: att.absenceDeduction } : null,
        { label: 'Income Tax (WHT)', amount: round(snap.incomeTax) },
        { label: 'EOBI (Employee Share)', amount: round(snap.eobi_ee) },
        pf > 0 ? { label: 'Provident Fund (Employee)', amount: pf } : null,
        advance > 0 ? { label: 'Advance Recovery', amount: advance } : null,
        loan > 0 ? { label: 'Loan Installment', amount: loan } : null,
        other > 0 ? { label: 'Other Deductions', amount: other } : null,
    ].filter(Boolean);

    // Net pay is what actually leaves the bank account — deductions reconcile to it.
    const totalDeductions = round2(grossTotal - netPay);
    const itemisedDeductions = round2(deductions.reduce((s, r) => s + r.amount, 0));
    if (Math.abs(itemisedDeductions - totalDeductions) >= 0.01) {
        deductions.push({ label: 'Other Adjustments', amount: round2(totalDeductions - itemisedDeductions) });
    }

    return {
        emp,
        pay,
        paidDays: att.paidDays,
        workingDays: att.calendarDays,
        absentDays: att.absentDays,
        absenceDeduction: att.absenceDeduction,
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
    const att = resolveAbsencePresentation(emp, pay, null);
    const grossSalary = att.fullSalary;
    const paidDays = parseFloat(pay?.paid_days ?? WORK_DAYS);
    const ratio = WORK_DAYS > 0 ? paidDays / WORK_DAYS : 1;
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
        { label: 'Gross Salary', amount: grossSalary, kind: 'salary' },
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
    const wht = (pay != null && pay.wht != null && pay.wht !== '')
        ? Math.round(parseFloat(pay.wht) || 0)
        : calculateMonthlyIncomeTax(grossProrated + otAmount + medicalReimb + expenseReimb + arrears + specialAllow + fuelMobile + bonus, medicalReimb, expenseReimb);
    const eobi = Math.round(parseFloat(pay?.eobi_ee || 0))
        || calculateEOBI({ year: pay?.year, month: pay?.month }).employeeShare;
    const pf = contractEosbType === 'Provident Fund' ? Math.round(grossSalary / 24) : 0;
    const advance = Math.round(parseFloat(pay?.advance_deduction || 0) || 0);
    const loan = Math.round(parseFloat(pay?.loan_deduction || 0) || 0);
    const other = Math.round(parseFloat(pay?.other_deduction || 0) || 0);

    const deductions = [
        att.absenceDeduction > 0
            ? { label: `Absent Deductions (${att.absentDays} days)`, amount: att.absenceDeduction, kind: 'absence' }
            : null,
        { label: 'Income Tax (WHT)', amount: wht, kind: 'tax' },
        { label: 'EOBI (Employee Share)', amount: eobi, kind: 'statutory' },
        pf > 0 ? { label: 'Provident Fund (Employee)', amount: pf, kind: 'statutory' } : null,
        advance > 0 ? { label: 'Advance Recovery', amount: advance, kind: 'recovery' } : null,
        loan > 0 ? { label: 'Loan Installment', amount: loan, kind: 'recovery' } : null,
        other > 0 ? { label: 'Other Deductions', amount: other, kind: 'recovery' } : null,
    ].filter(Boolean);

    const netPay = pay?.net != null && parseFloat(pay.net) > 0
        ? Math.round(parseFloat(pay.net))
        : Math.round(grossTotal - deductions.reduce((s, r) => s + r.amount, 0));
    const totalDeductions = grossTotal - netPay;
    const taxDeductions = deductions.filter(d => d.kind === 'tax').reduce((s, r) => s + r.amount, 0);
    const otherDeductions = totalDeductions - taxDeductions;

    return {
        emp,
        pay,
        paidDays: att.paidDays,
        workingDays: att.calendarDays,
        absentDays: att.absentDays,
        absenceDeduction: att.absenceDeduction,
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
    resolveAbsencePresentation,
};
