'use strict';

const {
    salaryAsOf,
    createRevision,
    listRevisions,
} = require('../src/modules/salaryRevision/service');
const { computePrSheetRow } = require('../src/payroll/prSheetEngine');

function makeStore({ salary = 50000, lockedKeys = [], revisions = [] } = {}) {
    const employees = new Map([['E1', { id: 'E1', salary }]]);
    const revisionRows = revisions.map((r, i) => ({
        id: r.id || i + 1,
        employee_id: r.employee_id || 'E1',
        old_salary: r.old_salary,
        new_salary: r.new_salary,
        effective_year: r.effective_year,
        effective_month: r.effective_month,
        changed_by: r.changed_by || null,
        changed_at: r.changed_at || '2026-08-01T00:00:00.000Z',
        note: r.note || null,
    }));
    const locked = new Set(lockedKeys);
    let nextId = revisionRows.length + 1;
    const updates = [];

    const pool = {
        query: jest.fn(async (sql, params = []) => {
            const s = String(sql);
            if (/SELECT salary FROM employees/i.test(s)) {
                const emp = employees.get(params[0]);
                return { rows: emp ? [{ salary: emp.salary }] : [] };
            }
            if (/FROM employee_salary_revisions/i.test(s) && /effective_year < \$2/i.test(s)) {
                const [empId, year, month] = params;
                const match = revisionRows
                    .filter((r) => r.employee_id === empId
                        && (r.effective_year < year || (r.effective_year === year && r.effective_month <= month)))
                    .sort((a, b) => (b.effective_year - a.effective_year) || (b.effective_month - a.effective_month));
                return { rows: match.length ? [{ new_salary: match[0].new_salary }] : [] };
            }
            if (/FROM employee_salary_revisions/i.test(s) && /effective_year > \$2/i.test(s)) {
                const [empId, year, month] = params;
                const match = revisionRows
                    .filter((r) => r.employee_id === empId
                        && (r.effective_year > year || (r.effective_year === year && r.effective_month > month)))
                    .sort((a, b) => (a.effective_year - b.effective_year) || (a.effective_month - b.effective_month));
                return { rows: match.length ? [{ old_salary: match[0].old_salary }] : [] };
            }
            if (/FROM payroll_transactions/i.test(s) && /locked/i.test(s)) {
                const key = `${params[0]}|${params[1]}|${params[2]}`;
                return { rows: locked.has(key) ? [{ '?column?': 1 }] : [] };
            }
            if (/SELECT effective_year,\s*effective_month/i.test(s) && /FROM employee_salary_revisions/i.test(s)) {
                const match = revisionRows
                    .filter((r) => r.employee_id === params[0])
                    .sort((a, b) => (b.effective_year - a.effective_year) || (b.effective_month - a.effective_month));
                return { rows: match.slice(0, 1) };
            }
            if (/INSERT INTO employee_salary_revisions/i.test(s)) {
                const [employee_id, old_salary, new_salary, effective_year, effective_month, changed_by, note] = params;
                if (revisionRows.some((r) => r.employee_id === employee_id
                    && r.effective_year === effective_year
                    && r.effective_month === effective_month)) {
                    const err = new Error('duplicate key value violates unique constraint');
                    err.code = '23505';
                    throw err;
                }
                const row = {
                    id: nextId++,
                    employee_id,
                    old_salary,
                    new_salary,
                    effective_year,
                    effective_month,
                    changed_by,
                    changed_at: '2026-08-28T00:00:00.000Z',
                    note,
                };
                revisionRows.push(row);
                return { rows: [row] };
            }
            if (/UPDATE employees SET salary/i.test(s)) {
                updates.push({ salary: params[0], id: params[1] });
                const emp = employees.get(params[1]);
                if (emp) emp.salary = params[0];
                return { rows: [], rowCount: emp ? 1 : 0 };
            }
            if (/SELECT id, employee_id, old_salary/i.test(s)) {
                return {
                    rows: revisionRows
                        .filter((r) => r.employee_id === params[0])
                        .sort((a, b) => (b.effective_year - a.effective_year) || (b.effective_month - a.effective_month)),
                };
            }
            throw new Error(`Unexpected SQL in test mock: ${s.slice(0, 120)}`);
        }),
    };

    return { pool, employees, revisionRows, locked, updates };
}

