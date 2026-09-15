import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, X } from 'lucide-react';
import { api } from '../../api';
import ClaimRequestCampaign from './ClaimRequestCampaign';
import { isTemplateExampleCode, parseManualClaimsCsv } from './manualClaimsCsv';
import './PortalClaimsHub.css';

const SADIA_EMAIL = 'sadia.komal@asil.com.pk';

const CLAIM_PROCESS_ROWS = [
  {
    situation: 'No Focal, no LM + official @wafi-energy.com or @asil.com.pk email',
    filler: 'Employee',
    approver: 'No separate step — employee submit is final',
  },
  {
    situation: 'Focal + LM on roster',
    filler: 'Focal',
    approver: 'Line Manager (LM)',
  },
  {
    situation: 'No Focal, has LM',
    filler: 'LM',
    approver: 'No separate step — LM is final',
  },
  {
    situation: 'Focal only (no LM)',
    filler: 'Focal',
    approver: 'No separate step — Focal is final',
  },
  {
    situation: 'No Focal, no LM + personal email (e.g. Gmail)',
    filler: `Sadia (${SADIA_EMAIL})`,
    approver: 'No separate step — Sadia fills and it is approved',
  },
];

const MONTHS = [
  [1, 'Jan'], [2, 'Feb'], [3, 'Mar'], [4, 'Apr'], [5, 'May'], [6, 'Jun'],
  [7, 'Jul'], [8, 'Aug'], [9, 'Sep'], [10, 'Oct'], [11, 'Nov'], [12, 'Dec'],
];

const CONTROL_LABEL = {
  waiting_focal: 'Waiting for Focal',
  waiting_employee: 'Waiting for Employee',
  waiting_lm: 'Waiting for LM',
  waiting_lm_fill: 'Waiting LM to add claims',
  final_lm_review: 'Final LM review',
  ready_for_payroll: 'Ready for Payroll',
  sent_to_payroll: 'Sent to Payroll',
  no_claims_confirmed: 'No Claims — Confirmed',
  no_claims_auto_closed: 'No Claims — Auto-closed (no response)',
  no_claims_unverified: 'No Claims — Closed (source unknown)',
  rejected_closed: 'Rejected — Closed',
  needs_review: 'Needs Review — payroll already has different values',
  not_invited: 'Not invited',
  invite_sent: 'Invite sent',
};

const FILLER_LABEL = {
  employee: 'Employee',
  focal: 'Focal',
  lm: 'LM',
};

function rosterEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || s === 'self' || s === 'n/a' || s === 'na' || s === 'none' || !s.includes('@')) return '';
  return s;
}

function personLabel(email, name) {
  const e = String(email || '').trim();
  const n = String(name || '').trim();
  if (n && e) return `${n} (${e})`;
  return n || e;
}

function uniquePeople(rows, emailOf, nameOf) {
  const map = new Map();
  for (const r of rows || []) {
    const email = rosterEmail(emailOf(r));
    if (!email) continue;
    const name = String(nameOf ? nameOf(r) : '').trim();
    const prev = map.get(email);
    if (!prev) map.set(email, { email, name });
    else if (!prev.name && name) prev.name = name;
  }
  return [...map.values()].sort((a, b) => {
    const la = (a.name || a.email).toLowerCase();
    const lb = (b.name || b.email).toLowerCase();
    return la.localeCompare(lb);
  });
}

const PENDING_CONTROLS = new Set([
  'not_invited', 'invite_sent', 'waiting_focal', 'waiting_employee', 'waiting_lm_fill',
  'waiting_lm', 'final_lm_review', 'ready_for_payroll', 'needs_review',
]);
const DONE_CONTROLS = new Set([
  'sent_to_payroll', 'no_claims_confirmed', 'no_claims_auto_closed', 'no_claims_unverified', 'rejected_closed',
]);


const MAILER_LABEL = {
  sent: 'Sent',
  send_failed: 'Send failed',
  not_sent: 'Not sent yet',
};

function formatWhen(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 16);
  return d.toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function defaultPeriod() {
  const n = new Date();
  const payMonth = n.getMonth() + 1;
  const payYear = n.getFullYear();
  const work = new Date(payYear, payMonth - 2, 1);
  return {
    workMonth: work.getMonth() + 1,
    workYear: work.getFullYear(),
    payMonth,
    payYear,
  };
}

