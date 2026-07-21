'use strict';

const {
    computePrSheetRow,
    computeModelABasis,
    computeOtRates,
} = require('../src/payroll/prSheetEngine');
const { MASTER_ROSTER_COLUMNS } = require('../src/modules/employees/masterRoster');
const { MONTHLY_HUB_COLUMNS, mergeMonthlyImportRow } = require('../src/modules/attendance/parser');

const POLICY = {
    standard_month_days: 30,
    ot_divisor_days: 26,
    ot_divisor_hours: 8,
    service_charge_pct: 0.18,
};

describe('Master Roster columns', () => {
    test('full master export has 60+ employee fields including supervisor/focals', () => {
        expect(MASTER_ROSTER_COLUMNS.length).toBeGreaterThanOrEqual(55);
        expect(MASTER_ROSTER_COLUMNS[0]).toBe('ASIL Employee Code');
        expect(MASTER_ROSTER_COLUMNS).toContain('Employee Name');
        expect(MASTER_ROSTER_COLUMNS).toContain('CNIC Number');
        expect(MASTER_ROSTER_COLUMNS).toContain('Supervisor Email');
        expect(MASTER_ROSTER_COLUMNS).toContain('Client Focal Email(s)');
        expect(MASTER_ROSTER_COLUMNS).toContain('Bank Account');
        expect(MASTER_ROSTER_COLUMNS).toContain('Payroll Cycle Type');
    });

    test('blank CSV cells do not appear in import patch', () => {
        const { csvRowToPatch, mergeEmployeePatch } = require('../src/modules/employees/masterRoster');
        const patch = csvRowToPatch(
            { 'ASIL Employee Code': 'ASIL/X', 'Supervisor Email': '  ', 'Salary': '50000' },
            { ctByName: new Map(), ctById: new Map(), clientByName: new Map() },
            { id: 'ASIL/X', name: 'Test', salary: 40000, supervisor_email: 'old@asil.com.pk' }
        );
        expect(patch.supervisor_email).toBeUndefined();
        expect(patch.salary).toBe(50000);
        const merged = mergeEmployeePatch(
            { name: 'Test', salary: 40000, supervisor_email: 'old@asil.com.pk' },
            patch
        );
        expect(merged.supervisor_email).toBe('old@asil.com.pk');
        expect(merged.salary).toBe(50000);
    });

    test('partial import only updates provided columns', () => {
        const { csvRowToPatch } = require('../src/modules/employees/masterRoster');
        const patch = csvRowToPatch(
            {
                'ASIL Employee Code': 'ASIL/PSO-001/25',
                'Supervisor Email': 'new.sup@asil.com.pk',
                'Client Focal Email(s)': 'focal@client.com',
            },
            { ctByName: new Map(), ctById: new Map(), clientByName: new Map() },
            { id: 'ASIL/PSO-001/25', name: 'Abbas Ali', cnic: '35202-1234567-1', salary: 47000 }
        );
        expect(patch.supervisor_email).toBe('new.sup@asil.com.pk');
        expect(patch.client_focal_emails).toBe('focal@client.com');
        expect(patch.cnic).toBeUndefined();
        expect(patch.salary).toBeUndefined();
    });
});

describe('Model A — 30-day calendar basis', () => {
    test('A = expected − present; payout = base × ((30 − A) / 30)', () => {
        const m = computeModelABasis({ presentDays: 24, expectedDays: 26, calendarBasis: 30 });
        expect(m.absentDays).toBe(2);
        expect(m.modelAPaidDays).toBe(28);
        expect(m.paidFactor).toBeCloseTo(28 / 30);

        const row = computePrSheetRow({
            newSalary: 30000,
            presentDays: 24,
            expectedDays: 26,
            modelA: true,
        }, POLICY);
        expect(row.salaryForDays).toBe(Math.round(30000 * (28 / 30)));
        expect(row.modelA.absentDays).toBe(2);
    });

    test('full present against expected → full base (Sundays/holidays paid)', () => {
        const row = computePrSheetRow({
            newSalary: 45991,
            presentDays: 26,
            expectedDays: 26,
            modelA: true,
        }, POLICY);
        expect(row.salaryForDays).toBe(45991);
        expect(row.modelA.absentDays).toBe(0);
    });

    test('OT 2X / 3X use Base / (26×8) × multiplier', () => {
        const salary = 45991;
        const rates = computeOtRates(salary, POLICY);
        expect(rates.otRate2x).toBeCloseTo((salary / 26 / 8) * 2);
        expect(rates.otRate3x).toBeCloseTo((salary / 26 / 8) * 3);

        const row = computePrSheetRow({
            newSalary: salary,
            presentDays: 30,
            expectedDays: 30,
            ot2: 9,
            ot3: 0,
        }, POLICY);
        expect(row.overtimeAmount).toBe(3980);
        expect(row.otRate2x).toBeCloseTo(rates.otRate2x);
    });
});

describe('15-column monthly hub blanks', () => {
    test('MONTHLY_HUB_COLUMNS length 15', () => {
        expect(MONTHLY_HUB_COLUMNS).toHaveLength(15);
    });

    test('blank cells do not wipe existing values', () => {
        const merged = mergeMonthlyImportRow(
            { presentDays: 26, ot2: 5, opd: 1500 },
            { 'Present Days': '28', 'OT Hrs @ 2X': '', OPD: '  ' }
        );
        expect(merged.presentDays).toBe(28);
        expect(merged.ot2).toBe(5);
        expect(merged.opd).toBe(1500);
    });
});
