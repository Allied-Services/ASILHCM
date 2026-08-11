'use strict';

/**
 * Resolve Payroll Sheet money inputs for Calculate.
 *
 * World A rule: payroll_transactions columns are the operator source of truth.
 * Attendance / Monthly Hub / claims may RAISE hours or fill gaps — they must never
 * wipe sheet OT/OPD/reimb just because a hub row exists with zeros.
 */

function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function positiveOrZero(v) {
    const n = num(v, 0);
    return n > 0 ? n : 0;
}

/**
 * @param {object} args
 * @param {object} args.sheet - payroll_transactions row (or {})
 * @param {{ ot1?: number, ot2?: number, ot3?: number }} args.attOt - from attendance
 * @param {object|null} args.monthlyOv - monthly_attendance_overrides row
 * @param {{ ot1?: number, ot2?: number, ot3?: number, opd?: number, expense?: number }} args.claimAgg
 * @param {boolean} args.hasClaims
 * @param {'canonical'|'sheet_inputs'} args.sourceMode
 */
function resolvePayrollSheetInputs({
    sheet = {},
    attOt = {},
    monthlyOv = null,
    claimAgg = {},
    hasClaims = false,
    sourceMode = 'sheet_inputs',
}) {
    const sheetOt1 = positiveOrZero(sheet.ot1_hrs);
    const sheetOt2 = positiveOrZero(sheet.ot2_hrs);
    const sheetOt3 = positiveOrZero(sheet.ot3_hrs);
    const sheetOpd = num(sheet.opd_claim);
    const sheetExpense = num(sheet.reimbursement);

    let ot1 = sheetOt1;
    let ot2 = sheetOt2;
    let ot3 = sheetOt3;
    let opd = sheetOpd;
    let expense = sheetExpense;

    if (sourceMode === 'canonical') {
        // Merge upward only — empty attendance / hub zeros cannot clear sheet OT
        ot1 = Math.max(ot1, positiveOrZero(attOt.ot1), positiveOrZero(claimAgg.ot1));
        ot2 = Math.max(ot2, positiveOrZero(attOt.ot2), positiveOrZero(claimAgg.ot2));
        ot3 = Math.max(ot3, positiveOrZero(attOt.ot3), positiveOrZero(claimAgg.ot3));

        if (monthlyOv) {
            // Hub OT applies only when > 0 (import blanks often land as 0, not null)
            if (positiveOrZero(monthlyOv.ot1_hours) > 0) ot1 = Math.max(ot1, num(monthlyOv.ot1_hours));
            if (positiveOrZero(monthlyOv.ot2_hours) > 0) ot2 = Math.max(ot2, num(monthlyOv.ot2_hours));
            if (positiveOrZero(monthlyOv.ot3_hours) > 0) ot3 = Math.max(ot3, num(monthlyOv.ot3_hours));
        }

        if (hasClaims) {
            opd = num(claimAgg.opd);
            expense = num(claimAgg.expense);
        }
    }
    // sheet_inputs: keep sheet columns only (idempotent recompute)

    return { ot1, ot2, ot3, opd, expense };
}

/**
 * Paid / present days for Model A.
 * Sheet paid_days wins when set; else hub present_days; else attendance-derived.
 */
function resolvePayrollSheetPaidDays({
    sheet = {},
    monthlyOv = null,
    attendancePaidDays = 0,
}) {
    let presentDaysForModelA = null;
    let absentDaysForModelA = null;
    let paidDays = num(attendancePaidDays, 0);

    if (monthlyOv) {
        if (monthlyOv.present_days != null) {
            presentDaysForModelA = num(monthlyOv.present_days);
            paidDays = presentDaysForModelA;
        }
        if (monthlyOv.absent_days != null) {
            absentDaysForModelA = num(monthlyOv.absent_days);
        }
    }

    if (sheet.paid_days != null && sheet.paid_days !== '') {
        const spd = num(sheet.paid_days);
        // Keep explicit 0 (unpaid month) — only skip null/empty
        paidDays = spd;
        if (presentDaysForModelA == null) presentDaysForModelA = spd;
    }

    return { paidDays, presentDaysForModelA, absentDaysForModelA };
}

module.exports = {
    resolvePayrollSheetInputs,
    resolvePayrollSheetPaidDays,
    num,
};
