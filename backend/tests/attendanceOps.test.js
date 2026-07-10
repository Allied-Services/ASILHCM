'use strict';

/**
 * Operational Core Alignment — attendance parser, monthly hub, focals.
 * Test-first for Format A / Format B CSV intake and 15-column monthly schema.
 */
const {
    detectAttendanceFormat,
    normalizeStatus,
    parseFormatARow,
    parseFormatBRow,
    computeHoursWorked,
    mapOtHoursFromExcess,
    MONTHLY_HUB_COLUMNS,
    mergeMonthlyImportRow,
    buildMonthlyExportRow,
} = require('../src/modules/attendance/parser');

describe('Attendance Format A — Explicit Codes', () => {
    test('detects Format A from EmployeeID,Date,Status headers', () => {
        expect(detectAttendanceFormat(['EmployeeID', 'Date', 'Status'])).toBe('format_a');
        expect(detectAttendanceFormat(['ASIL Employee Code', 'Date', 'Status (P/A/SUN/HOL)'])).toBe('format_a');
    });

    test('normalizes P/A/SUN/HOL status codes', () => {
        expect(normalizeStatus('P')).toBe('present');
        expect(normalizeStatus('A')).toBe('absent');
        expect(normalizeStatus('SUN')).toBe('sunday');
        expect(normalizeStatus('HOL')).toBe('holiday');
        expect(normalizeStatus('present')).toBe('present');
    });

    test('parseFormatARow maps employee/date/status', () => {
        const row = parseFormatARow({
            EmployeeID: 'ASIL/SPL-205/21',
            Date: '2026-06-02',
            Status: 'P',
        });
        expect(row).toEqual({
            employeeId: 'ASIL/SPL-205/21',
            date: '2026-06-02',
            status: 'present',
            hours: null,
            otHours: 0,
            format: 'format_a',
        });
    });

    test('SUN and HOL map to non-working statuses without OT', () => {
        expect(parseFormatARow({ EmployeeID: 'X', Date: '2026-06-07', Status: 'SUN' }).status).toBe('sunday');
        expect(parseFormatARow({ EmployeeID: 'X', Date: '2026-06-05', Status: 'HOL' }).status).toBe('holiday');
    });
});

describe('Attendance Format B — Biometric Timestamps', () => {
    test('detects Format B from TimeIn/TimeOut headers', () => {
        expect(detectAttendanceFormat(['EmployeeID', 'Date', 'TimeIn', 'TimeOut'])).toBe('format_b');
        expect(detectAttendanceFormat(['Emp ID', 'Punch Date', 'Time In', 'Time Out'])).toBe('format_b');
    });

    test('computeHoursWorked from time pair', () => {
        expect(computeHoursWorked('08:00', '17:00')).toBe(9);
        expect(computeHoursWorked('09:00', '17:00')).toBe(8);
        expect(computeHoursWorked('22:00', '06:00')).toBe(8); // overnight
        expect(computeHoursWorked('', '17:00')).toBe(null);
    });

    test('hours > 8 map excess into OT accumulation', () => {
        expect(mapOtHoursFromExcess(10)).toEqual({ status: 'ot', hours: 10, otHours: 2 });
        expect(mapOtHoursFromExcess(8)).toEqual({ status: 'present', hours: 8, otHours: 0 });
        expect(mapOtHoursFromExcess(7.5)).toEqual({ status: 'present', hours: 7.5, otHours: 0 });
    });

    test('parseFormatBRow marks Present and accumulates OT over 8h', () => {
        const row = parseFormatBRow({
            EmployeeID: 'ASIL/SPL-213/21',
            Date: '2026-06-03',
            TimeIn: '08:00',
            TimeOut: '18:30',
        });
        expect(row.employeeId).toBe('ASIL/SPL-213/21');
        expect(row.date).toBe('2026-06-03');
        expect(row.status).toBe('ot');
        expect(row.hours).toBe(10.5);
        expect(row.otHours).toBe(2.5);
        expect(row.format).toBe('format_b');
    });

    test('invalid punch pair (missing TimeOut) yields absent', () => {
        const row = parseFormatBRow({
            EmployeeID: 'ASIL/X',
            Date: '2026-06-03',
            TimeIn: '08:00',
            TimeOut: '',
        });
        expect(row.status).toBe('absent');
        expect(row.hours).toBe(null);
        expect(row.otHours).toBe(0);
    });
});

describe('Monthly Report Hub — 15 master columns', () => {
    test('MONTHLY_HUB_COLUMNS has exactly 15 columns in order', () => {
        expect(MONTHLY_HUB_COLUMNS).toEqual([
            'CNIC',
            'Staff Code',
            'Month',
            'Year',
            'ASIL Employee Code',
            'Contract Name',
            'Present Days',
            'OT Hrs @ 2X',
            'OT Hrs @ 3X',
            'OPD',
            'Expense Reimbursement',
            'Arrears',
            'Special Allowance',
            'Other Allowance Fuel | Mobile',
            'Other Deduction',
        ]);
        expect(MONTHLY_HUB_COLUMNS).toHaveLength(15);
    });

    test('buildMonthlyExportRow fills all 15 keys', () => {
        const row = buildMonthlyExportRow({
            cnic: '35202-1234567-1',
            staffCode: 'SC-1',
            month: 6,
            year: 2026,
            employeeId: 'ASIL/SPL-205/21',
            contractName: 'Wafi',
            presentDays: 26,
            ot2: 4,
            ot3: 0,
            opd: 1000,
            expense: 0,
            arrears: 0,
            specialAllowance: 0,
            fuelMobile: 500,
            otherDeduction: 0,
        });
        expect(Object.keys(row)).toEqual(MONTHLY_HUB_COLUMNS);
        expect(row['ASIL Employee Code']).toBe('ASIL/SPL-205/21');
        expect(row['Present Days']).toBe(26);
        expect(row['OT Hrs @ 2X']).toBe(4);
    });

    test('mergeMonthlyImportRow blocks blank cells from wiping existing data', () => {
        const existing = {
            presentDays: 26,
            ot2: 5,
            ot3: 2,
            opd: 1500,
            expense: 200,
            arrears: 100,
            specialAllowance: 50,
            fuelMobile: 300,
            otherDeduction: 10,
        };
        const incoming = {
            'ASIL Employee Code': 'ASIL/SPL-205/21',
            'Present Days': '28',
            'OT Hrs @ 2X': '',
            'OT Hrs @ 3X': null,
            OPD: '  ',
            'Expense Reimbursement': '250',
            Arrears: undefined,
            'Special Allowance': '',
            'Other Allowance Fuel | Mobile': '400',
            'Other Deduction': '',
        };
        const merged = mergeMonthlyImportRow(existing, incoming);
        expect(merged.presentDays).toBe(28);
        expect(merged.ot2).toBe(5); // blank blocked
        expect(merged.ot3).toBe(2); // null blocked
        expect(merged.opd).toBe(1500); // whitespace blocked
        expect(merged.expense).toBe(250);
        expect(merged.arrears).toBe(100);
        expect(merged.specialAllowance).toBe(50);
        expect(merged.fuelMobile).toBe(400);
        expect(merged.otherDeduction).toBe(10);
    });
});
