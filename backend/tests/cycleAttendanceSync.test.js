'use strict';

const { describe, test, expect } = (() => {
    try {
        const jestExpect = global.expect;
        if (typeof jestExpect === 'function' && typeof global.describe === 'function') {
            return { describe: global.describe, test: global.test, expect: jestExpect };
        }
    } catch (_) { /* node:test fallback below */ }
    const nodeTest = require('node:test');
    const assert = require('node:assert/strict');
    const expect = (actual) => ({
        toBe: (expected) => assert.equal(actual, expected),
        toEqual: (expected) => assert.deepEqual(actual, expected),
        toBeNull: () => assert.equal(actual, null),
        toContain: (expected) => assert.ok(String(actual).includes(expected)),
    });
    return { describe: nodeTest.describe, test: nodeTest.it, expect };
})();

const {
    findServiceOrderForEmployee,
    rowsFromLockedPaidDays,
    syncSoDeductionsFromCycleRows,
    syncSoDeductionsFromLockedSheet,
} = require('../src/modules/serviceOrders/cycleAttendanceSync');
const { submitImport, resolveAttendanceDays, collapseRowsByEmployee } = require('../src/modules/records/machineFile');

function mockFn(impl) {
    const fn = async (...args) => {
        fn.mock.calls.push(args);
        return impl(...args);
    };
    fn.mock = { calls: [] };
    return fn;
}

describe('findServiceOrderForEmployee', () => {
    const orders = [
        { id: 'SO-PSO-CHAKPIRANA', site_code: 'CHAKPIRANA', name: 'Chakpirana Depot', lines: [] },
        { id: 'SO-PSO-TARUJABBA', site_code: 'TARUJABBA', name: 'Tarujabba Depot', lines: [] },
    ];

    test('matches exact site code', () => {
        expect(findServiceOrderForEmployee(orders, { site: 'CHAKPIRANA' }).id).toBe('SO-PSO-CHAKPIRANA');
    });

    test('matches site code inside location', () => {
        expect(findServiceOrderForEmployee(orders, { site: '', location: 'Tarujabba Depot' }).id)
            .toBe('SO-PSO-TARUJABBA');
    });

    test('single-site contract always maps', () => {
        expect(findServiceOrderForEmployee([orders[0]], { site: 'UNKNOWN' }).id).toBe('SO-PSO-CHAKPIRANA');
    });

    test('does not dump a multi-site miss onto the first SO', () => {
        expect(findServiceOrderForEmployee(orders, { site: 'SIHALA', location: 'Sihala' })).toBeNull();
    });
});

