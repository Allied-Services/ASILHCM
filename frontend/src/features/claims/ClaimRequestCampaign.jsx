import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';

const PROFILE_LABEL = {
  focal_then_lm: 'Focal + LM',
  focal_only: 'Focal only',
  employee_then_lm: 'Employee + LM',
  lm_only: 'LM only',
  employee_then_asil: 'Employee + ASIL',
  setup_needed: 'Setup needed',
};

const PROFILE_EXPLAIN = {
  focal_then_lm: 'Focal fills OT / Expense / Medical for the nominated employees. After submit, the Line Manager reviews and approves.',
  focal_only: 'Focal fills the claims and is also the final approver — no Line Manager on file.',
  employee_then_lm: 'No focal. Employee has a Wafi or asil.com.pk mailbox and submits their own claims. The Line Manager reviews and approves.',
  lm_only: 'No Focal and no Wafi/ASIL employee mailbox. The Line Manager adds the claims and they are treated as final.',
  employee_then_asil: 'No focal and no Line Manager. The employee (Wafi or asil.com.pk mailbox) submits. ASIL Operations (Huzaifa) is the approver.',
  setup_needed: 'No Focal, no Wafi/ASIL mailbox, and no Line Manager. Sadia Komal is emailed a list with a link to update the roster.',
};

const MONTHS = [
  [1, 'Jan'], [2, 'Feb'], [3, 'Mar'], [4, 'Apr'], [5, 'May'], [6, 'Jun'],
  [7, 'Jul'], [8, 'Aug'], [9, 'Sep'], [10, 'Oct'], [11, 'Nov'], [12, 'Dec'],
];

const th = { padding: '8px 10px', fontSize: 12, color: '#64748b', textAlign: 'left', whiteSpace: 'nowrap', textTransform: 'uppercase', fontWeight: 700 };
const td = { padding: '7px 10px', verticalAlign: 'middle', fontSize: 13 };
const selectStyle = {
  background: 'var(--bg-card, #111827)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '7px 12px', color: 'var(--text)', fontSize: 14, minWidth: 180,
};

