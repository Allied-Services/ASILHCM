'use strict';

const { loadPayrollClaimCompare } = require('../payrollSheet/service');

function n(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}

async function loadSheetProvenance(pool, year, month, opts = {}) {
    const compare = await loadPayrollClaimCompare(pool, year, month, opts);
    const { rows: sheet } = await pool.query(
        `SELECT pt.employee_id, e.name, e.contract_id, e.contract_name, e.salary,
                pt.ot2_hrs, pt.ot3_hrs, pt.opd_claim, pt.reimbursement, pt.paid_days,
                pt.locked, pt.remarks
         FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE pt.year = $1 AND pt.month = $2`,
        [year, month]
    );
    const { rows: hub } = await pool.query(
        `SELECT employee_id, present_days, ot2_hours, ot3_hours, opd, expense, source
         FROM monthly_attendance_overrides
         WHERE period_year = $1 AND period_month = $2`,
        [year, month]
    ).catch(() => ({ rows: [] }));
    const hubBy = new Map(hub.map((h) => [h.employee_id, h]));

    const { rows: conflicts } = await pool.query(
        `SELECT * FROM payroll_input_conflicts
         WHERE year = $1 AND month = $2 AND resolved = FALSE`,
        [year, month]
    ).catch(() => ({ rows: [] }));

    const pending = [];
    const rows = sheet.map((r) => {
        const portal = compare.byEmployee?.[r.employee_id] || {};
        const h = hubBy.get(r.employee_id);
        const overwrite = {
            ot2: n(r.ot2_hrs) > 0 && n(portal.ot2) > 0 && n(r.ot2_hrs) !== n(portal.ot2),
            ot3: n(r.ot3_hrs) > 0 && n(portal.ot3) > 0 && n(r.ot3_hrs) !== n(portal.ot3),
        };
        const sheetHasOther = n(r.ot2_hrs) || n(r.ot3_hrs) || n(r.opd_claim) || n(r.reimbursement);
        const portalReady = n(portal.ot2) || n(portal.ot3) || n(portal.opd) || n(portal.expense);
        if (!r.locked && portalReady && !sheetHasOther) {
            pending.push({
                employee_id: r.employee_id,
                name: r.name,
                portal,
            });
        }
        return {
            employee_id: r.employee_id,
            name: r.name,
            contract_id: r.contract_id,
            salary_source: 'roster',
            attendance_source: h ? (h.source || 'monthly_hub') : 'sheet',
            claims_source: portalReady ? 'portal_cycle' : (sheetHasOther ? 'sheet' : 'none'),
            overwrite,
            locked: !!r.locked,
            sheet: {
                ot2_hrs: n(r.ot2_hrs),
                ot3_hrs: n(r.ot3_hrs),
                opd_claim: n(r.opd_claim),
                reimbursement: n(r.reimbursement),
                paid_days: r.paid_days,
            },
            portal,
            hub: h || null,
        };
    });

    return {
        year,
        month,
        rows,
        pending,
        conflicts,
        canLock: conflicts.length === 0,
    };
}

async function recordConflicts(pool, year, month, items, actor) {
    for (const it of items || []) {
        await pool.query(
            `INSERT INTO payroll_input_conflicts
                (year, month, employee_id, field, source_a, value_a, source_b, value_b, resolved)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)
             ON CONFLICT (year, month, employee_id, field) DO UPDATE SET
                source_a = EXCLUDED.source_a, value_a = EXCLUDED.value_a,
                source_b = EXCLUDED.source_b, value_b = EXCLUDED.value_b,
                resolved = FALSE`,
            [year, month, it.employee_id, it.field, it.source_a, String(it.value_a), it.source_b, String(it.value_b)]
        );
    }
    return loadSheetProvenance(pool, year, month);
}

async function resolveConflict(pool, id, actor) {
    await pool.query(
        `UPDATE payroll_input_conflicts
         SET resolved = TRUE, resolved_by = $2, resolved_at = NOW()
         WHERE id = $1`,
        [id, actor || null]
    );
    return { ok: true };
}

async function detectConflicts(pool, year, month) {
    const prov = await loadSheetProvenance(pool, year, month);
    const found = [];
    for (const r of prov.rows) {
        const hubOt2 = n(r.hub?.ot2_hours);
        const sheetOt2 = n(r.sheet.ot2_hrs);
        if (hubOt2 > 0 && sheetOt2 > 0 && hubOt2 !== sheetOt2) {
            found.push({
                employee_id: r.employee_id,
                field: 'ot2_hrs',
                source_a: 'sheet',
                value_a: sheetOt2,
                source_b: r.hub?.source || 'hub',
                value_b: hubOt2,
            });
        }
    }
    if (found.length) await recordConflicts(pool, year, month, found);
    return loadSheetProvenance(pool, year, month);
}

async function importPendingClaims(pool, year, month, employeeIds, actor) {
    const { writePortalAmountsToSheet } = require('../claims/claimsResponse');
    const prov = await loadSheetProvenance(pool, year, month);
    const wanted = new Set(employeeIds || []);
    const targets = prov.pending.filter((p) => !wanted.size || wanted.has(p.employee_id));
    const { rows: batch } = await pool.query(
        `INSERT INTO claim_import_batches (year, month, imported_by, employee_ids)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [year, month, actor || null, targets.map((t) => t.employee_id)]
    );
    let imported = 0;
    const blocked = [];
    for (const t of targets) {
        const portal = {
            ot2Write: n(t.portal?.ot2),
            ot3: n(t.portal?.ot3),
            expense: n(t.portal?.expense),
            medical: n(t.portal?.opd),
        };
        const result = await writePortalAmountsToSheet(pool, {
            employeeId: t.employee_id,
            month,
            year,
            portal,
        });
        if (result.wrotePayroll) imported += 1;
        else if (result.blocked) blocked.push({ employee_id: t.employee_id, code: result.blocked });
    }
    return { batch: batch[0], imported, blocked };
}

async function assertNoOpenConflicts(pool, year, month, employeeIds) {
    const params = [year, month];
    let extra = '';
    if (employeeIds?.length) {
        params.push(employeeIds);
        extra = ` AND employee_id = ANY($3::text[])`;
    }
    let rows;
    try {
        ({ rows } = await pool.query(
            `SELECT employee_id, field FROM payroll_input_conflicts
             WHERE year = $1 AND month = $2 AND resolved = FALSE ${extra}`,
            params
        ));
    } catch {
        return;
    }
    const open = (rows || []).filter((r) => r.field);
    if (open.length) {
        const err = new Error('Unresolved input conflicts — resolve them before lock');
        err.status = 409;
        err.code = 'INPUT_CONFLICTS';
        err.details = { conflicts: open };
        throw err;
    }
}

module.exports = {
    loadSheetProvenance,
    recordConflicts,
    resolveConflict,
    detectConflicts,
    importPendingClaims,
    assertNoOpenConflicts,
};
