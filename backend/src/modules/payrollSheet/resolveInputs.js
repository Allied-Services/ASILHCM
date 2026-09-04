'use strict';

/**
 * Resolve Payroll Sheet money inputs for Calculate.
 *
 * World A rule: payroll_transactions columns are the operator source of truth.
 * When a sheet cell is already > 0, that typed number wins — claims / attendance /
 * hub must not replace it (higher or lower). Empty / 0 cells may fill from those
 * sources. Hub zeros must never wipe sheet OT.
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
        const hubOt1 = monthlyOv ? positiveOrZero(monthlyOv.ot1_hours) : 0;
        const hubOt2 = monthlyOv ? positiveOrZero(monthlyOv.ot2_hours) : 0;
        const hubOt3 = monthlyOv ? positiveOrZero(monthlyOv.ot3_hours) : 0;
        // Typed / already-filled sheet OT wins. Fill only empty (0) cells.
        if (!(sheetOt1 > 0)) ot1 = Math.max(positiveOrZero(attOt.ot1), positiveOrZero(claimAgg.ot1), hubOt1);
        if (!(sheetOt2 > 0)) ot2 = Math.max(positiveOrZero(attOt.ot2), positiveOrZero(claimAgg.ot2), hubOt2);
        if (!(sheetOt3 > 0)) ot3 = Math.max(positiveOrZero(attOt.ot3), positiveOrZero(claimAgg.ot3), hubOt3);

        if (hasClaims) {
            if (!(sheetOpd > 0)) opd = num(claimAgg.opd);
            if (!(sheetExpense > 0)) expense = num(claimAgg.expense);
        }
    }
    // sheet_inputs: keep sheet columns only (idempotent recompute)

    return { ot1, ot2, ot3, opd, expense };
}

function hasHubAttendance(monthlyOv) {
    return !!(monthlyOv && (monthlyOv.present_days != null || monthlyOv.absent_days != null));
}

/**
 * Paid / present days for Model A.
 * sheet_inputs: sheet paid_days wins when set; else hub; else attendance-derived.
 * canonical (Merge approved Portal Claims): Monthly Cycle / hub attendance
 * overrides sheet paid_days so absent-day edits load onto the sheet.
 */
function resolvePayrollSheetPaidDays({
    sheet = {},
    monthlyOv = null,
    attendancePaidDays = 0,
    sourceMode = 'sheet_inputs',
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

    const hubWins = sourceMode === 'canonical' && hasHubAttendance(monthlyOv);
    if (!hubWins && sheet.paid_days != null && sheet.paid_days !== '') {
        const spd = num(sheet.paid_days);
        // Keep explicit 0 (unpaid month) — only skip null/empty
        paidDays = spd;
        if (presentDaysForModelA == null) presentDaysForModelA = spd;
    }

    return { paidDays, presentDaysForModelA, absentDaysForModelA };
}

/**
 * 22–27 "present" on a 28–31 day month is weekday attendance, not unpaid
 * Sunday-leave. Sunday is a paid holiday. Paid Days stay the calendar month.
 */
function isWeekdayShapedPaidDays(paidDays, calendarDays) {
    const pd = num(paidDays, 0);
    const cal = num(calendarDays, 0);
    if (cal < 28 || cal > 31) return false;
    if (pd < 22 || pd > 27) return false;
    return pd < cal;
}

function liftPaidDaysToCalendarMonth(paidDays, calendarDays, { explicitAbsent = false } = {}) {
    const cal = num(calendarDays, 0) || 30;
    if (explicitAbsent) return num(paidDays, 0);
    const pd = num(paidDays, 0);
    if (pd <= 0) return cal;
    if (isWeekdayShapedPaidDays(pd, cal)) return cal;
    return pd;
}

/**
 * Model A flags for Payroll Sheet Calculate.
 *
 * Paid Days default to the calendar month (30/31). A stored 26 (weekdays)
 * is Sundays-paid, not four days unpaid — otherwise 40,000 + OT 11,154
 * becomes Gross 45,821 instead of 51,154.
 *
 * Leave / Other Deduction cut pay. Do not shrink Paid Days for Sundays.
 * Mid-month joiners with a real short calendar count (e.g. 20) still prorate.
 */
function resolveSheetModelAComputeInput({
    paidDays,
    workingDays,
    presentDaysForModelA,
    absentDaysForModelA,
    sheetPaidDays,
    modelABasis = 30,
    calendarDays,
}) {
    const cal = num(calendarDays, 0) || num(modelABasis, 30) || 30;
    const hasExplicitAbsent = absentDaysForModelA != null && absentDaysForModelA !== '';
    const raw = sheetPaidDays == null || sheetPaidDays === ''
        ? num(paidDays, 0)
        : num(sheetPaidDays);
    const lifted = liftPaidDaysToCalendarMonth(raw || num(paidDays, 0), cal, {
        explicitAbsent: hasExplicitAbsent,
    });

    if (hasExplicitAbsent) {
        const absent = num(absentDaysForModelA);
        return {
            modelA: true,
            absentDays: absent,
            expectedDays: cal,
            calendarBasis: cal,
            presentDays: presentDaysForModelA != null
                ? num(presentDaysForModelA)
                : Math.max(0, cal - absent),
            // PD Days stay the full month; the cut is the absence line.
            persistPaidDays: cal,
        };
    }

    return {
        modelA: true,
        presentDays: lifted,
        expectedDays: cal,
        calendarBasis: cal,
        persistPaidDays: lifted,
    };
}

module.exports = {
    resolvePayrollSheetInputs,
    resolvePayrollSheetPaidDays,
    resolveSheetModelAComputeInput,
    isWeekdayShapedPaidDays,
    liftPaidDaysToCalendarMonth,
    num,
};
