import React, { useState, useEffect, useCallback } from 'react';
import { Mail, RefreshCw, Send, CheckCircle, XCircle, AlertTriangle, Clock, Users, DollarSign, FileText, Play, Eye, X } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
const tok = () => localStorage.getItem('asil_hcm_token');
const apiFetch = (path, opts = {}) => fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } }).then(r => r.json());

const fmt = n => (parseFloat(n) || 0).toLocaleString('en-PK');
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const monthName = d => d ? new Date(d).toLocaleString('en-PK', { month: 'long', year: 'numeric' }) : '—';

const STATUS_CONFIG = {
  PENDING:           { label: 'Pending Review',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  BODY_PARSED:       { label: 'Body Parsed',         color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  UNMATCHED:         { label: 'No Employee Match',   color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  NO_ATTACHMENT:     { label: 'No File',             color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
  NO_CONTENT:        { label: 'No Data',             color: '#475569', bg: 'rgba(71,85,105,0.10)' },
  DUPLICATE:         { label: 'Duplicate',           color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
  INVALID_MONTH:     { label: 'Invalid Month',       color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval',   color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  APPROVED:          { label: 'Approved',            color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  PROCESSED:         { label: '✓ Pushed to Payroll', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  REJECTED:          { label: 'Rejected',            color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};
const IRRELEVANT_STATUSES = ['NO_ATTACHMENT','NO_CONTENT','INVALID_MONTH','DUPLICATE'];

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
  return (
    <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700, color: cfg.color, background: cfg.bg, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(); d.setMonth(d.getMonth() - i);
  return { label: d.toLocaleString('en-PK', { month: 'long', year: 'numeric' }), value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` };
});

export default function EmailClaimsListener({ user }) {
  const [tab, setTab] = useState('inbox');
  const [claims, setClaims] = useState([]);
  const [stats, setStats] = useState({});
  const [listenerStatus, setListenerStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState(null);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterMonth, setFilterMonth] = useState('');
  const [hideIrrelevant, setHideIrrelevant] = useState(true);
  // Push to payroll state
  const [pushMonth, setPushMonth] = useState(MONTHS[0]?.value || '');
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);
  const [adjOt2, setAdjOt2] = useState('');
  const [adjOt3, setAdjOt3] = useState('');
  const [adjAmt, setAdjAmt] = useState('');

  // Consolidation tab
  const [consMonth, setConsMonth] = useState(MONTHS[0]?.value || '');
  const [consRows, setConsRows] = useState([]);
  const [consTotals, setConsTotals] = useState({});
  const [consLoading, setConsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  // Approval tab
  const [cycles, setCycles] = useState([]);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'ALL') params.set('status', filterStatus);
      if (filterMonth) params.set('month', filterMonth);
      const d = await apiFetch(`/api/claims/inbox?${params}`);
      setClaims(d.claims || []);
      setStats(d.stats || {});
    } catch {}
    setLoading(false);
  }, [filterStatus, filterMonth]);

  const loadListenerStatus = useCallback(async () => {
    try { const d = await apiFetch('/api/claims/listener-status'); setListenerStatus(d); } catch {}
  }, []);

  const loadConsolidation = useCallback(async () => {
    if (!consMonth) return;
    setConsLoading(true);
    try {
      const d = await apiFetch(`/api/claims/consolidation?month=${consMonth}`);
      setConsRows(d.rows || []);
      setConsTotals(d.totals || {});
    } catch {}
    setConsLoading(false);
  }, [consMonth]);

  const loadCycles = useCallback(async () => {
    try { const d = await apiFetch('/api/claims/approval-cycles'); setCycles(d.cycles || []); } catch {}
  }, []);

  useEffect(() => { loadInbox(); loadListenerStatus(); }, [loadInbox, loadListenerStatus]);
  useEffect(() => { if (tab === 'consolidation') loadConsolidation(); }, [tab, consMonth, loadConsolidation]);
  useEffect(() => { if (tab === 'approvals') loadCycles(); }, [tab, loadCycles]);

  const runPoll = async () => {
    setPolling(true); setPollResult(null);
    try {
      const d = await apiFetch('/api/claims/trigger-poll', { method: 'POST', body: '{}' });
      setPollResult(d);
      await loadInbox();
      await loadListenerStatus();
    } catch (e) { setPollResult({ error: e.message }); }
    setPolling(false);
  };

  const pushToPayroll = async (claimId) => {
    setPushing(true); setPushResult(null);
    try {
      const mo = MONTHS.find(m => m.value === pushMonth) || MONTHS[0];
      const mNum = mo ? (new Date(mo.value).getMonth() + 1) : new Date().getMonth() + 1;
      const yNum = mo ? new Date(mo.value).getFullYear() : new Date().getFullYear();
      // Save adjustments first if entered
      if (adjOt2 || adjOt3 || adjAmt) {
        await apiFetch(`/api/claims/${claimId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({
            ot_hours_2x: adjOt2 ? parseFloat(adjOt2) : undefined,
            ot_hours_3x: adjOt3 ? parseFloat(adjOt3) : undefined,
            claim_amount: adjAmt ? parseFloat(adjAmt) : undefined,
          }),
        });
      }
      const d = await apiFetch(`/api/claims/${claimId}/push-to-payroll`, {
        method: 'POST',
        body: JSON.stringify({ month: mNum, year: yNum }),
      });
      if (d.error) throw new Error(d.error);
      setPushResult({ ok: true, msg: d.message });
      await loadInbox();
      setSelectedClaim(null);
    } catch (e) { setPushResult({ error: e.message }); }
    setPushing(false);
  };

  const sendApprovals = async () => {
    setSending(true); setSendResult(null);
    try {
      const d = await apiFetch('/api/claims/send-approval-emails', { method: 'POST', body: JSON.stringify({ month: consMonth }) });
      setSendResult(d);
      await loadConsolidation();
    } catch (e) { setSendResult({ error: e.message }); }
    setSending(false);
  };

  const s = { background: '#0d1b2a', minHeight: '100vh', padding: '2rem', fontFamily: 'Inter, sans-serif', color: '#e2e8f0' };
  const card = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '1.25rem' };
  const btn = (col = '#6366f1', bg = 'rgba(99,102,241,0.15)') => ({ display: 'flex', alignItems: 'center', gap: '6px', background: bg, border: `1px solid ${col}`, color: col, padding: '0.55rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' });
  const th = { padding: '10px 12px', textAlign: 'left', color: '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' };
  const td = { padding: '10px 12px', fontSize: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle' };

  return (
    <div style={s}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Mail size={22} color="#6366f1" /> Email Claims Listener
          </h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            Processes OT, Expense & OPD claims from email attachments (ER3/TR3 forms)
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {listenerStatus && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', background: listenerStatus.configured ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${listenerStatus.configured ? '#22c55e' : '#ef4444'}` }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: listenerStatus.configured ? '#22c55e' : '#ef4444' }} />
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: listenerStatus.configured ? '#22c55e' : '#ef4444' }}>
                {listenerStatus.configured ? `Monitoring ${listenerStatus.inbox}` : 'Not Configured'}
              </span>
            </div>
          )}
          <button onClick={runPoll} disabled={polling} style={{ ...btn('#38bdf8', 'rgba(56,189,248,0.12)'), opacity: polling ? 0.7 : 1 }}>
            {polling ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
            {polling ? 'Running…' : 'Run Now'}
          </button>
        </div>
      </div>

      {/* Poll result */}
      {pollResult && (
        <div style={{ ...card, marginBottom: '1rem', borderColor: pollResult.error ? '#ef4444' : '#22c55e' }}>
          {pollResult.error
            ? <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>❌ {pollResult.error}</span>
            : <span style={{ color: '#22c55e', fontSize: '0.85rem' }}>✅ Poll complete — {pollResult.result?.processed || 0} attachment claims, {pollResult.result?.bodyParsed || 0} body-parsed, {pollResult.result?.duplicates || 0} duplicates</span>
          }
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Emails', value: stats.total || 0, icon: <Mail size={16} />, color: '#6366f1' },
          { label: 'Pending Review', value: stats.pending || 0, icon: <Clock size={16} />, color: '#f59e0b' },
          { label: 'Unmatched', value: stats.unmatched || 0, icon: <AlertTriangle size={16} />, color: '#ef4444' },
          { label: 'Approved', value: stats.approved || 0, icon: <CheckCircle size={16} />, color: '#22c55e' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={{ ...card, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color, fontSize: '0.75rem', fontWeight: 600 }}>{icon}{label}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '1.5rem' }}>
        {[['inbox', 'Inbox Monitor'], ['consolidation', 'Consolidation & Approval'], ['approvals', 'Approval Tracking']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: '0.75rem 1.25rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === k ? '#6366f1' : 'transparent'}`, color: tab === k ? '#6366f1' : '#64748b', cursor: 'pointer', fontWeight: tab === k ? 700 : 400, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>{l}</button>
        ))}
      </div>

      {/* ── TAB: INBOX ── */}
      {tab === 'inbox' && (
        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
          {/* Left: table */}
          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '7px 10px', borderRadius: '8px', fontSize: '0.85rem' }}>
                <option value="ALL">All Statuses</option>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '7px 10px', borderRadius: '8px', fontSize: '0.85rem' }}>
                <option value="">All Months</option>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <button onClick={loadInbox} style={btn()}><RefreshCw size={14} /> Refresh</button>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.84rem', color: '#94a3b8', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={hideIrrelevant} onChange={e => setHideIrrelevant(e.target.checked)} style={{ accentColor: '#6366f1' }} />
                Hide irrelevant (no data/file)
              </label>
            </div>
            <div style={{ overflowX: 'auto', ...card, padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Received', 'From', 'File / Source', 'Synopsis', 'Month', 'Employee', 'Type', 'Status', ''].map(h => <th key={h} style={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#64748b', padding: '2rem' }}>Loading…</td></tr>
                  ) : (() => {
                    const displayed = hideIrrelevant ? claims.filter(c => !IRRELEVANT_STATUSES.includes(c.status)) : claims;
                    return displayed.length === 0 ? (
                      <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No emails found. Run the poll or adjust filters.</td></tr>
                    ) : displayed.map(c => (
                      <tr key={c.id} style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ ...td, fontSize: '0.78rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(c.received_at)}</td>
                        <td style={{ ...td, maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#94a3b8', fontSize: '0.78rem' }}>{c.sender_email}</td>
                        <td style={{ ...td, maxWidth: '150px', fontSize: '0.78rem' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#cbd5e1' }}>
                            {c.attachment_filename || c.subject?.slice(0, 22) || '—'}
                          </div>
                          {c.body_parsed && <span style={{ fontSize: '0.68rem', color: '#38bdf8' }}>📧 body parsed</span>}
                        </td>
                        <td style={{ ...td, maxWidth: '180px', fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {c.synopsis || '—'}
                          </div>
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>{monthName(c.claim_month)}</td>
                        <td style={{ ...td, fontSize: '0.82rem' }}>{c.employee_name || <span style={{ color: '#ef4444', fontSize: '0.75rem' }}>Not matched</span>}</td>
                        <td style={td}><span style={{ fontSize: '0.75rem', fontWeight: 600, color: c.claim_type === 'OT' ? '#a78bfa' : '#f59e0b' }}>{c.claim_type || '—'}</span></td>
                        <td style={td}><StatusBadge status={c.status} /></td>
                        <td style={td}><button onClick={() => { setSelectedClaim(c); setAdjOt2(''); setAdjOt3(''); setAdjAmt(''); setPushResult(null); }} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}><Eye size={12} /></button></td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right: detail panel */}
          {selectedClaim && (
            <div style={{ width: '320px', flexShrink: 0, ...card, overflowY: 'auto', maxHeight: '82vh' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Claim Detail</span>
                <button onClick={() => setSelectedClaim(null)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={16} /></button>
              </div>
              <div style={{ marginBottom: '0.75rem' }}><StatusBadge status={selectedClaim.status} /></div>
              {selectedClaim.match_remark && (
                <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '8px', marginBottom: '0.75rem', fontSize: '0.78rem', color: '#f59e0b' }}>
                  ⚠ {selectedClaim.match_remark}
                </div>
              )}
              {selectedClaim.synopsis && (
                <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px', padding: '10px', marginBottom: '0.75rem', fontSize: '0.79rem', color: '#c7d2fe', fontStyle: 'italic', lineHeight: 1.5 }}>
                  "{selectedClaim.synopsis}"
                </div>
              )}
              {[
                ['Employee', selectedClaim.employee_name || '—'],
                ['ASIL Code', selectedClaim.employee_id || '—'],
                ['Dept', selectedClaim.dept || '—'],
                ['Claim Month', monthName(selectedClaim.claim_month)],
                ['Form Type', selectedClaim.claim_type || '—'],
                ['OT 1X Hrs', selectedClaim.ot_hours_1x || '—'],
                ['OT 2X Hrs', selectedClaim.ot_hours_2x || '—'],
                ['OT 3X Hrs', selectedClaim.ot_hours_3x || '—'],
                ['Expense PKR', selectedClaim.claim_amount ? `PKR ${fmt(selectedClaim.claim_amount)}` : '—'],
                ['Line Manager', selectedClaim.line_manager_name || '—'],
                ['Mgr Email', selectedClaim.line_manager_email || '—'],
                ['Source', selectedClaim.attachment_filename || (selectedClaim.body_parsed ? '📧 Email Body' : '—')],
                ['From', selectedClaim.sender_email],
                ['Received', fmtDate(selectedClaim.received_at)],
                ...(selectedClaim.pushed_at ? [['Pushed', fmtDate(selectedClaim.pushed_at)], ['Payroll', `${selectedClaim.payroll_month}/${selectedClaim.payroll_year}`]] : []),
              ].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.81rem' }}>
                  <span style={{ color: '#64748b' }}>{l}</span>
                  <span style={{ color: '#e2e8f0', textAlign: 'right', maxWidth: '58%', wordBreak: 'break-all' }}>{v}</span>
                </div>
              ))}
              {selectedClaim.raw_body && (
                <details style={{ marginTop: '0.75rem' }}>
                  <summary style={{ fontSize: '0.78rem', color: '#64748b', cursor: 'pointer' }}>Email body preview</summary>
                  <div style={{ marginTop: '6px', padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px', fontSize: '0.72rem', color: '#94a3b8', maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {selectedClaim.raw_body?.slice(0, 600)}
                  </div>
                </details>
              )}
              {!['PROCESSED','REJECTED'].includes(selectedClaim.status) && selectedClaim.employee_id && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Push to Payroll</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                    <div>
                      <label style={{ fontSize: '0.68rem', color: '#64748b' }}>OT 2X Hrs</label>
                      <input value={adjOt2} onChange={e => setAdjOt2(e.target.value)} placeholder={selectedClaim.ot_hours_2x || '0'} type="number" step="0.25" style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '5px 8px', borderRadius: '6px', fontSize: '0.82rem', width: '100%' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.68rem', color: '#64748b' }}>OT 3X Hrs</label>
                      <input value={adjOt3} onChange={e => setAdjOt3(e.target.value)} placeholder={selectedClaim.ot_hours_3x || '0'} type="number" step="0.25" style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '5px 8px', borderRadius: '6px', fontSize: '0.82rem', width: '100%' }} />
                    </div>
                    <div style={{ gridColumn: '1/-1' }}>
                      <label style={{ fontSize: '0.68rem', color: '#64748b' }}>Amount PKR</label>
                      <input value={adjAmt} onChange={e => setAdjAmt(e.target.value)} placeholder={selectedClaim.claim_amount || '0'} type="number" style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '5px 8px', borderRadius: '6px', fontSize: '0.82rem', width: '100%' }} />
                    </div>
                  </div>
                  <select value={pushMonth} onChange={e => setPushMonth(e.target.value)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '7px 10px', borderRadius: '8px', fontSize: '0.84rem', width: '100%', marginBottom: '8px' }}>
                    {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <button onClick={() => pushToPayroll(selectedClaim.id)} disabled={pushing} style={{ ...btn('#22c55e', 'rgba(34,197,94,0.15)'), width: '100%', justifyContent: 'center', opacity: pushing ? 0.7 : 1 }}>
                    <CheckCircle size={14} /> {pushing ? 'Pushing…' : '✓ Push to Payroll'}
                  </button>
                  {pushResult && (
                    <div style={{ marginTop: '8px', padding: '8px', borderRadius: '8px', background: pushResult.error ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', fontSize: '0.78rem', color: pushResult.error ? '#ef4444' : '#22c55e' }}>
                      {pushResult.error || pushResult.msg}
                    </div>
                  )}
                </div>
              )}
              {selectedClaim.status === 'PROCESSED' && (
                <div style={{ marginTop: '1rem', padding: '10px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', fontSize: '0.8rem', color: '#22c55e', textAlign: 'center' }}>
                  ✓ Pushed to {selectedClaim.payroll_month}/{selectedClaim.payroll_year} payroll on {fmtDate(selectedClaim.pushed_at)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: CONSOLIDATION ── */}
      {tab === 'consolidation' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <select value={consMonth} onChange={e => setConsMonth(e.target.value)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '8px 12px', borderRadius: '8px', fontSize: '0.85rem' }}>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <button onClick={loadConsolidation} style={btn()}><RefreshCw size={14} /> Refresh</button>
            </div>
            <button onClick={sendApprovals} disabled={sending || consRows.length === 0} style={{ ...btn('#22c55e', 'rgba(34,197,94,0.15)'), opacity: (sending || consRows.length === 0) ? 0.6 : 1 }}>
              <Send size={14} /> {sending ? 'Sending…' : 'Send Approval Emails'}
            </button>
          </div>

          {sendResult && (
            <div style={{ ...card, marginBottom: '1rem', borderColor: sendResult.error ? '#ef4444' : '#22c55e' }}>
              {sendResult.error
                ? <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>❌ {sendResult.error}</span>
                : <span style={{ color: '#22c55e', fontSize: '0.85rem' }}>✅ Sent to {sendResult.sent} manager(s). {sendResult.errors?.length ? `${sendResult.errors.length} failed.` : ''}</span>}
            </div>
          )}

          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            {[
              { label: 'Employees', value: consTotals.employees || 0, color: '#6366f1', icon: <Users size={14} /> },
              { label: 'OT 2X Hours', value: (consTotals.ot2Hours || 0).toFixed(1), color: '#a78bfa', icon: <Clock size={14} /> },
              { label: 'OT 3X Hours', value: (consTotals.ot3Hours || 0).toFixed(1), color: '#8b5cf6', icon: <Clock size={14} /> },
              { label: 'Expenses PKR', value: `PKR ${fmt(consTotals.expense || 0)}`, color: '#f59e0b', icon: <DollarSign size={14} /> },
              { label: 'OPD PKR', value: `PKR ${fmt(consTotals.opd || 0)}`, color: '#38bdf8', icon: <DollarSign size={14} /> },
            ].map(({ label, value, color, icon }) => (
              <div key={label} style={{ ...card }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color, fontSize: '0.72rem', fontWeight: 600, marginBottom: '4px' }}>{icon}{label}</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ overflowX: 'auto', ...card, padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>{['Employee', 'ASIL Code', 'Dept', 'OT 2X hrs', 'OT 3X hrs', 'Expense (PKR)', 'OPD (PKR)', 'Line Manager', 'Status'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {consLoading ? (
                  <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#64748b', padding: '2rem' }}>Loading…</td></tr>
                ) : consRows.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No pending claims for {monthName(consMonth)}.</td></tr>
                ) : consRows.map(r => (
                  <tr key={r.employee_id}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.employee_name}</td>
                    <td style={{ ...td, color: '#94a3b8', fontSize: '0.8rem' }}>{r.employee_id}</td>
                    <td style={{ ...td, color: '#94a3b8', fontSize: '0.8rem' }}>{r.dept || '—'}</td>
                    <td style={{ ...td, textAlign: 'center', color: '#a78bfa', fontWeight: 600 }}>{r.ot2_hours || '—'}</td>
                    <td style={{ ...td, textAlign: 'center', color: '#8b5cf6', fontWeight: 600 }}>{r.ot3_hours || '—'}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#f59e0b' }}>{r.expense_amount ? `PKR ${fmt(r.expense_amount)}` : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#38bdf8' }}>{r.opd_amount ? `PKR ${fmt(r.opd_amount)}` : '—'}</td>
                    <td style={{ ...td, fontSize: '0.8rem', color: '#94a3b8' }}>{r.line_manager_name || <span style={{ color: '#ef4444' }}>⚠ Not set</span>}</td>
                    <td style={td}><StatusBadge status={r.claim_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: APPROVAL TRACKING ── */}
      {tab === 'approvals' && (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Month', 'Manager', 'Manager Email', 'Employees', 'Total PKR', 'Sent', 'Responded', 'Decision'].map(h => <th key={h} style={th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {cycles.length === 0 ? (
                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No approval cycles yet. Send approval emails from the Consolidation tab.</td></tr>
              ) : cycles.map(c => (
                <tr key={c.id}>
                  <td style={td}>{monthName(c.cycle_month)}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{c.manager_name || '—'}</td>
                  <td style={{ ...td, color: '#94a3b8', fontSize: '0.8rem' }}>{c.manager_email}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{c.claims_count}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#f59e0b' }}>PKR {fmt(c.total_value)}</td>
                  <td style={{ ...td, fontSize: '0.8rem', color: '#64748b' }}>{fmtDate(c.sent_at)}</td>
                  <td style={{ ...td, fontSize: '0.8rem', color: '#64748b' }}>{c.responded_at ? fmtDate(c.responded_at) : <span style={{ color: '#f59e0b' }}>Awaiting</span>}</td>
                  <td style={td}>
                    {!c.response ? <StatusBadge status="AWAITING_APPROVAL" /> :
                      c.response === 'APPROVED' ? <StatusBadge status="APPROVED" /> :
                      <StatusBadge status="REJECTED" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
