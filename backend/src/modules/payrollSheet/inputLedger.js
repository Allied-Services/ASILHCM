'use strict';

const ITEM_TYPES = [
    'ATTENDANCE', 'OT', 'EXPENSE', 'MEDICAL',
    'DEDUCTION', 'ARREARS', 'SPECIAL_ALLOWANCE',
];

const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'pushed', 'locked'];

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function upsertLines(client, lines, actor) {
    const list = (lines || []).filter((l) => l && l.employeeId && ITEM_TYPES.includes(l.itemType));
    if (!list.length) return Promise.resolve({ wrote: 0 });

    const values = [];
    const params = [];
    list.forEach((l, i) => {
        const o = i * 18;
        values.push(
            `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},` +
            `$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12},$${o + 13},$${o + 14},` +
            `$${o + 15},$${o + 16},$${o + 17},$${o + 18},NOW(),NOW())`
        );
        const status = STATUSES.includes(l.status) ? l.status : 'approved';
        params.push(
            l.employeeId,
            l.contractId || null,
            Number(l.workMonth),
            Number(l.workYear),
            Number(l.payMonth || l.workMonth),
            Number(l.payYear || l.workYear),
            l.itemType,
            num(l.presentDays),
            num(l.absentDays),
            num(l.hours),
            num(l.amount),
            status,
            l.source || 'unknown',
            l.sourceRef || null,
            l.approvedBy || actor || null,
            l.approvedVia || null,
            l.reason || null,
            actor || null
        );
    });

    // 17 placeholders above but I pushed 18 values (including actor as created_by)
    // Fix: created_by is the last before timestamps. Count again.
    return client.query(
        `INSERT INTO payroll_input_ledger
            (employee_id, contract_id, work_month, work_year, pay_month, pay_year,
             item_type, present_days, absent_days, hours, amount, status, source,
             source_ref, approved_by, approved_via, reason, created_by, created_at, updated_at)
         VALUES ${values.join(',')}
         ON CONFLICT (employee_id, work_year, work_month, item_type, source) DO UPDATE SET
            contract_id = COALESCE(EXCLUDED.contract_id, payroll_input_ledger.contract_id),
            pay_month = EXCLUDED.pay_month,
            pay_year = EXCLUDED.pay_year,
            present_days = EXCLUDED.present_days,
            absent_days = EXCLUDED.absent_days,
            hours = EXCLUDED.hours,
            amount = EXCLUDED.amount,
            status = EXCLUDED.status,
            source_ref = COALESCE(EXCLUDED.source_ref, payroll_input_ledger.source_ref),
            approved_by = COALESCE(EXCLUDED.approved_by, payroll_input_ledger.approved_by),
            approved_via = COALESCE(EXCLUDED.approved_via, payroll_input_ledger.approved_via),
            reason = COALESCE(EXCLUDED.reason, payroll_input_ledger.reason),
            updated_at = NOW()`,
        params
    ).then((r) => ({ wrote: r.rowCount || 0 }));
}

function linesFromCycleRows({ rows, contractId, month, year, actor }) {
    const out = [];
    for (const r of rows || []) {
        if (!r.employeeId) continue;
        const base = {
            employeeId: r.employeeId,
            contractId,
            workMonth: month,
            workYear: year,
            payMonth: month,
            payYear: year,
            source: 'cycle_machine_file',
            status: 'approved',
            approvedBy: actor || null,
            approvedVia: 'machine_file',
        };
        if (r.presentDays != null || r.absentDays != null) {
            out.push({
                ...base,
                itemType: 'ATTENDANCE',
                presentDays: r.presentDays,
                absentDays: r.absentDays,
            });
        }
        const otHours = (Number(r.ot2Hours) || 0) + (Number(r.ot3Hours) || 0);
        if (otHours > 0) {
            out.push({
                ...base,
                itemType: 'OT',
                hours: otHours,
                amount: null,
                sourceRef: `ot2=${Number(r.ot2Hours) || 0};ot3=${Number(r.ot3Hours) || 0}`,
            });
        }
    }
    return out;
}

