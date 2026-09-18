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
    const sheetArrears = num(sheet.arrears);
    const sheetSpecial = num(sheet.special_allowance);
    const sheetDeduction = num(sheet.other_deduction);

    let ot1 = sheetOt1;
    let ot2 = sheetOt2;
    let ot3 = sheetOt3;
    let opd = sheetOpd;
    let expense = sheetExpense;
    let arrears = sheetArrears;
    let specialAllowance = sheetSpecial;
    let otherDeduction = sheetDeduction;

    if (sourceMode === 'canonical' || isDeclaredCycleAttendance(monthlyOv)) {
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
            if (!(sheetArrears > 0)) arrears = num(claimAgg.arrears);
            if (!(sheetSpecial > 0)) specialAllowance = num(claimAgg.specialAllowance);
            if (!(sheetDeduction > 0)) otherDeduction = num(claimAgg.otherDeduction);
        }
    }
    // sheet_inputs: keep sheet columns only (idempotent recompute)

    return { ot1, ot2, ot3, opd, expense, arrears, specialAllowance, otherDeduction };
}

function hasHubAttendance(monthlyOv) {
    return !!(monthlyOv && (monthlyOv.present_days != null || monthlyOv.absent_days != null));
}

const CYCLE_ATTENDANCE_SOURCES = new Set(['cycle_machine_file', 'fv_conservancy_attendance']);

function isDeclaredCycleAttendance(monthlyOv) {
    if (!monthlyOv) return false;
    const src = String(monthlyOv.source || '').trim();
    if (!CYCLE_ATTENDANCE_SOURCES.has(src)) return false;
    return monthlyOv.present_days != null || monthlyOv.absent_days != null;
}

function isCalendarDefaultedPaidDays(sheetPaidDays, calendarDays) {
    const cal = num(calendarDays, 0);
    if (!(cal > 0) || sheetPaidDays == null || sheetPaidDays === '') return false;
    return num(sheetPaidDays) === cal;
}

/**
 * Paid / present days for Model A.
 * sheet_inputs: sheet paid_days wins when set; else hub; else attendance-derived.
 * canonical (Merge approved Portal Claims): Monthly Cycle / hub attendance
 * overrides sheet paid_days so absent-day edits load onto the sheet.
 * Machine-file / FV cycle attendance is the declared source — it wins over a
 * leftover calendar-month sheet value (the 31-vs-absences PSO mismatch).
 */
function resolvePayrollSheetPaidDays({
    sheet = {},
    monthlyOv = null,
    attendancePaidDays = 0,
    sourceMode = 'sheet_inputs',
    calendarDays = 0,
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

    const declaredCycle = isDeclaredCycleAttendance(monthlyOv);
    const sheetLooksTyped = sheet.paid_days != null && sheet.paid_days !== ''
        && !isCalendarDefaultedPaidDays(sheet.paid_days, calendarDays);
    const hubWins = (sourceMode === 'canonical' && hasHubAttendance(monthlyOv))
        || (declaredCycle && !sheetLooksTyped);
    if (!hubWins && sheet.paid_days != null && sheet.paid_days !== '') {
        const spd = num(sheet.paid_days);
        // Keep explicit 0 (unpaid month) — only skip null/empty
        paidDays = spd;
        if (presentDaysForModelA == null) presentDaysForModelA = spd;
    }

    return { paidDays, presentDaysForModelA, absentDaysForModelA, declaredCycle };
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
 * Default (inferred / Excel import): Paid Days are the calendar month (30/31).
 * A stored 26 (weekdays) is Sundays-paid, not four days unpaid — otherwise
 * 40,000 + OT 11,154 becomes Gross 45,821 instead of 51,154.
 *
 * honorSheetPaidDays (default Calculate / sheet_inputs): the PD DAYS cell is
 * an operator input. Keep it and prorate. Do not lift 26→31 or force 31
 * because Monthly Cycle has a blank absent row.
 *
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
    honorSheetPaidDays = false,
    honorDeclaredAttendance = false,
}) {
    const cal = num(calendarDays, 0) || num(modelABasis, 30) || 30;
    const hasExplicitSheet = sheetPaidDays != null && sheetPaidDays !== '';
    if (honorSheetPaidDays && hasExplicitSheet && !honorDeclaredAttendance) {
        const capped = Math.min(Math.max(0, num(sheetPaidDays)), cal);
        return {
            modelA: true,
            presentDays: capped,
            expectedDays: cal,
            calendarBasis: cal,
            absentDays: Math.max(0, cal - capped),
            persistPaidDays: capped,
        };
    }
    const hasExplicitAbsent = absentDaysForModelA != null && absentDaysForModelA !== '';
    const raw = hasExplicitSheet
        ? num(sheetPaidDays)
        : num(paidDays, 0);
    const lifted = liftPaidDaysToCalendarMonth(raw || num(paidDays, 0), cal, {
        explicitAbsent: hasExplicitAbsent,
    });

    if (hasExplicitAbsent) {
        const absent = num(absentDaysForModelA);
        const present = presentDaysForModelA != null
            ? num(presentDaysForModelA)
            : Math.max(0, cal - absent);
        return {
            modelA: true,
            absentDays: absent,
            expectedDays: cal,
            calendarBasis: cal,
            presentDays: present,
            // Cycle/machine-file attendance persists the paid days that were declared.
            // Wafi Model A still shows the calendar month; the cut is the absence line.
            persistPaidDays: honorDeclaredAttendance ? present : cal,
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
    isDeclaredCycleAttendance,
    isCalendarDefaultedPaidDays,
    CYCLE_ATTENDANCE_SOURCES,
    num,
};
