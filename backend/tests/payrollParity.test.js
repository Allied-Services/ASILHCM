'use strict';

/**
 * MD Operational Mandate §4 — Zero Variance Rule
 * Tests for the 7 payroll pillars against Excel master-sheet formulas.
 */
const {
    calculateEOBI,
    calculateSESSI,
    calculateMonthlyIncomeTax,
} = require('../taxEngine');
const { computePrSheetRow, computeBonusDisbursement } = require('../src/payroll/prSheetEngine');
const {
    computeWorkingDays,
    derivePaidDays,
    aggregateClaimInputs,
    applyBillingAmount,
    PAYROLL_RUN_STATUSES,
    canTransitionStatus,
} = require('../src/modules/payrollrun/service');
const {
    canManuallySetPaymentStatus,
    PAYMENT_STATUS_NOTIFY_EMAILS,
} = require('../src/modules/ar/paymentStatusGuard');

const POLICY = {
    standard_month_days: 30,
    ot_divisor_days: 26,
    ot_divisor_hours: 8,
    service_charge_pct: 0.18,
    bonus_accrual_months: 12,
    gratuity_accrual_months: 12,
};

describe('Pillar 1 — OT 1X', () => {
    test('OT amount includes 1× hours in addition to 2× and 3×', () => {
        const salary = 45991;
        const row = computePrSheetRow({
            newSalary: salary,
            paidDays: 30,
            workingDays: 30,
            ot1: 8,
            ot2: 9,
            ot3: 4,
            salesTaxRate: 0.18,
        }, POLICY);
        const hourly = salary / 26 / 8;
        const expected = Math.round(hourly * (1 * 8 + 2 * 9 + 3 * 4));
        expect(row.overtimeAmount).toBe(expected);
    });

    test('Excel fixture ASIL/SPL-205/21 May-26: OT2=9 → 3980', () => {
        const row = computePrSheetRow({
            newSalary: 45991,
            paidDays: 30,
            workingDays: 30,
            ot2: 9,
            ot3: 0,
        }, POLICY);
        expect(row.overtimeAmount).toBe(3980);
        expect(row.eobiEmployee).toBe(400);
    });

    test('Excel fixture ASIL/SPL-213/21 May-26: OT2=14 → 6433', () => {
        const row = computePrSheetRow({
            newSalary: 47786,
            paidDays: 30,
            workingDays: 30,
            ot2: 14,
            ot3: 0,
        }, POLICY);
        expect(row.overtimeAmount).toBe(6433);
    });

    test('aggregateClaimInputs sums ot1 from overtime claims', () => {
        const result = aggregateClaimInputs([
            { id: 1, claim_type: 'overtime', claimed_items: [{ ot1: 3, ot2: 5, ot3: 2 }] },
            { id: 2, claim_type: 'medical', claimed_items: [{ amount: 1500 }] },
        ]);
        expect(result.ot1).toBe(3);
        expect(result.ot2).toBe(5);
        expect(result.ot3).toBe(2);
        expect(result.opd).toBe(1500);
    });

    test('PSO OT divisor 30×8 @1× — Excel Abdul Mateen fixture (67.5 hrs × 60,000/240)', () => {
        const psoPolicy = { ...POLICY, ot_divisor_days: 30, ot_divisor_hours: 8 };
        const row = computePrSheetRow({
            newSalary: 60000,
            paidDays: 30,
            workingDays: 30,
            ot1: 67.5,
        }, psoPolicy);
        expect(row.overtimeAmount).toBe(16875);
    });

    test('component rounding — integer gross and net (Excel parity)', () => {
        const row = computePrSheetRow({
            newSalary: 45991,
            paidDays: 30,
            workingDays: 30,
            ot2: 9,
            wht: 1600,
            pfDeduction: 1667,
        }, POLICY);
        expect(Number.isInteger(row.gross)).toBe(true);
        expect(Number.isInteger(row.netPay)).toBe(true);
        expect(row.netPay).toBe(row.gross - row.wht - row.pfDeduction - row.eobiEmployee);
    });

    test('fractional PF override — Excel Fayaz fixture (1666.67 PF + 42.56 WHT)', () => {
        const row = computePrSheetRow({
            newSalary: 40000,
            paidDays: 28,
            workingDays: 28,
            salaryForDays: 54256,
            wht: 42.56,
            pfDeduction: 1666.67,
            eobiEmployee: 400,
        }, POLICY);
        expect(row.gross).toBe(54256);
        expect(row.netPay).toBe(52147);
    });

    test('fractional PF override — Excel SPL/22/97 fixture (2864.67 PF + 187.52 WHT)', () => {
        const row = computePrSheetRow({
            newSalary: 68752,
            paidDays: 30,
            workingDays: 30,
            salaryForDays: 68752,
            wht: 187.52,
            pfDeduction: 2864.67,
            eobiEmployee: 400,
        }, POLICY);
        expect(row.gross).toBe(68752);
        expect(row.netPay).toBe(65300);
    });

    test('EOBI override — PSO labor row with eobi=0', () => {
        const row = computePrSheetRow({
            newSalary: 50000,
            paidDays: 30,
            workingDays: 30,
            eobiEmployee: 0,
        }, POLICY);
        expect(row.eobiEmployee).toBe(0);
        expect(row.netPay).toBe(row.gross - row.wht);
    });

    test('other deduction reduces net pay, not gross (Excel AE/AD parity)', () => {
        const row = computePrSheetRow({
            newSalary: 47000,
            presentDays: 27,
            expectedDays: 30,
            modelA: true,
            salaryForDays: 42300,
            otherDeduction: 26633,
            eobiEmployee: 400,
        }, POLICY);
        expect(row.gross).toBe(42300);
        expect(row.netPay).toBe(42300 - 26633 - 400);
    });

    test('Excel component overrides — salaryForDays + overtimeAmount', () => {
        const row = computePrSheetRow({
            newSalary: 40000,
            presentDays: 30,
            expectedDays: 30,
            modelA: true,
            salaryForDays: 40000,
            overtimeAmount: 19904,
            ot1: 103.5,
        }, POLICY);
        expect(row.gross).toBe(59904);
        expect(row.overtimeAmount).toBe(19904);
    });

    test('rate-card billing OT includes 1×', () => {
        const computed = { totalCost: 100000 };
        applyBillingAmount(computed, {
            billRate: 50000,
            paidDays: 30,
            workingDays: 30,
            ot1: 4,
            ot2: 2,
            ot3: 0,
            policy: POLICY,
            rateCardMatch: true,
        });
        const billHourly = 50000 / 26 / 8;
        expect(computed.billOtAmount).toBe(Math.round(billHourly * (1 * 4 + 2 * 2)));
    });
});

