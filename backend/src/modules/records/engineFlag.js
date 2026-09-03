'use strict';

const { getPolicy } = require('../constraints/service');
const { inferCommercialType } = require('./rulebook');

/** Explicit `runs` wins. Fixed Value / Conservancy also compute via World B (no sheet path). */
function effectivePayrollEngine(policy, contractId) {
    const stored = String(policy?.payroll_engine || 'legacy').trim().toLowerCase();
    if (stored === 'runs') return 'runs';
    if (inferCommercialType(policy, { id: contractId }) === 'fixed_value') return 'runs';
    return 'legacy';
}

async function getPayrollEngine(pool, contractId) {
    if (!contractId) return 'legacy';
    const policy = await getPolicy(pool, contractId);
    return effectivePayrollEngine(policy, contractId);
}

async function enginesForEmployees(pool, employeeIds) {
    if (!employeeIds?.length) return [];
    try {
        const { rows } = await pool.query(
            `SELECT e.id AS employee_id, e.contract_id, e.name,
                    COALESCE(cp.payroll_engine, 'legacy') AS payroll_engine
             FROM employees e
             LEFT JOIN LATERAL (
                SELECT payroll_engine FROM contract_policies
                WHERE contract_id = e.contract_id
                ORDER BY effective_from DESC, id DESC
                LIMIT 1
             ) cp ON TRUE
             WHERE e.id = ANY($1::text[])`,
            [employeeIds]
        );
        return rows;
    } catch {
        return [];
    }
}

function engineConflictError(code, message, employees) {
    const err = new Error(message);
    err.status = 409;
    err.code = code;
    err.details = { employees: (employees || []).slice(0, 50) };
    return err;
}

async function assertSheetWritable(pool, employeeIds) {
    const rows = await enginesForEmployees(pool, employeeIds);
    const blocked = rows.filter((r) => String(r.payroll_engine).toLowerCase() === 'runs');
    if (blocked.length) {
        throw engineConflictError(
            'CONTRACT_ON_RUNS_ENGINE',
            'These employees are on the runs engine. Use Payroll Sheet as view-only for that contract.',
            blocked
        );
    }
}

async function assertRunAllowed(pool, contractId) {
    const policy = await getPolicy(pool, contractId);
    if (!policy) {
        const err = new Error('No contract policy configured');
        err.status = 409;
        err.code = 'POLICY_MISSING';
        throw err;
    }
    if (effectivePayrollEngine(policy, contractId) !== 'runs') {
        const err = new Error('This contract is on the legacy sheet engine. Do not compute a parallel run.');
        err.status = 409;
        err.code = 'CONTRACT_ON_LEGACY_ENGINE';
        throw err;
    }
}

async function sheetEngineMap(pool, contractIds) {
    const map = {};
    for (const id of contractIds || []) {
        map[id] = await getPayrollEngine(pool, id);
    }
    return map;
}

module.exports = {
    getPayrollEngine,
    effectivePayrollEngine,
    enginesForEmployees,
    assertSheetWritable,
    assertRunAllowed,
    sheetEngineMap,
};
