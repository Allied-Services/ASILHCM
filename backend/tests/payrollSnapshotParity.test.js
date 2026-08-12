'use strict';

/**
 * Golden parity: every consumer of a payroll row must render the SAME numbers.
 *
 * The Payroll Sheet Calculate engine writes one snapshot per employee-month into
 * `payroll_transactions.computed_json`. The sheet UI, the locked CSV export, the bank
 * file and the payslip are all supposed to be views of that single snapshot. Historically
 * each of them recomputed payroll independently, so they disagreed in production — the
 * locked export invented Rs. 401 of tax for an employee the sheet correctly taxed at 0,
 * and the 305-person export differed from the sheet by Rs. 155,559 in total.
 *
 * These tests run the real producer chain (computePrSheetRow -> sheetCalcFromEngine) and
 * then assert that the export mapper and the payslip builder reproduce it field for field,
 * and that each document balances internally (gross - deductions === net).
 */

const { computePrSheetRow } = require('../src/payroll/prSheetEngine');
const { sheetCalcFromEngine } = require('../src/modules/payrollSheet/service');
const { readPayrollSnapshot, exportRowFromSnapshot } = require('../src/payroll/snapshotView');
const { buildWorldAPayslipData } = require('../src/modules/payslip/dataBuilder');

const POLICY = {
    standard_month_days: 30,
    service_charge_pct: 0.18,
    bonus_accrual_months: 12,
    gratuity_accrual_months: 12,
};

const EMP = {
    id: 'ASIL/SPL-208/21',
    name: 'Parity Fixture',
    salary: 42018,
    _eosb_type: 'Gratuity',
};

/** Runs the real Calculate chain and returns the snapshot exactly as it is persisted. */
function buildSnapshot(overrides = {}) {
    const {
        presentDays = 30,
        ot2 = 0,
        ot3 = 0,
        opd = 0,
        expense = 0,
        arrears = 0,
        specialAllowance = 0,
        fuelMobile = 0,
        bonusDisbursement = 0,
        otherDeduction = 0,
        advanceDeduction = 0,
        loanDeduction = 0,
        salary = EMP.salary,
    } = overrides;

    const computeInput = {
        salary,
        modelA: true,
        presentDays,
        expectedDays: 30,
        calendarBasis: 30,
        ot2,
        ot3,
        opd,
        expense,
        arrears,
        specialAllowance,
        fuelMobile,
        bonusDisbursement,
        otherDeduction,
        // Payroll-sheet rule: the annual bonus lump is not taxed in the payment month.
        excludeBonusFromWht: true,
        salesTaxRate: 0.15,
    };

    const ov = {
        paid_days: presentDays,
        ot2_hrs: ot2,
        ot3_hrs: ot3,
        opd_claim: opd,
        reimbursement: expense,
        arrears,
        bonus_amount: bonusDisbursement,
        special_allowance: specialAllowance,
        fuel_mobile: fuelMobile,
        other_deduction: otherDeduction,
        advance_deduction: advanceDeduction,
        loan_deduction: loanDeduction,
        medical_ee: 0,
        medical_sp: 0,
        medical_ch1: 0,
        medical_ch2: 0,
        remarks: null,
    };

    const computed = computePrSheetRow(computeInput, POLICY);
    return { snapshot: sheetCalcFromEngine(computed, ov, computeInput), ov };
}

/** The DB row as the export and payslip routes read it back. */
function payRow(snapshot, ov) {
    return { ...ov, computed_json: snapshot, locked: true };
}

const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);

/**
 * Reads the tax a payslip actually shows.
 *
 * The payslip omits zero-value rows, so an absent row legitimately means zero — but an
 * absent row must never be allowed to silently stand in for tax that was really charged.
 * Assert the row is there exactly when the snapshot says tax was deducted.
 */
function payslipWht(slip, expectedTax) {
    const whtRow = slip.deductions.find((d) => d.label === 'Income Tax (WHT)');
    if (expectedTax > 0) {
        expect(whtRow).toBeDefined();
        return whtRow.amount;
    }
    expect(whtRow).toBeUndefined();
    return 0;
}