describe('Pillar 2 — Working Days math', () => {
    test('July 2026: 31 days − 4 Sundays − 1 holiday = 26', () => {
        // Jul 2026 Sundays: 5, 12, 19, 26; holiday Jul 1
        const holidays = new Set(['2026-07-01']);
        expect(computeWorkingDays(2026, 7, holidays)).toBe(26);
    });

    test('manual sheet override wins over calendar math', () => {
        expect(computeWorkingDays(2026, 7, new Set(), { override: 28 })).toBe(28);
    });

    test('February 2026 non-leap: 28 − 4 Sundays = 24', () => {
        expect(computeWorkingDays(2026, 2, new Set())).toBe(24);
    });
});

describe('Pillar 3 — Default Present Days', () => {
    test('no attendance → paidDays defaults to workingDays', () => {
        expect(derivePaidDays([], 26, 'full_ledger')).toBe(26);
    });

    test('absent_only with no records → full working days', () => {
        expect(derivePaidDays([], 26, 'absent_only')).toBe(26);
    });

    test('present/half_day/leave still counted when records exist', () => {
        const records = [
            { status: 'present' },
            { status: 'half_day' },
            { status: 'leave' },
            { status: 'absent' },
        ];
        expect(derivePaidDays(records, 26, 'full_ledger')).toBe(2.5);
    });
});