describe('salaryAsOf', () => {
    test('before first revision uses employees.salary', async () => {
        const { pool } = makeStore({ salary: 50000 });
        await expect(salaryAsOf(pool, 'E1', 2026, 8)).resolves.toBe(50000);
    });

    test('after a Sep 2026 revision, Aug still sees old salary and Sep sees new', async () => {
        const { pool } = makeStore({
            salary: 60000,
            revisions: [{
                employee_id: 'E1',
                old_salary: 50000,
                new_salary: 60000,
                effective_year: 2026,
                effective_month: 9,
            }],
        });
        await expect(salaryAsOf(pool, 'E1', 2026, 8)).resolves.toBe(50000);
        await expect(salaryAsOf(pool, 'E1', 2026, 9)).resolves.toBe(60000);
        await expect(salaryAsOf(pool, 'E1', 2026, 10)).resolves.toBe(60000);
    });
});

describe('createRevision', () => {
    test('updates employees.salary when the revision is the latest', async () => {
        const { pool, employees, updates } = makeStore({ salary: 50000 });
        const result = await createRevision(pool, 'E1', {
            newSalary: 60000,
            effectiveYear: 2026,
            effectiveMonth: 9,
            note: 'Sep raise',
        }, { email: 'ops@asil.com.pk' });

        expect(result.masterUpdated).toBe(true);
        expect(Number(result.revision.new_salary)).toBe(60000);
        expect(Number(result.revision.old_salary)).toBe(50000);
        expect(updates).toEqual([{ salary: 60000, id: 'E1' }]);
        expect(employees.get('E1').salary).toBe(60000);
    });

    test('does not rewrite master salary for a backdated revision', async () => {
        const { pool, employees, updates } = makeStore({
            salary: 60000,
            revisions: [{
                employee_id: 'E1',
                old_salary: 50000,
                new_salary: 60000,
                effective_year: 2026,
                effective_month: 9,
            }],
        });
        const result = await createRevision(pool, 'E1', {
            newSalary: 52000,
            effectiveYear: 2026,
            effectiveMonth: 3,
            note: 'backdated correction',
        }, { email: 'ops@asil.com.pk' });

        expect(result.masterUpdated).toBe(false);
        expect(updates).toEqual([]);
        expect(employees.get('E1').salary).toBe(60000);
    });

    test('409 MONTH_LOCKED when that employee has a locked payroll row for the effective month', async () => {
        const { pool, updates, revisionRows } = makeStore({
            salary: 50000,
            lockedKeys: ['E1|2026|9'],
        });
        let caught;
        try {
            await createRevision(pool, 'E1', {
                newSalary: 60000,
                effectiveYear: 2026,
                effectiveMonth: 9,
            }, { email: 'ops@asil.com.pk' });
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeTruthy();
        expect(caught.status).toBe(409);
        expect(caught.code).toBe('MONTH_LOCKED');
        expect(updates).toEqual([]);
        expect(revisionRows).toHaveLength(0);
    });
});

describe('listRevisions', () => {
    test('returns dated history newest first', async () => {
        const { pool } = makeStore({
            salary: 60000,
            revisions: [
                { new_salary: 50000, effective_year: 2026, effective_month: 1 },
                { new_salary: 60000, effective_year: 2026, effective_month: 9 },
            ],
        });
        const rows = await listRevisions(pool, 'E1');
        expect(rows).toHaveLength(2);
        expect(rows[0].effective_month).toBe(9);
        expect(rows[1].effective_month).toBe(1);
    });
});

describe('bonus accrual follows salaryAsOf', () => {
    test('Sep raise does not inflate Jan–Aug bonus accrual', async () => {
        const { pool } = makeStore({
            salary: 60000,
            revisions: [{
                employee_id: 'E1',
                old_salary: 50000,
                new_salary: 60000,
                effective_year: 2026,
                effective_month: 9,
            }],
        });
        const augSalary = await salaryAsOf(pool, 'E1', 2026, 8);
        const sepSalary = await salaryAsOf(pool, 'E1', 2026, 9);
        const aug = computePrSheetRow({
            newSalary: augSalary,
            contractBonusMonths: 1,
            paidDays: 30,
            workingDays: 30,
        }, { service_charge_pct: 0.18 });
        const sep = computePrSheetRow({
            newSalary: sepSalary,
            contractBonusMonths: 1,
            paidDays: 30,
            workingDays: 30,
        }, { service_charge_pct: 0.18 });

        expect(augSalary).toBe(50000);
        expect(sepSalary).toBe(60000);
        expect(aug.bonusAccrual).toBe(Math.round(1 * 50000 / 12));
        expect(sep.bonusAccrual).toBe(Math.round(1 * 60000 / 12));
    });
});
