import { computeOtHoursFromRow, formatIsoDateDdMmYyyy, otRateHintForDate } from './claimsTimeParse.js';

export const WIZARD_STEPS = ['ot', 'expense', 'medical', 'supports', 'review'];

export const STEP_LABELS = {
  ot: 'Overtime',
  expense: 'Expense Reimbursement',
  medical: 'Medical Reimbursement',
  supports: 'Supports',
  review: 'Review & Confirm',
};

const TYPE_TO_STEP = { OT: 'ot', EXPENSE: 'expense', MEDICAL: 'medical' };

const TYPE_LABELS = {
  ATTENDANCE: 'Attendance',
  OT: 'Overtime',
  EXPENSE: 'Expense Reimbursement',
  MEDICAL: 'Medical reimbursement',
};

/** Contract pack → fill UI (file-only vs on-screen). */
export function fillExperienceFromPack(pack = {}) {
  const enabledTypes = (pack.enabled_types || pack.enabledTypes || ['OT', 'EXPENSE', 'MEDICAL'])
    .map((t) => String(t || '').trim().toUpperCase())
    .filter(Boolean);
  const types = enabledTypes.length ? [...new Set(enabledTypes)] : ['OT', 'EXPENSE', 'MEDICAL'];
  const collectionMode = String(pack.collection_mode || pack.collectionMode || 'monthly_form').toLowerCase();
  const fileOnly = collectionMode === 'machine_file';
  return {
    enabledTypes: types,
    collectionMode,
    fileOnly,
    showOnScreen: !fileOnly,
    typeList: types.map((t) => TYPE_LABELS[t] || t).join(', '),
    hasAttendance: types.includes('ATTENDANCE'),
    hasOt: types.includes('OT'),
    hasExpense: types.includes('EXPENSE'),
    hasMedical: types.includes('MEDICAL'),
  };
}

/** Build wizard steps from contract enabled_types (ATTENDANCE is file-only, not an on-screen step). */
export function buildWizardSteps(enabledTypes = ['OT', 'EXPENSE', 'MEDICAL']) {
  const types = (enabledTypes || []).map((t) => String(t || '').trim().toUpperCase());
  const steps = [];
  if (types.includes('OT')) steps.push('ot');
  if (types.includes('EXPENSE')) steps.push('expense');
  if (types.includes('MEDICAL')) steps.push('medical');
  if (steps.some((s) => s === 'expense' || s === 'medical')) steps.push('supports');
  steps.push('review');
  return steps;
}

export function stepIndex(step, steps = WIZARD_STEPS) {
  const i = steps.indexOf(step);
  return i >= 0 ? i : 0;
}

export function nextStep(step, steps = WIZARD_STEPS) {
  const i = stepIndex(step, steps);
  return steps[Math.min(i + 1, steps.length - 1)];
}

export function prevStep(step, steps = WIZARD_STEPS) {
  const i = stepIndex(step, steps);
  return steps[Math.max(i - 1, 0)];
}

export function isMeaningfulOtRow(row) {
  if (!row) return false;
  const hours = parseFloat(row.ot_hours);
  return !!(String(row.claim_date || '').trim()
    || (Number.isFinite(hours) && hours > 0)
    || String(row.time_from || '').trim()
    || String(row.time_to || '').trim()
    || String(row.nature || '').trim());
}

export function isMeaningfulMoneyRow(row) {
  if (!row) return false;
  const amt = parseFloat(row.amount);
  return !!(String(row.claim_date || '').trim()
    || (Number.isFinite(amt) && amt > 0)
    || String(row.description || '').trim()
    || String(row.patient_name || '').trim());
}

export function syncOtHours(rows) {
  return (rows || []).map((r) => {
    const hrs = computeOtHoursFromRow(r);
    return hrs != null && hrs > 0 ? { ...r, ot_hours: String(hrs) } : { ...r, ot_hours: '' };
  });
}

export function countMeaningfulRows(rows, type) {
  if (type === 'OT') return (rows || []).filter(isMeaningfulOtRow).length;
  return (rows || []).filter(isMeaningfulMoneyRow).length;
}

export function prepareItemsForSave(otRows, expRows, medRows, confirmNoClaims, holidayMap = {}) {
  if (confirmNoClaims) return [];
  const otPrepared = syncOtHours(otRows).map((r) => {
    const hint = otRateHintForDate(r.claim_date, holidayMap);
    if (!hint) return r;
    return { ...r, ot_multiplier: hint.rate === 'Triple' ? 'Triple' : 'Double' };
  });
  return [...otPrepared, ...(expRows || []), ...(medRows || [])].filter((r) => {
    if (r.claim_type === 'OT') return isMeaningfulOtRow(r);
    return isMeaningfulMoneyRow(r);
  });
}