describe('Pillar 4 — Medical Reimbursements', () => {
    test('OPD medical reimbursement adds to gross and is excluded from WHT base', () => {
        const row = computePrSheetRow({
            newSalary: 50000,
            paidDays: 30,
            workingDays: 30,
            opd: 5000,
            expense: 0,
        }, POLICY);
        expect(row.gross).toBe(50000 + 5000);
        // Taxable monthly = gross - opd - expense = 50000
        expect(row.wht).toBe(Math.round(calculateMonthlyIncomeTax(55000, 5000, 0)));
    });
});

describe('Pillar 5 — Previous Dues', () => {
    test('previousDues adds to gross like arrears', () => {
        const row = computePrSheetRow({
            newSalary: 40000,
            paidDays: 30,
            workingDays: 30,
            previousDues: 2500,
            arrears: 1000,
        }, POLICY);
        expect(row.gross).toBe(40000 + 2500 + 1000);
    });
});

describe('Pillar 6 — Employee EOBI 400 PKR', () => {
    test('flat EE share is always 400', () => {
        expect(calculateEOBI().employeeShare).toBe(400);
        expect(calculateEOBI().employerShare).toBe(2000);
        const row = computePrSheetRow({ newSalary: 87416, paidDays: 30, workingDays: 30 }, POLICY);
        expect(row.eobiEmployee).toBe(400);
    });
});

describe('Pillar 7 — Pakistan tax deductions', () => {
    test('FBR 2025-26 slab: annual 600k → 0 monthly tax', () => {
        expect(calculateMonthlyIncomeTax(50000)).toBe(0);
    });

    test('FBR slab: annual 1.2M → 1% of amount above 600k / 12', () => {
        // 100000/mo * 12 = 1,200,000 → (600000)*0.01 = 6000 annual → 500/mo
        expect(calculateMonthlyIncomeTax(100000)).toBe(500);
    });

    test('SESSI employer only, capped, exempt above 40k', () => {
        expect(calculateSESSI(30000)).toBe(1800);
        expect(calculateSESSI(40000)).toBe(2400);
        expect(calculateSESSI(40001)).toBe(0);
    });

    test('SESSI is flat Rs. 2,400 when contractual salary is below 45,000', () => {
        const row = computePrSheetRow({
            newSalary: 44356,
            paidDays: 30,
            workingDays: 30,
            ot2: 16,
            ot3: 0,
        }, POLICY);
        expect(row.gross).toBeGreaterThan(40000);
        expect(row.sessiEmployer).toBe(2400);
    });

    test('SESSI exempt when contractual salary is 45000 or above', () => {
        const row = computePrSheetRow({
            newSalary: 45158,
            paidDays: 30,
            workingDays: 30,
        }, POLICY);
        expect(row.sessiEmployer).toBe(0);
    });

    test('medical coverage is tracked separately and excluded from total payroll cost', () => {
        const row = computePrSheetRow({
            newSalary: 50000,
            paidDays: 30,
            workingDays: 30,
            medicalCoverage: 3159,
            lifeInsurance: 150,
        }, POLICY);
        expect(row.medicalCoverage).toBe(3159);
        const withoutMed = computePrSheetRow({
            newSalary: 50000,
            paidDays: 30,
            workingDays: 30,
            lifeInsurance: 150,
        }, POLICY);
        expect(row.totalPayrollCost).toBe(withoutMed.totalPayrollCost);
    });

    test('bonus_accrual_months 0 disables bonus (does not fall through to 12)', () => {
        const row = computePrSheetRow({
            newSalary: 48000,
            paidDays: 30,
            workingDays: 30,
            lifeInsurance: 150,
        }, { ...POLICY, bonus_accrual_months: 0 });
        expect(row.bonusAccrual).toBe(0);
        expect(row.lifeInsurance).toBe(150);
    });

    test('engine WHT matches taxEngine with OPD/expense exclusions', () => {
        const row = computePrSheetRow({
            newSalary: 100000,
            paidDays: 30,
            workingDays: 30,
            opd: 2000,
            expense: 3000,
        }, POLICY);
        expect(row.wht).toBe(calculateMonthlyIncomeTax(row.gross, 2000, 3000));
    });

    test('bonus disbursed in July when contract bonus_disbursement_month = 7', () => {
        const bonus = computeBonusDisbursement({
            salary: 48000,
            doj: '2020-01-01',
            month: 7,
            year: 2026,
            bonusMonths: 1,
            bonusMinMonths: 0,
            disbursementMonth: 7,
        });
        expect(bonus).toBe(48000);

        const juneBonus = computeBonusDisbursement({
            salary: 48000,
            doj: '2020-01-01',
            month: 6,
            year: 2026,
            bonusMonths: 1,
            bonusMinMonths: 0,
            disbursementMonth: 7,
        });
        expect(juneBonus).toBe(0);
    });

    test('bonus pro-rata for mid-year joiner when bonus_min_months = 0', () => {
        const bonus = computeBonusDisbursement({
            salary: 48000,
            doj: '2026-04-01',
            month: 7,
            year: 2026,
            bonusMonths: 1,
            bonusMinMonths: 0,
            disbursementMonth: 7,
        });
        // Apr–Jul cycle end (Jul 28 anchor) ≈ 3 months served → 48000 * 3/12
        expect(bonus).toBe(12000);
    });

    test('bonus disbursement increases net pay but not TPC double-count', () => {
        const base = computePrSheetRow({
            newSalary: 48000,
            paidDays: 30,
            workingDays: 30,
            lifeInsurance: 150,
            contractBonusMonths: 1,
            bonusDisbursement: 0,
        }, POLICY);
        const withBonus = computePrSheetRow({
            newSalary: 48000,
            paidDays: 30,
            workingDays: 30,
            lifeInsurance: 150,
            contractBonusMonths: 1,
            bonusDisbursement: 48000,
        }, POLICY);
        expect(withBonus.bonusDisbursed).toBe(48000);
        expect(withBonus.gross).toBe(base.gross + 48000);
        expect(withBonus.netPay).toBeGreaterThan(base.netPay);
        expect(withBonus.totalPayrollCost).toBe(base.totalPayrollCost);
    });
});