function linesFromPortalAmounts({
    employeeId,
    contractId,
    workMonth,
    workYear,
    payMonth,
    payYear,
    portal = {},
    status = 'approved',
    source = 'portal_claim',
    actor,
    approvedVia,
}) {
    const out = [];
    const base = {
        employeeId,
        contractId,
        workMonth,
        workYear,
        payMonth,
        payYear,
        source,
        status,
        approvedBy: actor || null,
        approvedVia: approvedVia || null,
    };
    const otHours = (Number(portal.ot2Write) || 0) + (Number(portal.ot3) || 0) + (Number(portal.ot1) || 0);
    if (otHours > 0) out.push({ ...base, itemType: 'OT', hours: otHours });
    if (Number(portal.expense) > 0) out.push({ ...base, itemType: 'EXPENSE', amount: Number(portal.expense) });
    if (Number(portal.medical) > 0) out.push({ ...base, itemType: 'MEDICAL', amount: Number(portal.medical) });
    if (Number(portal.arrears) > 0) out.push({ ...base, itemType: 'ARREARS', amount: Number(portal.arrears) });
    if (Number(portal.deduction) > 0) out.push({ ...base, itemType: 'DEDUCTION', amount: Number(portal.deduction) });
    if (Number(portal.specialAllowance) > 0) {
        out.push({ ...base, itemType: 'SPECIAL_ALLOWANCE', amount: Number(portal.specialAllowance) });
    }
    return out;
}

async function listDesk(pool, {
    workMonth,
    workYear,
    contractId,
    client,
    stage,
} = {}) {
    const wm = parseInt(workMonth, 10);
    const wy = parseInt(workYear, 10);
    if (!wm || !wy) {
        const err = new Error('workMonth and workYear are required');
        err.status = 400;
        throw err;
    }
    const params = [wm, wy];
    const where = ['l.work_month = $1', 'l.work_year = $2'];
    if (contractId) {
        params.push(contractId);
        where.push(`l.contract_id = $${params.length}`);
    }
    if (client) {
        params.push(client);
        where.push(`e.client = $${params.length}`);
    }
    if (stage) {
        params.push(stage);
        where.push(`l.status = $${params.length}`);
    }

    const { rows } = await pool.query(
        `SELECT l.*,
                e.name,
                e.client,
                e.location,
                e.designation,
                pt.locked,
                pt.paid_days AS sheet_paid_days,
                pt.ot2_hrs AS sheet_ot2,
                pt.net AS sheet_net
         FROM payroll_input_ledger l
         LEFT JOIN employees e ON e.id = l.employee_id
         LEFT JOIN payroll_transactions pt
           ON pt.employee_id = l.employee_id
          AND pt.month = l.pay_month
          AND pt.year = l.pay_year
         WHERE ${where.join(' AND ')}
         ORDER BY e.name NULLS LAST, l.employee_id, l.item_type`,
        params
    );

    const people = new Map();
    for (const r of rows) {
        if (!people.has(r.employee_id)) {
            people.set(r.employee_id, {
                employeeId: r.employee_id,
                name: r.name,
                client: r.client,
                contractId: r.contract_id,
                location: r.location,
                designation: r.designation,
                locked: !!r.locked,
                sheetPaidDays: r.sheet_paid_days,
                sheetOt2: r.sheet_ot2,
                sheetNet: r.sheet_net,
                items: [],
            });
        }
        people.get(r.employee_id).items.push({
            id: r.id,
            itemType: r.item_type,
            presentDays: r.present_days,
            absentDays: r.absent_days,
            hours: r.hours,
            amount: r.amount,
            status: r.status,
            source: r.source,
            approvedBy: r.approved_by,
            approvedVia: r.approved_via,
            reason: r.reason,
            updatedAt: r.updated_at,
        });
    }
    return {
        workMonth: wm,
        workYear: wy,
        people: [...people.values()],
        count: people.size,
    };
}

async function intervene(pool, {
    employeeId,
    contractId,
    workMonth,
    workYear,
    payMonth,
    payYear,
    itemType,
    presentDays,
    absentDays,
    hours,
    amount,
    reason,
    sourceNote,
    actor,
}) {
    if (!employeeId || !ITEM_TYPES.includes(itemType)) {
        const err = new Error('employeeId and a valid itemType are required');
        err.status = 400;
        throw err;
    }
    if (!reason || !String(reason).trim()) {
        const err = new Error('Reason is required for payroll intervention');
        err.status = 400;
        throw err;
    }
    const result = await upsertLines(pool, [{
        employeeId,
        contractId,
        workMonth,
        workYear,
        payMonth: payMonth || workMonth,
        payYear: payYear || workYear,
        itemType,
        presentDays,
        absentDays,
        hours,
        amount,
        status: 'approved',
        source: 'payroll_intervention',
        approvedBy: actor || null,
        approvedVia: 'payroll_intervention',
        reason: `${String(reason).trim()}${sourceNote ? ` [${sourceNote}]` : ''}`,
    }], actor);
    return { ok: true, ...result, approvedVia: 'payroll_intervention' };
}

module.exports = {
    ITEM_TYPES,
    STATUSES,
    upsertLines,
    linesFromCycleRows,
    linesFromPortalAmounts,
    listDesk,
    intervene,
};
