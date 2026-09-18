'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  followingMonth,
  mergeReviewPeople,
  reviewStageOf,
  boardDownloadRows,
  rowsToCsv,
  skipReasonLabel,
  buildChasePayload,
  confirmSendMessage,
} from './cycleDeskExport.js';

describe('cycle desk helpers', () => {
  it('followingMonth wraps December', () => {
    assert.deepEqual(followingMonth(8, 2026), { month: 9, year: 2026 });
    assert.deepEqual(followingMonth(12, 2026), { month: 1, year: 2027 });
  });

  it('merges the claims board with ledger rows and keeps No Claims people', () => {
    const merged = mergeReviewPeople(
      [
        {
          employee_id: 'ASIL/SPL-404/21',
          name: 'Muhammad Usman',
          client: 'Wafi Energy',
          contract_name: 'Wafi 3P',
          mailed_to: 'm.usman-contractor@wafi-energy.com',
          lm: 'muhammad.rauf@wafi-energy.com',
          control_status: 'waiting_lm',
          control_label: 'Waiting for LM',
        },
        {
          employee_id: 'ASIL/SPL-001',
          name: 'No Claims Person',
          client: 'Wafi Energy',
          control_status: 'no_claims_confirmed',
          no_claims_kind: 'confirmed',
        },
      ],
      [
        {
          employeeId: 'ASIL/SPL-404/21',
          items: [{ status: 'submitted', itemType: 'OT' }],
          locked: false,
        },
      ]
    );
    assert.equal(merged.length, 2);
    const usman = merged.find((p) => p.employeeId === 'ASIL/SPL-404/21');
    const none = merged.find((p) => p.employeeId === 'ASIL/SPL-001');
    assert.equal(reviewStageOf(usman), 'waiting_lm');
    assert.equal(usman.items[0].itemType, 'OT');
    assert.equal(reviewStageOf(none), 'no_claims');
  });

  it('download CSV includes No Claims and Approver columns', () => {
    const csv = rowsToCsv(boardDownloadRows([
      {
        name: 'Muhammad Ahsan Khan',
        employee_id: 'ASIL/SPL-345/21',
        client: 'Wafi Energy',
        contract_name: 'Wafi 3P',
        mailed_to: 'focal@wafi-energy.com',
        lm: 'muhammad.rauf@wafi-energy.com',
        control_label: 'No Claims — Confirmed',
        control_status: 'no_claims_confirmed',
        portal: { ot2: 0, expense: 0 },
      },
    ]));
    assert.match(csv, /ASIL Code/);
    assert.match(csv, /Approver/);
    assert.match(csv, /ASIL\/SPL-345\/21/);
    assert.match(csv, /muhammad.rauf@wafi-energy.com/);
    assert.match(csv, /yes/);
  });

  it('chase payload fills the next pay month', () => {
    const payload = buildChasePayload({
      action: 'remind_approver',
      employeeIds: ['ASIL/SPL-404/21'],
      month: 8,
      year: 2026,
      audience: { filterClient: 'Wafi Energy' },
    });
    assert.equal(payload.payMonth, 9);
    assert.equal(payload.payYear, 2026);
    assert.equal(payload.client, 'Wafi Energy');
    assert.equal(payload.action, 'remind_approver');
  });

  it('confirm text names filler and approver inboxes', () => {
    const text = confirmSendMessage({
      target: 'both',
      month: 8,
      year: 2026,
      employees: [{
        id: 'ASIL/SPL-404/21',
        name: 'Muhammad Usman',
        fillerEmail: 'm.usman-contractor@wafi-energy.com',
      }],
      approverPlan: {
        send: [{ name: 'Muhammad Usman', lm: 'muhammad.rauf@wafi-energy.com' }],
        targets: [{ email: 'muhammad.rauf@wafi-energy.com' }],
        skipped: [{ name: 'Ali', reason: 'not_waiting_approver' }],
      },
    });
    assert.match(text, /Aug 2026/);
    assert.match(text, /m.usman-contractor@wafi-energy.com/);
    assert.match(text, /muhammad.rauf@wafi-energy.com/);
    assert.match(text, /ops-support@asil.com.pk/);
    assert.match(text, /Not waiting on the Line Manager/);
    assert.equal(skipReasonLabel('already_finished'), 'Already approved or closed.');
  });
});
