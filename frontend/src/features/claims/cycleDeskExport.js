const BOARD_HEADERS = [
  'Name',
  'ASIL Code',
  'Client',
  'Contract',
  'Location',
  'Filler role',
  'Email goes to',
  'Approver',
  'Status',
  'Last activity',
  'Next action',
  'OT 2x',
  'OT 3x',
  'Expense',
  'Medical',
  'No Claims',
];

const MONTHS = [
  [1, 'Jan'], [2, 'Feb'], [3, 'Mar'], [4, 'Apr'], [5, 'May'], [6, 'Jun'],
  [7, 'Jul'], [8, 'Aug'], [9, 'Sep'], [10, 'Oct'], [11, 'Nov'], [12, 'Dec'],
];

export function followingMonth(month, year) {
  const m = Number(month);
  const y = Number(year);
  if (!m || !y) return { month: null, year: null };
  return m === 12 ? { month: 1, year: y + 1 } : { month: m + 1, year: y };
}

export function monthLabel(month) {
  return MONTHS.find(([n]) => n === Number(month))?.[1] || String(month);
}

export function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function isNoClaimsRow(p = {}) {
  const status = p.control_status || p.controlStatus || '';
  return [
    'no_claims_confirmed',
    'no_claims_auto_closed',
    'no_claims_unverified',
    'no_claims',
  ].includes(status) || !!p.noClaims || p.no_claims_kind === 'confirmed';
}

export function reviewStageOf(p = {}) {
  if (p.locked) return 'locked';
  const status = p.controlStatus || p.control_status || '';
  if (isNoClaimsRow(p)) return 'no_claims';
  if (status === 'waiting_lm' || status === 'final_lm_review') return 'waiting_lm';
  if (['waiting_focal', 'waiting_employee', 'waiting_lm_fill'].includes(status)) return 'waiting_fill';
  if (status === 'not_invited' || status === 'invite_sent') return 'not_started';
  if (status === 'ready_for_payroll' || status === 'needs_review') return 'ready';
  const items = p.items || [];
  if (items.some((i) => i.status === 'pushed') || status === 'sent_to_payroll') return 'pushed';
  if (items.some((i) => i.status === 'approved')) return 'approved';
  if (items.some((i) => i.status === 'submitted')) return 'submitted';
  return status || 'unknown';
}

export function mergeReviewPeople(boardPeople = [], ledgerPeople = []) {
  const byId = new Map();
  for (const p of boardPeople) {
    if (!p?.employee_id && !p?.employeeId) continue;
    const id = p.employee_id || p.employeeId;
    byId.set(id, {
      employeeId: id,
      name: p.name,
      client: p.client,
      contractId: p.contract_id || p.contractId,
      contractName: p.contract_name || p.contractName,
      location: p.location,
      mailedTo: p.mailed_to || p.mailedTo,
      approver: p.lm || p.approver_email || p.approver,
      fillerRole: p.filler_role || p.fillerRole,
      controlStatus: p.control_status || p.controlStatus,
      controlLabel: p.control_label || p.controlLabel,
      lastActivity: p.last_activity_label || p.lastActivity,
      next: p.now_label || p.next,
      portal: p.portal || {},
      noClaims: isNoClaimsRow(p),
      items: [],
      locked: false,
      bankReady: null,
      bankLabels: [],
      sheetPaidDays: null,
    });
  }
  for (const l of ledgerPeople) {
    const id = l.employeeId || l.employee_id;
    if (!id) continue;
    const existing = byId.get(id) || {
      employeeId: id,
      name: l.name,
      client: l.client,
      contractId: l.contractId,
      contractName: l.contractName,
      location: l.location,
      mailedTo: '',
      approver: '',
      fillerRole: '',
      controlStatus: '',
      controlLabel: '',
      lastActivity: '',
      next: '',
      portal: {},
      noClaims: false,
      items: [],
      locked: false,
      bankReady: null,
      bankLabels: [],
      sheetPaidDays: null,
    };
    existing.items = l.items || [];
    existing.locked = !!l.locked;
    existing.bankReady = l.bankReady;
    existing.bankLabels = l.bankLabels || [];
    existing.sheetPaidDays = l.sheetPaidDays;
    existing.name = existing.name || l.name;
    existing.client = existing.client || l.client;
    existing.location = existing.location || l.location;
    existing.contractId = existing.contractId || l.contractId;
    byId.set(id, existing);
  }
  return [...byId.values()].sort((a, b) => String(a.name || a.employeeId).localeCompare(String(b.name || b.employeeId)));
}

