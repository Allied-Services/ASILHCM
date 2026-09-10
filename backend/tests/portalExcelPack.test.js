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

    test('parser keeps one of duplicate expense rows for the same employee/date/amount', () => {
        const wb = XLSX.utils.book_new();
        const rows = [
            ['Date', 'ASIL Employee Code', 'Employee Name', 'Total Expense Amount (PKR)', 'Description of Expense'],
            ['20-08-2026', 'ASIL-1', 'Ali', 1000, 'Fuel'],
            ['28-08-2026', 'ASIL-1', 'Ali', 2600, 'Mobile Recharge'],
            ['28-08-2026', 'ASIL-1', 'Ali', 2600, 'Mobile Recharge'],
            ['28-08-2026', 'ASIL-1', 'Ali', 2600, 'Mobile Recharge'],
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Expense Claims');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const parsed = parseMasterClaimsWorkbook(buf, {
            allowedEmployeeIds: ['ASIL-1'],
            enabledTypes: ['EXPENSE'],
        });
        const items = parsed.itemsByEmployee.get('ASIL-1') || [];
        expect(items.filter((i) => i.claim_type === 'EXPENSE')).toHaveLength(2);
        expect(parsed.warnings.some((w) => /duplicate row/i.test(w))).toBe(true);
    });
});
