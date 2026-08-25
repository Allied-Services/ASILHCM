import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import ClaimRequestCampaign from './ClaimRequestCampaign';
import './PortalClaimsHub.css';

const MONTHS = [
  [1, 'Jan'], [2, 'Feb'], [3, 'Mar'], [4, 'Apr'], [5, 'May'], [6, 'Jun'],
  [7, 'Jul'], [8, 'Aug'], [9, 'Sep'], [10, 'Oct'], [11, 'Nov'], [12, 'Dec'],
];

const CONTROL_LABEL = {
  waiting_focal: 'Waiting for Focal',
  waiting_lm: 'Waiting for LM',
  final_lm_review: 'Final LM review',
  ready_for_payroll: 'Ready for Payroll',
  sent_to_payroll: 'Sent to Payroll',
  no_claims_closed: 'No Claims — Closed',
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
  return v ? String(v) : '—';
}

function rowClass(controlStatus, open) {
  const bits = [];
  if (controlStatus === 'sent_to_payroll') bits.push('is-ok');
  if (controlStatus === 'needs_review' || controlStatus === 'rejected_closed') bits.push('is-bad');
  if (controlStatus === 'ready_for_payroll' || controlStatus === 'final_lm_review' || controlStatus === 'waiting_lm') bits.push('is-warn');
  if (open) bits.push('is-open');
  return bits.join(' ');
}

export default function PortalClaimsHub({ user }) {
  const start = defaultPeriod();
  const [workMonth, setWorkMonth] = useState(start.workMonth);
  const [workYear, setWorkYear] = useState(start.workYear);
  const [payMonth, setPayMonth] = useState(start.payMonth);
  const [payYear, setPayYear] = useState(start.payYear);
  const [client, setClient] = useState('');
  const [contract, setContract] = useState('');
  const [location, setLocation] = useState('');
  const [section, setSection] = useState('response');
  const [filter, setFilter] = useState('needs_action');
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
    mode: 'add', reason: '',
  });
  const [ovPreview, setOvPreview] = useState(null);
  const [rulePreview, setRulePreview] = useState(null);
  const [editingRule, setEditingRule] = useState(null);

  const isSuper = user?.role === 'superadmin';

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
  const people = (board?.people || []).filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'needs_action' || filter === 'waiting' || filter === 'closed') {
      return p.action_view === filter;
    }
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
    setOv(o => ({
      ...o,
      employeeId: p.employee_id,
      month: payMonth,
      year: payYear,
      ot1Hours: p.portal?.ot1 || 0,
      ot2Hours: p.portal?.ot2 || 0,
      ot3Hours: p.portal?.ot3 || 0,
      expenseAmount: p.portal?.expense || 0,
      medicalAmount: p.portal?.medical || 0,
      mode: 'add',
    }));
    setSection('manual');
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
      const d = await api.portalClaimsManualOverride({ ...ov, month: payMonth, year: payYear, dryRun: !commit });
      setOvPreview(d);
      if (d.warning) setMsg(d.warning);
      if (commit) {
        setMsg('Override applied.');
        await loadBoard();
      } else {
        setMsg('Dry-run preview ready — review before Commit.');
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
      <h2 className="pch-title">Portal Claims</h2>
      <p className="pch-sub">
        Work month is when OT / medical / expense happened. Paid on is the Payroll Sheet month.
        Response lists everyone in the audience — not only people who already submitted.
      </p>

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

      <div className="pch-jobs">
        <button type="button" className={`pch-job${section === 'response' ? ' is-on' : ''}`} onClick={() => setSection('response')}>Track &amp; send to payroll</button>
        <button type="button" className={`pch-job${section === 'request' ? ' is-on' : ''}`} onClick={() => setSection('request')}>Send invites</button>
        <button type="button" className={`pch-job${section === 'manual' ? ' is-on' : ''}`} onClick={() => setSection('manual')}>Manual correction</button>
      </div>

      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}

      {section === 'response' && (
        <>
          <div className="pch-note is-info">
            {board?.period_label || 'Who must act, what is ready for payroll, and what is closed.'}
          </div>
          <div className="pch-stats">
            <div className="pch-stat is-warn"><strong>{controlCounts.ready_for_payroll || 0}</strong><span>Ready for Payroll</span></div>
            <div className="pch-stat is-warn"><strong>{controlCounts.final_lm_review || 0}</strong><span>Final LM review</span></div>
            <div className="pch-stat"><strong>{(controlCounts.waiting_focal || 0) + (controlCounts.waiting_lm || 0) + (controlCounts.invite_sent || 0)}</strong><span>Waiting on others</span></div>
            <div className="pch-stat is-ok"><strong>{controlCounts.sent_to_payroll || 0}</strong><span>Sent to Payroll</span></div>
            <div className="pch-stat"><strong>{controlCounts.no_claims_closed || 0}</strong><span>No Claims — Closed</span></div>
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
                {open.control_status === 'no_claims_closed' && <div className="pch-note">No claims this month — closed.</div>}
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

      {section === 'request' && (
        <ClaimRequestCampaign
          user={user}
          hidePeriod
          claimMonth={workMonth}
          claimYear={workYear}
          onPeriodChange={(m, y) => setWork(m, y)}
        />
      )}

      {section === 'manual' && (
        <>
          <h3>Manual add</h3>
          <p className="pch-sub">
            Only for OTHER DATA rows, or someone who missed the portal. Finance can Add. Superadmin can Replace or Remove. Dry-run first.
          </p>
          <div className="pch-form">
            <label><span>ASIL Employee Code</span>
              <input value={ov.employeeId} onChange={e => setOv(o => ({ ...o, employeeId: e.target.value }))} placeholder="e.g. ASIL/SPL-001" />
            </label>
            <label><span>OT 1× Hours</span>
              <input type="number" value={ov.ot1Hours} onChange={e => setOv(o => ({ ...o, ot1Hours: e.target.value }))} />
            </label>
            <label><span>OT 2× Hours</span>
              <input type="number" value={ov.ot2Hours} onChange={e => setOv(o => ({ ...o, ot2Hours: e.target.value }))} />
            </label>
            <label><span>OT 3× Hours</span>
              <input type="number" value={ov.ot3Hours} onChange={e => setOv(o => ({ ...o, ot3Hours: e.target.value }))} />
            </label>
            <label><span>Expense Amount (PKR)</span>
              <input type="number" value={ov.expenseAmount} onChange={e => setOv(o => ({ ...o, expenseAmount: e.target.value }))} />
            </label>
            <label><span>Medical Amount (PKR)</span>
              <input type="number" value={ov.medicalAmount} onChange={e => setOv(o => ({ ...o, medicalAmount: e.target.value }))} />
            </label>
            <label><span>Mode</span>
              <select value={ov.mode} onChange={e => setOv(o => ({ ...o, mode: e.target.value }))}>
                <option value="add">Add</option>
                {isSuper && <option value="replace">Replace (superadmin)</option>}
                {isSuper && <option value="remove">Remove (superadmin)</option>}
              </select>
            </label>
            <label className="pch-span"><span>Reason (required)</span>
              <input value={ov.reason} onChange={e => setOv(o => ({ ...o, reason: e.target.value }))} placeholder="Why this override is needed" />
            </label>
          </div>
          <div className="pch-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => runOverride(false)}>Dry-run</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={() => runOverride(true)}>Commit</button>
          </div>
          {ovPreview && (
            <pre className="pch-note">{JSON.stringify({ before: ovPreview.before, after: ovPreview.after, warning: ovPreview.warning }, null, 2)}</pre>
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
