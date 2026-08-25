'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { personLabelFromEmail, formatPktDateTime, buildClaimPeopleStory } from './claimsPeople.js';

describe('claimsPeople', () => {
  it('turns a Wafi mailbox into a readable name', () => {
    assert.equal(personLabelFromEmail('muhammad-ali.butt@wafi-energy.com'), 'Muhammad Ali Butt');
    assert.equal(personLabelFromEmail('S.Raza-Contractor@wafi-energy.com'), 'S Raza Contractor');
  });

  it('formats Pakistan wall-clock from UTC', () => {
    assert.equal(formatPktDateTime('2026-08-25T11:28:20.149Z'), '25 Aug 2026, 16:28');
  });

  it('makes it obvious Ali both entered and approved Jahanzeb (LM only)', () => {
    const story = buildClaimPeopleStory({
      employee_name: 'Syed Jahanzeb Raza',
      filler_email: 'muhammad-ali.butt@wafi-energy.com',
      approver_email: 'muhammad-ali.butt@wafi-energy.com',
      routing_profile: 'lm_only',
      status: 'approved',
      submitted_at: '2026-08-25T11:28:20.149Z',
      approved_at: '2026-08-25T11:38:11.880Z',
      approved_snapshot: { by: 'muhammad-ali.butt@wafi-energy.com' },
    });
    assert.match(story.headline, /Muhammad Ali Butt entered and approved/);
    assert.match(story.headline, /same person — submit is final/);
    assert.equal(story.forWhom, 'Syed Jahanzeb Raza');
    assert.equal(story.samePerson, true);
    assert.equal(story.lines[0].value, 'Syed Jahanzeb Raza');
    assert.match(story.lines[1].value, /Muhammad Ali Butt · 25 Aug 2026, 16:28/);
    assert.match(story.lines[2].value, /same person — submit is final · 25 Aug 2026, 16:38/);
  });

  it('keeps Focal and LM as two different people', () => {
    const story = buildClaimPeopleStory({
      employee_name: 'Example Guard',
      filler_email: 'focal.one@wafi-energy.com',
      approver_email: 'line.manager@wafi-energy.com',
      routing_profile: 'focal_then_lm',
      status: 'submitted',
      submitted_at: '2026-08-25T10:00:00.000Z',
    });
    assert.match(story.headline, /Focal One/);
    assert.match(story.headline, /Line Manager/);
    assert.equal(story.samePerson, false);
    assert.equal(story.lines.find((l) => l.label === 'Waiting approval from')?.value, 'Line Manager');
  });
});
