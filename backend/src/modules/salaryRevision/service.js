'use strict';

function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function periodKey(year, month) {
    return Number(year) * 12 + Number(month);
}

function isPeriodAtOrBefore(year, month, targetYear, targetMonth) {
    return periodKey(year, month) <= periodKey(targetYear, targetMonth);
}

function pickSalaryAsOf(revisions, year, month, fallback) {
    const y = Number(year);
    const m = Number(month);
    let bestOnOrBefore = null;
    let earliestAfter = null;
    for (const r of revisions || []) {
        if (isPeriodAtOrBefore(r.effective_year, r.effective_month, y, m)) {
            if (!bestOnOrBefore
                || periodKey(r.effective_year, r.effective_month) > periodKey(bestOnOrBefore.effective_year, bestOnOrBefore.effective_month)) {
                bestOnOrBefore = r;
            }
        } else if (!earliestAfter
            || periodKey(r.effective_year, r.effective_month) < periodKey(earliestAfter.effective_year, earliestAfter.effective_month)) {
            earliestAfter = r;
        }
    }
    if (bestOnOrBefore) return num(bestOnOrBefore.new_salary, fallback);
    if (earliestAfter) return num(earliestAfter.old_salary, fallback);
    return num(fallback);
}

async function salaryAsOf(pool, employeeId, year, month) {
    const y = Number(year);
    const m = Number(month);
    const { rows: onOrBefore } = await pool.query(
        `SELECT new_salary
         FROM employee_salary_revisions
         WHERE employee_id = $1
           AND (effective_year < $2 OR (effective_year = $2 AND effective_month <= $3))
         ORDER BY effective_year DESC, effective_month DESC
         LIMIT 1`,
        [employeeId, y, m],
    );
    if (onOrBefore.length) return num(onOrBefore[0].new_salary);

    // Master salary is already the latest rate. Months before the first
    // revision must use that revision's old_salary so a Sep raise cannot
    // pretend Jan–Aug were already paid at the new rate.
    const { rows: after } = await pool.query(
        `SELECT old_salary
         FROM employee_salary_revisions
         WHERE employee_id = $1
           AND (effective_year > $2 OR (effective_year = $2 AND effective_month > $3))
         ORDER BY effective_year ASC, effective_month ASC
         LIMIT 1`,
        [employeeId, y, m],
    );
    if (after.length) return num(after[0].old_salary);

    const { rows: empRows } = await pool.query(
        `SELECT salary FROM employees WHERE id = $1`,
        [employeeId],
    );
    return empRows.length ? num(empRows[0].salary) : 0;
}

async function loadRevisionsForEmployees(pool, employeeIds) {
    if (!employeeIds || !employeeIds.length) return [];
    const { rows } = await pool.query(
        `SELECT employee_id, old_salary, new_salary, effective_year, effective_month
         FROM employee_salary_revisions
         WHERE employee_id = ANY($1::text[])
         ORDER BY employee_id, effective_year DESC, effective_month DESC`,
        [employeeIds],
    );
    return rows;
}

function salaryAsOfMap(revisionRows, employees, year, month) {
    const byEmp = new Map();
    for (const r of revisionRows || []) {
        if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, []);
        byEmp.get(r.employee_id).push(r);
    }
    const map = new Map();
    for (const emp of employees || []) {
        map.set(emp.id, pickSalaryAsOf(byEmp.get(emp.id) || [], year, month, emp.salary));
    }
    return map;
}

async function listRevisions(pool, employeeId) {
    const { rows } = await pool.query(
        `SELECT id, employee_id, old_salary, new_salary, effective_year, effective_month,
                changed_by, changed_at, note
         FROM employee_salary_revisions
         WHERE employee_id = $1
         ORDER BY effective_year DESC, effective_month DESC, changed_at DESC`,
        [employeeId],
    );
    return rows;
}

function validateRevisionInput(employeeId, payload) {
    if (!employeeId || !String(employeeId).trim()) {
        const err = new Error('Employee id is required');
        err.status = 400;
        err.code = 'INVALID_EMPLOYEE';
        throw err;
    }
    const newSalary = Number(payload.newSalary);
    const effectiveYear = parseInt(payload.effectiveYear, 10);
    const effectiveMonth = parseInt(payload.effectiveMonth, 10);
    if (!Number.isFinite(newSalary) || newSalary < 0) {
        const err = new Error('newSalary must be a non-negative number');
        err.status = 400;
        err.code = 'INVALID_SALARY';
        throw err;
    }
    if (!effectiveYear || !effectiveMonth || effectiveMonth < 1 || effectiveMonth > 12) {
        const err = new Error('effectiveYear and effectiveMonth (1-12) are required');
        err.status = 400;
        err.code = 'INVALID_PERIOD';
        throw err;
    }
    return {
        newSalary,
        effectiveYear,
        effectiveMonth,
        note: payload.note != null && String(payload.note).trim() ? String(payload.note).trim() : null,
    };
}

async function createRevision(pool, employeeId, payload, actor = {}) {
    const { newSalary, effectiveYear, effectiveMonth, note } = validateRevisionInput(employeeId, payload || {});

    const { rows: empRows } = await pool.query(
        `SELECT salary FROM employees WHERE id = $1`,
        [employeeId],
    );
    if (!empRows.length) {
        const err = new Error('Employee not found');
        err.status = 404;
        err.code = 'EMPLOYEE_NOT_FOUND';
        throw err;
    }
    const oldSalary = num(empRows[0].salary);

    const { rows: lockedRows } = await pool.query(
        `SELECT 1 FROM payroll_transactions
         WHERE employee_id = $1 AND year = $2 AND month = $3 AND locked = TRUE
         LIMIT 1`,
        [employeeId, effectiveYear, effectiveMonth],
    );
    if (lockedRows.length) {
        const err = new Error('Payroll for this employee is locked for that month. Unlock before changing salary.');
        err.status = 409;
        err.code = 'MONTH_LOCKED';
        throw err;
    }

    const { rows: latestRows } = await pool.query(
        `SELECT effective_year, effective_month
         FROM employee_salary_revisions
         WHERE employee_id = $1
         ORDER BY effective_year DESC, effective_month DESC
         LIMIT 1`,
        [employeeId],
    );
    const isLatest = !latestRows.length
        || periodKey(effectiveYear, effectiveMonth) >= periodKey(latestRows[0].effective_year, latestRows[0].effective_month);

    const changedBy = actor.email || actor.id || null;
    let inserted;
    try {
        const { rows } = await pool.query(
            `INSERT INTO employee_salary_revisions
                (employee_id, old_salary, new_salary, effective_year, effective_month, changed_by, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, employee_id, old_salary, new_salary, effective_year, effective_month,
                       changed_by, changed_at, note`,
            [employeeId, oldSalary, newSalary, effectiveYear, effectiveMonth, changedBy, note],
        );
        inserted = rows[0];
    } catch (err) {
        if (err.code === '23505') {
            const conflict = new Error('A salary revision already exists for that employee and month.');
            conflict.status = 409;
            conflict.code = 'REVISION_EXISTS';
            throw conflict;
        }
        throw err;
    }

    let masterUpdated = false;
    if (isLatest) {
        await pool.query(
            `UPDATE employees SET salary = $1 WHERE id = $2`,
            [newSalary, employeeId],
        );
        masterUpdated = true;
    }

    return { revision: inserted, masterUpdated };
}

module.exports = {
    salaryAsOf,
    listRevisions,
    createRevision,
    loadRevisionsForEmployees,
    salaryAsOfMap,
    pickSalaryAsOf,
};
