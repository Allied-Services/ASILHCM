'use strict';

const fs = require('fs');
const path = require('path');
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

    test('Provident Fund contract deducts Gross ÷ 24 and matches employer PF (no gratuity)', () => {
        const salary = 48000;
        const computed = computePrSheetRow({
            newSalary: salary,
            presentDays: 30,
            expectedDays: 30,
            modelA: true,
            eosbType: 'Provident Fund',
            lifeInsurance: 150,
        }, { standard_month_days: 30, service_charge_pct: 0.18, gratuity_accrual_months: 12 });

        const pf = Math.round(salary / 24);
        expect(computed.pfDeduction).toBe(pf);
        expect(computed.gratuityAccrual).toBe(0);
        expect(computed.netPay).toBe(computed.gross - computed.wht - pf - computed.eobiEmployee);

        const withoutPf = computePrSheetRow({
            newSalary: salary,
            presentDays: 30,
            expectedDays: 30,
            modelA: true,
            lifeInsurance: 150,
        }, { standard_month_days: 30, service_charge_pct: 0.18, gratuity_accrual_months: 12 });
        // PF ER replaces gratuity: TPC delta = pfER − gratuity
        expect(computed.totalPayrollCost).toBe(withoutPf.totalPayrollCost - withoutPf.gratuityAccrual + pf);

        const calc = sheetCalcFromEngine(computed, { paid_days: 30 }, { newSalary: salary });
        expect(calc.pfEE).toBe(pf);
        expect(calc.pfER).toBe(pf);
        expect(calc.gratuity).toBe(0);
        expect(calc.netPay).toBe(computed.netPay);
    });

    test('PF contract ignores stored pfDeduction of 0 (default column must not wipe PF)', () => {
        const salary = 37933;
        const computed = computePrSheetRow({
            newSalary: salary,
            presentDays: 30,
            expectedDays: 30,
            modelA: true,
            eosbType: 'Provident Fund',
            pfDeduction: 0,
        }, { standard_month_days: 30, service_charge_pct: 0.18 });
        expect(computed.pfDeduction).toBe(Math.round(salary / 24));
    });

    test('without eosbType, PF stays 0 unless an explicit positive override is passed', () => {
        const none = computePrSheetRow({
            newSalary: 48000,
            presentDays: 30,
            expectedDays: 30,
            modelA: true,
        }, { standard_month_days: 30, service_charge_pct: 0.18 });
        expect(none.pfDeduction).toBe(0);
        expect(none.gratuityAccrual).toBe(Math.round(48000 / 12));

        const override = computePrSheetRow({
            newSalary: 48000,
            presentDays: 30,
            expectedDays: 30,
            modelA: true,
            pfDeduction: 1667,
        }, { standard_month_days: 30, service_charge_pct: 0.18 });
        expect(override.pfDeduction).toBe(1667);
    });

    test('exposes eobi_er and sessi from the engine for a 40k Sindh-style row', () => {
        const salary = 40000;
        const computed = computePrSheetRow({
            newSalary: salary,
            presentDays: 30,
            expectedDays: 30,
            modelA: true,
            eobiMinWage: 40000,
        }, { standard_month_days: 30, service_charge_pct: 0.18 });
        expect(computed.eobiEmployer).toBe(2000);
        expect(computed.sessiEmployer).toBe(2400);

        const calc = sheetCalcFromEngine(computed, { paid_days: 30 }, { newSalary: salary });
        expect(calc.eobi_er).toBe(2000);
        expect(calc.sessi).toBe(2400);
        expect(calc.eobi_ee).toBe(400);
        expect(calc.pfEE).toBe(0);
    });

    test('upsert SQL persists eobi_er, sessi_er and pf_ee from calc', () => {
        const src = fs.readFileSync(path.join(__dirname, '../src/modules/payrollSheet/service.js'), 'utf8');
        const start = src.indexOf('async function upsertPayrollTransactions');
        expect(start).toBeGreaterThan(-1);
        const block = src.slice(start, src.indexOf('async function writeCycleAttendanceToSheet', start));
        expect(block).toMatch(/eobi_er/);
        expect(block).toMatch(/sessi_er/);
        expect(block).toMatch(/pf_ee/);
        expect(block).toMatch(/p\.calc\.eobi_er/);
        expect(block).toMatch(/p\.calc\.sessi/);
        expect(block).toMatch(/p\.calc\.pfEE/);
        expect(block).toMatch(/r\.calc\.eobi_er/);
        expect(block).toMatch(/r\.calc\.sessi/);
        expect((block.match(/eobi_er = EXCLUDED\.eobi_er/g) || []).length).toBeGreaterThanOrEqual(2);
        expect((block.match(/sessi_er = EXCLUDED\.sessi_er/g) || []).length).toBeGreaterThanOrEqual(2);
    });
});