export const SUPPORT_CATEGORY_LABELS = {
  expense_support: 'Expense supports',
  expense: 'Expense supports',
  medical_support: 'Medical supports',
  medical: 'Medical supports',
  excel_workbook: 'Excel workbook',
  other: 'Other',
};

export function attachmentsForSupportType(attachments, kind) {
  const map = {
    expense: ['expense_support', 'expense'],
    medical: ['medical_support', 'medical'],
    workbook: ['excel_workbook'],
  };
  const cats = map[kind] || [];
  return (attachments || []).filter((a) => cats.includes(String(a.category || '').toLowerCase()));
}

export function supportCategoryLabel(category) {
  return SUPPORT_CATEGORY_LABELS[String(category || '').toLowerCase()] || String(category || 'other');
}

export function buildClaimSummary({ otRows, expRows, medRows, attachments = [], pkHolidays = {} }) {
  const otPrepared = syncOtHours(otRows);
  const otLines = otPrepared.filter(isMeaningfulOtRow).map((r, idx) => {
    const hint = otRateHintForDate(r.claim_date, pkHolidays);
    const rateLabel = r.ot_multiplier || hint?.rateLabel || '2×';
    return {
      key: `ot-${idx}`,
      type: 'OT',
      date: formatIsoDateDdMmYyyy(r.claim_date),
      detail: `${r.time_from || '—'} → ${r.time_to || '—'} · ${r.ot_hours || '?'}h · ${rateLabel}`,
      extra: [hint?.label, r.nature].filter(Boolean).join(' · ') || r.nature || '',
    };
  });
  const expenseLines = (expRows || []).filter(isMeaningfulMoneyRow).map((r, idx) => ({
    key: `exp-${idx}`,
    type: 'EXPENSE',
    date: formatIsoDateDdMmYyyy(r.claim_date),
    detail: `PKR ${r.amount || '—'}`,
    extra: r.description || '',
  }));
  const medicalLines = (medRows || []).filter(isMeaningfulMoneyRow).map((r, idx) => ({
    key: `med-${idx}`,
    type: 'MEDICAL',
    date: formatIsoDateDdMmYyyy(r.claim_date),
    detail: `PKR ${r.amount || '—'}${r.patient_name ? ` · ${r.patient_name}` : ''}`,
    extra: r.description || '',
  }));

  const totalOtHours = otLines.reduce((sum, line) => {
    const h = parseFloat(String(line.detail).match(/([\d.]+)h/)?.[1]);
    return sum + (Number.isFinite(h) ? h : 0);
  }, 0);

  const totalExpense = expenseLines.reduce((sum, line) => {
    const n = parseFloat(String(line.detail).replace(/[^\d.]/g, ''));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const totalMedical = medicalLines.reduce((sum, line) => {
    const n = parseFloat(String(line.detail).replace(/[^\d.]/g, ''));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const hasExpenseSupport = attachments.some((a) => ['expense_support', 'expense'].includes(String(a.category || '').toLowerCase()));
  const hasMedicalSupport = attachments.some((a) => ['medical_support', 'medical'].includes(String(a.category || '').toLowerCase()));

  return {
    otLines,
    expenseLines,
    medicalLines,
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      category: a.category || 'other',
    })),
    totals: {
      otHours: Math.round(totalOtHours * 100) / 100,
      expense: totalExpense,
      medical: totalMedical,
      lineCount: otLines.length + expenseLines.length + medicalLines.length,
    },
    hasExpense: expenseLines.length > 0,
    hasMedical: medicalLines.length > 0,
    hasExpenseSupport,
    hasMedicalSupport,
    supportBlockers: [
      ...(expenseLines.length && !hasExpenseSupport ? ['Expense supports file missing'] : []),
      ...(medicalLines.length && !hasMedicalSupport ? ['Medical supports file missing'] : []),
    ],
  };
}

export function savedLinesFromRows(otRows, expRows, medRows) {
  return prepareItemsForSave(otRows, expRows, medRows, false).map((r) => ({
    claim_type: r.claim_type,
    claim_date_display: formatIsoDateDdMmYyyy(r.claim_date),
    ot_hours: r.ot_hours,
    time_from: r.time_from,
    time_to: r.time_to,
    amount: r.amount,
    description: r.nature || r.description,
  }));
}