describe('Payroll snapshot parity — sheet, export and payslip agree', () => {
    // The exact production case: salary 42,018 with a bonus lump that pushes cash gross
    // to 90,100. Annualising the FULL gross yields Rs. 401 of tax; the sheet correctly
    // taxes 0 because the bonus is excluded. The export used to show the 401.
    const BONUS = 90100 - 42018;

    test('export row reproduces the snapshot field for field', () => {
        const { snapshot, ov } = buildSnapshot({ bonusDisbursement: BONUS });
        const row = exportRowFromSnapshot(EMP, payRow(snapshot, ov), snapshot);

        expect(row.grossM).toBe(snapshot.grossMonthly);
        expect(row.netPay).toBe(snapshot.netPay);
        expect(row.wht).toBe(snapshot.incomeTax);
        expect(row.eobi_ee).toBe(snapshot.eobi_ee);
        expect(row.pfDed).toBe(snapshot.pfEE);
        expect(row.otAmt).toBe(snapshot.otAmount);
        expect(row.bonus).toBe(snapshot.bonusDisbursed);
        expect(row.gratuity).toBe(snapshot.gratuity);
        expect(row.sessi).toBe(snapshot.sessi);
        expect(row.costBase).toBe(snapshot.totalPayrollCost);
        expect(row.sc).toBe(snapshot.serviceCharges);
        expect(row.st).toBe(snapshot.salesTax);
        expect(row.inv).toBe(snapshot.totalInvoice);
        expect(row.pd).toBe(snapshot.pd);
    });

    test('payslip reproduces the snapshot totals', () => {
        const { snapshot, ov } = buildSnapshot({ bonusDisbursement: BONUS });
        const slip = buildWorldAPayslipData(EMP, payRow(snapshot, ov), 'Gratuity');

        expect(slip.grossTotal).toBe(snapshot.grossMonthly);
        expect(slip.netPay).toBe(snapshot.netPay);
        expect(payslipWht(slip, snapshot.incomeTax)).toBe(snapshot.incomeTax);
    });

    test('export and payslip agree with each other on gross, net and tax', () => {
        const { snapshot, ov } = buildSnapshot({ bonusDisbursement: BONUS });
        const pay = payRow(snapshot, ov);
        const row = exportRowFromSnapshot(EMP, pay, snapshot);
        const slip = buildWorldAPayslipData(EMP, pay, 'Gratuity');

        expect(row.grossM).toBe(slip.grossTotal);
        expect(row.netPay).toBe(slip.netPay);
        expect(row.totalDed).toBe(slip.totalDeductions);
        expect(row.wht).toBe(payslipWht(slip, row.wht));
    });

    test('a taxed employee gets a visible tax row matching the export', () => {
        const HIGH_SALARY = 250000;
        const emp = { ...EMP, salary: HIGH_SALARY };
        const { snapshot, ov } = buildSnapshot({ salary: HIGH_SALARY });
        const pay = payRow(snapshot, ov);
        const slip = buildWorldAPayslipData(emp, pay, 'Gratuity');
        const row = exportRowFromSnapshot(emp, pay, snapshot);

        // Hiding zero-value rows must not extend to hiding tax that was actually deducted.
        expect(snapshot.incomeTax).toBeGreaterThan(0);
        expect(payslipWht(slip, snapshot.incomeTax)).toBe(snapshot.incomeTax);
        expect(row.wht).toBe(snapshot.incomeTax);
        expect(slip.grossTotal - slip.totalDeductions).toBe(slip.netPay);
    });

    test('regression: bonus-excluded row is taxed 0 in the export, not 401', () => {
        const { snapshot, ov } = buildSnapshot({ bonusDisbursement: BONUS });
        expect(snapshot.grossMonthly).toBe(90100);
        expect(snapshot.incomeTax).toBe(0);

        const row = exportRowFromSnapshot(EMP, payRow(snapshot, ov), snapshot);
        expect(row.wht).toBe(0);

        // Guard the specific wrong answer: annualising the full cash gross.
        const annualisedOnFullGross = Math.round(((90100 * 12 - 600000) * 0.01) / 12);
        expect(annualisedOnFullGross).toBe(401);
        expect(row.wht).not.toBe(annualisedOnFullGross);
    });
});