function followingMonth(month, year) {
  const d = new Date(year, month, 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

function money(n) {
  const v = Number(n) || 0;
  return v ? v.toLocaleString('en-PK') : '—';
}

function hours(n) {
  const v = Number(n) || 0;
  if (!v) return '—';
  return (Math.round(v * 100) / 100).toFixed(2);
}

function rowClass(controlStatus, open) {
  const bits = [];
  if (controlStatus === 'sent_to_payroll' || controlStatus === 'no_claims_confirmed') bits.push('is-ok');
  if (controlStatus === 'needs_review' || controlStatus === 'rejected_closed' || controlStatus === 'no_claims_auto_closed') bits.push('is-bad');
  if (controlStatus === 'ready_for_payroll' || controlStatus === 'final_lm_review' || controlStatus === 'waiting_lm' || controlStatus === 'waiting_lm_fill') bits.push('is-warn');
  if (open) bits.push('is-open');
  return bits.join(' ');
}

function sameEmail(a, b) {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  return !!(left && right && left.includes('@') && left === right);
}

function fillerRoleOf(p) {
  const profile = String(p.routing_profile || '').toLowerCase();
  if (p.filler_role === 'employee' || profile.startsWith('employee')) return 'employee';
  if (sameEmail(p.email, p.mailed_to || p.filler_email)) return 'employee';
  if (p.filler_role) return p.filler_role;
  if (profile === 'lm_only') return 'lm';
  return 'focal';
}

function isPendingRow(p) {
  if (p.action_view === 'waiting' || p.action_view === 'needs_action') return true;
  return PENDING_CONTROLS.has(p.control_status);
}

function isDoneRow(p) {
  if (p.action_view === 'closed') return true;
  return DONE_CONTROLS.has(p.control_status);
}

function bucketOf(filter) {
  if (filter === 'payroll_desk') return 'payroll_desk';
  if (['pending', 'waiting', 'needs_action', 'not_started', 'pending_fill', 'pending_lm', 'pending_ops'].includes(filter)) return 'pending';
  if (['done', 'closed', 'done_no_claims', 'done_approved', 'done_rejected', 'no_claims_confirmed', 'no_claims_auto_closed', 'claims_approved'].includes(filter)) return 'done';
  return 'all';
}

/** Focal/employee filled and submitted — waiting LM or ASIL approval. */
function isSubmittedByFocal(p) {
  if (p.submission_status === 'submitted') return true;
  return p.control_status === 'waiting_lm' || p.control_status === 'final_lm_review';
}

/** Filler explicitly tapped Confirm No Claims in the portal. */
function isNoClaimsConfirmed(p) {
  return p.control_status === 'no_claims_confirmed'
    || (p.submission_status === 'no_claims' && p.no_claims_kind === 'confirmed');
}

/** LM (or final filler) approved — ready for payroll push or already on sheet. */
function isClaimsApproved(p) {
  if (['approved', 'in_payroll'].includes(p.submission_status)) return true;
  return ['ready_for_payroll', 'sent_to_payroll'].includes(p.control_status);
}

function hasPayrollDeskRow(p) {
  if (isClaimsApproved(p)) return true;
  const sheet = p.sheet || {};
  const portal = p.portal || {};
  return [sheet.ot2, sheet.ot3, sheet.medical, sheet.expense, sheet.reimb,
    portal.ot2, portal.ot3, portal.expense, portal.medical]
    .some((n) => Number(n) > 0);
}

export default function PortalClaimsHub({
  user,
  lockSection = null,
  initialFilter = null,
  hideSectionNav = false,
  onOpenManual = null,
  manualSeed = null,
  onManualSeedConsumed = null,
  initialWorkMonth = null,
  initialWorkYear = null,
  initialPayMonth = null,
  initialPayYear = null,
}) {
  const start = defaultPeriod();
  const [workMonth, setWorkMonth] = useState(initialWorkMonth || start.workMonth);
  const [workYear, setWorkYear] = useState(initialWorkYear || start.workYear);
  const [payMonth, setPayMonth] = useState(initialPayMonth || start.payMonth);
  const [payYear, setPayYear] = useState(initialPayYear || start.payYear);
  const [client, setClient] = useState('');
  const [contract, setContract] = useState('');
  const [location, setLocation] = useState('');
  const [focal, setFocal] = useState('');
  const [lm, setLm] = useState('');
  const defaultSection = lockSection || (new URLSearchParams(window.location.search).get('setup_needed') === '1' ? 'request' : 'response');
  const [section, setSection] = useState(defaultSection);
  const [filter, setFilter] = useState(initialFilter || 'all');
  const [who, setWho] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [pushPreview, setPushPreview] = useState(null);
  const [board, setBoard] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [rules, setRules] = useState([]);
  const [ov, setOv] = useState({
    employeeId: '', month: start.payMonth, year: start.payYear,
    ot1Hours: 0, ot2Hours: 0, ot3Hours: 0, expenseAmount: 0, medicalAmount: 0,
    arrearsAmount: 0, deductionAmount: 0, specialAllowanceAmount: 0,
    mode: 'add', reason: '', resubmitToLm: true,
  });
  const [ovPreview, setOvPreview] = useState(null);
  const [csvPreview, setCsvPreview] = useState(null);
  const [rulePreview, setRulePreview] = useState(null);
  const [editingRule, setEditingRule] = useState(null);
  const [showClaimProcess, setShowClaimProcess] = useState(false);
  const [filterRows, setFilterRows] = useState([]);
  const [filtersReady, setFiltersReady] = useState(false);
  const [boardLoading, setBoardLoading] = useState(true);

  useEffect(() => {
    if (lockSection) setSection(lockSection);
  }, [lockSection]);

  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    if (!manualSeed) return;
    setOv(o => ({ ...o, ...manualSeed, resubmitToLm: manualSeed.resubmitToLm !== false }));
    setOvPreview(null);
    if (onManualSeedConsumed) onManualSeedConsumed();
  }, [manualSeed, onManualSeedConsumed]);

  const activeSection = lockSection || section;
  const isSuper = user?.role === 'superadmin';

  useEffect(() => {
    if (!showClaimProcess && !openId) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showClaimProcess) setShowClaimProcess(false);
      else setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showClaimProcess, openId]);

  useEffect(() => {
    if (!openId) return undefined;
    const main = document.querySelector('.main-content');
    const prevBody = document.body.style.overflow;
    const prevMain = main ? main.style.overflow : '';
    document.body.style.overflow = 'hidden';
    if (main) main.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      if (main) main.style.overflow = prevMain;
    };
  }, [openId]);

  const setWork = (m, y) => {
    setWorkMonth(m);
    setWorkYear(y);
    const next = followingMonth(m, y);
    setPayMonth(next.month);
    setPayYear(next.year);
  };

  const loadBoard = useCallback(async () => {
    if (!filtersReady) return;
    setErr('');
    setBoardLoading(true);
    try {
      const q = {
        workMonth: String(workMonth),
        workYear: String(workYear),
        payMonth: String(payMonth),
        payYear: String(payYear),
      };
      if (client) q.client = client;
      if (contract) q.contract = contract;
      if (location) q.location = location;
      if (focal) q.focal = focal;
      if (lm) q.lm = lm;
      const d = await api.portalClaimsResponse(q);
      setBoard(d);
      setSelected(new Set());
    } catch (e) {
      setErr(e.message);
    } finally {
      setBoardLoading(false);
    }
  }, [filtersReady, workMonth, workYear, payMonth, payYear, client, contract, location, focal, lm]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  useEffect(() => {
    let cancelled = false;
    api.portalClaimsFilters()
      .then((d) => {
        if (cancelled) return;
        const rows = d.rows || [];
        setFilterRows(rows);
        setClient((prev) => {
          if (prev) return prev;
          const wafi = [...new Set(rows.map((r) => r.client).filter(Boolean))]
            .find((c) => /wafi/i.test(c));
          return wafi || prev;
        });
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setFiltersReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    api.portalClaimsEligibilityRules().then(d => setRules(d.rules || [])).catch(() => {});
  }, []);

  const clients = useMemo(() => {
    return [...new Set((filterRows || []).map((p) => p.client).filter(Boolean))].sort();
  }, [filterRows]);
  const contracts = useMemo(() => {
    const map = new Map();
    const rows = (filterRows || []).filter((p) => !client || p.client === client);
    for (const p of rows) {
      if (p.contract_id) map.set(p.contract_id, p.contract_name || p.contract_id);
    }
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [filterRows, client]);
  const locations = useMemo(() => {
    const set = new Set((filterRows || [])
      .filter((p) => !client || p.client === client)
      .filter((p) => !contract || p.contract_id === contract)
      .map((p) => p.location)
      .filter(Boolean));
    return [...set].sort();
  }, [filterRows, client, contract]);
  const orgRows = useMemo(() => {
    return (filterRows || []).filter((p) => {
      if (client && p.client !== client) return false;
      if (contract && p.contract_id !== contract) return false;
      if (location && p.location !== location) return false;
      return true;
    });
  }, [filterRows, client, contract, location]);
  const focals = useMemo(() => {
    const rows = lm
      ? orgRows.filter((p) => rosterEmail(p.line_manager_email) === lm)
      : orgRows;
    return uniquePeople(rows, (p) => p.focal_email || p.claim_authority);
  }, [orgRows, lm]);
  const lms = useMemo(() => {
    const rows = focal
      ? orgRows.filter((p) => rosterEmail(p.focal_email || p.claim_authority) === focal)
      : orgRows;
    return uniquePeople(rows, (p) => p.line_manager_email, (p) => p.line_manager_name);
  }, [orgRows, focal]);
  const focalLabel = useMemo(() => (focals.find((p) => p.email === focal) || { email: focal }).email, [focals, focal]);
  const lmLabel = useMemo(() => {
    const hit = lms.find((p) => p.email === lm);
    return hit ? personLabel(hit.email, hit.name) : lm;
  }, [lms, lm]);

  useEffect(() => {
    if (focal && !focals.some((p) => p.email === focal)) setFocal('');
  }, [focals, focal]);
  useEffect(() => {
    if (lm && !lms.some((p) => p.email === lm)) setLm('');
  }, [lms, lm]);

  // eslint-disable-next-line no-unused-vars
  const counts = board?.counts || {};
  const controlCounts = board?.control_counts || {};
  const allPeople = board?.people || [];
  const pipelineCounts = useMemo(() => {
    const rows = allPeople;
    return {
      pending: rows.filter(isPendingRow).length,
      done: rows.filter(isDoneRow).length,
      not_started: rows.filter((p) => p.control_status === 'not_invited' || p.control_status === 'invite_sent').length,
      pending_fill: rows.filter((p) => ['waiting_focal', 'waiting_employee', 'waiting_lm_fill'].includes(p.control_status)).length,
      pending_lm: rows.filter((p) => p.control_status === 'waiting_lm' || p.control_status === 'final_lm_review').length,
      pending_ops: rows.filter((p) => p.control_status === 'ready_for_payroll' || p.control_status === 'needs_review').length,
      done_no_claims: rows.filter(isNoClaimsConfirmed).length,
      done_auto_closed: rows.filter((p) => p.control_status === 'no_claims_auto_closed').length,
      done_approved: rows.filter((p) => p.control_status === 'sent_to_payroll').length,
      done_rejected: rows.filter((p) => p.control_status === 'rejected_closed').length,
    };
  }, [board]);
  const people = allPeople.filter((p) => {
    if (filter === 'all') {
      // keep
    } else if (filter === 'pending') {
      if (!isPendingRow(p)) return false;
    } else if (filter === 'done') {
      if (!isDoneRow(p)) return false;
    } else if (filter === 'not_started') {
      if (p.control_status !== 'not_invited' && p.control_status !== 'invite_sent') return false;
    } else if (filter === 'pending_fill') {
      if (!['waiting_focal', 'waiting_employee', 'waiting_lm_fill'].includes(p.control_status)) return false;
    } else if (filter === 'pending_lm') {
      if (p.control_status !== 'waiting_lm' && p.control_status !== 'final_lm_review') return false;
    } else if (filter === 'pending_ops') {
      if (p.control_status !== 'ready_for_payroll' && p.control_status !== 'needs_review') return false;
    } else if (filter === 'done_no_claims' || filter === 'no_claims_confirmed') {
      if (!isNoClaimsConfirmed(p)) return false;
    } else if (filter === 'done_approved' || filter === 'claims_approved') {
      if (p.control_status !== 'sent_to_payroll') return false;
    } else if (filter === 'done_rejected') {
      if (p.control_status !== 'rejected_closed') return false;
    } else if (filter === 'no_claims_auto_closed') {
      if (p.control_status !== 'no_claims_auto_closed') return false;
    } else if (filter === 'needs_action' || filter === 'waiting' || filter === 'closed') {
      if (p.action_view !== filter) return false;
    } else if (filter === 'submitted_by_focal') {
      if (!isSubmittedByFocal(p)) return false;
    } else if (filter === 'payroll_desk') {
      if (!hasPayrollDeskRow(p)) return false;
    } else if (p.control_status !== filter) {
      return false;
    }
    if (who !== 'all' && fillerRoleOf(p) !== who) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = `${p.name || ''} ${p.employee_id || ''} ${p.location || ''} ${p.email || ''} ${p.mailed_to || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const open = allPeople.find(p => p.employee_id === openId) || null;
  const visibleIds = people.map(p => p.employee_id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const pushIds = useMemo(() => (
    [...selected].filter((id) => {
      const p = (board?.people || []).find((x) => x.employee_id === id);
      return p?.can_push_payroll;
    })
  ), [selected, board]);
  const pushTotals = useMemo(() => {
    let ot2 = 0;
    let ot3 = 0;
    let exp = 0;
    let med = 0;
    for (const id of pushIds) {
      const p = (board?.people || []).find((x) => x.employee_id === id);
      if (!p) continue;
      ot2 += Number(p.portal?.ot2Write || 0);
      ot3 += Number(p.portal?.ot3 || 0);
      exp += Number(p.portal?.expense || 0);
      med += Number(p.portal?.medical || 0);
    }
    return { ot2, ot3, exp, med, count: pushIds.length };
  }, [pushIds, board]);

  const payrollDeskCount = allPeople.filter(hasPayrollDeskRow).length;
  const activeBucket = bucketOf(filter);
  const whoCounts = useMemo(() => {
    const inBucket = allPeople.filter((p) => {
      if (activeBucket === 'pending') return isPendingRow(p);
      if (activeBucket === 'done') return isDoneRow(p);
      return true;
    });
    return {
      all: inBucket.length,
      focal: inBucket.filter((p) => fillerRoleOf(p) === 'focal').length,
      lm: inBucket.filter((p) => fillerRoleOf(p) === 'lm').length,
      employee: inBucket.filter((p) => fillerRoleOf(p) === 'employee').length,
    };
  }, [allPeople, activeBucket]);


  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };

  const fillManualFrom = (p) => {
    if (!p) return;
    const seed = {
      employeeId: p.employee_id,
      ot1Hours: p.portal?.ot1 || 0,
      ot2Hours: p.portal?.ot2 || 0,
      ot3Hours: p.portal?.ot3 || 0,
      expenseAmount: p.portal?.expense || 0,
      medicalAmount: p.portal?.medical || 0,
      arrearsAmount: p.portal?.arrears || 0,
      deductionAmount: p.portal?.deduction || 0,
      specialAllowanceAmount: p.portal?.specialAllowance || 0,
      mode: 'add',
      resubmitToLm: true,
    };
    if (onOpenManual) {
      onOpenManual(seed);
      return;
    }
    setOv(o => ({ ...o, ...seed }));
    setSection('manual');
  };

  const runCsvImport = async (commit) => {
    if (!csvPreview?.rows?.length) {
      const reason = csvPreview?.parseError || 'Load a CSV file with a Code column and at least one data row first.';
      setErr(reason);
      setCsvPreview((prev) => ({ ...(prev || {}), localError: reason }));
      return;
    }
    if (commit && !window.confirm(
      `Overwrite portal claims for ${csvPreview.rows.length} employee(s) for work month ${workMonth}/${workYear}?\n\n`
      + `This replaces existing ${MONTHS[workMonth - 1]?.[1] || workMonth} claim values. `
      + `${MONTHS[workMonth - 1]?.[1] || workMonth} salary (already paid) is not changed. `
      + `Amounts are payable with ${MONTHS[payMonth - 1]?.[1] || payMonth} salary. `
      + `Send to LM = N replaces portal values only and sends no Focal or LM email.`
    )) return;
    setBusy(true); setErr(''); setMsg('');
    setCsvPreview((prev) => ({ ...prev, localError: '', result: null }));
    try {
      const d = await api.portalClaimsManualImport({
        rows: csvPreview.rows.map((row) => ({
          ...row,
          workMonth: row['Work Month'] || workMonth,
          workYear: row['Work Year'] || workYear,
        })),
        workMonth,
        workYear,
        dryRun: !commit,
      });
      const rows = d.results || [];
      const fails = rows.filter((r) => !r.ok);
      const failNote = fails.length
        ? fails.map((r) => `${r.employeeId || 'Row'}: ${r.error || 'Failed'}`).join(' · ')
        : '';
      setCsvPreview((prev) => ({ ...prev, result: d, localError: failNote }));
      const ok = d.summary?.ready ?? rows.filter(r => r.ok).length;
      const bad = d.summary?.failed ?? rows.filter(r => !r.ok).length;
      const note = commit
        ? `CSV import: ${ok} applied${bad ? ` · ${bad} failed` : ''}.`
        : `CSV dry-run: ${ok} ready${bad ? ` · ${bad} blocked` : ''}.`;
      setMsg(note);
      if (bad) setErr(failNote || `${bad} row(s) failed — see the list under Commit CSV.`);
      if (commit) await loadBoard();
    } catch (e) {
      setErr(e.message);
      setCsvPreview((prev) => ({ ...prev, localError: e.message }));
    } finally {
      setBusy(false);
    }
  };

  const runPushPayroll = async (dryRun) => {
    if (!pushIds.length) {
      setErr('Tick at least one Ready for Payroll row.');
      return;
    }
    if (!dryRun && !window.confirm(`Push ${pushIds.length} approved claim(s) to the ${payMonth}/${payYear} Payroll Sheet?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.portalClaimsPushPayroll({
        employeeIds: pushIds,
        workMonth,
        workYear,
        dryRun,
      });
      setPushPreview(d);
      if (dryRun) {
        setMsg(`Preview: ${d.summary?.ready || 0} ready · ${d.summary?.needs_review || 0} needs review · ${d.summary?.not_ready || 0} not ready.`);
      } else {
        setMsg(`Payroll push: ${d.summary?.sent || 0} sent · ${d.summary?.already_sent || 0} already sent · ${d.summary?.needs_review || 0} blocked.`);
        await loadBoard();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runAugustReopen = async (dryRun) => {
    if (!dryRun && !window.confirm('Reopen all LM-rejected July-work claims once and email each Line Manager? This cannot be undone without superadmin force.')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.portalClaimsReopenAugustRejected({ workMonth, workYear, dryRun });
      if (d.skipped) {
        setMsg(`August reopen already ran on ${formatWhen(d.ran_at)} — use superadmin force to repeat.`);
      } else if (dryRun) {
        setMsg(`Preview: would reopen ${d.wouldReopen || 0} claim(s) · ${(d.approverEmails || []).length} LM email(s).`);
      } else {
        setMsg(`Reopened ${d.reopened || 0} claim(s) · emailed ${(d.emailsSent || []).length} Line Manager(s).`);
        await loadBoard();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runOverride = async (commit) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const payload = {
        ...ov,
        workMonth,
        workYear,
        month: ov.resubmitToLm ? workMonth : payMonth,
        year: ov.resubmitToLm ? workYear : payYear,
        dryRun: !commit,
      };
      const d = await api.portalClaimsManualOverride(payload);
      setOvPreview(d);
      if (d.warning) setMsg(d.warning);
      if (d.message) setMsg(d.message);
      if (commit) {
        setMsg(d.message || (ov.resubmitToLm ? 'Correction sent for LM re-approval.' : 'Override applied.'));
        await loadBoard();
      } else {
        setMsg(d.message || d.warning || 'Dry-run preview ready — review before Commit.');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const exportTieout = async () => {
    try {
      const d = await api.portalClaimsTieout(payMonth, payYear);
      const lines = [['Employee', 'Name', 'Client', 'Channel', 'OT1', 'OT2', 'OT3', 'Expense', 'Medical', 'Status']];
      for (const r of d.portal || []) {
        lines.push([r.employee_id, r.name, r.client, r.channel, r.ot1_hours, r.ot2_hours, r.ot3_hours, r.expense, r.medical, r.status]);
      }
      const csv = lines.map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claims_payroll_tieout_${payYear}_${payMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="pch">
      <div className="pch-header">
        <div className="pch-header-copy">
          <h2 className="pch-title">Portal Claims</h2>
          <p className="pch-sub">
            Work month is when OT / medical / expense happened. Paid on is the Payroll Sheet month.
            Response lists everyone in the audience — not only people who already submitted.
          </p>
        </div>
        <button
          type="button"
          className="pch-process-btn"
          onClick={() => setShowClaimProcess(true)}
        >
          <BookOpen size={16} aria-hidden />
          See Claim Process
        </button>
      </div>

      {showClaimProcess && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && setShowClaimProcess(false)}
        >
          <div
            className="modal-box pch-process-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pch-process-title"
          >
            <div className="pch-process-head">
              <div>
                <h3 id="pch-process-title">How Portal Claims routing works</h3>
                <p className="pch-process-lead">
                  August 2026 Wafi trial — who fills the form and who approves, based on roster data.
                </p>
              </div>
              <button
                type="button"
                className="pch-process-x"
                aria-label="Close"
                onClick={() => setShowClaimProcess(false)}
              >
                <X size={22} />
              </button>
            </div>
            <div className="pch-process-body">
              <p className="pch-process-note">
                <strong>Official email</strong> means the employee&apos;s roster email ends with{' '}
                <code>@wafi-energy.com</code> or <code>@asil.com.pk</code>. Personal Gmail/Yahoo does not count.
              </p>
              <div className="pch-table-wrap">
                <table className="pch-table pch-process-table">
                  <thead>
                    <tr>
                      <th>If the employee has…</th>
                      <th>Who fills</th>
                      <th>Who approves</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CLAIM_PROCESS_ROWS.map((row) => (
                      <tr key={row.situation}>
                        <td>{row.situation}</td>
                        <td>{row.filler}</td>
                        <td>{row.approver}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="pch-muted pch-process-foot">Last updated August 2026. Ask ops if roster focal/LM emails look wrong.</p>
            </div>
            <div className="pch-process-footbar">
              <button type="button" className="pch-process-close" onClick={() => setShowClaimProcess(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pch-period">
        <label>
          <span className="lbl">Work month</span>
          <select value={workMonth} onChange={e => setWork(+e.target.value, workYear)}>
            {MONTHS.map(([n, lab]) => <option key={n} value={n}>{lab}</option>)}
          </select>
          <input type="number" value={workYear} onChange={e => setWork(workMonth, +e.target.value)} />
          <span className="hint">OT / medical / expense happened here</span>
        </label>
        <label>
          <span className="lbl">Paid on Payroll Sheet</span>
          <select value={payMonth} onChange={e => setPayMonth(+e.target.value)}>
            {MONTHS.map(([n, lab]) => <option key={n} value={n}>{lab}</option>)}
          </select>
          <input type="number" value={payYear} onChange={e => setPayYear(+e.target.value)} />
          <span className="hint">Reimbursed the following month</span>
        </label>
        <label>
          <span className="lbl">Client</span>
          <select value={client} disabled={!filtersReady} onChange={e => { setClient(e.target.value); setContract(''); setLocation(''); setFocal(''); setLm(''); }}>
            <option value="">All clients</option>
            {clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="hint">{filtersReady ? 'Same audience as request emails' : 'Loading clients…'}</span>
        </label>
        <label>
          <span className="lbl">Contract</span>
          <select value={contract} onChange={e => setContract(e.target.value)}>
            <option value="">All contracts</option>
            {contracts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label>
          <span className="lbl">Location</span>
          <select value={location} onChange={e => setLocation(e.target.value)}>
            <option value="">All locations</option>
            {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
          </select>
        </label>
        <label>
          <span className="lbl">Focal</span>
          <select value={focal} disabled={!filtersReady} onChange={e => setFocal(e.target.value)}>
            <option value="">All focals</option>
            {focals.map((p) => (
              <option key={p.email} value={p.email}>{personLabel(p.email, p.name)}</option>
            ))}
          </select>
          <span className="hint">People on this Focal&apos;s roster</span>
        </label>
        <label>
          <span className="lbl">Line Manager</span>
          <select value={lm} disabled={!filtersReady} onChange={e => setLm(e.target.value)}>
            <option value="">All line managers</option>
            {lms.map((p) => (
              <option key={p.email} value={p.email}>{personLabel(p.email, p.name)}</option>
            ))}
          </select>
          <span className="hint">People who report to this LM</span>
        </label>
        <div>
          <span className="lbl">Audience</span>
          <strong>{boardLoading ? '…' : (board?.audience_count ?? '…')}</strong>
          <span className="hint">Submit by day 18 · LM by day 22</span>
        </div>
      </div>

      {!hideSectionNav && !lockSection && (
      <div className="pch-jobs">
        <button type="button" className={`pch-job${activeSection === 'response' ? ' is-on' : ''}`} onClick={() => setSection('response')}>Track &amp; send to payroll</button>
        <button type="button" className={`pch-job${activeSection === 'request' ? ' is-on' : ''}`} onClick={() => setSection('request')}>Send invites</button>
        <button type="button" className={`pch-job${activeSection === 'manual' ? ' is-on' : ''}`} onClick={() => setSection('manual')}>Manual correction</button>
      </div>
      )}

      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}

      {activeSection === 'response' && (
        <>
          <div className="pch-note is-info">
            {filter === 'payroll_desk'
              ? `${MONTHS[workMonth - 1]?.[1] || workMonth} work claims that are approved or already on the ${MONTHS[payMonth - 1]?.[1] || payMonth} Payroll Sheet.`
              : (board?.period_label || 'Pending still needs a filler, LM, or payroll push. Done is No Claims, sent to payroll, or rejected.')}
          </div>
          <div className="pch-buckets" role="tablist" aria-label="Claim progress">
            <button type="button" className={`pch-bucket is-warn${activeBucket === 'pending' ? ' is-on' : ''}`} onClick={() => { setFilter('pending'); setWho('all'); }}>
              <strong>{boardLoading ? '…' : pipelineCounts.pending}</strong>
              <span>Pending</span>
              <em>Still waiting on fill, LM, or payroll</em>
            </button>
            <button type="button" className={`pch-bucket is-ok${activeBucket === 'done' ? ' is-on' : ''}`} onClick={() => { setFilter('done'); setWho('all'); }}>
              <strong>{boardLoading ? '…' : pipelineCounts.done}</strong>
              <span>Done</span>
              <em>No Claims, approved, or closed</em>
            </button>
            <button type="button" className={`pch-bucket${activeBucket === 'all' ? ' is-on' : ''}`} onClick={() => { setFilter('all'); setWho('all'); }}>
              <strong>{boardLoading ? '…' : (board?.audience_count || 0)}</strong>
              <span>All</span>
              <em>Everyone in this audience</em>
            </button>
          </div>
          <div className="pch-filter-bar">
            <div className="pch-chips">
              {activeBucket === 'pending' && (
                <>
                  <button type="button" className={`pch-chip${filter === 'pending' ? ' is-on' : ''}`} onClick={() => setFilter('pending')}>All pending {pipelineCounts.pending}</button>
                  <button type="button" className={`pch-chip${filter === 'not_started' ? ' is-on' : ''}`} onClick={() => setFilter('not_started')}>Not started {pipelineCounts.not_started}</button>
                  <button type="button" className={`pch-chip${filter === 'pending_fill' ? ' is-on' : ''}`} onClick={() => setFilter('pending_fill')}>Waiting fill {pipelineCounts.pending_fill}</button>
                  <button type="button" className={`pch-chip${filter === 'pending_lm' ? ' is-on' : ''}`} onClick={() => setFilter('pending_lm')}>Waiting LM {pipelineCounts.pending_lm}</button>
                  <button type="button" className={`pch-chip${filter === 'pending_ops' ? ' is-on' : ''}`} onClick={() => setFilter('pending_ops')}>Ready / review {pipelineCounts.pending_ops}</button>
                </>
              )}
              {activeBucket === 'done' && (
                <>
                  <button type="button" className={`pch-chip${filter === 'done' ? ' is-on' : ''}`} onClick={() => setFilter('done')}>All done {pipelineCounts.done}</button>
                  <button type="button" className={`pch-chip${filter === 'done_no_claims' ? ' is-on' : ''}`} onClick={() => setFilter('done_no_claims')}>No Claims confirmed {pipelineCounts.done_no_claims}</button>
                  {(pipelineCounts.done_auto_closed || 0) > 0 && (
                    <button type="button" className={`pch-chip${filter === 'no_claims_auto_closed' ? ' is-on' : ''}`} onClick={() => setFilter('no_claims_auto_closed')}>Auto-closed {pipelineCounts.done_auto_closed}</button>
                  )}
                  <button type="button" className={`pch-chip${filter === 'done_approved' ? ' is-on' : ''}`} onClick={() => setFilter('done_approved')}>Approved / on sheet {pipelineCounts.done_approved}</button>
                  {(pipelineCounts.done_rejected || 0) > 0 && (
                    <button type="button" className={`pch-chip${filter === 'done_rejected' ? ' is-on' : ''}`} onClick={() => setFilter('done_rejected')}>Rejected {pipelineCounts.done_rejected}</button>
                  )}
                </>
              )}
              {activeBucket === 'all' && (
                <>
                  <button type="button" className={`pch-chip${filter === 'all' ? ' is-on' : ''}`} onClick={() => setFilter('all')}>All {board?.audience_count || 0}</button>
                  <button type="button" className={`pch-chip${filter === 'done_no_claims' ? ' is-on' : ''}`} onClick={() => setFilter('done_no_claims')}>No Claims {pipelineCounts.done_no_claims}</button>
                  <button type="button" className={`pch-chip${filter === 'pending_lm' ? ' is-on' : ''}`} onClick={() => setFilter('pending_lm')}>Waiting LM {pipelineCounts.pending_lm}</button>
                  <button type="button" className={`pch-chip${filter === 'done_approved' ? ' is-on' : ''}`} onClick={() => setFilter('done_approved')}>Approved {pipelineCounts.done_approved}</button>
                </>
              )}
              {filter === 'payroll_desk' && (
                <button type="button" className="pch-chip is-on">Payroll desk {payrollDeskCount}</button>
              )}
              <button type="button" className="btn-secondary" onClick={loadBoard}>Refresh</button>
            </div>
            <div className="pch-who">
              <span className="pch-who-label">Filler</span>
              {[
                ['all', 'All', whoCounts.all],
                ['focal', 'Focal', whoCounts.focal],
                ['lm', 'LM', whoCounts.lm],
                ['employee', 'Employee', whoCounts.employee],
              ].map(([id, label, n]) => (
                <button key={id} type="button" className={`pch-chip${who === id ? ' is-on' : ''}`} onClick={() => setWho(id)}>{label} {n}</button>
              ))}
            </div>
            <label className="pch-search">
              <span className="sr-only">Search</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or code…"
              />
            </label>
          </div>
          <div className="pch-showing">
            Showing <strong>{people.length}</strong>
            {search.trim() ? ' matching' : ''} of {board?.audience_count || 0}
            {who !== 'all' ? ` · ${FILLER_LABEL[who] || who} fill` : ''}
            {focal ? ` · Focal ${focalLabel}` : ''}
            {lm ? ` · LM ${lmLabel}` : ''}
          </div>
          {(controlCounts.rejected_closed || 0) > 0 && ['superadmin', 'finance_manager'].includes(user?.role) && (
            <div className="pch-note is-warn">
              {controlCounts.rejected_closed} LM-rejected claim(s) are closed.
              {' '}
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => runAugustReopen(true)}>Preview August reopen</button>
              {' '}
              <button type="button" className="btn-primary" disabled={busy} onClick={() => runAugustReopen(false)}>Run one-time LM reopen + email</button>
            </div>
          )}
          {filter === 'needs_review' && (
            <div className="pch-note is-bad">
              Payroll Sheet already has different OT / medical / expense values. Verify manually — auto-push is blocked.
            </div>
          )}
          <div className="pch-chase">
            <div className="pch-chase-line">
              <strong>{pushTotals.count}</strong> selected for payroll
              {pushTotals.count > 0 && (
                <span className="pch-muted">
                  {' '}· OT2 {pushTotals.ot2.toFixed(1)}h · OT3 {pushTotals.ot3.toFixed(1)}h · Exp {money(pushTotals.exp)} · Med {money(pushTotals.med)}
                </span>
              )}
              <button type="button" className="btn-secondary" disabled={busy || !pushIds.length} onClick={() => runPushPayroll(true)}>Preview push</button>
              <button type="button" className="btn-primary" disabled={busy || !pushIds.length} onClick={() => runPushPayroll(false)}>Review and push to payroll</button>
            </div>
            <p className="pch-muted">Tick Ready for Payroll rows, then Review and push to payroll. That writes {MONTHS[workMonth - 1]?.[1] || workMonth} work onto the {MONTHS[payMonth - 1]?.[1] || payMonth} Payroll Sheet. Calculate / Update Payroll afterwards to see the same OT, expense, and medical on the sheet.</p>
          </div>
          {pushPreview && (
            <pre className="pch-note">{JSON.stringify(pushPreview.summary, null, 2)}</pre>
          )}
          <div className="pch-table-wrap">
            <table className="pch-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select visible" />
                  </th>
                  <th>Employee</th>
                  <th>Filler</th>
                  <th>OT 2x</th>
                  <th>OT 3x</th>
                  <th>Expense</th>
                  <th>Medical</th>
                  <th>Claim summary</th>
                  <th>Status</th>
                  <th>Last activity</th>
                  <th>Next</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {boardLoading && people.length === 0 && (
                  <tr><td colSpan={12} className="pch-muted">Loading claims…</td></tr>
                )}
                {!boardLoading && people.length === 0 && (
                  <tr><td colSpan={12} className="pch-muted">No people for this filter.</td></tr>
                )}
                {people.map(p => (
                  <tr key={p.employee_id} className={rowClass(p.control_status, openId === p.employee_id)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(p.employee_id)}
                        disabled={!p.can_push_payroll}
                        onChange={() => toggleOne(p.employee_id)}
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                    <td>
                      {p.name}
                      <div className="pch-muted">{p.employee_id} · {p.location || '—'}</div>
                    </td>
                    <td>
                      {FILLER_LABEL[fillerRoleOf(p)] || 'Focal'}
                      {p.mailed_to && (
                        <div className="pch-muted">{p.mailed_to}</div>
                      )}
                    </td>
                    <td>{hours(p.portal?.ot2Write || p.portal?.ot2)}</td>
                    <td>{hours(p.portal?.ot3)}</td>
                    <td>{money(p.portal?.expense)}</td>
                    <td>{money(p.portal?.medical)}</td>
                    <td>{p.claim_summary || '—'}</td>
                    <td>
                      <strong>{p.control_label || CONTROL_LABEL[p.control_status] || p.control_status}</strong>
                      {p.payroll_pushed_at && <div className="pch-muted">Sent {formatWhen(p.payroll_pushed_at)}</div>}
                    </td>
                    <td>
                      {p.last_activity_label ? `${p.last_activity_label} · ${formatWhen(p.last_activity_at)}` : '—'}
                    </td>
                    <td>{p.now_label || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOpenId(p.employee_id);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {open && createPortal(
            <div
              className="modal-overlay pch-detail-overlay"
              role="presentation"
              onClick={(e) => { if (e.target === e.currentTarget) setOpenId(null); }}
            >
              <div
                className="modal-box pch-detail-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pch-person-title"
              >
                <div className="pch-detail-head">
                  <div>
                    <h3 id="pch-person-title">{open.name}</h3>
                    <p className="pch-sub">{open.employee_id} · {open.location || '—'} · {open.path || '—'} · Filler {FILLER_LABEL[fillerRoleOf(open)] || 'Focal'}{open.mailed_to ? ` (${open.mailed_to})` : ''} · LM {open.lm || '—'}</p>
                  </div>
                  <button type="button" className="pch-process-x" onClick={() => setOpenId(null)} aria-label="Close person">
                    <X size={18} />
                  </button>
                </div>
                <div className="pch-detail">
              <div>
                <div className="pch-table-wrap">
                  <table className="pch-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>OT 2x hrs</th>
                        <th>OT 3x hrs</th>
                        <th>Medical PKR</th>
                        <th>Expense PKR</th>
                        <th>Arrears</th>
                        <th>Deduction</th>
                        <th>Spl Allow</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Portal ({MONTHS[workMonth - 1][1]} work)</td>
                        <td>{hours(open.portal?.ot2)}</td>
                        <td>{hours(open.portal?.ot3)}</td>
                        <td>{money(open.portal?.medical)}</td>
                        <td>{money(open.portal?.expense)}</td>
                        <td>{money(open.portal?.arrears)}</td>
                        <td>{money(open.portal?.deduction)}</td>
                        <td>{money(open.portal?.specialAllowance)}</td>
                      </tr>
                      <tr className={open.status === 'on_sheet' ? 'is-ok' : open.status === 'other_data' ? 'is-bad' : ''}>
                        <td>Payroll Sheet ({MONTHS[payMonth - 1][1]})</td>
                        <td>{hours(open.sheet?.ot2)}</td>
                        <td>{hours(open.sheet?.ot3)}</td>
                        <td>{money(open.sheet?.medical)}</td>
                        <td>{money(open.sheet?.expense)}</td>
                        <td>{money(open.sheet?.arrears)}</td>
                        <td>{money(open.sheet?.deduction)}</td>
                        <td>{money(open.sheet?.specialAllowance)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {open.control_status === 'sent_to_payroll' && <div className="pch-note is-ok">Sent to Payroll{open.payroll_pushed_at ? ` on ${formatWhen(open.payroll_pushed_at)}` : ''}. No further push.</div>}
                {open.control_status === 'ready_for_payroll' && <div className="pch-note is-warn">LM approved — tick this row and use Review and push to payroll above.</div>}
                {open.control_status === 'final_lm_review' && <div className="pch-note is-warn">Reopened once for final LM review. Waiting on {open.lm || 'Line Manager'}.</div>}
                {open.control_status === 'needs_review' && (
                  <div className="pch-note is-bad">
                    Needs Review — Payroll Sheet already has different values. Use Manual correction after verifying.
                  </div>
                )}
                {open.control_status === 'waiting_lm' && <div className="pch-note is-warn">Waiting on Line Manager {open.lm || ''}.</div>}
                {open.control_status === 'waiting_focal' && <div className="pch-note is-info">Waiting on Focal {open.mailed_to || ''} to fill or finish.</div>}
                {open.control_status === 'waiting_employee' && <div className="pch-note is-info">Waiting on Employee {open.mailed_to || ''} to fill or finish.</div>}
                {open.control_status === 'waiting_lm_fill' && <div className="pch-note is-info">Waiting on Line Manager {open.mailed_to || ''} to fill (submit is final).</div>}
                {open.control_status === 'invite_sent' && <div className="pch-note is-info">Invite sent to {open.mailed_to} on {formatWhen(open.sent_at)}.</div>}
                {open.control_status === 'not_invited' && <div className="pch-note">Not invited yet — use Send invites tab.</div>}
                {open.control_status === 'no_claims_confirmed' && (
                  <div className="pch-note is-ok">
                    Filler confirmed no claims{open.submitted_at ? ` on ${formatWhen(open.submitted_at)}` : ''}.
                    {open.mailed_to ? ` Confirmed by ${open.mailed_to}.` : ''}
                  </div>
                )}
                {open.control_status === 'no_claims_auto_closed' && (
                  <div className="pch-note is-bad">
                    Auto-closed after the fill deadline — filler did not confirm no claims.
                    {open.submitted_at ? ` Closed on ${formatWhen(open.submitted_at)}.` : ''}
                  </div>
                )}
                {open.control_status === 'no_claims_unverified' && (
                  <div className="pch-note">
                    No claims recorded, but the system cannot tell whether the filler confirmed or the row was auto-closed.
                  </div>
                )}
                {open.control_status === 'rejected_closed' && <div className="pch-note is-bad">Rejected — closed{open.lm_reopen_count ? ' (final)' : ''}.</div>}
                {open.last_reminder_at && <div className="pch-muted">Last reminder {formatWhen(open.last_reminder_at)}</div>}
              </div>
              <div>
                <h3>Payroll</h3>
                <p className="pch-sub">
                  LM approval does not write to the Payroll Sheet. ASIL pushes Ready for Payroll rows from the list above.
                </p>
                <div className="pch-actions">
                  {open.can_push_payroll && (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy}
                      onClick={async () => {
                        setSelected(new Set([open.employee_id]));
                        await runPushPayroll(false);
                      }}
                    >
                      Push this employee to payroll
                    </button>
                  )}
                  <button type="button" className="btn-secondary" onClick={() => fillManualFrom(open)}>Manual correction</button>
                  <button type="button" className="btn-secondary" onClick={() => setOpenId(null)}>Close</button>
                </div>
              </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      )}

      {activeSection === 'request' && (
        <ClaimRequestCampaign
          user={user}
          hidePeriod
          claimMonth={workMonth}
          claimYear={workYear}
          onPeriodChange={(m, y) => setWork(m, y)}
        />
      )}

      {activeSection === 'manual' && (
        <>
          <h3>Manual correction &amp; CSV upload</h3>
          <p className="pch-sub">
            Work month above is the <strong>claim month</strong> you are correcting
            (July work, payable with August salary). This replaces Portal Claims for that work month.
            It does <strong>not</strong> change the already-paid July salary sheet.
            Default: send OT / Expense / Medical back to the Line Manager. Uncheck only for a direct
            {' '}{MONTHS[payMonth - 1]?.[1] || 'next-month'} Payroll Sheet write.
            Arrears, Deductions, and Special Allowance write to that pay-month sheet now.
          </p>
          <div className="pch-form">
            <label className="pch-span">
              <span>
                <input
                  type="checkbox"
                  checked={!!ov.resubmitToLm}
                  onChange={e => setOv(o => ({ ...o, resubmitToLm: e.target.checked }))}
                />
                {' '}Send to Line Manager for re-approval after correction (recommended)
              </span>
            </label>
            <label><span>ASIL Employee Code</span>
              <input value={ov.employeeId} onChange={e => setOv(o => ({ ...o, employeeId: e.target.value }))} placeholder="e.g. ASIL/SPL-001" />
            </label>
            <label><span>OT 1× Hours</span>
              <input type="number" step="0.01" value={ov.ot1Hours} onChange={e => setOv(o => ({ ...o, ot1Hours: e.target.value }))} />
            </label>
            <label><span>OT 2× Hours</span>
              <input type="number" step="0.01" value={ov.ot2Hours} onChange={e => setOv(o => ({ ...o, ot2Hours: e.target.value }))} />
            </label>
            <label><span>OT 3× Hours</span>
              <input type="number" step="0.01" value={ov.ot3Hours} onChange={e => setOv(o => ({ ...o, ot3Hours: e.target.value }))} />
            </label>
            <label><span>Expense Amount (PKR)</span>
              <input type="number" step="0.01" value={ov.expenseAmount} onChange={e => setOv(o => ({ ...o, expenseAmount: e.target.value }))} />
            </label>
            <label><span>Medical / OPD (PKR)</span>
              <input type="number" step="0.01" value={ov.medicalAmount} onChange={e => setOv(o => ({ ...o, medicalAmount: e.target.value }))} />
            </label>
            <label><span>Arrears (PKR)</span>
              <input type="number" step="0.01" value={ov.arrearsAmount} onChange={e => setOv(o => ({ ...o, arrearsAmount: e.target.value }))} />
            </label>
            <label><span>Deductions (PKR)</span>
              <input type="number" step="0.01" value={ov.deductionAmount} onChange={e => setOv(o => ({ ...o, deductionAmount: e.target.value }))} />
            </label>
            <label><span>Special Allowance (PKR)</span>
              <input type="number" step="0.01" value={ov.specialAllowanceAmount} onChange={e => setOv(o => ({ ...o, specialAllowanceAmount: e.target.value }))} />
            </label>
            {!ov.resubmitToLm && (
              <label><span>Payroll mode</span>
                <select value={ov.mode} onChange={e => setOv(o => ({ ...o, mode: e.target.value }))}>
                  <option value="add">Add</option>
                  {isSuper && <option value="replace">Replace (superadmin)</option>}
                  {isSuper && <option value="remove">Remove (superadmin)</option>}
                </select>
              </label>
            )}
            <label className="pch-span"><span>Reason (required)</span>
              <input value={ov.reason} onChange={e => setOv(o => ({ ...o, reason: e.target.value }))} placeholder="Why this correction is needed" />
            </label>
          </div>
          <div className="pch-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => runOverride(false)}>Dry-run</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => runOverride(true)}>Commit</button>
            <a className="btn-secondary" href={`${import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com'}/api/portal-claims/manual-override/template`} target="_blank" rel="noreferrer">Download CSV template</a>
          </div>
          {ovPreview && (
            <pre className="pch-note">{JSON.stringify({ before: ovPreview.before, after: ovPreview.after, warning: ovPreview.warning, message: ovPreview.message }, null, 2)}</pre>
          )}

          <h3 style={{ marginTop: 24 }}>Bulk CSV upload</h3>
          <p className="pch-sub">
            Columns: Code, Emp Name, OT (1X), OT (x2), OT (x3), OPD, Exp, Arrears, Deduction, Special Allowance, Work Month, Work Year, Reason, Send to LM?
            Save as CSV (not .xlsx). Work month defaults to the filter above when omitted.
            Send to LM = Y replaces the work-month portal claim and emails the LM to re-approve.
            Send to LM = N replaces the portal claim only — no Focal or LM email, no July salary change.
          </p>
          <div className="pch-actions">
            <input
              type="file"
              accept=".csv,text/csv,.txt"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                const parsed = parseManualClaimsCsv(text);
                const example = (parsed.rows || []).find((r) => isTemplateExampleCode(r.Code || r['ASIL Employee Code']));
                const exampleErr = example
                  ? 'ASIL/SPL-001 is the template example, not a real employee. Use the 133-row July file with real ASIL codes.'
                  : '';
                setCsvPreview({
                  name: file.name,
                  rows: parsed.rows,
                  result: null,
                  parseError: parsed.error,
                  localError: parsed.error || exampleErr,
                });
                if (parsed.error || exampleErr) {
                  setErr(parsed.error || exampleErr);
                  setMsg('');
                } else {
                  setErr('');
                  setMsg(`Loaded ${parsed.rows.length} row(s) from ${file.name}. Dry-run first, then Commit CSV.`);
                }
              }}
            />
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => runCsvImport(false)}>Dry-run CSV</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => runCsvImport(true)}>Commit CSV</button>
          </div>
          {csvPreview?.name && (
            <div className={csvPreview.parseError || csvPreview.localError ? 'pch-note is-bad' : 'pch-note is-ok'}>
              {csvPreview.parseError || csvPreview.localError
                ? csvPreview.parseError || csvPreview.localError
                : `${csvPreview.rows.length} row(s) ready from ${csvPreview.name}.`}
              {busy ? ' Working — do not close this tab…' : ''}
            </div>
          )}
          {csvPreview?.result && (
            <div className="pch-table-wrap">
              <table className="pch-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Result</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(csvPreview.result.results || [])]
                    .map((r, i) => ({ r, i }))
                    .sort((a, b) => Number(!!a.r.ok) - Number(!!b.r.ok))
                    .map(({ r, i }) => (
                    <tr key={`${r.employeeId || i}`} className={r.ok ? 'is-ok' : 'is-bad'}>
                      <td>{r.employeeId || csvPreview.rows[i]?.Code || '—'}</td>
                      <td>{r.ok ? (r.dryRun ? 'Ready' : 'Applied') : 'Failed'}</td>
                      <td>{r.error || r.warning || r.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <details className="pch-admin">
        <summary>Admin — eligibility, SAMPLE flush, test pack, CSV</summary>
        <div className="pch-actions">
          <button type="button" className="btn-secondary" onClick={exportTieout}>Export CSV</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
            setBusy(true); setErr(''); setMsg('');
            try {
              const d = await api.portalClaimsNotifyApprovers(null, workMonth, workYear);
              setMsg(`Approver packs: ${(d.packs || []).map(p => `${p.approverEmail} (${p.count} pending)`).join(', ') || 'none pending'}`);
            } catch (e) { setErr(e.message); }
            finally { setBusy(false); }
          }}>Notify approvers</button>
          {['superadmin', 'finance_manager', 'finance_approver'].includes(user?.role) && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
              setBusy(true); setErr(''); setMsg('');
              try {
                const d = await api.portalClaimsCampaign({
                  month: workMonth, year: workYear, dryRun: false, campaignMode: 'sample', testPackFour: true,
                });
                setMsg(`4-routing test pack: ${d.invites?.filter(i => i.ok).length || 0} email(s).`);
              } catch (e) { setErr(e.message); }
              finally { setBusy(false); }
            }}>4-routing test pack</button>
          )}
          {isSuper && (
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
                if (!window.confirm('Clear ONLY the 3 sample test employees’ portal claims?')) return;
                setBusy(true);
                try {
                  const d = await api.portalClaimsResetSample();
                  setMsg(`Sample cleared: ${(d.clearedSubmissions || []).map(s => s.employee_id).join(', ') || 'nothing'}.`);
                  await loadBoard();
                } catch (e) { setErr(e.message); }
                finally { setBusy(false); }
              }}>Reset sample employees</button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
                if (!window.confirm('Delete all SAMPLE-mode portal claim periods for Wafi?')) return;
                setBusy(true);
                try {
                  const d = await api.portalClaimsFlushSample({ claimMonth: workMonth, claimYear: workYear, client: 'wafi' });
                  setMsg(`Flushed ${d.deletedPeriods || 0} sample period(s).`);
                  await loadBoard();
                } catch (e) { setErr(e.message); }
                finally { setBusy(false); }
              }}>Flush SAMPLE Wafi data</button>
            </>
          )}
        </div>
        {rules.length > 0 && (
          <div className="pch-note">
            {rules.map(r => (
              <div key={r.id}>
                <strong>{r.name}</strong>
                {r.client_pattern ? ` · client ~ ${r.client_pattern}` : ''}
                {(r.dept_exclude || []).length ? ` · exclude: ${r.dept_exclude.join(', ')}` : ''}
                {r.active === false ? ' (inactive)' : ''}
                {' '}
                <button type="button" className="btn-secondary" onClick={async () => {
                  try {
                    const d = await api.portalClaimsPreviewEligibilityRule(r.id);
                    setRulePreview({ name: r.name, ...d });
                  } catch (e) { setErr(e.message); }
                }}>Preview</button>
                {(user?.role === 'superadmin' || user?.role === 'finance_manager') && (
                  <button type="button" className="btn-secondary" onClick={() => setEditingRule({ ...r, dept_exclude_str: (r.dept_exclude || []).join(', ') })}>Edit</button>
                )}
              </div>
            ))}
            {rulePreview && (
              <p>{rulePreview.name} matches {rulePreview.count} employee(s).</p>
            )}
            {editingRule && (
              <div className="pch-form">
                <label><span>Name</span>
                  <input value={editingRule.name} onChange={e => setEditingRule(x => ({ ...x, name: e.target.value }))} />
                </label>
                <label><span>Client pattern</span>
                  <input value={editingRule.client_pattern || ''} onChange={e => setEditingRule(x => ({ ...x, client_pattern: e.target.value }))} />
                </label>
                <label className="pch-span"><span>Exclude depts</span>
                  <input value={editingRule.dept_exclude_str || ''} onChange={e => setEditingRule(x => ({ ...x, dept_exclude_str: e.target.value }))} />
                </label>
                <div className="pch-actions">
                  <button type="button" className="btn-primary" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try {
                      await api.portalClaimsSaveEligibilityRule({
                        id: editingRule.id,
                        name: editingRule.name,
                        priority: editingRule.priority,
                        active: editingRule.active !== false,
                        client_pattern: editingRule.client_pattern,
                        dept_exclude: (editingRule.dept_exclude_str || '').split(',').map(s => s.trim()).filter(Boolean),
                        eligible: editingRule.eligible !== false,
                      });
                      setEditingRule(null);
                      const d = await api.portalClaimsEligibilityRules();
                      setRules(d.rules || []);
                      setMsg('Eligibility rule saved.');
                    } catch (e) { setErr(e.message); }
                    finally { setBusy(false); }
                  }}>Save rule</button>
                  <button type="button" className="btn-secondary" onClick={() => setEditingRule(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
      </details>
    </div>
  );
}
