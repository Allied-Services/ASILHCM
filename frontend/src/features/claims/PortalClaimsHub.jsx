import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { api } from '../../api';
import ClaimRequestCampaign from './ClaimRequestCampaign';
import { parseManualClaimsCsv } from './manualClaimsCsv';
import './PortalClaimsHub.css';

const SADIA_EMAIL = 'sadia.komal@asil.com.pk';

const CLAIM_PROCESS_ROWS = [
  {
    situation: 'No Focal, no LM + official @wafi-energy.com or @asil.com.pk email',
    filler: 'Employee',
    approver: `Sadia approves (${SADIA_EMAIL})`,
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
  if (controlStatus === 'ready_for_payroll' || controlStatus === 'final_lm_review' || controlStatus === 'waiting_lm') bits.push('is-warn');
  if (open) bits.push('is-open');
  return bits.join(' ');
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

export default function PortalClaimsHub({
  user,
  lockSection = null,
  initialFilter = null,
  hideSectionNav = false,
  onOpenManual = null,
  manualSeed = null,
  onManualSeedConsumed = null,
}) {
  const start = defaultPeriod();
  const [workMonth, setWorkMonth] = useState(start.workMonth);
  const [workYear, setWorkYear] = useState(start.workYear);
  const [payMonth, setPayMonth] = useState(start.payMonth);
  const [payYear, setPayYear] = useState(start.payYear);
  const [client, setClient] = useState('');
  const [contract, setContract] = useState('');
  const [location, setLocation] = useState('');
  const defaultSection = lockSection || (new URLSearchParams(window.location.search).get('setup_needed') === '1' ? 'request' : 'response');
  const [section, setSection] = useState(defaultSection);
  const [filter, setFilter] = useState(initialFilter || 'needs_action');
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
    mode: 'add', reason: '', resubmitToLm: true,
  });
  const [ovPreview, setOvPreview] = useState(null);
  const [csvPreview, setCsvPreview] = useState(null);
  const [rulePreview, setRulePreview] = useState(null);
  const [editingRule, setEditingRule] = useState(null);
  const [showClaimProcess, setShowClaimProcess] = useState(false);

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
    if (!showClaimProcess) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setShowClaimProcess(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showClaimProcess]);

  const setWork = (m, y) => {
    setWorkMonth(m);
    setWorkYear(y);
    const next = followingMonth(m, y);
    setPayMonth(next.month);
    setPayYear(next.year);
  };

  const loadBoard = useCallback(async () => {
    setErr('');
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
      const d = await api.portalClaimsResponse(q);
      setBoard(d);
      setSelected(new Set());
    } catch (e) {
      setErr(e.message);
    }
  }, [workMonth, workYear, payMonth, payYear, client, contract, location]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  useEffect(() => {
    if (client || !board?.people?.length) return;
    const wafi = [...new Set(board.people.map(p => p.client).filter(Boolean))]
      .find(c => /wafi/i.test(c));
    if (wafi) setClient(wafi);
  }, [board, client]);

  useEffect(() => {
    api.portalClaimsEligibilityRules().then(d => setRules(d.rules || [])).catch(() => {});
  }, []);

  const clients = useMemo(() => {
    const set = new Set((board?.people || []).map(p => p.client).filter(Boolean));
    return [...set].sort();
  }, [board]);
  const contracts = useMemo(() => {
    const map = new Map();
    for (const p of board?.people || []) {
      if (p.contract_id) map.set(p.contract_id, p.contract_name || p.contract_id);
    }
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [board]);
  const locations = useMemo(() => {
    const set = new Set((board?.people || []).map(p => p.location).filter(Boolean));
    return [...set].sort();
  }, [board]);

  // eslint-disable-next-line no-unused-vars
  const counts = board?.counts || {};
  const actionCounts = board?.action_counts || {};
  const controlCounts = board?.control_counts || {};
  const pipelineCounts = useMemo(() => {
    const rows = board?.people || [];
    return {
      submitted_by_focal: rows.filter(isSubmittedByFocal).length,
      claims_approved: rows.filter(isClaimsApproved).length,
      no_claims_confirmed: rows.filter(isNoClaimsConfirmed).length,
    };
  }, [board]);
  const people = (board?.people || []).filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'needs_action' || filter === 'waiting' || filter === 'closed') {
      return p.action_view === filter;
    }
    if (filter === 'submitted_by_focal') return isSubmittedByFocal(p);
    if (filter === 'claims_approved') return isClaimsApproved(p);
    if (filter === 'no_claims_confirmed') return isNoClaimsConfirmed(p);
    if (filter === 'no_claims_auto_closed') return p.control_status === 'no_claims_auto_closed';
    return p.control_status === filter;
  });
  const open = (board?.people || []).find(p => p.employee_id === openId) || null;
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

  const chips = [
    ['needs_action', `Needs action ${actionCounts.needs_action || 0}`],
    ['waiting', `Waiting ${actionCounts.waiting || 0}`],
    ['submitted_by_focal', `Claims Submitted by Focals ${pipelineCounts.submitted_by_focal || 0}`],
    ['claims_approved', `Claims Approved ${pipelineCounts.claims_approved || 0}`],
    ['no_claims_confirmed', `No Claims Confirmed ${pipelineCounts.no_claims_confirmed || 0}`],
    ['no_claims_auto_closed', `No Claims Auto-closed ${controlCounts.no_claims_auto_closed || 0}`],
    ['closed', `Closed ${actionCounts.closed || 0}`],
    ['all', `All ${board?.audience_count || 0}`],
  ];


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
      + `Amounts are payable with ${MONTHS[payMonth - 1]?.[1] || payMonth} salary after LM approval `
      + `(or immediately on that sheet if Send to LM = N).`
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
      setCsvPreview((prev) => ({ ...prev, result: d, localError: '' }));
      const ok = d.summary?.ready ?? (d.results || []).filter(r => r.ok).length;
      const bad = d.summary?.failed ?? (d.results || []).filter(r => !r.ok).length;
      const note = commit
        ? `CSV import: ${ok} applied${bad ? ` · ${bad} failed` : ''}.`
        : `CSV dry-run: ${ok} ready${bad ? ` · ${bad} blocked` : ''}.`;
      setMsg(note);
      if (bad) setErr(`${bad} row(s) failed — see the list under Commit CSV.`);
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
          <select value={client} onChange={e => { setClient(e.target.value); setContract(''); setLocation(''); }}>
            <option value="">All clients</option>
            {clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="hint">Same audience as request emails</span>
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
        <div>
          <span className="lbl">Audience</span>
          <strong>{board?.audience_count ?? '…'}</strong>
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
            {board?.period_label || 'Who must act, what is ready for payroll, and what is closed.'}
          </div>
          <div className="pch-stats">
            <div className="pch-stat is-warn"><strong>{pipelineCounts.submitted_by_focal || 0}</strong><span>Submitted by Focals</span></div>
            <div className="pch-stat is-ok"><strong>{pipelineCounts.claims_approved || 0}</strong><span>Claims Approved</span></div>
            <div className="pch-stat is-warn"><strong>{controlCounts.ready_for_payroll || 0}</strong><span>Ready for Payroll</span></div>
            <div className="pch-stat is-warn"><strong>{controlCounts.final_lm_review || 0}</strong><span>Final LM review</span></div>
            <div className="pch-stat"><strong>{(controlCounts.waiting_focal || 0) + (controlCounts.waiting_lm || 0) + (controlCounts.invite_sent || 0)}</strong><span>Waiting on others</span></div>
            <div className="pch-stat is-ok"><strong>{controlCounts.sent_to_payroll || 0}</strong><span>Sent to Payroll</span></div>
            <div className="pch-stat is-ok"><strong>{pipelineCounts.no_claims_confirmed || 0}</strong><span>No Claims Confirmed</span></div>
            <div className="pch-stat is-bad"><strong>{controlCounts.no_claims_auto_closed || 0}</strong><span>No Claims Auto-closed</span></div>
            {(controlCounts.no_claims_unverified || 0) > 0 && (
              <div className="pch-stat"><strong>{controlCounts.no_claims_unverified || 0}</strong><span>No Claims (source unknown)</span></div>
            )}
            <div className="pch-stat is-bad"><strong>{controlCounts.needs_review || 0}</strong><span>Needs Review</span></div>
          </div>
          <div className="pch-chips">
            {chips.map(([id, label]) => (
              <button key={id} type="button" className={`pch-chip${filter === id ? ' is-on' : ''}`} onClick={() => setFilter(id)}>{label}</button>
            ))}
            <button type="button" className="btn-secondary" onClick={loadBoard}>Refresh</button>
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
            <p className="pch-muted">Only Ready for Payroll rows can be ticked for push. LM approval alone does not write to the sheet — ASIL confirms here. Sent rows cannot be pushed again.</p>
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
                  <th>Claim summary</th>
                  <th>Status</th>
                  <th>Last activity</th>
                  <th>Next</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {people.length === 0 && (
                  <tr><td colSpan={7} className="pch-muted">No people for this filter.</td></tr>
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
                      <button type="button" className="btn-secondary" onClick={() => setOpenId(p.employee_id)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {open && (
            <div className="pch-detail">
              <div>
                <h3>{open.name}</h3>
                <p className="pch-sub">{open.employee_id} · {open.location || '—'} · {open.path || '—'} · LM {open.lm || '—'}</p>
                <div className="pch-table-wrap">
                  <table className="pch-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>OT 2x hrs</th>
                        <th>OT 3x hrs</th>
                        <th>Medical PKR</th>
                        <th>Expense PKR</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Portal ({MONTHS[workMonth - 1][1]} work)</td>
                        <td>{hours(open.portal?.ot2)}</td>
                        <td>{hours(open.portal?.ot3)}</td>
                        <td>{money(open.portal?.medical)}</td>
                        <td>{money(open.portal?.expense)}</td>
                      </tr>
                      <tr className={open.status === 'on_sheet' ? 'is-ok' : open.status === 'other_data' ? 'is-bad' : ''}>
                        <td>Payroll Sheet ({MONTHS[payMonth - 1][1]})</td>
                        <td>{hours(open.sheet?.ot2)}</td>
                        <td>{hours(open.sheet?.ot3)}</td>
                        <td>{money(open.sheet?.medical)}</td>
                        <td>{money(open.sheet?.expense)}</td>
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
                </div>
              </div>
            </div>
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
            Default: send each line back to the Line Manager. Uncheck only for a direct
            {' '}{MONTHS[payMonth - 1]?.[1] || 'next-month'} Payroll Sheet write.
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
            Columns: Code, Emp Name, OT (1X), OT (x2), OT (x3), OPD, Exp, Work Month, Work Year, Reason, Send to LM?
            Save as CSV (not .xlsx). Work month defaults to the filter above when omitted.
            Send to LM = Y replaces the work-month portal claim and asks the LM to re-approve.
            Send to LM = N writes the <strong>following</strong> Payroll Sheet month (August for July work), never the locked July salary sheet.
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
                setCsvPreview({
                  name: file.name,
                  rows: parsed.rows,
                  result: null,
                  parseError: parsed.error,
                  localError: parsed.error || '',
                });
                if (parsed.error) {
                  setErr(parsed.error);
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
                  {(csvPreview.result.results || []).map((r, i) => (
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