function numOrBlank(n) {
  const v = Number(n);
  return v ? v : '';
}

export function boardDownloadRows(people = []) {
  return people.map((p) => {
    const portal = p.portal || {};
    const noClaims = isNoClaimsRow(p) || p.noClaims;
    return {
      name: p.name || '',
      employee_id: p.employee_id || p.employeeId || '',
      client: p.client || '',
      contract: p.contract_name || p.contractName || p.contract_id || p.contractId || '',
      location: p.location || '',
      filler_role: p.filler_role || p.fillerRole || '',
      email_goes_to: p.mailed_to || p.mailedTo || '',
      approver: p.lm || p.approver_email || p.approver || '',
      status: p.control_label || p.controlLabel || p.control_status || p.controlStatus || reviewStageOf(p),
      last_activity: p.last_activity_label || p.lastActivity || '',
      next: p.now_label || p.next || '',
      ot2: numOrBlank(portal.ot2Write || portal.ot2),
      ot3: numOrBlank(portal.ot3),
      expense: numOrBlank(portal.expense),
      medical: numOrBlank(portal.medical),
      no_claims: noClaims ? 'yes' : 'no',
    };
  });
}

export function rowsToCsv(rows = []) {
  const lines = [BOARD_HEADERS.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push([
      r.name, r.employee_id, r.client, r.contract, r.location,
      r.filler_role, r.email_goes_to, r.approver, r.status,
      r.last_activity, r.next, r.ot2, r.ot3, r.expense, r.medical, r.no_claims,
    ].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function skipReasonLabel(reason) {
  if (reason === 'not_waiting_approver') {
    return 'Not waiting on the Line Manager — they have not submitted a claim yet, or approval is already done.';
  }
  if (reason === 'already_finished') return 'Already approved or closed.';
  if (reason === 'no_period') return 'No claim period on file yet.';
  if (reason === 'not_waiting_filler') return 'Not waiting on the filler.';
  if (reason === 'no_invite_batch') return 'No invite has been sent yet.';
  if (reason === 'already_invited') return 'Already invited.';
  return reason || 'Cannot send.';
}

export function buildChasePayload({
  action,
  employeeIds,
  month,
  year,
  campaignMode = 'actual',
  preview = false,
  audience = {},
}) {
  const pay = followingMonth(month, year);
  return {
    action,
    preview: !!preview,
    campaignMode,
    workMonth: month,
    workYear: year,
    payMonth: pay.month,
    payYear: pay.year,
    client: audience.filterClient || audience.client || '',
    contract: audience.filterContract || audience.contract || '',
    location: audience.filterLoc || audience.location || '',
    dept: audience.filterDept || audience.dept || '',
    employeeIds,
  };
}

export function confirmSendMessage({
  target,
  month,
  year,
  employees = [],
  approverPlan = null,
}) {
  const work = `${monthLabel(month)} ${year}`;
  const lines = [`Work month: ${work}`];
  if (target === 'filler' || target === 'both') {
    lines.push('', 'Resend to Email goes to:');
    for (const e of employees) {
      lines.push(`- ${e.name} (${e.id}) → ${e.fillerEmail || e.mailTo || '—'}`);
    }
  }
  if (target === 'approver' || target === 'both') {
    const send = approverPlan?.send || [];
    const skipped = approverPlan?.skipped || [];
    const targets = approverPlan?.targets || [];
    lines.push('', 'Resend to Approver:');
    if (!targets.length) lines.push('- Nobody is waiting on a Line Manager.');
    for (const t of targets) {
      const names = send
        .filter((p) => String(p.lm || '').toLowerCase() === String(t.email || '').toLowerCase())
        .map((p) => p.name)
        .join(', ');
      lines.push(`- ${t.email}${names ? ` — ${names}` : ''}`);
    }
    if (skipped.length) {
      lines.push('', 'Cannot send Approver:');
      for (const s of skipped) {
        lines.push(`- ${s.name || s.employee_id}: ${skipReasonLabel(s.reason)}`);
      }
    }
  }
  lines.push('', 'CC: ops-support@asil.com.pk');
  return lines.join('\n');
}