export default function ClaimRequestCampaign({ user, onPeriodChange, claimMonth, claimYear, hidePeriod, actualOnly = false }) {
  const [month, setMonth] = useState(() => claimMonth || 8);
  const [year, setYear] = useState(() => claimYear || 2026);
  const [campaignMode, setCampaignMode] = useState(actualOnly ? 'actual' : 'sample');
  const [filterClient, setFilterClient] = useState('');
  const [filterContract, setFilterContract] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterLoc, setFilterLoc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [activeId, setActiveId] = useState(null);
  const [confirmActual, setConfirmActual] = useState(false);
  const [sendResults, setSendResults] = useState(null);
  const [filterRows, setFilterRows] = useState([]);
  const [filterGates, setFilterGates] = useState({});
  const [filtersBusy, setFiltersBusy] = useState(true);

  const employees = preview?.employees || [];
  const recipients = preview?.recipients || [];
  const skipped = preview?.skipped || [];
  const gates = preview?.gates || filterGates || {};

  const clients = useMemo(() => {
    return [...new Set(filterRows.map(e => e.client).filter(Boolean))].sort();
  }, [filterRows]);

  const contracts = useMemo(() => {
    const pool = filterClient ? filterRows.filter(e => e.client === filterClient) : [];
    const map = new Map();
    for (const e of pool) {
      const key = e.contract_id || e.contract_name || '';
      if (!key) continue;
      if (!map.has(key)) map.set(key, e.contract_name || e.contract_id);
    }
    return [...map.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [filterRows, filterClient]);

  const departments = useMemo(() => {
    if (!filterClient) return [];
    return [...new Set(filterRows
      .filter(e => e.client === filterClient)
      .filter(e => !filterContract || e.contract_id === filterContract || e.contract_name === filterContract)
      .map(e => e.dept)
      .filter(Boolean))].sort();
  }, [filterRows, filterClient, filterContract]);

  const locations = useMemo(() => {
    if (!filterClient) return [];
    return [...new Set(filterRows
      .filter(e => e.client === filterClient)
      .filter(e => !filterContract || e.contract_id === filterContract || e.contract_name === filterContract)
      .filter(e => !filterDept || e.dept === filterDept)
      .map(e => e.location)
      .filter(Boolean))].sort();
  }, [filterRows, filterClient, filterContract, filterDept]);

  const visible = employees;

  const selectedVisible = visible.filter(e => selected.has(e.id));
  const allVisibleSelected = visible.length > 0 && visible.every(e => selected.has(e.id));

  const activeEmp = useMemo(
    () => employees.find(e => e.id === activeId) || selectedVisible[0] || null,
    [employees, activeId, selectedVisible]
  );
  const activeRecipient = useMemo(
    () => (activeEmp ? recipients.find(r => r.fillerEmail === activeEmp.fillerEmail) : null),
    [recipients, activeEmp]
  );

  const clearRoster = () => {
    setPreview(null);
    setSelected(new Set());
    setActiveId(null);
    setSendResults(null);
    setConfirmActual(false);
  };

  const setMonthYear = (m, y) => {
    setMonth(m);
    setYear(y);
    clearRoster();
    if (onPeriodChange) onPeriodChange(m, y);
  };

  useEffect(() => {
    if (claimMonth && claimYear && (claimMonth !== month || claimYear !== year)) {
      setMonth(claimMonth);
      setYear(claimYear);
    }
  }, [claimMonth, claimYear, month, year]);

  useEffect(() => {
    let cancelled = false;
    setFiltersBusy(true);
    api.portalClaimsCampaignFilters()
      .then((d) => {
        if (cancelled) return;
        setFilterRows(d.rows || []);
        setFilterGates(d.gates || {});
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message);
      })
      .finally(() => {
        if (!cancelled) setFiltersBusy(false);
      });
    return () => { cancelled = true; };
  }, []);

  const resetFilters = () => {
    setFilterClient('');
    setFilterContract('');
    setFilterDept('');
    setFilterLoc('');
    clearRoster();
  };

  const audience = () => ({
    filterClient, filterContract, filterDept, filterLoc,
  });

  const buildPreview = async () => {
    if (!filterClient) {
      setErr('Select a client first, then load employees.');
      return;
    }
    setBusy(true); setErr(''); setMsg(''); setSendResults(null); setConfirmActual(false);
    setSelected(new Set());
    setActiveId(null);
    try {
      const d = await api.portalClaimsCampaignPreview({
        month, year, campaignMode, dryRun: true,
        ...audience(),
      });
      setPreview(d);
      const n = d.employees?.length || d.summary?.employeeCount || 0;
      setMsg(`Loaded ${n} employee(s) for this filter. Tick who to send, then Send.`);
      if (onPeriodChange) onPeriodChange(month, year);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setActiveId(id);
  };

  const toggleAllVisible = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const e of visible) next.delete(e.id);
      } else {
        for (const e of visible) next.add(e.id);
      }
      return next;
    });
  };

  const runSend = async (mode) => {
    if (actualOnly && mode === 'sample') {
      setErr('Monthly Cycle sends live emails only. SAMPLE is not available here.');
      return;
    }
    if (!selected.size) {
      setErr('Tick at least one employee, then Send.');
      return;
    }
    if (mode === 'actual' && !gates.actualSendAllowed) {
      setErr('ACTUAL send is blocked until CLAIMS_ALLOW_ACTUAL_SEND=true is set on the backend.');
      return;
    }
    if (mode === 'actual' && !confirmActual) {
      setErr('Tick the confirmation box before sending ACTUAL emails.');
      return;
    }
    if (mode === 'sample' && !gates.sampleEmailConfigured) {
      setErr('SAMPLE send needs CLAIMS_SAMPLE_EMAIL on the backend.');
      return;
    }
    const ids = [...selected];
    const fillerCount = new Set(employees.filter(e => selected.has(e.id)).map(e => e.fillerEmail)).size;
    const label = mode === 'sample' ? 'SAMPLE' : 'ACTUAL';
    if (!window.confirm(`Send ${label} invites for ${ids.length} employee(s) → ${fillerCount} email(s) for ${month}/${year}?`)) return;

    setBusy(true); setErr(''); setMsg(''); setSendResults(null);
    try {
      const d = await api.portalClaimsCampaign({
        month, year, dryRun: false, campaignMode: mode,
        onlyEmployeeIds: ids,
        ...audience(),
      });
      const invites = d.invites || [];
      const ok = invites.filter(i => i.ok).length;
      const fail = invites.filter(i => !i.ok);
      setSendResults(invites);
      setMsg(mode === 'sample'
        ? `SAMPLE sent — ${ok} email(s) redirected to ${gates.sampleEmail || 'the sample inbox'} for ${ids.length} employee(s).${fail.length ? ` ${fail.length} failed.` : ''}`
        : `ACTUAL sent — ${ok} email(s) covering ${ids.length} employee(s).${fail.length ? ` ${fail.length} failed.` : ''}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!user && (
    ['superadmin', 'finance_manager', 'finance_approver', 'operations_supervisor'].includes(user.role)
    || !!(user.permissions?.claims_portal?.subPerms || []).includes('campaign')
    || (Array.isArray(user.permissions?.claims_portal) && user.permissions.claims_portal.includes('campaign'))
  );
  const selectedFillerCount = new Set(employees.filter(e => selected.has(e.id)).map(e => e.fillerEmail)).size;

  return (
    <div style={{
      marginBottom: 28, padding: 16, borderRadius: 12,
      border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.04)',
    }}>
      <h3 style={{ margin: '0 0 4px' }}>Send claim request emails</h3>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)', maxWidth: 860, lineHeight: 1.5 }}>
        {actualOnly
          ? 'These emails go to the real Focal / LM addresses. Choose Client (then Contract / Department / Location if you want), Load employees, tick who to send, confirm, and Send.'
          : 'Choose Client (then Contract / Department / Location if you want), then Load employees. Only that slice is fetched. Tick who to send. Focals get one email for their nominated people.'}
      </p>

      {err && <div style={{ color: '#fca5a5', marginBottom: 10 }}>{err}</div>}
      {msg && <div style={{ color: '#86efac', marginBottom: 10 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        {!hidePeriod && (
          <>
        <Field label="1. Claim month">
          <select value={month} onChange={e => setMonthYear(+e.target.value, year)} style={selectStyle}>
            {MONTHS.map(([n, lab]) => <option key={n} value={n}>{lab}</option>)}
          </select>
        </Field>
        <Field label="Year">
          <input type="number" value={year} onChange={e => setMonthYear(month, +e.target.value)}
            style={{ ...selectStyle, width: 90, minWidth: 90 }} />
        </Field>
          </>
        )}
        {!actualOnly && ['sample', 'actual'].map(m => (
          <button key={m} type="button" onClick={() => { setCampaignMode(m); clearRoster(); }}
            style={{
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, height: 38,
              border: campaignMode === m ? '2px solid #22c55e' : '1px solid var(--border)',
              background: campaignMode === m ? 'rgba(34,197,94,0.15)' : 'transparent',
              color: campaignMode === m ? '#22c55e' : 'var(--text-muted)',
            }}>
            {m.toUpperCase()}
          </button>
        ))}
        {actualOnly && (
          <span style={{ fontSize: 12, color: '#86efac', paddingBottom: 8, fontWeight: 700 }}>
            Live send
          </span>
        )}
        {campaignMode === 'sample' && (
          <span style={{ fontSize: 12, color: '#fcd34d', paddingBottom: 8, maxWidth: 420, lineHeight: 1.4 }}>
            SAMPLE mode — emails deliver to the test inbox only. The table shows each employee&apos;s real Focal/LM address; SAMPLE sends redirect to {gates.sampleEmail || 'CLAIMS_SAMPLE_EMAIL'}.
          </span>
        )}
        <button type="button" className="btn-primary" disabled={busy || filtersBusy || !filterClient} onClick={buildPreview}
          style={{ height: 38 }}>
          {busy ? 'Loading…' : preview ? 'Reload this filter' : 'Load employees'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', paddingBottom: 8 }}>Submit by day 18 · LM approve by day 22</span>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <Field label="2. Client">
          <select value={filterClient} disabled={filtersBusy}
            onChange={e => { setFilterClient(e.target.value); setFilterContract(''); setFilterDept(''); setFilterLoc(''); clearRoster(); }}
            style={{ ...selectStyle, opacity: filtersBusy ? 0.5 : 1 }}>
            <option value="">{filtersBusy ? 'Loading clients…' : 'Select client…'}</option>
            {clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="3. Contract">
          <select value={filterContract} disabled={!filterClient}
            onChange={e => { setFilterContract(e.target.value); setFilterDept(''); setFilterLoc(''); clearRoster(); }}
            style={{ ...selectStyle, opacity: filterClient ? 1 : 0.5 }}>
            <option value="">{filterClient ? 'All contracts' : 'Select client first'}</option>
            {contracts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>
        <Field label="4. Department">
          <select value={filterDept} disabled={!filterClient}
            onChange={e => { setFilterDept(e.target.value); setFilterLoc(''); clearRoster(); }}
            style={{ ...selectStyle, opacity: filterClient ? 1 : 0.5 }}>
            <option value="">{filterClient ? 'All departments' : 'Select client first'}</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="5. Location">
          <select value={filterLoc} disabled={!filterClient}
            onChange={e => { setFilterLoc(e.target.value); clearRoster(); }}
            style={{ ...selectStyle, opacity: filterClient ? 1 : 0.5 }}>
            <option value="">{filterClient ? 'All locations' : 'Select client first'}</option>
            {locations.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        {filterClient && (
          <button type="button" onClick={resetFilters}
            style={{ height: 38, fontSize: 12, color: '#f87171', background: 'transparent', border: '1px solid #ef444440', borderRadius: 8, padding: '0 12px', cursor: 'pointer' }}>
            Clear filters
          </button>
        )}
      </div>

      {gates && (gates.sampleEmailConfigured || gates.actualSendAllowed !== undefined) && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          {!actualOnly && (
            <>
              SAMPLE inbox: {gates.sampleEmailConfigured ? gates.sampleEmail : 'not configured (CLAIMS_SAMPLE_EMAIL)'}
              {' · '}
            </>
          )}
          ACTUAL send: {gates.actualSendAllowed ? 'allowed' : 'blocked until CLAIMS_ALLOW_ACTUAL_SEND=true'}
          {Array.isArray(gates.monitorCc) && gates.monitorCc.length > 0 && (
            <>
              {' · '}
              CC: {gates.monitorCc.join(', ')}
            </>
          )}
        </div>
      )}

      {!preview && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          {filterClient
            ? 'Filters are set. Click Load employees to pull only this slice.'
            : 'Select a client first. The full roster is not loaded until you do.'}
        </p>
      )}

      {preview && (
        <>
          {filterClient && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) minmax(280px,0.75fr)', gap: 14, alignItems: 'start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button type="button" onClick={toggleAllVisible}
                    style={{ background: '#14532d', border: '1px solid #22c55e', color: '#bbf7d0', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                    Select / clear all pending
                  </button>
                  <span style={{ fontSize: 13, color: '#e2e8f0' }}>
                    {selected.size
                      ? <><strong style={{ color: '#22c55e' }}>{selected.size}</strong> selected · {selectedFillerCount} email(s) · {visible.length} in this filter</>
                      : 'Tick the green boxes, then Send. Only ticked employees are included.'}
                  </span>
                </div>
                <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 480 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: 'var(--bg-dark, #0c0f14)', position: 'sticky', top: 0 }}>
                      <tr>
                        {['Send?', 'Employee', 'Dept', 'Contract', 'Location', 'Path', 'Email goes to', 'Approver'].map(h => (
                          <th key={h} style={th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.length === 0 && (
                        <tr><td colSpan={8} style={{ ...td, color: 'var(--text-muted)' }}>No employees for this filter.</td></tr>
                      )}
                      {visible.map((e, i) => {
                        const picked = selected.has(e.id);
                        const isActive = activeId === e.id;
                        return (
                          <tr key={e.id}
                            onClick={() => setActiveId(e.id)}
                            style={{
                              borderTop: '1px solid var(--border)',
                              background: picked ? 'rgba(34,197,94,0.12)' : (isActive ? 'rgba(56,189,248,0.08)' : (i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent')),
                              cursor: 'pointer',
                            }}>
                            <td style={td} onClick={ev => ev.stopPropagation()}>
                              <button type="button" title={picked ? 'Selected' : 'Select to send'}
                                onClick={() => toggleOne(e.id)}
                                style={{
                                  width: 22, height: 22, borderRadius: 4, padding: 0,
                                  border: '2px solid #22c55e',
                                  background: picked ? '#22c55e' : '#052e16',
                                  color: '#fff', fontWeight: 800, fontSize: 13, lineHeight: 1,
                                  cursor: 'pointer',
                                }}>
                                {picked ? '✓' : ''}
                              </button>
                            </td>
                            <td style={{ ...td, fontWeight: 600, color: '#f0f4f8' }}>
                              {e.name}
                              <div style={{ fontSize: 11, color: '#64748b' }}>{e.id}</div>
                            </td>
                            <td style={{ ...td, color: '#94a3b8', fontSize: 12 }}>{e.dept || '—'}</td>
                            <td style={{ ...td, color: '#94a3b8', fontSize: 12 }}>{e.contract_name || e.contract_id || '—'}</td>
                            <td style={{ ...td, color: '#94a3b8' }}>{e.location || '—'}</td>
                            <td style={td}><PathBadge profile={e.routingProfile} label={e.roleLabel} /></td>
                            <td style={{ ...td, fontSize: 12 }}>
                              <div>{e.fillerEmail || e.mailTo || '—'}</div>
                              {e.sampleRedirect && campaignMode === 'sample' && (
                                <div style={{ fontSize: 11, color: '#fcd34d' }}>
                                  SAMPLE sends to {gates.sampleEmail || 'sample inbox'}
                                </div>
                              )}
                            </td>
                            <td style={{ ...td, fontSize: 12, color: '#94a3b8' }}>{e.approverEmail || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{
                border: '1px solid var(--border)', borderRadius: 10, padding: 12,
                background: 'var(--bg-dark, #0c0f14)', minHeight: 280,
              }}>
                {!activeRecipient && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Click an employee to preview the email that person&apos;s filler will receive.</p>}
                {activeRecipient && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Email preview</div>
                    <div style={{ fontSize: 13, marginBottom: 4 }}><strong>To:</strong> {activeRecipient.mailTo}</div>
                    {(activeRecipient.cc || gates.monitorCc || []).length > 0 && (
                      <div style={{ fontSize: 13, marginBottom: 4 }}><strong>CC:</strong> {(activeRecipient.cc || gates.monitorCc).join(', ')}</div>
                    )}
                    {activeRecipient.sampleRedirect && (
                      <div style={{ fontSize: 12, color: '#fcd34d', marginBottom: 4 }}>Would go to {activeRecipient.fillerEmail}</div>
                    )}
                    <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Subject:</strong> {activeRecipient.subject}</div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 10px' }}>
                      {PROFILE_EXPLAIN[activeRecipient.routingProfile] || activeRecipient.roleLabel}
                      {activeEmp && selected.has(activeEmp.id)
                        ? ' Send will list only the ticked employees for this filler.'
                        : ' Tick this employee to include them in the send.'}
                    </p>
                    <iframe
                      title="Email preview"
                      sandbox=""
                      srcDoc={activeRecipient.html || ''}
                      style={{ width: '100%', height: 380, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {canSend && filterClient && (
            <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {!actualOnly && (
              <button type="button"
                disabled={busy || !selected.size}
                onClick={() => runSend('sample')}
                style={{
                  background: selected.size ? '#14532d' : 'transparent',
                  border: '1px solid #22c55e', color: '#bbf7d0',
                  padding: '8px 16px', borderRadius: 8, cursor: selected.size ? 'pointer' : 'not-allowed',
                  fontWeight: 700, fontSize: 13, opacity: selected.size ? 1 : 0.5,
                }}>
                Send SAMPLE ({selected.size} employee{selected.size === 1 ? '' : 's'} → {selectedFillerCount} email{selectedFillerCount === 1 ? '' : 's'})
              </button>
              )}
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={confirmActual} onChange={e => setConfirmActual(e.target.checked)}
                  disabled={!gates.actualSendAllowed} />
                I confirm sending {selectedFillerCount} ACTUAL email(s) for {selected.size} employee(s)
              </label>
              <button type="button"
                disabled={busy || !selected.size || !confirmActual || !gates.actualSendAllowed}
                onClick={() => runSend('actual')}
                style={{
                  background: '#22c55e', border: 'none', color: '#052e16',
                  padding: '8px 16px', borderRadius: 8, fontWeight: 800, fontSize: 13,
                  cursor: (!selected.size || !confirmActual || !gates.actualSendAllowed) ? 'not-allowed' : 'pointer',
                  opacity: (!selected.size || !confirmActual || !gates.actualSendAllowed) ? 0.45 : 1,
                }}>
                Send ACTUAL to {selected.size} selected
              </button>
              {!gates.actualSendAllowed && (
                <span style={{ fontSize: 12, color: '#fca5a5' }}>
                  {actualOnly
                    ? 'Live send is blocked on this server until CLAIMS_ALLOW_ACTUAL_SEND=true.'
                    : 'ACTUAL is blocked on this server. Set CLAIMS_ALLOW_ACTUAL_SEND=true on Render after the SAMPLE looks right.'}
                </span>
              )}
            </div>
          )}

          {sendResults && (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <th style={th}>Filler</th>
                    <th style={th}>To</th>
                    <th style={th}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {sendResults.map((i, idx) => (
                    <tr key={i.fillerEmail || idx} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={td}>{i.fillerEmail}</td>
                      <td style={td}>{i.mailTo || '—'}</td>
                      <td style={{ ...td, color: i.ok ? '#86efac' : '#fca5a5' }}>{i.ok ? 'Sent' : (i.error || 'Failed')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {skipped.length > 0 && <ExcludedPanel skipped={skipped} />}
        </>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function PathBadge({ profile, label }) {
  const text = PROFILE_LABEL[profile] || label || profile || '—';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.06)',
      border: '1px solid var(--border)', whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

function ExcludedPanel({ skipped }) {
  const [showNotEligible, setShowNotEligible] = useState(false);
  const setup = skipped.filter(s => s.category === 'setup_needed');
  const notEligible = skipped.filter(s => s.category !== 'setup_needed');
  const rows = showNotEligible ? skipped : setup;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Excluded — fix in Employee Information</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
        Setup needed ({setup.length}) = no Focal, no Wafi/ASIL mailbox, and no Line Manager. Sadia Komal is emailed a link to update these.
        {notEligible.length > 0 && (
          <>
            {' '}Other skipped ({notEligible.length}).
            {' '}
            <button type="button" className="btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => setShowNotEligible(v => !v)}>
              {showNotEligible ? 'Hide skipped' : 'Show skipped'}
            </button>
          </>
        )}
      </p>
      {rows.length === 0 && (
        <p style={{ fontSize: 12, color: '#86efac', margin: 0 }}>No roster setup gaps — every listed employee has a filler email.</p>
      )}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={th}>Employee</th>
                <th style={th}>Dept</th>
                <th style={th}>Client</th>
                <th style={th}>Category</th>
                <th style={th}>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={`${s.employee_id || i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={td}>{s.name || '—'}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.employee_id}</div></td>
                  <td style={td}>{s.dept || '—'}</td>
                  <td style={td}>{s.client || '—'}</td>
                  <td style={td}>{s.category === 'setup_needed' ? 'Setup needed' : (s.category === 'not_eligible' ? 'Not eligible' : '—')}</td>
                  <td style={td}>{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
