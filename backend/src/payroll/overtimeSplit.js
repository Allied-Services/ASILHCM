'use strict';

const DEFAULT_WORK_DAYS = 26;

/**
 * Itemise a single overtime payout into its 2X and 3X lines for display.
 *
 * The payout total is authoritative — it comes from the payroll snapshot. These rows
 * only apportion it, and always sum back to it exactly, so a payslip can never show
 * component lines that disagree with the amount actually paid.
 *
 * Both the World A and World B payslips call this. Keep it here rather than in either
 * payslip module: a second copy of overtime arithmetic is how the payslip and the sheet
 * drifted apart before.
 */
function overtimeRows(ot2Hrs, ot3Hrs, otAmount, baseSalary, workDays = DEFAULT_WORK_DAYS) {
    const h2 = parseFloat(ot2Hrs) || 0;
    const h3 = parseFloat(ot3Hrs) || 0;
    const total = Math.round(parseFloat(otAmount) || 0);
    if (total <= 0 && h2 <= 0 && h3 <= 0) return [];
    if (h2 <= 0 && h3 <= 0) return [{ label: 'Overtime', amount: total }];
    if (h3 <= 0) return [{ label: `Overtime 2X (${h2} hrs)`, amount: total }];
    if (h2 <= 0) return [{ label: `Overtime 3X (${h3} hrs)`, amount: total }];

    const days = parseFloat(workDays) || DEFAULT_WORK_DAYS;
    const hourly = (parseFloat(baseSalary) || 0) / days / 8;
    let ot2Amt = Math.round(h2 * 2 * hourly);
    let ot3Amt = total - ot2Amt;
    // The 2X line valued at the standard hourly rate can exceed the whole payout when the
    // payout was prorated or capped. Fall back to splitting it by weighted hours instead.
    if (ot3Amt < 0) {
        const w2 = h2 * 2;
        const w3 = h3 * 3;
        const w = w2 + w3 || 1;
        ot2Amt = Math.round(total * (w2 / w));
        ot3Amt = total - ot2Amt;
    }
    return [
        { label: `Overtime 2X (${h2} hrs)`, amount: ot2Amt },
        { label: `Overtime 3X (${h3} hrs)`, amount: ot3Amt },
    ];
}

module.exports = { overtimeRows, DEFAULT_WORK_DAYS };
