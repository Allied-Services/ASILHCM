'use strict';

const { loadSheetEmployees } = require('../src/modules/payrollSheet/service');

describe('loadSheetEmployees', () => {
    test('includes Inactive leavers whose last working day falls in the sheet month', async () => {
        const calls = [];
        const pool = {
            query: jest.fn(async (sql, params) => {
                calls.push({ sql: String(sql).replace(/\s+/g, ' '), params });
                if (String(sql).includes('FROM payroll_transactions')) {
                    return { rows: [] };
                }
                return { rows: [{ id: 'ASIL/PSO-091/25', name: 'Sadaqat', last_working_day: '2026-08-18' }] };
            }),
        };
        const rows = await loadSheetEmployees(pool, {
            year: 2026,
            month: 8,
            client: 'Pakistan State Oil Company Limited',
        });
        expect(rows).toHaveLength(1);
        const empSql = calls.find((c) => c.sql.includes('FROM employees e'));
        expect(empSql).toBeTruthy();
        expect(empSql.sql).toMatch(/last_working_day IS NOT NULL/);
        expect(empSql.sql).not.toMatch(/COALESCE\(LOWER\(TRIM\(e\.active\)\), 'yes'\) IN \('yes', 'true', '1'\)/);
        expect(empSql.params[0]).toBe(2026);
        expect(empSql.params[1]).toBe(8);
    });
});
