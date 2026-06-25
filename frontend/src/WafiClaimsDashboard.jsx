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
  PENDING_REVIEW: { label: 'Pending Review', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', pulse: true },
  IRRELEVANT:    { label: 'Not Relevant',   color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
  VERIFIED:      { label: 'Verified ✓',     color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  SKIPPED:       { label: 'Skipped',        color: '#475569', bg: 'rgba(71,85,105,0.1)'  },
  WRONG_FORMAT:  { label: 'Wrong Format',   color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
};

function StatusBadge({ status }) {
  const cfg = STATUS[status] || { label: status || '—', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
  return (
    <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.73rem', fontWeight: 700, color: cfg.color, background: cfg.bg, whiteSpace: 'nowrap', animation: cfg.pulse ? 'wafi_pulse 2s ease-in-out infinite' : 'none' }}>
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
  const d = new Date(); d.setMonth(d.getMonth() + 1 - i);
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

  // QC Draft state
  const [qcDraftLoading, setQcDraftLoading] = useState(null); // sessionId being drafted
  const [qcDraftResult, setQcDraftResult]   = useState({});

  // ── Override employee state ────────────────────────────────────────────────
  const [overrideModal, setOverrideModal] = useState(null); // { sessionId, rawCode }
  const [empSearch, setEmpSearch]         = useState('');
  const [empResults, setEmpResults]       = useState([]);
  const [empSearching, setEmpSearching]   = useState(false);
  const [selectedEmp, setSelectedEmp]     = useState(null);
  const [overrideLoading, setOverrideLoading] = useState(false);
  const [overrideResult, setOverrideResult]   = useState(null);

  // ── Verify modal state
  const [verifyModal, setVerifyModal]     = useState(null); // { sessionId, sender, filename, otCount, expCount, medCount }
  const [verifyMonth, setVerifyMonth]     = useState(MONTHS[1]); // default: next month (index 1)
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult]   = useState(null);

  // ── Batch verify state
  const [selectedSessions, setSelectedSessions] = useState(new Set());
  const [batchVerifyLoading, setBatchVerifyLoading] = useState(false);

  // ── Focal points state
  const [focalPoints, setFocalPoints]     = useState([]);
  const [fpLoading, setFpLoading]         = useState(false);
  const [fpForm, setFpForm]               = useState({ email: '', name: '', location: '', role: 'claimed_by' });
  const [fpSaving, setFpSaving]           = useState(false);

  // ── Employee claims tab state
  const [empClaimsSearch, setEmpClaimsSearch] = useState('');
  const [empClaimsData, setEmpClaimsData]     = useState([]);
  const [empClaimsLoading, setEmpClaimsLoading] = useState(false);
  const [empClaimsFilter, setEmpClaimsFilter] = useState({ claimType: 'ALL', dateFrom: '', dateTo: '' });

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
      if (d && !d.error) {
        setSessionDetail(d);
      } else {
        setSessionDetail({ session: null, items: [], _error: d?.error || 'Failed to load' });
      }
    } catch (e) {
      setSessionDetail({ session: null, items: [], _error: e.message });
    }
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

  // Verify handler
  const handleVerify = async () => {
    if (!verifyModal) return;
    setVerifyLoading(true); setVerifyResult(null);
    try {
      const d = await apiFetch(`/api/wafi-claims/sessions/${verifyModal.sessionId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ month: verifyMonth.month, year: verifyMonth.year }),
      });
      setVerifyResult(d);
      if (d.ok) {
        await loadSessionDetail(verifyModal.sessionId);
        await loadSessions();
        await loadStats();
        setTimeout(() => setVerifyModal(null), 2200);
      }
    } catch (e) { setVerifyResult({ error: e.message }); }
    setVerifyLoading(false);
  };

  // Skip session handler
  const handleSkip = async (sessionId) => {
    try {
      await apiFetch(`/api/wafi-claims/sessions/${sessionId}/skip`, { method: 'POST' });
      await loadSessions();
      await loadStats();
    } catch (e) { console.error('Skip failed:', e); }
  };

  // Create QC rejection draft email
  const handleQcDraft = async (sess) => {
    setQcDraftLoading(sess.id);
    try {
      const d = await apiFetch(`/api/wafi-claims/sessions/${sess.id}/qc-draft`, { method: 'POST' });
      setQcDraftResult(prev => ({ ...prev, [sess.id]: d }));
      if (d.ok) { await loadSessions(); await loadStats(); }
    } catch (e) { setQcDraftResult(prev => ({ ...prev, [sess.id]: { error: e.message } })); }
    setQcDraftLoading(null);
  };

  // Reject session (admin dismisses permanently)
  const handleReject = async (sessionId) => {
    if (!window.confirm('Mark this session as REJECTED? It will be removed from the pending list.')) return;
    try {
      await apiFetch(`/api/wafi-claims/sessions/${sessionId}/reject`, { method: 'POST' });
      await loadSessions();
      await loadStats();
    } catch (e) { console.error('Reject failed:', e); }
  };

  // Batch verify handler
  const handleBatchVerify = async () => {
    if (!selectedSessions.size) return;
    const month = MONTHS[1]; // next month by default
    setBatchVerifyLoading(true);
    try {
      await apiFetch('/api/wafi-claims/sessions/batch-verify', {
        method: 'POST',
        body: JSON.stringify({ sessionIds: [...selectedSessions], month: month.month, year: month.year }),
      });
      setSelectedSessions(new Set());
      await loadSessions();
      await loadStats();
    } catch (e) { console.error('Batch verify failed:', e); }
    setBatchVerifyLoading(false);
  };

  // Load focal points
  const loadFocalPoints = useCallback(async () => {
    setFpLoading(true);
    try {
      const d = await apiFetch('/api/wafi-claims/focal-points');
      setFocalPoints(d.focalPoints || []);
    } catch {} finally { setFpLoading(false); }
  }, []);

  // Add focal point
  const addFocalPoint = async () => {
    if (!fpForm.email) return;
    setFpSaving(true);
    try {
      await apiFetch('/api/wafi-claims/focal-points', { method: 'POST', body: JSON.stringify(fpForm) });
      setFpForm({ email: '', name: '', location: '', role: 'claimed_by' });
      await loadFocalPoints();
    } catch {} finally { setFpSaving(false); }
  };

  // Remove focal point
  const removeFocalPoint = async (id) => {
    await apiFetch(`/api/wafi-claims/focal-points/${id}`, { method: 'DELETE' });
    await loadFocalPoints();
  };

  // Load employee claims
  const loadEmpClaims = useCallback(async () => {
    setEmpClaimsLoading(true);
    try {
      const params = new URLSearchParams();
      if (empClaimsSearch) params.set('employeeCode', empClaimsSearch);
      if (empClaimsFilter.claimType !== 'ALL') params.set('claimType', empClaimsFilter.claimType);
      if (empClaimsFilter.dateFrom) params.set('dateFrom', empClaimsFilter.dateFrom);
      if (empClaimsFilter.dateTo)   params.set('dateTo', empClaimsFilter.dateTo);
      const d = await apiFetch(`/api/wafi-claims/employee-claims?${params}`);
      setEmpClaimsData(d.employees || []);
    } catch {} finally { setEmpClaimsLoading(false); }
  }, [empClaimsSearch, empClaimsFilter]);

  // These useEffects must come AFTER loadFocalPoints and loadEmpClaims are defined
  useEffect(() => { if (tab === 'focal')     loadFocalPoints(); }, [tab, loadFocalPoints]);
  useEffect(() => { if (tab === 'employees') loadEmpClaims();   }, [tab, loadEmpClaims]);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const TABS = [
    ['overview', 'Overview & Gmail'],
    ['sessions', 'Sessions'],
    ['items',    'Items Ledger'],
    ['queue',    'Payroll Queue'],
    ['employees','Employee Claims'],
    ['focal',    'Focal Points'],
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
            <StatCard label="Pending Review"    value={stats?.pending_review || 0}    icon={<Clock size={14}/>}        color="#f59e0b" />
            <StatCard label="Not Relevant"      value={stats?.irrelevant || 0}        icon={<Inbox size={14}/>}        color="#64748b" />
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

          {selectedSessions.size > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'10px 14px', background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'8px', marginBottom:'12px' }}>
              <span style={{ fontSize:'0.84rem', color:'#f59e0b', fontWeight:600 }}>{selectedSessions.size} session(s) selected</span>
              <button onClick={handleBatchVerify} disabled={batchVerifyLoading} style={btn('#10b981','rgba(16,185,129,0.12)')}>
                {batchVerifyLoading ? <Spinner size={14}/> : <CheckCircle size={14}/>} Verify Selected
              </button>
              <button onClick={() => setSelectedSessions(new Set())} style={btn('#64748b','rgba(100,116,139,0.1)')}><X size={14}/> Clear</button>
            </div>
          )}

          <div style={{ ...s.card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={s.th}><input type="checkbox" onChange={e => {
                  if (e.target.checked) setSelectedSessions(new Set(sessions.filter(s => s.processing_status === 'PENDING_REVIEW').map(s => s.id)));
                  else setSelectedSessions(new Set());
                }} /></th>
                {['Received','Sender','Filename','Month','Status','OT 1x','OT 2x','OT 3x','Exp','Med','Rev?','Actions'].map(h => <th key={h} style={s.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {sessionsLoading ? (
                  <tr><td colSpan={13} style={{ ...s.td, textAlign: 'center', padding: '2rem' }}><div style={{ display: 'flex', justifyContent: 'center', gap: '8px', color: '#64748b' }}><Spinner /> Loading sessions…</div></td></tr>
                ) : sessions.length === 0 ? (
                  <tr><td colSpan={13} style={{ ...s.td, textAlign: 'center', color: '#64748b', padding: '2rem' }}>No sessions found.</td></tr>
                ) : sessions.map(sess => (
                  <React.Fragment key={sess.id}>
                    <tr style={{ transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={s.td}>
                        {sess.processing_status === 'PENDING_REVIEW' && (
                          <input type="checkbox" checked={selectedSessions.has(sess.id)}
                            onChange={e => {
                              const next = new Set(selectedSessions);
                              if (e.target.checked) next.add(sess.id); else next.delete(sess.id);
                              setSelectedSessions(next);
                            }} />
                        )}
                      </td>
                      <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDT(sess.received_at)}</td>
                      <td style={{ ...s.td, fontSize: '0.76rem', color: '#94a3b8', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {sess.sender_email}
                        {sess.is_first_time_sender && (
                          <span style={{ fontSize:'0.65rem', background:'rgba(249,115,22,0.15)', color:'#f97316', border:'1px solid rgba(249,115,22,0.3)', borderRadius:'4px', padding:'1px 5px', marginLeft:'4px' }}>NEW</span>
                        )}
                      </td>
                      <td style={{ ...s.td, fontSize: '0.78rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sess.attachment_filename || '—'}</td>
                      <td style={{ ...s.td, fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{sess.claim_month ? new Date(sess.claim_month).toLocaleString('en-PK',{month:'short',year:'numeric'}) : '—'}</td>
                      <td style={s.td}><StatusBadge status={sess.processing_status} /></td>
                      <td style={{ ...s.td, textAlign: 'center', color: '#a78bfa', fontSize: '0.8rem' }}>{sess.ot_single_count || 0}</td>
                      <td style={{ ...s.td, textAlign: 'center', color: '#c084fc', fontSize: '0.8rem' }}>{sess.ot_double_count || 0}</td>
                      <td style={{ ...s.td, textAlign: 'center', color: '#7c3aed', fontSize: '0.8rem' }}>{sess.ot_triple_count || 0}</td>
                      <td style={{ ...s.td, textAlign: 'center', color: '#f59e0b', fontSize: '0.8rem' }}>{sess.total_expense_rows || 0}</td>
                      <td style={{ ...s.td, textAlign: 'center', color: '#38bdf8', fontSize: '0.8rem' }}>{sess.total_medical_rows || 0}</td>
                      <td style={{ ...s.td, textAlign: 'center', fontSize: '0.76rem' }}>{sess.is_revision ? <span style={{ color: '#38bdf8' }}>Yes</span> : <span style={{ color: '#475569' }}>—</span>}</td>
                      <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          <button onClick={() => handleExpandSession(sess.id)} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {expandedSession === sess.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Details
                          </button>
                          {sess.processing_status === 'PENDING_REVIEW' && (
                            <button
                              onClick={() => setVerifyModal({ sessionId: sess.id, sender: sess.sender_email, filename: sess.attachment_filename, otCount: sess.total_ot_rows, expCount: sess.total_expense_rows, medCount: sess.total_medical_rows })}
                              style={{ ...btn('#10b981','rgba(16,185,129,0.12)'), fontSize:'0.78rem', padding:'5px 10px' }}
                            >
                              <CheckCircle size={13}/> Verify
                            </button>
                          )}
                          {sess.processing_status === 'IRRELEVANT' && (
                            <button
                              onClick={() => handleSkip(sess.id)}
                              style={{ ...btn('#64748b','rgba(100,116,139,0.1)'), fontSize:'0.78rem', padding:'5px 10px' }}
                            >
                              <X size={13}/> Skip
                            </button>
                          )}
                          {sess.processing_status === 'VALIDATION_FAILED' && (
                            <>
                              <button
                                onClick={() => handleQcDraft(sess)}
                                disabled={qcDraftLoading === sess.id}
                                style={{ ...btn('#f59e0b','rgba(245,158,11,0.12)'), fontSize:'0.78rem', padding:'5px 10px' }}
                                title="Create QC rejection draft email in Gmail"
                              >
                                {qcDraftLoading === sess.id ? <Spinner size={13}/> : '✉'} QC Draft
                              </button>
                              <button
                                onClick={() => handleReject(sess.id)}
                                style={{ ...btn('#ef4444','rgba(239,68,68,0.1)'), fontSize:'0.78rem', padding:'5px 10px' }}
                                title="Mark as rejected and remove from pending list"
                              >
                                ✕ Reject
                              </button>
                            </>
                          )}
                          {sess.processing_status === 'PROCESSED_SUCCESSFULLY' && !sess.pushed_to_payroll && ((sess.total_ot_rows || 0) + (sess.total_expense_rows || 0) + (sess.total_medical_rows || 0)) > 0 && (
                            <button onClick={() => { setStageModal({ sessionId: sess.id, sender: sess.sender_email }); setStageResult(null); }} style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', color: '#22c55e', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem' }}>
                              Stage →
                            </button>
                          )}
                          {sess.pushed_to_payroll && <span style={{ fontSize: '0.72rem', color: '#22c55e', padding: '4px 0' }}>✓ Staged</span>}
                        </div>
                        {qcDraftResult[sess.id] && (
                          <div style={{ fontSize:'0.7rem', color: qcDraftResult[sess.id].error ? '#ef4444' : '#10b981', marginTop:'3px' }}>
                            {qcDraftResult[sess.id].error || 'Draft created ✓'}
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail: validation errors + items */}
                    {expandedSession === sess.id && (
                      <tr>
                        <td colSpan={13} style={{ padding: '0 12px 12px', background: 'rgba(0,0,0,0.2)' }}>
                          {!sessionDetail ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', padding: '12px 0', fontSize: '0.82rem' }}>
                              <Spinner size={14} /> Loading details…
                            </div>
                          ) : sessionDetail._error ? (
                            <div style={{ color: '#ef4444', fontSize: '0.82rem', padding: '12px 0' }}>⚠ Failed to load details: {sessionDetail._error}</div>
                          ) : (
                            <div>
                              {/* IRRELEVANT email summary */}
                              {sessionDetail.session?.processing_status === 'IRRELEVANT' && sessionDetail.session?.email_summary && (
                                <div style={{ background:'rgba(100,116,139,0.08)', border:'1px solid rgba(100,116,139,0.2)', borderRadius:'8px', padding:'12px 14px', marginBottom:'1rem', marginTop:'10px' }}>
                                  <div style={{ fontSize:'0.72rem', color:'#64748b', fontWeight:600, marginBottom:'4px', textTransform:'uppercase' }}>Email Content Preview</div>
                                  <div style={{ fontSize:'0.82rem', color:'#94a3b8', fontStyle:'italic', lineHeight:1.5 }}>{sessionDetail.session.email_summary}</div>
                                  <button onClick={() => handleSkip(sessionDetail.session.id)} style={{ ...btn('#64748b','rgba(100,116,139,0.1)'), marginTop:'8px', fontSize:'0.75rem', padding:'4px 10px' }}><X size={12}/> Mark as Skipped</button>
                                </div>
                              )}

                              {/* Settlement month */}
                              {sessionDetail.session?.settlement_month && (
                                <div style={{ fontSize:'0.82rem', marginTop:'10px', marginBottom:'8px' }}>
                                  <span style={{ color:'#64748b' }}>Settlement Month: </span>
                                  <strong style={{ color:'#10b981' }}>{fmtD(sessionDetail.session.settlement_month)}</strong>
                                </div>
                              )}

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

                              {/* Name warnings */}
                              {sessionDetail.session?.name_warnings?.length > 0 && (
                                <div style={{ marginBottom:'1rem' }}>
                                  <div style={{ color:'#f59e0b', fontWeight:700, fontSize:'0.85rem', marginBottom:'6px' }}>⚠ Name Match Warnings ({sessionDetail.session.name_warnings.length})</div>
                                  <div style={{ fontSize:'0.78rem', color:'#94a3b8' }}>These rows were accepted but have partial name matches. Verify manually if needed.</div>
                                  <div style={{ overflowX:'auto', marginTop:'8px' }}>
                                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.78rem' }}>
                                      <thead><tr>{['Sheet','Row','Warning','Value'].map(h => <th key={h} style={{ ...s.th, fontSize:'0.68rem', background:'rgba(245,158,11,0.06)' }}>{h}</th>)}</tr></thead>
                                      <tbody>
                                        {sessionDetail.session.name_warnings.map((w, i) => (
                                          <tr key={i}>
                                            <td style={{ ...s.td, fontSize:'0.76rem' }}>{w.sheet}</td>
                                            <td style={{ ...s.td, fontSize:'0.76rem', textAlign:'center' }}>{w.row}</td>
                                            <td style={{ ...s.td, fontSize:'0.76rem', color:'#f59e0b' }}>{w.warning}</td>
                                            <td style={{ ...s.td, fontSize:'0.76rem', color:'#94a3b8', fontStyle:'italic' }}>{String(w.value||'').slice(0,40)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {/* Claims totals summary */}
                              {(sessionDetail.session?.total_ot_rows > 0 || sessionDetail.session?.total_expense_rows > 0 || sessionDetail.session?.total_medical_rows > 0) && (
                                <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginBottom:'12px', marginTop:'8px' }}>
                                  {sessionDetail.session.total_ot_rows > 0 && (
                                    <div style={{ background:'rgba(167,139,250,0.1)', border:'1px solid rgba(167,139,250,0.2)', borderRadius:'8px', padding:'8px 14px' }}>
                                      <div style={{ fontSize:'0.7rem', color:'#a78bfa', fontWeight:600, textTransform:'uppercase' }}>OT Single</div>
                                      <div style={{ fontSize:'1.1rem', fontWeight:800, color:'#a78bfa' }}>{sessionDetail.session.ot_single_count || 0} rows</div>
                                    </div>
                                  )}
                                  {(sessionDetail.session.ot_double_count > 0) && (
                                    <div style={{ background:'rgba(192,132,252,0.1)', border:'1px solid rgba(192,132,252,0.2)', borderRadius:'8px', padding:'8px 14px' }}>
                                      <div style={{ fontSize:'0.7rem', color:'#c084fc', fontWeight:600, textTransform:'uppercase' }}>OT 2× Hours</div>
                                      <div style={{ fontSize:'1.1rem', fontWeight:800, color:'#c084fc' }}>{sessionDetail.session.ot_double_count || 0} rows</div>
                                    </div>
                                  )}
                                  {(sessionDetail.session.ot_triple_count > 0) && (
                                    <div style={{ background:'rgba(124,58,237,0.1)', border:'1px solid rgba(124,58,237,0.2)', borderRadius:'8px', padding:'8px 14px' }}>
                                      <div style={{ fontSize:'0.7rem', color:'#7c3aed', fontWeight:600, textTransform:'uppercase' }}>OT 3× Hours</div>
                                      <div style={{ fontSize:'1.1rem', fontWeight:800, color:'#7c3aed' }}>{sessionDetail.session.ot_triple_count || 0} rows</div>
                                    </div>
                                  )}
                                  {sessionDetail.session.total_expense_rows > 0 && (
                                    <div style={{ background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:'8px', padding:'8px 14px' }}>
                                      <div style={{ fontSize:'0.7rem', color:'#f59e0b', fontWeight:600, textTransform:'uppercase' }}>Expense Claims</div>
                                      <div style={{ fontSize:'1.1rem', fontWeight:800, color:'#f59e0b' }}>{sessionDetail.session.total_expense_rows} rows</div>
                                      <div style={{ fontSize:'0.75rem', color:'#d97706' }}>PKR {(sessionDetail.items?.filter(i=>i.claim_type==='EXPENSE').reduce((s,i)=>s+parseFloat(i.raw_amount||0),0)||0).toLocaleString('en-PK')}</div>
                                    </div>
                                  )}
                                  {sessionDetail.session.total_medical_rows > 0 && (
                                    <div style={{ background:'rgba(56,189,248,0.1)', border:'1px solid rgba(56,189,248,0.2)', borderRadius:'8px', padding:'8px 14px' }}>
                                      <div style={{ fontSize:'0.7rem', color:'#38bdf8', fontWeight:600, textTransform:'uppercase' }}>Medical Claims</div>
                                      <div style={{ fontSize:'1.1rem', fontWeight:800, color:'#38bdf8' }}>{sessionDetail.session.total_medical_rows} rows</div>
                                      <div style={{ fontSize:'0.75rem', color:'#0891b2' }}>PKR {(sessionDetail.items?.filter(i=>i.claim_type==='MEDICAL').reduce((s,i)=>s+parseFloat(i.raw_amount||0),0)||0).toLocaleString('en-PK')}</div>
                                    </div>
                                  )}
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
                                        {['Tab','Row','Code','Name DB','Date','Type','OT Hrs','Mult','Amount','Payout','Match'].map(h => <th key={h} style={{ ...s.th, fontSize: '0.68rem' }}>{h}</th>)}
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
                                            <td style={s.td}>
                                              {item.name_similarity != null && parseFloat(item.name_similarity) < 0.8 ? (
                                                <span style={{ color:'#f59e0b', fontSize:'0.72rem', fontWeight:700 }}>⚠ {(parseFloat(item.name_similarity)*100).toFixed(0)}%</span>
                                              ) : (
                                                <span style={{ color:'#22c55e', fontSize:'0.72rem' }}>✓</span>
                                              )}
                                            </td>
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
          TAB 5: Employee Claims
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'employees' && (
        <div>
          {/* Search + Filter bar */}
          <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginBottom:'1.5rem', alignItems:'center' }}>
            <input
              value={empClaimsSearch}
              onChange={e => setEmpClaimsSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadEmpClaims()}
              placeholder="Search by name, employee code…"
              style={{ ...s.input, minWidth:'240px', flex:1 }}
            />
            <select value={empClaimsFilter.claimType} onChange={e => setEmpClaimsFilter(f => ({...f, claimType: e.target.value}))} style={s.sel}>
              <option value="ALL">All Types</option>
              <option value="OT">Overtime</option>
              <option value="EXPENSE">Expense</option>
              <option value="MEDICAL">Medical</option>
            </select>
            <input type="date" value={empClaimsFilter.dateFrom} onChange={e => setEmpClaimsFilter(f => ({...f, dateFrom: e.target.value}))} style={s.input} />
            <input type="date" value={empClaimsFilter.dateTo}   onChange={e => setEmpClaimsFilter(f => ({...f, dateTo:   e.target.value}))} style={s.input} />
            <button onClick={loadEmpClaims} style={btn('#6366f1')}><Search size={14}/> Search</button>
          </div>

          {empClaimsLoading ? (
            <div style={{ textAlign:'center', padding:'3rem' }}><Spinner size={32}/></div>
          ) : empClaimsData.length === 0 ? (
            <div style={{ ...s.card, textAlign:'center', color:'#64748b', padding:'3rem' }}>No employee claims found. Search by name or code above.</div>
          ) : (
            empClaimsData.map(emp => (
              <div key={emp.employee_id || emp.name} style={{ ...s.card, marginBottom:'1rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:'0.95rem', color:'#e2e8f0' }}>{emp.name || 'Unknown'}</div>
                    <div style={{ fontSize:'0.75rem', color:'#64748b' }}>{emp.employee_id || '—'}</div>
                  </div>
                  <div style={{ fontSize:'0.75rem', color:'#64748b' }}>{emp.months.length} month(s) on record</div>
                </div>
                {emp.months.map(mo => (
                  <div key={mo.month} style={{ marginBottom:'0.75rem', borderLeft:'3px solid #334155', paddingLeft:'12px' }}>
                    <div style={{ fontWeight:600, fontSize:'0.82rem', color:'#94a3b8', marginBottom:'6px' }}>
                      {new Date(mo.month + '-01').toLocaleString('en-US', { month:'long', year:'numeric' })}
                    </div>
                    <div style={{ display:'flex', gap:'10px', flexWrap:'wrap' }}>
                      {mo.claims.map((c, ci) => (
                        <div key={ci} style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'8px', padding:'8px 12px', minWidth:'140px' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                            <ClaimTypeBadge type={c.claim_type} />
                            <StatusBadge status={c.status} />
                          </div>
                          {c.claim_type === 'OT' ? (
                            <>
                              <div style={{ fontSize:'0.78rem', color:'#94a3b8' }}>{c.row_count} rows · {c.total_ot_hours.toFixed(1)}h</div>
                              <div style={{ fontSize:'0.85rem', fontWeight:700, color:'#a78bfa' }}>PKR {fmt(c.total_ot_payout)}</div>
                            </>
                          ) : (
                            <>
                              <div style={{ fontSize:'0.78rem', color:'#94a3b8' }}>{c.row_count} rows</div>
                              <div style={{ fontSize:'0.85rem', fontWeight:700, color: c.claim_type==='EXPENSE' ? '#f59e0b' : '#38bdf8' }}>PKR {fmt(c.total_amount)}</div>
                            </>
                          )}
                          {c.settlement_month && (
                            <div style={{ fontSize:'0.68rem', color:'#10b981', marginTop:'2px' }}>Settles: {new Date(c.settlement_month).toLocaleString('en-US',{month:'short',year:'numeric'})}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 6: Focal Points
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'focal' && (
        <div>
          {/* Add new focal point form */}
          <div style={{ ...s.card, marginBottom:'1.5rem' }}>
            <div style={{ fontWeight:700, fontSize:'0.9rem', marginBottom:'1rem', color:'#e2e8f0' }}>Add Focal Point</div>
            <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', alignItems:'flex-end' }}>
              <div style={{ flex:2, minWidth:'180px' }}>
                <label style={{ fontSize:'0.72rem', color:'#64748b', display:'block', marginBottom:'4px' }}>Email *</label>
                <input value={fpForm.email} onChange={e => setFpForm(f => ({...f, email:e.target.value}))} placeholder="focal@wafi-energy.com" style={{ ...s.input, width:'100%', boxSizing:'border-box' }} />
              </div>
              <div style={{ flex:2, minWidth:'140px' }}>
                <label style={{ fontSize:'0.72rem', color:'#64748b', display:'block', marginBottom:'4px' }}>Name</label>
                <input value={fpForm.name} onChange={e => setFpForm(f => ({...f, name:e.target.value}))} placeholder="Full Name" style={{ ...s.input, width:'100%', boxSizing:'border-box' }} />
              </div>
              <div style={{ flex:2, minWidth:'130px' }}>
                <label style={{ fontSize:'0.72rem', color:'#64748b', display:'block', marginBottom:'4px' }}>Location</label>
                <input value={fpForm.location} onChange={e => setFpForm(f => ({...f, location:e.target.value}))} placeholder="LOBP Keamari" style={{ ...s.input, width:'100%', boxSizing:'border-box' }} />
              </div>
              <div style={{ flex:1, minWidth:'130px' }}>
                <label style={{ fontSize:'0.72rem', color:'#64748b', display:'block', marginBottom:'4px' }}>Role</label>
                <select value={fpForm.role} onChange={e => setFpForm(f => ({...f, role:e.target.value}))} style={{ ...s.sel, width:'100%' }}>
                  <option value="claimed_by">Claimed By</option>
                  <option value="approved_by">Approved By</option>
                </select>
              </div>
              <button onClick={addFocalPoint} disabled={fpSaving || !fpForm.email} style={{ ...btn('#6366f1'), alignSelf:'flex-end' }}>
                {fpSaving ? <Spinner size={14}/> : null} Add
              </button>
            </div>
          </div>

          {/* Focal points list */}
          <div style={s.card}>
            <div style={{ fontWeight:700, fontSize:'0.9rem', marginBottom:'1rem', color:'#e2e8f0' }}>Registered Focal Points</div>
            {fpLoading ? <Spinner size={20}/> : (
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>
                  {['Email','Name','Location','Role','Action'].map(h => <th key={h} style={s.th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {focalPoints.length === 0 && (
                    <tr><td colSpan={5} style={{ ...s.td, textAlign:'center', color:'#64748b' }}>No focal points registered yet</td></tr>
                  )}
                  {focalPoints.map(fp => (
                    <tr key={fp.id}>
                      <td style={s.td}><span style={{ fontFamily:'monospace', fontSize:'0.8rem', color:'#e2e8f0' }}>{fp.email}</span></td>
                      <td style={s.td}>{fp.name || '—'}</td>
                      <td style={s.td}>{fp.location || '—'}</td>
                      <td style={s.td}>
                        <span style={{ fontSize:'0.72rem', fontWeight:600, padding:'2px 8px', borderRadius:'4px', background: fp.role==='approved_by' ? 'rgba(56,189,248,0.12)' : 'rgba(99,102,241,0.12)', color: fp.role==='approved_by' ? '#38bdf8' : '#6366f1' }}>
                          {fp.role === 'approved_by' ? 'Approved By' : 'Claimed By'}
                        </span>
                      </td>
                      <td style={s.td}>
                        <button onClick={() => removeFocalPoint(fp.id)} style={{ background:'transparent', border:'1px solid rgba(239,68,68,0.3)', color:'#ef4444', padding:'3px 8px', borderRadius:'5px', cursor:'pointer', fontSize:'0.72rem' }}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Verify Modal
      ══════════════════════════════════════════════════════════════════════ */}
      {verifyModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1050 }}>
          <div style={{ background:'#1e293b', border:'1px solid rgba(16,185,129,0.3)', borderRadius:'14px', padding:'1.75rem', minWidth:'380px', maxWidth:'480px', width:'92%' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
              <div style={{ fontWeight:700, fontSize:'1rem', color:'#e2e8f0' }}>Verify & Push to Payroll</div>
              <button onClick={() => setVerifyModal(null)} style={{ background:'transparent', border:'none', color:'#64748b', cursor:'pointer', display:'flex' }}><X size={18}/></button>
            </div>

            {/* Summary */}
            <div style={{ background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.15)', borderRadius:'8px', padding:'10px 14px', marginBottom:'1.25rem' }}>
              <div style={{ fontSize:'0.82rem', color:'#94a3b8', marginBottom:'6px' }}>Session from <strong style={{ color:'#e2e8f0' }}>{verifyModal.sender}</strong></div>
              <div style={{ fontSize:'0.78rem', color:'#64748b' }}>{verifyModal.filename}</div>
              <div style={{ display:'flex', gap:'16px', marginTop:'8px' }}>
                <span style={{ fontSize:'0.8rem', color:'#a78bfa' }}>⏱ {verifyModal.otCount} OT</span>
                <span style={{ fontSize:'0.8rem', color:'#f59e0b' }}>💳 {verifyModal.expCount} Expense</span>
                <span style={{ fontSize:'0.8rem', color:'#38bdf8' }}>🏥 {verifyModal.medCount} Medical</span>
              </div>
            </div>

            {/* Settlement month picker */}
            <label style={{ fontSize:'0.78rem', color:'#64748b', display:'block', marginBottom:'6px' }}>Settlement Payroll Month</label>
            <select
              value={`${verifyMonth.year}-${verifyMonth.month}`}
              onChange={e => { const sel = MONTHS.find(m => `${m.year}-${m.month}` === e.target.value); if (sel) setVerifyMonth(sel); }}
              style={{ ...s.sel, width:'100%', marginBottom:'0.5rem' }}
            >
              {MONTHS.map(m => <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{m.label}</option>)}
            </select>
            <div style={{ fontSize:'0.72rem', color:'#64748b', marginBottom:'1.25rem' }}>A confirmation draft email will be created in Gmail for this month's settlement.</div>

            {/* Result feedback */}
            {verifyResult && (
              <div style={{ marginBottom:'1rem', padding:'10px 12px', borderRadius:'8px', background: verifyResult.error ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', fontSize:'0.82rem', color: verifyResult.error ? '#ef4444' : '#10b981' }}>
                {verifyResult.error || verifyResult.message}
              </div>
            )}

            <div style={{ display:'flex', gap:'10px', justifyContent:'flex-end' }}>
              <button onClick={() => setVerifyModal(null)} style={btn('#64748b','rgba(100,116,139,0.1)')}>Cancel</button>
              <button onClick={handleVerify} disabled={verifyLoading} style={{ ...btn('#10b981','rgba(16,185,129,0.15)'), opacity: verifyLoading ? 0.7 : 1 }}>
                {verifyLoading ? <Spinner size={14}/> : <CheckCircle size={14}/>}
                {verifyLoading ? 'Verifying…' : 'Confirm & Push to Payroll'}
              </button>
            </div>
          </div>
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

      <style>{`@keyframes wafi_spin { to { transform: rotate(360deg); } } @keyframes wafi_pulse { 0%,100% { opacity:1 } 50% { opacity:0.6 } }`}</style>
    </div>

  );
}