describe('Payroll snapshot parity — documents balance internally', () => {
    const CASES = [
        { name: 'plain full month', opts: {} },
        { name: 'part month', opts: { presentDays: 21 } },
        { name: 'overtime', opts: { ot2: 12.5, ot3: 4 } },
        { name: 'bonus lump', opts: { bonusDisbursement: 48082 } },
        { name: 'claims and allowances', opts: { opd: 3000, expense: 2500, specialAllowance: 1500, fuelMobile: 800 } },
        { name: 'other deduction', opts: { otherDeduction: 2200 } },
        { name: 'advance and loan', opts: { advanceDeduction: 1500, loanDeduction: 2500 } },
        { name: 'everything at once', opts: {
            presentDays: 24, ot2: 9.5, ot3: 2, opd: 1200, expense: 900, arrears: 3000,
            specialAllowance: 500, fuelMobile: 400, bonusDisbursement: 20000,
            otherDeduction: 1100, advanceDeduction: 800, loanDeduction: 600,
        } },
    ];

    test.each(CASES)('$name: export row balances (gross - deductions = net)', ({ opts }) => {
        const { snapshot, ov } = buildSnapshot(opts);
        const row = exportRowFromSnapshot(EMP, payRow(snapshot, ov), snapshot);
        expect(row.grossM - row.totalDed).toBe(row.netPay);
    });

    test.each(CASES)('$name: payslip balances and its line items sum to the totals', ({ opts }) => {
        const { snapshot, ov } = buildSnapshot(opts);
        const slip = buildWorldAPayslipData(EMP, payRow(snapshot, ov), 'Gratuity');

        expect(slip.grossTotal - slip.totalDeductions).toBe(slip.netPay);
        expect(sum(slip.additions)).toBe(slip.grossTotal);
        expect(sum(slip.deductions)).toBe(slip.totalDeductions);
    });

    test.each(CASES)('$name: export and payslip never disagree', ({ opts }) => {
        const { snapshot, ov } = buildSnapshot(opts);
        const pay = payRow(snapshot, ov);
        const row = exportRowFromSnapshot(EMP, pay, snapshot);
        const slip = buildWorldAPayslipData(EMP, pay, 'Gratuity');

        expect(row.grossM).toBe(slip.grossTotal);
        expect(row.netPay).toBe(slip.netPay);
        expect(row.totalDed).toBe(slip.totalDeductions);
    });
});

describe('readPayrollSnapshot', () => {
    test('accepts a jsonb object and a JSON string alike', () => {
        const { snapshot } = buildSnapshot({ bonusDisbursement: 1000 });
        expect(readPayrollSnapshot({ computed_json: snapshot }).grossMonthly).toBe(snapshot.grossMonthly);
        expect(readPayrollSnapshot({ computed_json: JSON.stringify(snapshot) }).grossMonthly).toBe(snapshot.grossMonthly);
    });

    test('returns null for rows with no usable snapshot so callers keep the legacy path', () => {
        expect(readPayrollSnapshot(null)).toBeNull();
        expect(readPayrollSnapshot({})).toBeNull();
        expect(readPayrollSnapshot({ computed_json: null })).toBeNull();
        expect(readPayrollSnapshot({ computed_json: 'not json' })).toBeNull();
        expect(readPayrollSnapshot({ computed_json: {} })).toBeNull();
    });

    test('pre-snapshot rows still produce a payslip via the legacy path', () => {
        const legacyPay = { paid_days: 26, wht: 0, net: 41618, eobi_ee: 400 };
        const slip = buildWorldAPayslipData(EMP, legacyPay, 'Gratuity');
        expect(slip.grossTotal).toBe(EMP.salary);
        expect(slip.netPay).toBe(41618);
    });
});
