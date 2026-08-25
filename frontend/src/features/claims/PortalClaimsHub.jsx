import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import ClaimRequestCampaign from './ClaimRequestCampaign';
import './PortalClaimsHub.css';

const MONTHS = [
  [1, 'Jan'], [2, 'Feb'], [3, 'Mar'], [4, 'Apr'], [5, 'May'], [6, 'Jun'],
  [7, 'Jul'], [8, 'Aug'], [9, 'Sep'], [10, 'Oct'], [11, 'Nov'], [12, 'Dec'],
];

const STATUS_LABEL = {
  not_invited: 'Not invited',
  invite_sent: 'Invite sent',
  waiting_focal: 'Waiting Focal',
  waiting_employee: 'Waiting Employee',
  waiting_fill: 'Waiting fill',
  waiting_lm: 'Waiting LM',
  waiting_asil: 'Waiting ASIL',
  no_claims: 'No claims',
  rejected: 'Rejected',
  on_sheet: 'On sheet · match',
  other_data: 'OTHER DATA',
  ready_import: 'Approved · not on sheet',
  closed: 'Finished',
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

function rowClass(status, open) {
  const bits = [];
  if (status === 'on_sheet') bits.push('is-ok');
  if (status === 'other_data' || status === 'rejected' || status === 'send_failed') bits.push('is-bad');
  if (status === 'waiting_lm' || status === 'waiting_asil' || status === 'ready_import') bits.push('is-warn');
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
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(() => new Set());
  const [confirmActual, setConfirmActual] = useState(false);
  const [force, setForce] = useState(false);
  const [board, setBoard] = useState(null);
  const [openId, setOpenId] = useState(null);
  const detailRef = useRef(null);
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

  const counts = board?.counts || {};
  const people = (board?.people || []).filter(p => filter === 'all' || p.status === filter);
  const open = (board?.people || []).find(p => p.employee_id === openId) || null;
  const visibleIds = people.map(p => p.employee_id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  const chips = [
    ['all', `All ${board?.audience_count || 0}`],
    ['not_invited', `Not invited ${counts.not_invited || 0}`],
    ['invite_sent', `Invite sent ${counts.invite_sent || 0}`],
    ['waiting_focal', `Waiting Focal ${counts.waiting_focal || 0}`],
    ['waiting_employee', `Waiting Employee ${counts.waiting_employee || 0}`],
    ['waiting_lm', `Waiting LM ${counts.waiting_lm || 0}`],
    ['waiting_asil', `Waiting ASIL ${counts.waiting_asil || 0}`],
    ['no_claims', `No claims ${counts.no_claims || 0}`],
    ['rejected', `Rejected ${counts.rejected || 0}`],
    ['on_sheet', `On sheet · match ${counts.on_sheet || 0}`],
    ['other_data', `OTHER DATA ${counts.other_data || 0}`],
    ['ready_import', `Approved · not on sheet ${counts.ready_import || 0}`],
  ];

  const stillInChain = (counts.invite_sent || 0) + (counts.waiting_focal || 0)
    + (counts.waiting_employee || 0) + (counts.waiting_fill || 0)
    + (counts.waiting_lm || 0) + (counts.waiting_asil || 0);

  const canSend = !!user && (
    ['superadmin', 'finance_manager', 'finance_approver', 'operations_supervisor'].includes(user.role)
    || !!(user.permissions?.claims_portal?.subPerms || []).includes('campaign')
    || (Array.isArray(user.permissions?.claims_portal) && user.permissions.claims_portal.includes('campaign'))
  );

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

  const runChase = async (action, preview) => {
    if (!selected.size) {
      setErr('Tick at least one person, then send or remind.');
      return;
    }
    if (!preview && !confirmActual) {
      setErr('Tick the confirmation box before sending ACTUAL emails.');
      return;
    }
    const ids = [...selected];
    const verb = action === 'invite' ? 'invite' : action === 'remind_filler' ? 'focal reminder' : 'LM reminder';
    if (!preview && !window.confirm(`Send ACTUAL ${verb} for ${ids.length} ticked person(s)?`)) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.portalClaimsChase({
        action,
        preview,
        campaignMode: 'actual',
        force: force && user?.role === 'superadmin',
        workMonth, workYear, payMonth, payYear,
        client, contract, location,
        employeeIds: ids,
      });
      const toList = (d.targets || []).map(t => t.email).filter(Boolean);
      if (preview) {
        setMsg(`Preview ${verb}: ${d.send_count || 0} will be mailed → ${toList.join(', ') || 'no addresses'}.${d.skipped?.length ? ` Skipped ${d.skipped.length}.` : ''}`);
      } else {
        const ok = (d.sent || []).filter(s => s.ok).length;
        setMsg(`ACTUAL ${verb}: ${ok} email(s) to ${toList.join(', ') || '—'}.${d.skipped?.length ? ` Skipped ${d.skipped.length}.` : ''}`);
        await loadBoard();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = (employeeId) => {
    setOpenId(employeeId);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
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

  const importIfEmpty = async (p) => {
    if (!p) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.portalClaimsImportIfEmpty({
        employeeId: p.employee_id, workMonth, workYear,
      });
      setMsg(d.wrotePayroll
        ? `Imported ${p.name} onto the ${payMonth}/${payYear} Payroll Sheet.`
        : 'Nothing to write — portal amounts are empty.');
      await loadBoard();
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
        <button type="button" className={`pch-job${section === 'response' ? ' is-on' : ''}`} onClick={() => setSection('response')}>1. Response</button>
        <button type="button" className={`pch-job${section === 'request' ? ' is-on' : ''}`} onClick={() => setSection('request')}>2. Request emails</button>
        <button type="button" className={`pch-job${section === 'manual' ? ' is-on' : ''}`} onClick={() => setSection('manual')}>3. Manual add</button>
      </div>

      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}

      {section === 'response' && (
        <>
          <div className="pch-note is-info">
            {board?.period_label || 'Compare portal numbers to the Payroll Sheet. Auto-import only when those four columns are empty.'}
          </div>
          <div className="pch-stats">
            <div className="pch-stat"><strong>{board?.audience_count ?? '—'}</strong><span>In audience</span></div>
            <div className="pch-stat is-ok"><strong>{counts.on_sheet || 0}</strong><span>On sheet · match</span></div>
            <div className="pch-stat is-warn"><strong>{stillInChain}</strong><span>Still in the chain</span></div>
            <div className="pch-stat is-bad"><strong>{counts.other_data || 0}</strong><span>OTHER DATA — do not auto-import</span></div>
          </div>
          <div className="pch-chips">
            {chips.map(([id, label]) => (
              <button key={id} type="button" className={`pch-chip${filter === id ? ' is-on' : ''}`} onClick={() => setFilter(id)}>{label}</button>
            ))}
            <button type="button" className="btn-secondary" onClick={loadBoard}>Refresh</button>
          </div>
          {filter === 'other_data' && (
            <div className="pch-note is-bad">
              Auto-import is blocked. The Payroll Sheet already has OT, medical, or expense. Verify what is there, then add this claim by hand for that person only.
            </div>
          )}
          {canSend && (
            <div className="pch-chase">
              <div className="pch-chase-line">
                <strong>{selected.size}</strong> ticked
                <button type="button" className="btn-secondary" disabled={busy || !selected.size} onClick={() => runChase('invite', true)}>Preview invite</button>
                <button type="button" className="btn-secondary" disabled={busy || !selected.size} onClick={() => runChase('remind_filler', true)}>Preview focal reminder</button>
                <button type="button" className="btn-secondary" disabled={busy || !selected.size} onClick={() => runChase('remind_approver', true)}>Preview LM reminder</button>
              </div>
              <div className="pch-chase-line">
                <label className="pch-check">
                  <input type="checkbox" checked={confirmActual} onChange={e => setConfirmActual(e.target.checked)} />
                  I confirm ACTUAL mail to real Focal / Employee / LM addresses
                </label>
                <button type="button" className="btn-primary" disabled={busy || !selected.size || !confirmActual} onClick={() => runChase('invite', false)}>Send invite</button>
                <button type="button" className="btn-secondary" disabled={busy || !selected.size || !confirmActual} onClick={() => runChase('remind_filler', false)}>Send focal reminder</button>
                <button type="button" className="btn-secondary" disabled={busy || !selected.size || !confirmActual} onClick={() => runChase('remind_approver', false)}>Send LM reminder</button>
                {isSuper && (
                  <label className="pch-check">
                    <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
                    Superadmin force (re-mail finished people)
                  </label>
                )}
              </div>
              <p className="pch-muted">Sent = HCM handed the mail to Resend. Reminded shows the last chase email for that focal batch. Finished people are skipped unless Superadmin force is on.</p>
            </div>
          )}
          <div className="pch-table-wrap">
            <table className="pch-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select visible" />
                  </th>
                  <th>Employee</th>
                  <th>Now</th>
                  <th>To</th>
                  <th>Sent</th>
                  <th>Reminded</th>
                  <th>Mailer</th>
                  <th>Path</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {people.length === 0 && (
                  <tr><td colSpan={9} className="pch-muted">No people for this filter.</td></tr>
                )}
                {people.map(p => (
                  <tr key={p.employee_id} className={rowClass(p.status, openId === p.employee_id)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(p.employee_id)}
                        onChange={() => toggleOne(p.employee_id)}
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                    <td>
                      {p.name}
                      <div className="pch-muted">{p.employee_id} · {p.location || '—'}</div>
                    </td>
                    <td>
                      {p.now_label || STATUS_LABEL[p.status] || p.status}
                      <div className="pch-muted">{STATUS_LABEL[p.status] || p.status}</div>
                    </td>
                    <td>
                      {p.mailed_to || '—'}
                      {p.lm && <div className="pch-muted">LM {p.lm}</div>}
                    </td>
                    <td>{formatWhen(p.sent_at)}</td>
                    <td>
                      {p.last_reminder_at
                        ? `${formatWhen(p.last_reminder_at)}${p.reminder_count ? ` (${p.reminder_count}×)` : ''}`
                        : '—'}
                    </td>
                    <td>{MAILER_LABEL[p.mailer] || p.mailer || '—'}</td>
                    <td>{p.path || '—'}</td>
                    <td>
                      <button type="button" className="btn-secondary" onClick={() => openDetail(p.employee_id)}>View detail</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {open && (
            <div className="pch-detail" ref={detailRef}>
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
                {open.status === 'on_sheet' && <div className="pch-note is-ok">Match. August sheet equals the approved portal claim.</div>}
                {open.status === 'other_data' && (
                  <div className="pch-note is-bad">
                    OTHER DATA — auto-import refused. Sheet already has numbers that are not this portal claim. Verify, then Manual add.
                  </div>
                )}
                {open.status === 'ready_import' && (
                  <div className="pch-note is-warn">Approved. Sheet columns are empty. Import is allowed.</div>
                )}
                {open.status === 'waiting_lm' && <div className="pch-note is-warn">Waiting on Line Manager {open.lm || ''}. Not on the Payroll Sheet yet.</div>}
                {open.status === 'waiting_asil' && <div className="pch-note is-warn">Waiting on ASIL {open.lm || ''} to approve.</div>}
                {open.status === 'waiting_focal' && <div className="pch-note is-info">Waiting on Focal {open.mailed_to || ''} to fill or finish.</div>}
                {open.status === 'waiting_employee' && <div className="pch-note is-info">Waiting on the employee {open.mailed_to || ''} to fill.</div>}
                {open.status === 'waiting_fill' && <div className="pch-note is-info">Waiting on Employee / Focal to submit.</div>}
                {open.status === 'invite_sent' && <div className="pch-note is-info">Invite sent to {open.mailed_to} on {formatWhen(open.sent_at)}. No draft yet.</div>}
                {open.status === 'not_invited' && <div className="pch-note">In the audience — no email yet. Tick and send an invite from this page.</div>}
                {open.status === 'no_claims' && <div className="pch-note">They said no claims this month. Sheet stays empty.</div>}
                {open.status === 'rejected' && <div className="pch-note is-bad">Rejected by {open.decided_by || 'approver'} ({open.decided_email || open.lm || '—'}).</div>}
                {open.status === 'closed' && <div className="pch-note">Finished · nothing to pay.</div>}
                {open.last_reminder_at && <div className="pch-muted">Last reminder {formatWhen(open.last_reminder_at)}</div>}
              </div>
              <div>
                <h3>Import rule</h3>
                <p className="pch-sub">
                  Auto-import writes the work-month portal OT / medical / expense onto the pay-month sheet only when OT2, OT3, medical, and expense are all zero.
                </p>
                <div className="pch-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || open.sample || open.status !== 'ready_import'}
                    onClick={() => importIfEmpty(open)}
                  >
                    {open.status === 'other_data' || open.sheet_has_values ? 'Import blocked' : 'Import if empty'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => fillManualFrom(open)}>Manual add</button>
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
        <summary>Admin — eligibility, CSV export, superadmin tools</summary>
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
          {isSuper && (
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
                setBusy(true); setErr(''); setMsg('');
                try {
                  const d = await api.portalClaimsResyncSubmissionEmails({ periodId: 3 });
                  setMsg(`Resynced filler emails: ${d.updated || 0} updated (${d.scanned || 0} scanned).`);
                  await loadBoard();
                } catch (e) { setErr(e.message); }
                finally { setBusy(false); }
              }}>Resync roster emails (July ACTUAL)</button>
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