describe('syncSoDeductionsFromCycleRows', () => {
    const line = {
        id: 44,
        name: 'Manpower',
        rate: 120000,
        is_manpower_dependent: true,
        roles: [{ designation: 'Gardener', count: 1 }],
    };

    function mockPool({ orders, employees }) {
        const calls = [];
        const pool = {
            query: mockFn(async (sql, params) => {
                const q = String(sql).replace(/\s+/g, ' ');
                calls.push({ q, params });
                if (q.includes('FROM service_orders so')) {
                    return { rows: orders };
                }
                if (q.includes('FROM employees')) {
                    return { rows: employees };
                }
                if (q.includes('DELETE FROM so_deductions')) {
                    return { rowCount: 1 };
                }
                if (q.includes('INSERT INTO so_deductions')) {
                    return { rowCount: params.filter((_, i) => i % 8 === 0).length };
                }
                return { rows: [] };
            }),
        };
        return { pool, calls };
    }

    test('writes attendance_ledger shortage for a matching FV employee', async () => {
        const { pool, calls } = mockPool({
            orders: [{
                id: 'SO-PSO-CHAKPIRANA',
                site_code: 'CHAKPIRANA',
                name: 'Chakpirana Depot',
                lines: [line],
            }],
            employees: [{
                id: 'ASIL-1',
                designation: 'Gardener',
                site: 'CHAKPIRANA',
                location: 'Chakpirana Depot',
            }],
        });

        const summary = await syncSoDeductionsFromCycleRows(pool, {
            contractId: 'CTR-PSO-NORTH-ZONE',
            month: 9,
            year: 2026,
            actor: 'test@asil.com.pk',
            rows: [{ employeeId: 'ASIL-1', absentDays: 3 }],
        });

        expect(summary.deductions).toBe(1);
        expect(summary.errors).toEqual([]);
        const insert = calls.find((c) => c.q.includes('INSERT INTO so_deductions'));
        expect(insert.params).toEqual([
            'SO-PSO-CHAKPIRANA', 44, 9, 2026, 'ASIL-1', 3, 12000, 'test@asil.com.pk',
        ]);
        expect(calls.some((c) => c.q.includes('DELETE FROM so_deductions'))).toBe(true);
    });

    test('leaver before the month is not written as a named shortage', async () => {
        const { pool, calls } = mockPool({
            orders: [{
                id: 'SO-PSO-MORGAH',
                site_code: 'MORGAH',
                name: 'Morgah Installation',
                lines: [line],
            }],
            employees: [{
                id: 'ASIL/PSO-202/25',
                designation: 'FM Supervisor',
                site: 'MORGAH',
                last_working_day: '2026-07-31',
                active: 'No',
            }],
        });
        const summary = await syncSoDeductionsFromCycleRows(pool, {
            contractId: 'CTR-PSO-NORTH-ZONE',
            month: 8,
            year: 2026,
            rows: [{ employeeId: 'ASIL/PSO-202/25', absentDays: 30 }],
        });
        expect(summary.deductions).toBe(0);
        expect(summary.skipped.some((s) => s.reason === 'not_in_period')).toBe(true);
        expect(calls.some((c) => c.q.includes('INSERT INTO so_deductions'))).toBe(false);
    });

    test('zero absent clears prior shortage and inserts nothing', async () => {
        const { pool, calls } = mockPool({
            orders: [{
                id: 'SO-PSO-CHAKPIRANA',
                site_code: 'CHAKPIRANA',
                lines: [line],
            }],
            employees: [{ id: 'ASIL-1', designation: 'Gardener', site: 'CHAKPIRANA' }],
        });
        const summary = await syncSoDeductionsFromCycleRows(pool, {
            contractId: 'CTR-PSO-NORTH-ZONE',
            month: 9,
            year: 2026,
            rows: [{ employeeId: 'ASIL-1', absentDays: 0 }],
        });
        expect(summary.deductions).toBe(0);
        expect(calls.some((c) => c.q.includes('DELETE FROM so_deductions'))).toBe(true);
        expect(calls.some((c) => c.q.includes('INSERT INTO so_deductions'))).toBe(false);
    });

    test('locked Sheet paid_days of 28 becomes 2 absent days on the 30-day SO month', () => {
        const byContract = rowsFromLockedPaidDays([
            { employee_id: 'ASIL-1', contract_id: 'CTR-PSO-NORTH-ZONE', paid_days: 28 },
            { employee_id: 'ASIL-2', contract_id: 'CTR-PSO-NORTH-ZONE', paid_days: 30 },
            { employee_id: 'ASIL-3', contract_id: 'CTR-WAFI', paid_days: 31 },
        ]);
        expect(byContract.get('CTR-PSO-NORTH-ZONE')).toEqual([
            { employeeId: 'ASIL-1', presentDays: 28, absentDays: 2 },
            { employeeId: 'ASIL-2', presentDays: 30, absentDays: 0 },
        ]);
        expect(byContract.get('CTR-WAFI')).toEqual([
            { employeeId: 'ASIL-3', presentDays: 31, absentDays: 0 },
        ]);
    });

    test('sync from locked Sheet writes the paid_days shortage, not the file number', async () => {
        const { pool, calls } = mockPool({
            orders: [{
                id: 'SO-PSO-CHAKPIRANA',
                site_code: 'CHAKPIRANA',
                lines: [line],
            }],
            employees: [{ id: 'ASIL-1', designation: 'Gardener', site: 'CHAKPIRANA' }],
        });
        const origQuery = pool.query;
        pool.query = async (sql, params) => {
            const q = String(sql).replace(/\s+/g, ' ');
            if (q.includes('FROM payroll_transactions pt')) {
                return {
                    rows: [{
                        employee_id: 'ASIL-1',
                        paid_days: 27,
                        contract_id: 'CTR-PSO-NORTH-ZONE',
                    }],
                };
            }
            return origQuery(sql, params);
        };

        const summary = await syncSoDeductionsFromLockedSheet(pool, {
            year: 2026,
            month: 8,
            employeeIds: ['ASIL-1'],
            actor: 'payroll@asil.com.pk',
        });
        expect(summary.deductions).toBe(1);
        const insert = calls.find((c) => c.q.includes('INSERT INTO so_deductions'));
        expect(insert.params[4]).toBe('ASIL-1');
        expect(insert.params[5]).toBe(3);
    });

    test('cost-plus contract without service orders is a no-op', async () => {
        const { pool } = mockPool({ orders: [], employees: [] });
        const summary = await syncSoDeductionsFromCycleRows(pool, {
            contractId: 'CTR-WAFI',
            month: 9,
            year: 2026,
            rows: [{ employeeId: 'ASIL-1', absentDays: 2 }],
        });
        expect(summary.skipped).toEqual([{ reason: 'no_service_orders' }]);
        expect(summary.deductions).toBe(0);
    });
});

describe('collapseRowsByEmployee', () => {
    test('last row for a duplicate employee wins', () => {
        const rows = collapseRowsByEmployee([
            { employee_id: 'ASIL-1', absent_days: 2 },
            { employee_id: 'ASIL-1', absent_days: 5 },
            { employee_id: 'ASIL-2', absent_days: 1 },
        ], 'absent_only');
        expect(rows).toEqual([
            {
                employeeId: 'ASIL-1',
                presentDays: 25,
                absentDays: 5,
                ot2Hours: undefined,
                ot3Hours: undefined,
            },
            {
                employeeId: 'ASIL-2',
                presentDays: 29,
                absentDays: 1,
                ot2Hours: undefined,
                ot3Hours: undefined,
            },
        ]);
    });
});

