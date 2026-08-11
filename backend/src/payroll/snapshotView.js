'use strict';

/**
 * Read side of the Payroll Sheet snapshot.
 *
 * `payroll_transactions.computed_json` has exactly one producer — the Payroll Sheet
 * Calculate engine in `src/modules/payrollSheet/service.js` — and it is what the sheet
 * UI displays and what the bank file pays. Every other consumer (locked CSV export,
 * bank files, payslips, invoice columns) must render it through this module rather than
 * recompute payroll from raw inputs. Independent recomputation in each consumer is what
 * made the locked export disagree with the sheet.
 *
 * Rows calculated before the snapshot column existed (pre 2026-08-10) return null here,
 * and callers keep their legacy path for those months only.
 */

const round = (v) => Math.round(parseFloat(v) || 0);
const numeric = (v) => parseFloat(v) || 0;

function readPayrollSnapshot(pay) {
    const raw = pay?.computed_json;
    if (!raw) return null;
    let snap = raw;
    if (typeof raw === 'string') {
        try { snap = JSON.parse(raw); } catch { return null; }
    }
    if (!snap || typeof snap !== 'object' || snap.grossMonthly == null) return null;
    return snap;
}

/**
 * Maps a snapshot onto the flat shape the payroll CSV / bank file builders consume.
 * `other_deduction` is read from the row because the snapshot folds it into net pay
 * without itemising it.
 */
function exportRowFromSnapshot(emp, pay, snap) {
    const grossM = round(snap.grossMonthly);
    const netPay = round(snap.netPay);
    const medEE = round(snap.medEE);
    const medSP = round(snap.medSP);
    const medCh1 = round(snap.medCh1);
    const medCh2 = round(snap.medCh2);

    return {
        grossM,
        netPay,
        // Derived from the two snapshot totals so the exported row always balances,
        // whatever combination of deductions produced it.
        totalDed: grossM - netPay,
        wht: round(snap.incomeTax),
        eobi_ee: round(snap.eobi_ee),
        eobi_er: round(snap.eobi_er),
        sessi: round(snap.sessi),
        pfDed: round(snap.pfEE),
        pfER: round(snap.pfER),
        advDed: round(snap.advanceDed),
        loanDed: round(snap.loanDed),
        otherDed: round(pay?.other_deduction),
        gratuity: round(snap.gratuity),
        eosbType: emp?._eosb_type || (emp?.pf_enrolled ? 'Provident Fund' : 'None'),
        costBase: round(snap.totalPayrollCost),
        sc: round(snap.serviceCharges),
        st: round(snap.salesTax),
        inv: round(snap.totalInvoice),
        otAmt: round(snap.otAmount),
        opd: round(snap.opdClaim),
        reimb: round(snap.reimb),
        arr: round(snap.arrears),
        spl: round(snap.splAllow),
        fuel: round(snap.fuelMob),
        bonus: round(snap.bonusDisbursed != null ? snap.bonusDisbursed : snap.bonusAmount),
        overhead: round(snap.overhead),
        pd: numeric(snap.pd),
        ot2hrs: numeric(snap.ot2hrs),
        ot3hrs: numeric(snap.ot3hrs),
        medEE,
        medSP,
        medCh1,
        medCh2,
        medTotal: medEE + medSP + medCh1 + medCh2,
        bonusAccrual: round(snap.bonusAccrual),
        lifeIns: round(snap.lifeIns),
    };
}

module.exports = {
    readPayrollSnapshot,
    exportRowFromSnapshot,
};