describe('Payroll status cycle', () => {
    test('statuses include invoiced between locked and paid', () => {
        expect(PAYROLL_RUN_STATUSES).toEqual(['draft', 'proposed', 'locked', 'invoiced', 'paid', 'revised']);
    });

    test('allowed transitions', () => {
        expect(canTransitionStatus('draft', 'proposed')).toBe(true);
        expect(canTransitionStatus('proposed', 'locked')).toBe(true);
        expect(canTransitionStatus('locked', 'paid')).toBe(true);
        expect(canTransitionStatus('invoiced', 'paid')).toBe(true);
        expect(canTransitionStatus('paid', 'revised')).toBe(true);
        expect(canTransitionStatus('revised', 'proposed')).toBe(true);
        expect(canTransitionStatus('draft', 'paid')).toBe(false);
        expect(canTransitionStatus('locked', 'draft')).toBe(false);
    });
});

describe('Payment status security (MD mandate §5)', () => {
    test('only MD (shezad) or Finance Manager (asif.awan) may manually set Paid', () => {
        expect(canManuallySetPaymentStatus('shezad.mumtaz@asil.com.pk')).toBe(true);
        expect(canManuallySetPaymentStatus('asif.awan@asil.com.pk')).toBe(true);
        expect(canManuallySetPaymentStatus('huzaifa.rafaqat@asil.com.pk')).toBe(false);
        expect(canManuallySetPaymentStatus('laiba.mughal@asil.com.pk')).toBe(false);
    });

    test('EOD notify list matches MD roster', () => {
        expect(PAYMENT_STATUS_NOTIFY_EMAILS).toEqual([
            'asif.awan@asil.com.pk',
            'shezad.mumtaz@asil.com.pk',
            'huzaifa.rafaqat@asil.com.pk',
            'laiba.mughal@asil.com.pk',
        ]);
    });
});