describe('submitImport writes absent_days then SO shortages', () => {
    test('persists derived absent and returns so_sync', async () => {
        const days = resolveAttendanceDays({ present_days: 27 }, 'days');
        expect(days).toEqual({ present: 27, absent: 3 });

        const importRow = {
            id: 9,
            contract_id: 'CTR-PSO-NORTH-ZONE',
            period_month: 9,
            period_year: 2026,
            input_mode: 'days',
            status: 'draft',
        };
        const fileRow = {
            employee_id: 'ASIL-1',
            matched: true,
            present_days: 27,
            absent_days: null,
            ot2_hours: 0,
            ot3_hours: 0,
        };
        const so = {
            id: 'SO-PSO-CHAKPIRANA',
            site_code: 'CHAKPIRANA',
            lines: [{
                id: 44,
                rate: 120000,
                is_manpower_dependent: true,
                roles: [{ designation: 'Gardener', count: 1 }],
            }],
        };

        const clientQuery = mockFn(async (sql, params) => {
            const q = String(sql).replace(/\s+/g, ' ');
            if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rows: [] };
            if (q.includes('INSERT INTO monthly_attendance_overrides')) {
                expect(params[3]).toBe(27);
                expect(params[4]).toBe(3);
                expect(q).toContain('absent_days');
                return { rows: [] };
            }
            if (q.includes('FROM service_orders so')) return { rows: [so] };
            if (q.includes('FROM employees')) {
                return { rows: [{ id: 'ASIL-1', designation: 'Gardener', site: 'CHAKPIRANA' }] };
            }
            if (q.includes('DELETE FROM so_deductions') || q.includes('INSERT INTO so_deductions')) {
                return { rows: [] };
            }
            if (q.includes('DELETE FROM cycle_file_imports')) return { rows: [] };
            if (q.includes('UPDATE cycle_file_imports')) return { rows: [] };
            if (q.includes('INSERT INTO payroll_transactions')) {
                expect(params[1]).toBe(9);
                expect(params[2]).toBe(2026);
                expect(params[0]).toEqual(['ASIL-1']);
                expect(params[4]).toEqual([27]);
                return { rowCount: 1, rows: [] };
            }
            return { rows: [] };
        });
        const poolQuery = mockFn(async (sql) => {
            const q = String(sql);
            if (q.includes('FROM cycle_file_imports')) return { rows: [importRow] };
            if (q.includes('FROM cycle_file_rows')) return { rows: [fileRow] };
            return { rows: [] };
        });
        const pool = {
            query: poolQuery,
            connect: async () => ({
                query: clientQuery,
                release: () => {},
            }),
        };

        const result = await submitImport(pool, 9, 'ops@asil.com.pk');
        expect(result.so_sync.deductions).toBe(1);
        expect(result.sheet_write.wrote).toBe(1);
        expect(clientQuery.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
        expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM cycle_file_imports'))).toBe(true);
        expect(result.import.status).toBe('draft'); // getImport reuses the same draft fixture
    });

    test('replaces a previous submitted file for the same month', async () => {
        const importRow = {
            id: 10,
            contract_id: 'CTR-PSO-NORTH-ZONE',
            period_month: 9,
            period_year: 2026,
            input_mode: 'absent_only',
            status: 'draft',
        };
        const deletes = [];
        const clientQuery = mockFn(async (sql, params) => {
            const q = String(sql).replace(/\s+/g, ' ');
            if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rows: [] };
            if (q.includes('INSERT INTO monthly_attendance_overrides')) return { rows: [] };
            if (q.includes('FROM service_orders so')) {
                return {
                    rows: [{
                        id: 'SO-PSO-CHAKPIRANA',
                        site_code: 'CHAKPIRANA',
                        lines: [{
                            id: 44,
                            rate: 120000,
                            is_manpower_dependent: true,
                            roles: [{ designation: 'Gardener', count: 1 }],
                        }],
                    }],
                };
            }
            if (q.includes('FROM employees')) {
                return { rows: [{ id: 'ASIL-1', designation: 'Gardener', site: 'CHAKPIRANA' }] };
            }
            if (q.includes('DELETE FROM so_deductions') || q.includes('INSERT INTO so_deductions')) {
                return { rows: [] };
            }
            if (q.includes('DELETE FROM cycle_file_imports')) {
                deletes.push(params);
                return { rowCount: 1 };
            }
            if (q.includes('UPDATE cycle_file_imports')) return { rows: [] };
            return { rows: [] };
        });
        const pool = {
            query: mockFn(async (sql) => {
                const q = String(sql);
                if (q.includes('FROM cycle_file_imports')) return { rows: [importRow] };
                if (q.includes('FROM cycle_file_rows')) {
                    return { rows: [{ employee_id: 'ASIL-1', matched: true, absent_days: 4 }] };
                }
                return { rows: [] };
            }),
            connect: async () => ({ query: clientQuery, release: () => {} }),
        };

        await submitImport(pool, 10, 'ops@asil.com.pk');
        expect(deletes[0]).toEqual(['CTR-PSO-NORTH-ZONE', 9, 2026, 10]);
        expect(clientQuery.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
    });
});
