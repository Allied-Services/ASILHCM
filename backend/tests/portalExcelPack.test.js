'use strict';

const XLSX = require('xlsx');
const {
    buildPersonalizedClaimsWorkbook,
    parseMasterClaimsWorkbook,
} = require('../src/modules/claims/portalExcel');

describe('pack-aware claims workbook', () => {
    const people = [{ id: 'ASIL-1', name: 'Ali', dept: 'Ops', location: 'Karachi' }];

    test('machine-file pack includes Attendance and omits unused sheets', () => {
        const buf = buildPersonalizedClaimsWorkbook(people, {
            enabledTypes: ['ATTENDANCE', 'OT'],
            claimMonth: 8,
            claimYear: 2026,
        });
        const wb = XLSX.read(buf, { type: 'buffer' });
        expect(wb.SheetNames).toContain('Attendance');
        expect(wb.SheetNames).toContain('Overtime');
        expect(wb.SheetNames).not.toContain('Expense Claims');
        expect(wb.SheetNames).not.toContain('Medical & IPD Claims');
    });

    test('parser does not treat Attendance as Overtime', () => {
        const buf = buildPersonalizedClaimsWorkbook(people, {
            enabledTypes: ['ATTENDANCE'],
            claimMonth: 8,
            claimYear: 2026,
        });
        const parsed = parseMasterClaimsWorkbook(buf, {
            allowedEmployeeIds: ['ASIL-1'],
            enabledTypes: ['ATTENDANCE'],
        });
        expect(parsed.itemsByEmployee.size).toBe(0);
        expect(parsed.errors).toEqual([]);
    });
});
