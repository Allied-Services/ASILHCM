'use strict';

/**
 * Frontend claims fill helper tests (Node ESM).
 * Run: node --test frontend/src/features/claims/claimsFillHelpers.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClaimSummary,
  prepareItemsForSave,
  nextStep,
  prevStep,
  isMeaningfulOtRow,
  attachmentsForSupportType,
  fillExperienceFromPack,
} from './claimsFillHelpers.js';

describe('claimsFillHelpers', () => {
  it('keeps two meaningful OT lines in save payload', () => {
    const otRows = [
      { claim_type: 'OT', claim_date: '2026-07-15', time_from: '5:00 PM', time_to: '7:00 PM', nature: 'Ops', ot_hours: '' },
      { claim_type: 'OT', claim_date: '2026-07-16', time_from: '6:00 PM', time_to: '8:00 PM', nature: 'Ops', ot_hours: '' },
    ];
    const items = prepareItemsForSave(otRows, [], [], false);
    assert.equal(items.filter((i) => i.claim_type === 'OT').length, 2);
  });

  it('builds consolidated summary with OT, expense, and medical totals', () => {
    const summary = buildClaimSummary({
      otRows: [
        { claim_type: 'OT', claim_date: '2026-07-15', time_from: '5:00 PM', time_to: '7:00 PM', nature: 'A', ot_hours: '2' },
      ],
      expRows: [{ claim_type: 'EXPENSE', claim_date: '2026-07-10', amount: '500', description: 'Fuel' }],
      medRows: [{ claim_type: 'MEDICAL', claim_date: '2026-07-12', amount: '1200', description: 'OPD', patient_name: 'Self' }],
      attachments: [{ id: 1, filename: 'bills.pdf', category: 'medical_support' }],
    });
    assert.equal(summary.otLines.length, 1);
    assert.equal(summary.expenseLines.length, 1);
    assert.equal(summary.medicalLines.length, 1);
    assert.equal(summary.totals.lineCount, 3);
    assert.equal(summary.totals.expense, 500);
    assert.equal(summary.totals.medical, 1200);
    assert.equal(summary.hasMedicalSupport, true);
    assert.deepEqual(summary.supportBlockers, ['Expense supports file missing']);
  });

  it('wizard step navigation moves forward and back', () => {
    assert.equal(nextStep('ot'), 'expense');
    assert.equal(prevStep('expense'), 'ot');
    assert.equal(nextStep('review'), 'review');
  });

  it('ignores blank OT rows', () => {
    assert.equal(isMeaningfulOtRow(emptyOt()), false);
  });

  it('groups support attachments by expense vs medical', () => {
    const attachments = [
      { id: 1, filename: 'receipt.pdf', category: 'expense_support' },
      { id: 2, filename: 'rx.jpg', category: 'medical_support' },
    ];
    assert.equal(attachmentsForSupportType(attachments, 'expense').length, 1);
    assert.equal(attachmentsForSupportType(attachments, 'medical').length, 1);
  });

  it('machine file pack is file-only and lists Attendance', () => {
    const exp = fillExperienceFromPack({
      enabled_types: ['ATTENDANCE', 'OT', 'EXPENSE', 'MEDICAL'],
      collection_mode: 'machine_file',
    });
    assert.equal(exp.fileOnly, true);
    assert.equal(exp.showOnScreen, false);
    assert.equal(exp.hasAttendance, true);
    assert.match(exp.typeList, /Attendance/);
  });

  it('monthly form pack keeps on-screen entry', () => {
    const exp = fillExperienceFromPack({
      enabled_types: ['OT', 'EXPENSE', 'MEDICAL'],
      collection_mode: 'monthly_form',
    });
    assert.equal(exp.fileOnly, false);
    assert.equal(exp.showOnScreen, true);
  });
});

function emptyOt() {
  return { claim_type: 'OT', claim_date: '', ot_hours: '', ot_multiplier: 'Double', nature: '', time_from: '', time_to: '' };
}
