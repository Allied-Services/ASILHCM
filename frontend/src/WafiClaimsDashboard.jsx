import React, { useState, useEffect, useCallback } from 'react';
import {
  Inbox, RefreshCw, Play, CheckCircle, XCircle, AlertTriangle,
  Clock, FileText, Download, ChevronDown, ChevronUp, Filter,
  Search, Calendar, Wifi, WifiOff, Package, X, Layers,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
const tok = () => localStorage.getItem('asil_hcm_token');
const apiFetch = (path, opts = {}) =>
  fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${tok()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  }).then(r => r.json());

const fmt    = n => (parseFloat(n) || 0).toLocaleString('en-PK');
const fmtD   = d => d ? new Date(d).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtDT  = d => d ? new Date(d).toLocaleString('en-PK', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const fmtNum = n => (parseFloat(n) || 0).toFixed(2);

// ── Style constants ───────────────────────────────────────────────────────────
const s = {
  root:  { background: '#0d1b2a', minHeight: '100vh', padding: '2rem', fontFamily: 'Inter, sans-serif', color: '#e2e8f0' },
  card:  { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '1.25rem' },
  th:    { padding: '10px 12px', textAlign: 'left', color: '#64748b', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'nowrap' },
  td:    { padding: '10px 12px', fontSize: '0.84rem', borderBottom: '1px solid rgba(255,255,255,0.04)', verticalAlign: 'middle' },
  input: { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '7px 10px', borderRadius: '8px', fontSize: '0.84rem', outline: 'none' },
  sel:   { background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '7px 10px', borderRadius: '8px', fontSize: '0.84rem' },
};

const btn = (col = '#6366f1', bg = 'rgba(99,102,241,0.15)') => ({
  display: 'flex', alignItems: 'center', gap: '6px',
  background: bg, border: `1px solid ${col}`, color: col,
  padding: '0.55rem 1rem', borderRadius: '8px',
  cursor: 'pointer', fontWeight: 600, fontSize: '0.84rem', whiteSpace: 'nowrap',
});

// ── Status Badge ──────────────────────────────────────────────────────────────
const STATUS = {
  VALIDATING:             { label: 'Validating',   color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  VALIDATION_FAILED:      { label: 'Failed QC',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
  PROCESSED_SUCCESSFULLY: { label: 'Passed',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  REVISED:                { label: 'Revised',      color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
};

function StatusBadge({ status }) {
  const cfg = STATUS[status] || { label: status || '—', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
  return (
    <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.73rem', fontWeight: 700, color: cfg.color, background: cfg.bg, whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  );
}

function ClaimTypeBadge({ type }) {
  const map = {
    OT:      { label: 'OT',      color: '#a78bfa' },
    EXPENSE: { label: 'Expense', color: '#f59e0b' },
    MEDICAL: { label: 'Medical', color: '#38bdf8' },
  };
  const c = map[type] || { label: type || '—', color: '#94a3b8' };
  return <span style={{ fontSize: '0.72rem', fontWeight: 700, color: c.color }}>{c.label}</span>;
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ size = 18 }) {
  return (
    <>
      <div style={{ width: size, height: size, border: '2px solid #334155', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'wafi_spin 0.8s linear infinite', flexShrink: 0 }} />
      <style>{`@keyframes wafi_spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color }) {
  return (
    <div style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color, fontSize: '0.72rem', fontWeight: 600 }}>{icon}{label}</div>
      <div style={{ fontSize: '1.8rem', fontWeight: 800, color, lineHeight: 1.1 }}>{value ?? '—'}</div>
    </div>
  );
}

// ── Month selector helper ─────────────────────────────────────────────────────
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(); d.setMonth(d.getMonth() - i);
  return { label: d.toLocaleString('en-PK', { month: 'long', year: 'numeric' }), month: d.getMonth() + 1, year: d.getFullYear() };
});

// ════════════════════════════════════════════════════════════════════════════════
export default function WafiClaimsDashboard({ user }) {
  const [tab, setTab] = useState('overview');

  // ── Overview state ────────────────────────────────────────────────────────
  const [stats, setStats]             = useState(null);
  const [gmailStatus, setGmailStatus] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [pollResult, setPollResult]   = useState(null);
  const [polling, setPolling]         = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);

  // ── Sessions state ────────────────────────────────────────────────────────
  const [sessions, setSessions]         = useState([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessFilter, setSessFilter]     = useState({ status: '', dateFrom: '', dateTo: '' });
  const [sessPage, setSessPage]         = useState(1);
  const [expandedSession, setExpandedSession] = useState(null);
  const [sessionDetail, setSessionDetail]   = useState(null);
  const [stageModal, setStageModal]     = useState(null); // { sessionId }
  const [stageMonth, setStageMonth]     = useState(MONTHS[0]);
  const [stageLoading, setStageLoading] = useState(false);
  const [stageResult, setStageResult]   = useState(null);

  // ── Override employee state ────────────────────────────────────────────────
  const [overrideModal, setOverrideModal] = useState(null); // { sessionId, rawCode }
  const [empSearch, setEmpSearch]         = useState('');
  const [empResults, setEmpResults]       = useState([]);
  const [empSearching, setEmpSearching]   = useState(false);
  const [selectedEmp, setSelectedEmp]     = useState(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideResult, setOverrideResult]   = useState(null);

  // ── Items state ───────────────────────────────────────────────────────────
  const [items, setItems]             = useState([]);
  const [itemsTotal, setItemsTotal]   = useState(0);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsFilter, setItemsFilter] = useState({ dateFrom: '', dateTo: '', location: '', claimType: 'ALL', employeeCode: '' });
  const [itemsPage, setItemsPage]     = useState(1);

  // ── Payroll Queue state ───────────────────────────────────────────────────
  const [queueSessions, setQueueSessions] = useState([]);
  const [queueLoading, setQueueLoading]   = useState(false);

  // ── Data loaders ──────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [st, gs, rs] = await Promise.all([
        apiFetch('/api/wafi-claims/stats'),
        apiFetch('/api/wafi-claims/gmail-auth-status'),
        apiFetch('/api/wafi-claims/sessions?limit=25'),
      ]);
      setStats(st);
      setGmailStatus(gs);
      setRecentSessions(rs.sessions || []);
    } catch {}
    setStatsLoading(false);
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const params = new URLSearchParams({ page: sessPage, limit: 50 });
      if (sessFilter.status)   params.set('status', sessFilter.status);
      if (sessFilter.dateFrom) params.set('dateFrom', sessFilter.dateFrom);
      if (sessFilter.dateTo)   params.set('dateTo', sessFilter.dateTo);
      const d = await apiFetch(`/api/wafi-claims/sessions?${params}`);
      setSessions(d.sessions || []);
      setSessionTotal(d.total || 0);
    } catch {}
    setSessionsLoading(false);
  }, [sessPage, sessFilter]);

  const loadSessionDetail = useCallback(async (id) => {
    try {
      const d = await apiFetch(`/api/wafi-claims/sessions/${id}`);
      setSessionDetail(d);
    } catch {}
  }, []);

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const params = new URLSearchParams({ page: itemsPage, limit: 50 });
      if (itemsFilter.dateFrom)    params.set('dateFrom', itemsFilter.dateFrom);
      if (itemsFilter.dateTo)      params.set('dateTo', itemsFilter.dateTo);
      if (itemsFilter.location)    params.set('location', itemsFilter.location);
      if (itemsFilter.claimType && itemsFilter.claimType !== 'ALL') params.set('claimType', itemsFilter.claimType);
      if (itemsFilter.employeeCode) params.set('employeeCode', itemsFilter.employeeCode);
      const d = await apiFetch(`/api/wafi-claims/items?${params}`);
      setItems(d.items || []);
      setItemsTotal(d.total || 0);
    } catch {}
    setItemsLoading(false);
  }, [itemsPage, itemsFilter]);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const d = await apiFetch('/api/wafi-claims/sessions?status=PROCESSED_SUCCESSFULLY&limit=100');
      setQueueSessions((d.sessions || []).filter(s => !s.pushed_to_payroll));
    } catch {}
    setQueueLoading(false);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (tab === 'sessions') loadSessions(); }, [tab, loadSessions]);
  useEffect(() => { if (tab === 'items') loadItems(); }, [tab, loadItems]);
  useEffect(() => { if (tab === 'queue') loadQueue(); }, [tab, loadQueue]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const runPoll = async () => {
    setPolling(true); setPollResult(null);
    try {
      const d = await apiFetch('/api/wafi-claims/trigger-poll', { method: 'POST', body: '{}' });
      setPollResult(d);
      await loadStats();
    } catch (e) { setPollResult({ error: e.message }); }
    setPolling(false);
  };

  const handleExpandSession = async (id) => {
    if (expandedSession === id) { setExpandedSession(null); setSessionDetail(null); return; }
    setExpandedSession(id);
    setSessionDetail(null);
    await loadSessionDetail(id);
  };

  const handleStagePayroll = async () => {
    if (!stageModal) return;
    setStageLoading(true); setStageResult(null);
    try {
      const d = await apiFetch(`/api/wafi-claims/sessions/${stageModal.sessionId}/stage-payroll`, {
        method: 'POST',
        body: JSON.stringify({ month: stageMonth.month, year: stageMonth.year }),
      });
      setStageResult(d.error ? { error: d.error } : { ok: true, msg: d.message });
      if (!d.error) {
        await loadSessions();
        await loadQueue();
        await loadStats();
        setTimeout(() => setStageModal(null), 2000);
      }
    } catch (e) { setStageResult({ error: e.message }); }
    setStageLoading(false);
  };

  const exportItems = () => {
    const params = new URLSearchParams();
    if (itemsFilter.dateFrom)    params.set('dateFrom', itemsFilter.dateFrom);
    if (itemsFilter.dateTo)      params.set('dateTo', itemsFilter.dateTo);
    if (itemsFilter.location)    params.set('location', itemsFilter.location);
    if (itemsFilter.claimType && itemsFilter.claimType !== 'ALL') params.set('claimType', itemsFilter.claimType);
    if (itemsFilter.employeeCode) params.set('employeeCode', itemsFilter.employeeCode);
    window.open(`${API}/api/wafi-claims/export?${params}&_tok=${tok()}`, '_blank');
  };

  const searchEmployees = useCallback(async (q) => {
    setEmpSearch(q);
    setSelectedEmp(null);
    if (q.length < 2) { setEmpResults([]); return; }
    setEmpSearching(true);
    try {
      const d = await apiFetch(`/api/wafi-claims/employee-search?q=${encodeURIComponent(q)}`);
      setEmpResults(d.employees || []);
    } catch {} finally { setEmpSearching(false); }
  }, []);

  const handleOverride = async () => {
    if (!overrideModal || !selectedEmp) return;
    setOverrideLoading(true); setOverrideResult(null);
    try {
      const d = await apiFetch(
        `/api/wafi-claims/sessions/${overrideModal.sessionId}/override-employee`,
        { method: 'POST', body: JSON.stringify({ rawCode: overrideModal.rawCode, correctEmployeeId: selectedEmp.id }) }
      );
      setOverrideResult(d);
      if (d.ok) {
        // Refresh the session detail and session list
        await loadSessionDetail(overrideModal.sessionId);
        await loadSessions();
        await loadStats();
        if (d.newStatus === 'PROCESSED_SUCCESSFULLY') {
          setTimeout(() => setOverrideModal(null), 2200);
        }
      }
    } catch (e) { setOverrideResult({ error: e.message }); }
    setOverrideLoading(false);
  };

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const TABS = [
    ['overview', 'Overview & Gmail'],
    ['sessions', 'Sessions'],
    ['items', 'Items Ledger'],
    ['queue', 'Payroll Queue'],
  ];

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div style={s.root}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Inbox size={22} color="#6366f1" /> Wafi Claims Ingestion Engine
          </h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.84rem' }}>
            Gmail OAuth2 pipeline · Excel template validation · Auto-payroll staging
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {gmailStatus && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', background: gmailStatus.connected ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${gmailStatus.connected ? '#22c55e' : '#ef4444'}` }}>
              {gmailStatus.connected ? <Wifi size={14} color="#22c55e" /> : <WifiOff size={14} color="#ef4444" />}
              <span style={{ fontSize: '0.76rem', fontWeight: 600, color: gmailStatus.connected ? '#22c55e' : '#ef4444' }}>
                {gmailStatus.connected ? gmailStatus.gmail_user : 'Gmail Not Configured'}
              </span>
            </div>
          )}
          <button onClick={runPoll} disabled={polling} style={{ ...btn('#38bdf8', 'rgba(56,189,248,0.12)'), opacity: polling ? 0.7 : 1 }}>
            {polling ? <Spinner size={14} /> : <Play size={14} />}
            {polling ? 'Polling…' : 'Run Poll Now'}
          </button>
        </div>
      </div>

      {/* Poll result */}
      {pollResult && (
        <div style={{ ...s.card, marginBottom: '1rem', borderColor: pollResult.error ? '#ef4444' : '#22c55e' }}>
          {pollResult.error
            ? <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>❌ {pollResult.error}</span>
            : <span style={{ color: '#22c55e', fontSize: '0.85rem' }}>✅ Poll complete — {pollResult.result?.processed ?? 0} processed, {pollResult.result?.errors ?? 0} errors</span>
          }
        </div>
      )}

      {/* ── Tab Navigation ── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '1.5rem' }}>
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: '0.75rem 1.25rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === k ? '#6366f1' : 'transparent'}`, color: tab === k ? '#6366f1' : '#64748b', cursor: 'pointer', fontWeight: tab === k ? 700 : 400, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
            {l}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1: Overview / Gmail Status
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <div>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <StatCard label="Total Submissions" value={stats?.total_sessions ?? (statsLoading ? '…' : 0)} icon={<Inbox size={15} />} color="#6366f1" />
            <StatCard label="Passed (Valid)"    value={stats?.passed ?? 0}            icon={<CheckCircle size={15} />} color="#22c55e" />
            <StatCard label="Failed (QC)"       value={stats?.failed ?? 0}            icon={<XCircle size={15} />}     color="#ef4444" />
            <StatCard label="Pending Payroll"   value={stats?.pending_payroll ?? 0}   icon={<Clock size={15} />}       color="#f59e0b" />
            <StatCard label="OT Rows"           value={stats?.total_ot_rows ?? 0}     icon={<FileText size={15} />}    color="#a78bfa" />
            <StatCard label="Expense Rows"      value={stats?.total_expense_rows ?? 0} icon={<Package size={15} />}   color="#f59e0b" />
            <StatCard label="Medical Rows"      value={stats?.total_medical_rows ?? 0} icon={<Layers size={15} />}    color="#38bdf8" />
          </div>

          {/* Gmail info card */}
          <div style={{ ...s.card, marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {gmailStatus?.connected
                    ? <><Wifi size={16} color="#22c55e" /> Gmail Connected</>
                    : <><WifiOff size={16} color="#ef4444" /> Gmail Not Configured</>
                  }
                </div>
                <div style={{ fontSize: '0.82rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>Inbox: <strong style={{ color: '#e2e8f0' }}>{gmailStatus?.gmail_user || '—'}</strong></span>
                  <span>Total captured: <strong style={{ color: '#6366f1' }}>{gmailStatus?.total_captured ?? 0}</strong></span>
                  <span>Last poll: <strong style={{ color: '#e2e8f0' }}>{gmailStatus?.last_poll ? fmtDT(gmailStatus.last_poll) : 'Never'}</strong></span>
                </div>
              </div>
              {!gmailStatus?.connected && (
                <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', fontSize: '0.8rem', color: '#f59e0b', maxWidth: '340px' }}>
                  ⚠ Run <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: '4px' }}>node gmail-auth-setup.js</code> in the backend to generate OAuth credentials, then set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in Render environment.
                </div>
              )}
            </div>
          </div>

          {/* Recent sessions */}
          <div style={{ ...s.card, padding: 0, overflowX: 'auto' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 700, fontSize: '0.88rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Recent Submissions (last 25)</span>
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 400 }}>See all → Sessions tab</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Received','Sender','File','Month','Status','OT','Exp','Med'].map(h => <th key={h} style={s.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {recentSessions.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No submissions yet. Run a poll to start ingesting emails.</td></tr>
                ) : recentSessions.map(sess => (
                  <tr key={sess.id} style={{ transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDT(sess.received_at)}</td>
                    <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sess.sender_email}</td>
                    <td style={{ ...s.td, fontSize: '0.78rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sess.attachment_filename || '—'}</td>
                    <td style={{ ...s.td, fontSize: '0.76rem', whiteSpace: 'nowrap' }}>{sess.claim_month ? new Date(sess.claim_month).toLocaleString('en-PK',{month:'short',year:'numeric'}) : '—'}</td>
                    <td style={s.td}><StatusBadge status={sess.processing_status} /></td>
                    <td style={{ ...s.td, textAlign: 'center', color: '#a78bfa', fontSize: '0.8rem' }}>{sess.total_ot_rows || 0}</td>
                    <td style={{ ...s.td, textAlign: 'center', color: '#f59e0b', fontSize: '0.8rem' }}>{sess.total_expense_rows || 0}</td>
                    <td style={{ ...s.td, textAlign: 'center', color: '#38bdf8', fontSize: '0.8rem' }}>{sess.total_medical_rows || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2: Sessions
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'sessions' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={sessFilter.status} onChange={e => { setSessFilter(f => ({ ...f, status: e.target.value })); setSessPage(1); }} style={s.sel}>
              <option value="">All Statuses</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input type="date" value={sessFilter.dateFrom} onChange={e => setSessFilter(f => ({ ...f, dateFrom: e.target.value }))} style={{ ...s.input, colorScheme: 'dark' }} placeholder="From" />
            <input type="date" value={sessFilter.dateTo}   onChange={e => setSessFilter(f => ({ ...f, dateTo: e.target.value }))}   style={{ ...s.input, colorScheme: 'dark' }} placeholder="To" />
            <button onClick={loadSessions} style={btn()}><RefreshCw size={14} /> Refresh</button>
            <span style={{ color: '#64748b', fontSize: '0.8rem', marginLeft: 'auto' }}>{sessionTotal} total</span>
          </div>

          <div style={{ ...s.card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Received','Sender','Filename','Month','Status','OT','Exp','Med','Rev?','Actions'].map(h => <th key={h} style={s.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {sessionsLoading ? (
                  <tr><td colSpan={10} style={{ ...s.td, textAlign: 'center', padding: '2rem' }}><div style={{ display: 'flex', justifyContent: 'center', gap: '8px', color: '#64748b' }}><Spinner /> Loading sessions…</div></td></tr>
                ) : sessions.length === 0 ? (
                  <tr><td colSpan={10} style={{ ...s.td, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No sessions found.</td></tr>
                ) : sessions.map(sess => (
                  <React.Fragment key={sess.id}>
                    <tr style={{ transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDT(sess.received_at)}</td>
                      <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sess.sender_email}</td>
                      <td style={{ ...s.td, fontSize: '0.78rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sess.attachment_filename || '—'}</td>
                      <td style={{ ...s.td, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{sess.claim_month ? new Date(sess.claim_month).toLocaleString('en-PK',{month:'short',year:'numeric'}) : '—'}</td>
                      <td style={s.td}><StatusBadge status={sess.processing_status} /></td>
                      <td style={{ ...s.td, textAlign: 'center', color: '#a78bfa', fontSize: '0.8rem' }}>{sess.total_ot_rows || 0}</td>
                      <td style={{ ...s.td, textAlign: 'center', color: '#f59e0b', fontSize: '0.8rem' }}>{sess.total_expense_rows || 0}</td>
                      <td style={{ ...s.td, textAlign: 'center', color: '#38bdf8', fontSize: '0.8rem' }}>{sess.total_medical_rows || 0}</td>
                      <td style={{ ...s.td, textAlign: 'center', fontSize: '0.76rem' }}>{sess.is_revision ? <span style={{ color: '#38bdf8' }}>Yes</span> : <span style={{ color: '#475569' }}>—</span>}</td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => handleExpandSession(sess.id)} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {expandedSession === sess.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Details
                          </button>
                          {sess.processing_status === 'PROCESSED_SUCCESSFULLY' && !sess.pushed_to_payroll && (
                            <button onClick={() => { setStageModal({ sessionId: sess.id, sender: sess.sender_email }); setStageResult(null); }} style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#22c55e', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem' }}>
                              Stage →
                            </button>
                          )}
                          {sess.pushed_to_payroll && <span style={{ fontSize: '0.72rem', color: '#22c55e', padding: '4px 0' }}>✓ Staged</span>}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail: validation errors + items */}
                    {expandedSession === sess.id && (
                      <tr>
                        <td colSpan={10} style={{ padding: '0 12px 12px', background: 'rgba(0,0,0,0.2)' }}>
                          {!sessionDetail ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', padding: '12px 0', fontSize: '0.82rem' }}>
                              <Spinner size={14} /> Loading details…
                            </div>
                          ) : (
                            <div>
                              {/* Validation errors */}
                              {(sessionDetail.session?.validation_errors?.length > 0) && (
                                <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ef4444', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Validation Errors ({sessionDetail.session.validation_errors.length})
                                  </div>
                                  <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                      <thead><tr>
                                        {['Sheet','Row','Column','Error','Value','Action'].map(h => <th key={h} style={{ ...s.th, fontSize: '0.68rem', background: 'rgba(239,68,68,0.06)' }}>{h}</th>)}
                                      </tr></thead>
                                      <tbody>
                                        {sessionDetail.session.validation_errors.map((e, i) => (
                                          <tr key={i}>
                                            <td style={{ ...s.td, fontSize: '0.76rem' }}>{e.sheet}</td>
                                            <td style={{ ...s.td, fontSize: '0.76rem', textAlign: 'center' }}>{e.row}</td>
                                            <td style={{ ...s.td, fontSize: '0.76rem', textAlign: 'center' }}>{e.column}</td>
                                            <td style={{ ...s.td, fontSize: '0.76rem', color: '#ef4444' }}>{e.error}</td>
                                            <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8', fontStyle: 'italic' }}>{String(e.value || '').slice(0, 50)}</td>
                                            <td style={s.td}>
                                              {e.error?.toLowerCase().includes('employee code not found') && (
                                                <button
                                                  onClick={() => {
                                                    setOverrideModal({ sessionId: sess.id, rawCode: e.value });
                                                    setEmpSearch(''); setEmpResults([]); setSelectedEmp(null); setOverrideResult(null);
                                                  }}
                                                  style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1', color: '#6366f1', padding: '3px 8px', borderRadius: '5px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}
                                                >
                                                  Override →
                                                </button>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Items */}
                              {sessionDetail.items?.length > 0 && (
                                <div>
                                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#22c55e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '6px' }}>
                                    Logged Items ({sessionDetail.items.length})
                                  </div>
                                  <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                                      <thead><tr>
                                        {['Tab','Row','Code','Name DB','Date','Type','OT Hrs','Mult','Amount','Payout'].map(h => <th key={h} style={{ ...s.th, fontSize: '0.68rem' }}>{h}</th>)}
                                      </tr></thead>
                                      <tbody>
                                        {sessionDetail.items.map(item => (
                                          <tr key={item.id}>
                                            <td style={{ ...s.td, fontSize: '0.73rem', color: '#94a3b8' }}>{item.tab_name?.replace(' Claims','')}</td>
                                            <td style={{ ...s.td, fontSize: '0.73rem', textAlign: 'center', color: '#64748b' }}>{item.row_number}</td>
                                            <td style={{ ...s.td, fontSize: '0.72rem', color: '#94a3b8' }}>{item.employee_id || item.employee_code_raw}</td>
                                            <td style={{ ...s.td, fontSize: '0.75rem' }}>{item.employee_name_db || '—'}</td>
                                            <td style={{ ...s.td, fontSize: '0.73rem', whiteSpace: 'nowrap' }}>{fmtD(item.claim_date)}</td>
                                            <td style={s.td}><ClaimTypeBadge type={item.claim_type} /></td>
                                            <td style={{ ...s.td, textAlign: 'center', color: '#a78bfa' }}>{item.ot_hours || '—'}</td>
                                            <td style={{ ...s.td, fontSize: '0.72rem', color: '#94a3b8' }}>{item.ot_multiplier || '—'}</td>
                                            <td style={{ ...s.td, textAlign: 'right', color: '#f59e0b' }}>{item.raw_amount ? `PKR ${fmt(item.raw_amount)}` : '—'}</td>
                                            <td style={{ ...s.td, textAlign: 'right', color: '#22c55e' }}>{item.ot_payout ? `PKR ${fmt(item.ot_payout)}` : '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                              {!sessionDetail.session?.validation_errors?.length && !sessionDetail.items?.length && (
                                <div style={{ color: '#64748b', fontSize: '0.82rem', padding: '8px 0' }}>No items or errors to display.</div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {sessionTotal > 50 && (
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '1rem' }}>
              <button disabled={sessPage === 1} onClick={() => setSessPage(p => p - 1)} style={{ ...btn(), opacity: sessPage === 1 ? 0.4 : 1 }}>← Prev</button>
              <span style={{ color: '#64748b', fontSize: '0.84rem', padding: '0 8px', lineHeight: '2rem' }}>Page {sessPage} of {Math.ceil(sessionTotal / 50)}</span>
              <button disabled={sessPage >= Math.ceil(sessionTotal / 50)} onClick={() => setSessPage(p => p + 1)} style={{ ...btn(), opacity: sessPage >= Math.ceil(sessionTotal / 50) ? 0.4 : 1 }}>Next →</button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 3: Items Ledger
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'items' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Calendar size={14} color="#64748b" />
              <input type="date" value={itemsFilter.dateFrom} onChange={e => { setItemsFilter(f => ({...f, dateFrom: e.target.value})); setItemsPage(1); }} style={{ ...s.input, colorScheme: 'dark' }} />
              <span style={{ color: '#64748b' }}>–</span>
              <input type="date" value={itemsFilter.dateTo}   onChange={e => { setItemsFilter(f => ({...f, dateTo: e.target.value})); setItemsPage(1); }}   style={{ ...s.input, colorScheme: 'dark' }} />
            </div>
            <select value={itemsFilter.claimType} onChange={e => { setItemsFilter(f => ({...f, claimType: e.target.value})); setItemsPage(1); }} style={s.sel}>
              <option value="ALL">All Types</option>
              <option value="OT">Overtime</option>
              <option value="EXPENSE">Expense</option>
              <option value="MEDICAL">Medical</option>
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '0 8px' }}>
              <Search size={13} color="#64748b" />
              <input placeholder="Employee code…" value={itemsFilter.employeeCode} onChange={e => { setItemsFilter(f => ({...f, employeeCode: e.target.value})); setItemsPage(1); }} style={{ ...s.input, border: 'none', background: 'transparent', padding: '7px 4px', width: '140px' }} />
            </div>
            <input placeholder="Location…" value={itemsFilter.location} onChange={e => { setItemsFilter(f => ({...f, location: e.target.value})); setItemsPage(1); }} style={{ ...s.input, width: '120px' }} />
            <button onClick={loadItems} style={btn()}><RefreshCw size={14} /> Refresh</button>
            <button onClick={exportItems} style={{ ...btn('#22c55e', 'rgba(34,197,94,0.12)') }}><Download size={14} /> Export Excel</button>
            <span style={{ color: '#64748b', fontSize: '0.8rem', marginLeft: 'auto' }}>{itemsTotal} items</span>
          </div>

          <div style={{ ...s.card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                {['Date','Emp Code','Employee Name','Location','Dept','Type','Description','OT Hrs','Multiplier','Amount','Payout'].map(h => <th key={h} style={s.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {itemsLoading ? (
                  <tr><td colSpan={11} style={{ ...s.td, textAlign: 'center', padding: '2rem' }}><div style={{ display: 'flex', justifyContent: 'center', gap: '8px', color: '#64748b' }}><Spinner /> Loading…</div></td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={11} style={{ ...s.td, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No items found. Adjust filters or run a poll.</td></tr>
                ) : items.map(item => (
                  <tr key={item.id} style={{ transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ ...s.td, fontSize: '0.76rem', whiteSpace: 'nowrap' }}>{fmtD(item.claim_date)}</td>
                    <td style={{ ...s.td, fontSize: '0.74rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{item.employee_id || item.employee_code_raw}</td>
                    <td style={{ ...s.td, fontSize: '0.83rem', fontWeight: 500 }}>{item.employee_name_db || '—'}</td>
                    <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8' }}>{item.location || '—'}</td>
                    <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8' }}>{item.department || '—'}</td>
                    <td style={s.td}><ClaimTypeBadge type={item.claim_type} /></td>
                    <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || item.expense_type || item.claim_type || '—'}</td>
                    <td style={{ ...s.td, textAlign: 'center', color: '#a78bfa', fontWeight: 600 }}>{item.ot_hours ? fmtNum(item.ot_hours) : '—'}</td>
                    <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8' }}>{item.ot_multiplier || '—'}</td>
                    <td style={{ ...s.td, textAlign: 'right', color: '#f59e0b' }}>{item.raw_amount ? `PKR ${fmt(item.raw_amount)}` : '—'}</td>
                    <td style={{ ...s.td, textAlign: 'right', color: '#22c55e', fontWeight: 600 }}>{item.ot_payout ? `PKR ${fmt(item.ot_payout)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {itemsTotal > 50 && (
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '1rem' }}>
              <button disabled={itemsPage === 1} onClick={() => setItemsPage(p => p - 1)} style={{ ...btn(), opacity: itemsPage === 1 ? 0.4 : 1 }}>← Prev</button>
              <span style={{ color: '#64748b', fontSize: '0.84rem', padding: '0 8px', lineHeight: '2rem' }}>Page {itemsPage} of {Math.ceil(itemsTotal / 50)}</span>
              <button disabled={itemsPage >= Math.ceil(itemsTotal / 50)} onClick={() => setItemsPage(p => p + 1)} style={{ ...btn(), opacity: itemsPage >= Math.ceil(itemsTotal / 50) ? 0.4 : 1 }}>Next →</button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 4: Payroll Staging Queue
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'queue' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ color: '#64748b', fontSize: '0.85rem' }}>{queueSessions.length} session(s) pending payroll staging</div>
            <button onClick={loadQueue} style={btn()}><RefreshCw size={14} /> Refresh</button>
          </div>

          {queueLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', color: '#64748b', padding: '2rem' }}><Spinner /> Loading…</div>
          ) : queueSessions.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', color: '#64748b', padding: '3rem' }}>
              <CheckCircle size={32} color="#22c55e" style={{ marginBottom: '12px', opacity: 0.6 }} />
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>All sessions staged!</div>
              <div style={{ fontSize: '0.84rem' }}>No PROCESSED_SUCCESSFULLY sessions are awaiting payroll staging.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {queueSessions.map(sess => (
                <div key={sess.id} style={{ ...s.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: '4px' }}>{sess.attachment_filename || `Session #${sess.id}`}</div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <span>Sender: {sess.sender_email}</span>
                      <span>Received: {fmtD(sess.received_at)}</span>
                      <span style={{ color: '#a78bfa' }}>{sess.total_ot_rows} OT rows</span>
                      <span style={{ color: '#f59e0b' }}>{sess.total_expense_rows} expense rows</span>
                      <span style={{ color: '#38bdf8' }}>{sess.total_medical_rows} medical rows</span>
                    </div>
                  </div>
                  <button onClick={() => { setStageModal({ sessionId: sess.id, sender: sess.sender_email }); setStageResult(null); }} style={{ ...btn('#22c55e', 'rgba(34,197,94,0.15)') }}>
                    <CheckCircle size={14} /> Stage to Payroll
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Stage to Payroll Modal
      ══════════════════════════════════════════════════════════════════════ */}
      {stageModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '1.75rem', minWidth: '340px', maxWidth: '440px', width: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem' }}>Stage Claims to Payroll</div>
              <button onClick={() => setStageModal(null)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex' }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '1rem' }}>Session #{stageModal.sessionId} from <strong style={{ color: '#e2e8f0' }}>{stageModal.sender}</strong></div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: '4px' }}>Target Payroll Month</label>
              <select value={`${stageMonth.year}-${stageMonth.month}`} onChange={e => { const sel = MONTHS.find(m => `${m.year}-${m.month}` === e.target.value); if (sel) setStageMonth(sel); }} style={{ ...s.sel, width: '100%' }}>
                {MONTHS.map(m => <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{m.label}</option>)}
              </select>
            </div>

            {stageResult && (
              <div style={{ marginBottom: '1rem', padding: '10px 12px', borderRadius: '8px', background: stageResult.error ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', fontSize: '0.82rem', color: stageResult.error ? '#ef4444' : '#22c55e' }}>
                {stageResult.error || stageResult.msg}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setStageModal(null)} style={{ ...btn('#64748b', 'rgba(100,116,139,0.1)') }}>Cancel</button>
              <button onClick={handleStagePayroll} disabled={stageLoading} style={{ ...btn('#22c55e', 'rgba(34,197,94,0.15)'), opacity: stageLoading ? 0.7 : 1 }}>
                {stageLoading ? <Spinner size={14} /> : <CheckCircle size={14} />}
                {stageLoading ? 'Staging…' : 'Confirm Stage'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ══════════════════════════════════════════════════════════════════════
          Override Employee Modal
      ══════════════════════════════════════════════════════════════════════ */}
      {overrideModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ background: '#1e293b', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '14px', padding: '1.75rem', minWidth: '380px', maxWidth: '500px', width: '92%' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#e2e8f0' }}>Override Employee Code</div>
              <button onClick={() => setOverrideModal(null)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex' }}><X size={18} /></button>
            </div>

            {/* Wrong code info */}
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '10px 14px', marginBottom: '1.25rem', fontSize: '0.82rem' }}>
              <span style={{ color: '#94a3b8' }}>Wrong code in Excel: </span>
              <strong style={{ color: '#ef4444', fontFamily: 'monospace' }}>{overrideModal.rawCode}</strong>
            </div>

            {/* Employee search */}
            <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: '6px' }}>Search correct employee (name or code)</label>
            <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
              <input
                value={empSearch}
                onChange={e => searchEmployees(e.target.value)}
                placeholder="e.g. Muhammad Awais or ASIL/SPL-85/21"
                style={{ ...s.input, width: '100%', boxSizing: 'border-box' }}
                autoFocus
              />
              {empSearching && <div style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)' }}><Spinner size={14} /></div>}
            </div>

            {/* Results dropdown */}
            {empResults.length > 0 && !selectedEmp && (
              <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden', marginBottom: '0.75rem', maxHeight: '200px', overflowY: 'auto' }}>
                {empResults.map(emp => (
                  <div
                    key={emp.id}
                    onClick={() => { setSelectedEmp(emp); setEmpResults([]); }}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#e2e8f0' }}>{emp.name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{emp.id} · {emp.dept || '—'} · {emp.location || '—'}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Selected employee */}
            {selectedEmp && (
              <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '8px', padding: '10px 14px', marginBottom: '1rem', fontSize: '0.82rem' }}>
                <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: '2px' }}>✓ {selectedEmp.name}</div>
                <div style={{ color: '#64748b' }}>{selectedEmp.id} · {selectedEmp.dept || '—'}</div>
                <button onClick={() => { setSelectedEmp(null); setEmpSearch(''); }} style={{ marginTop: '6px', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.72rem', padding: 0 }}>← Change</button>
              </div>
            )}

            {/* Result feedback */}
            {overrideResult && (
              <div style={{ marginBottom: '1rem', padding: '10px 12px', borderRadius: '8px', background: overrideResult.error ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)', fontSize: '0.82rem', color: overrideResult.error ? '#ef4444' : '#22c55e' }}>
                {overrideResult.error || overrideResult.message}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setOverrideModal(null)} style={{ ...btn('#64748b', 'rgba(100,116,139,0.1)') }}>Cancel</button>
              <button onClick={handleOverride} disabled={!selectedEmp || overrideLoading} style={{ ...btn('#6366f1', 'rgba(99,102,241,0.15)'), opacity: (!selectedEmp || overrideLoading) ? 0.5 : 1 }}>
                {overrideLoading ? <Spinner size={14} /> : null}
                {overrideLoading ? 'Saving…' : 'Confirm Override'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes wafi_spin { to { transform: rotate(360deg); } }`}</style>
    </div>

  );
}
