'use strict';

const { sheetCalcFromEngine } = require('../src/modules/payrollSheet/service');
const { computePrSheetRow } = require('../src/payroll/prSheetEngine');

describe('payrollSheet sheetCalcFromEngine', () => {
    test('does not double-subtract advance and loan from net', () => {
        const computed = computePrSheetRow({
            newSalary: 100000,
            presentDays: 30,
            expectedDays: 30,
            modelA: true,
            otherDeduction: 500, // sheet other only
            excludeBonusFromWht: true,
        }, { standard_month_days: 30, service_charge_pct: 0.18 });

        const calc = sheetCalcFromEngine(computed, {
            paid_days: 30,
            advance_deduction: 1000,
            loan_deduction: 2000,
            other_deduction: 500,
        }, {});

        // Engine net already reduced by otherDeduction 500; then -1000 -2000 once
        expect(calc.netPay).toBe(Math.round(computed.netPay - 1000 - 2000));
        expect(calc.advanceDed).toBe(1000);
        expect(calc.loanDed).toBe(2000);
    });

    test('July Wafi-style excludeBonusFromWht matches SPL-91 tax shape', () => {
        const computed = computePrSheetRow({
            newSalary: 90000,
            presentDays: 30,
            expectedDays: 30,
            modelA: true,
            ot2: 40,
            bonusDisbursement: 50000,
            excludeBonusFromWht: true,
        }, { standard_month_days: 30, service_charge_pct: 0.18, ot_divisor_days: 26, ot_divisor_hours: 8 });

        const calc = sheetCalcFromEngine(computed, { paid_days: 30 }, { opd: 0, expense: 0 });
        expect(calc.incomeTax).toBe(computed.wht);
        expect(calc.grossMonthly).toBe(computed.gross);
        expect(calc.serverComputed).toBe(true);
    });
});
