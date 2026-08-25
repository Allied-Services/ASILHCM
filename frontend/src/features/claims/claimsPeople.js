'use strict';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function personLabelFromEmail(email) {
  const raw = String(email || '').trim();
  if (!raw) return '';
  const local = raw.split('@')[0] || '';
  const words = local
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  return words.join(' ') || raw;
}

export function formatPktDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function samePerson(a, b) {
  const left = normalizeEmail(a);
  const right = normalizeEmail(b);
  return Boolean(left && right && left === right);
}

function isSelfFinal(profile) {
  return profile === 'lm_only' || profile === 'focal_only';
}

/**
 * Plain-English who-entered / who-approved story for a portal claim.
 * Does not change routing or lock state — display only.
 */
export function buildClaimPeopleStory(sub = {}) {
  const forWhom = String(sub.employee_name || '').trim() || 'this employee';
  const enteredEmail = sub.filler_email || '';
  const approvedEmail = sub.approved_snapshot?.by || sub.approver_email || '';
  const enteredBy = personLabelFromEmail(enteredEmail);
  const approvedBy = personLabelFromEmail(approvedEmail);
  const enteredAt = formatPktDateTime(sub.submitted_at);
  const approvedAt = formatPktDateTime(sub.approved_at);
  const selfFinal = isSelfFinal(sub.routing_profile);
  const same = samePerson(enteredEmail, approvedEmail);
  const status = String(sub.status || '');

  const lines = [{ label: 'Claim is for', value: forWhom }];

  if (enteredBy && enteredAt) {
    lines.push({ label: 'Entered by', value: `${enteredBy} · ${enteredAt}` });
  } else if (enteredBy) {
    lines.push({ label: 'Entered by', value: enteredBy });
  } else {
    lines.push({ label: 'Entered by', value: 'Not submitted yet' });
  }

  if (status === 'approved' || status === 'in_payroll') {
    if (same && selfFinal) {
      lines.push({
        label: 'Approved by',
        value: approvedAt
          ? `same person — submit is final · ${approvedAt}`
          : 'same person — submit is final',
      });
    } else if (approvedBy && approvedAt) {
      lines.push({ label: 'Approved by', value: `${approvedBy} · ${approvedAt}` });
    } else if (approvedBy) {
      lines.push({ label: 'Approved by', value: approvedBy });
    }
  } else if (status === 'submitted') {
    if (selfFinal || same) {
      lines.push({ label: 'Approval', value: 'same person — submit is final' });
    } else if (approvedBy) {
      lines.push({ label: 'Waiting approval from', value: approvedBy });
    } else {
      lines.push({ label: 'Waiting approval from', value: 'Line Manager' });
    }
  } else if (selfFinal && enteredBy) {
    lines.push({ label: 'Approval', value: 'same person — submit is final' });
  } else if (approvedBy) {
    lines.push({ label: 'Will be approved by', value: approvedBy });
  }

  let headline;
  if ((status === 'approved' || status === 'in_payroll') && same && enteredBy) {
    headline = `${enteredBy} entered and approved this claim (same person — submit is final).`;
  } else if (status === 'approved' || status === 'in_payroll') {
    headline = approvedBy
      ? `${enteredBy || 'Someone'} entered this claim. ${approvedBy} approved it.`
      : 'This claim is approved.';
  } else if (status === 'submitted' && !selfFinal && approvedBy) {
    headline = `${enteredBy || 'Someone'} entered this claim. Waiting for ${approvedBy} to approve.`;
  } else if (selfFinal && enteredBy) {
    headline = `${enteredBy} enters this claim. Submit is final.`;
  } else {
    headline = enteredBy ? `${enteredBy} is entering this claim.` : `Claim for ${forWhom}.`;
  }

  return {
    forWhom,
    enteredBy,
    enteredEmail,
    enteredAt,
    approvedBy,
    approvedEmail,
    approvedAt,
    samePerson: same,
    selfFinal,
    headline,
    lines,
  };
}
