import React, { useState, useEffect } from 'react';
import { Wrench, LogOut, AlertCircle, CheckCircle, Clock } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
const TOKEN_KEY = 'asil_cmms_client_token';
const CLIENT_KEY = 'asil_cmms_client';

async function cmmsFetch(path, token, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: { ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

const fmtDate = s => s ? new Date(s).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function LoginScreen({ onLogin }) {
  const [phase, setPhase] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [clientInfo, setClientInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function requestOtp(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/cmms/client/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setClientInfo({ name: data.name, site: data.site });
      setPhase('otp');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/cmms/client/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(CLIENT_KEY, JSON.stringify(data.client));
      onLogin(data.token, data.client);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: 64, height: 64, background: 'linear-gradient(135deg, #f59e0b, #ea580c)', borderRadius: '16px', margin: '0 auto 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Wrench size={32} color="white" />
          </div>
          <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>Client CMMS Portal</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: '0.9rem' }}>Report and track maintenance issues at your site</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', padding: '2rem' }}>
          {phase === 'email' ? (
            <form onSubmit={requestOtp}>
              <h2 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.25rem', fontSize: '1.1rem' }}>Sign In</h2>
              <p style={{ color: '#94a3b8', fontSize: '0.83rem', marginBottom: '1.5rem' }}>Enter your registered client email to receive an OTP.</p>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus
                style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '12px 16px', color: '#fff', fontSize: '1rem', outline: 'none', boxSizing: 'border-box' }} />
              {error && <p style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '8px' }}>{error}</p>}
              <button type="submit" disabled={loading}
                style={{ width: '100%', marginTop: '1rem', background: 'linear-gradient(135deg, #f59e0b, #ea580c)', border: 'none', color: '#fff', padding: '13px', borderRadius: '10px', fontWeight: 700, fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                {loading ? 'Sending OTP...' : 'Send OTP →'}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <h2 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.25rem', fontSize: '1.1rem' }}>
                Welcome{clientInfo?.name ? `, ${clientInfo.name}` : ''}
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '0.83rem', marginBottom: '1.5rem' }}>
                Site: {clientInfo?.site || '—'} · OTP sent to {email}
              </p>
              <input type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="• • • • • •" required maxLength={6} autoFocus
                style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '12px 16px', color: '#fff', fontSize: '1.5rem', letterSpacing: '0.3em', textAlign: 'center', outline: 'none', boxSizing: 'border-box' }} />
              {error && <p style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '8px' }}>{error}</p>}
              <button type="submit" disabled={loading || otp.length < 6}
                style={{ width: '100%', marginTop: '1rem', background: 'linear-gradient(135deg, #f59e0b, #ea580c)', border: 'none', color: '#fff', padding: '13px', borderRadius: '10px', fontWeight: 700, fontSize: '1rem', cursor: (loading || otp.length < 6) ? 'not-allowed' : 'pointer', opacity: (loading || otp.length < 6) ? 0.7 : 1 }}>
                {loading ? 'Verifying...' : 'Verify & Sign In →'}
              </button>
              <button type="button" onClick={() => { setPhase('email'); setOtp(''); setError(''); }}
                style={{ width: '100%', marginTop: '0.75rem', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem' }}>
                ← Use a different email
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function statusColor(status, dueDate) {
  if (dueDate && ['open', 'in_progress'].includes(status)) {
    const due = new Date(dueDate);
    if (due < new Date()) return '#ef4444';
  }
  if (status === 'resolved' || status === 'closed') return '#22c55e';
  if (status === 'in_progress') return '#f59e0b';
  return '#94a3b8';
}

function Dashboard({ token, client, onLogout }) {
  const [tab, setTab] = useState('tickets');
  const [tickets, setTickets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ category: 'Other', priority: 'normal', title: '', description: '', due_date: '', cc_email: '' });
  const [photo, setPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    setLoading(true);
    cmmsFetch('/api/cmms/client/tickets', token)
      .then(d => setTickets(d.tickets || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    fetch(`${API}/api/cmms/sites`)
      .then(() => {})
      .catch(() => {});
    setCategories([
      'Housekeeping', 'Gardening', 'Painting', 'Rider', 'Tea Boy', 'AC Technician',
      'Sanitation', 'HSSE', 'Staff Welfare', 'Safety', 'Other',
    ]);
  }, [client.site]);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => { if (v) fd.append(k, v); });
      if (photo) fd.append('photo', photo);
      await cmmsFetch('/api/cmms/client/tickets', token, { method: 'POST', body: fd });
      setForm({ category: 'Other', priority: 'normal', title: '', description: '', due_date: '', cc_email: '' });
      setPhoto(null);
      setTab('tickets');
      load();
    } catch (err) {
      alert(err.message);
    }
    setSubmitting(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
      <header style={{ borderBottom: '1px solid #334155', padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>CMMS — {client.site}</h1>
          <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>{client.name || client.email}</p>
        </div>
        <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.06)', border: '1px solid #334155', color: '#94a3b8', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer' }}>
          <LogOut size={16} /> Sign out
        </button>
      </header>

      <div style={{ display: 'flex', borderBottom: '1px solid #334155', padding: '0 1.5rem' }}>
        {[{ key: 'tickets', label: 'All Tickets' }, { key: 'report', label: 'Report Issue' }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: '0.85rem 1.25rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t.key ? '#f59e0b' : 'transparent'}`,
              color: tab === t.key ? '#f59e0b' : '#94a3b8', cursor: 'pointer', fontWeight: tab === t.key ? 700 : 400 }}>
            {t.label}
          </button>
        ))}
      </div>

      <main style={{ padding: '1.5rem', maxWidth: '960px', margin: '0 auto' }}>
        {tab === 'tickets' && (
          <div>
            {loading ? <p style={{ color: '#94a3b8' }}>Loading tickets...</p> : !tickets.length ? (
              <p style={{ color: '#94a3b8' }}>No tickets yet. Use Report Issue to log one.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {tickets.map(t => (
                  <div key={t.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#64748b' }}>{t.id}</div>
                        <div style={{ fontWeight: 700, marginTop: '4px' }}>{t.title}</div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '0.8rem' }}>
                        <div style={{ color: statusColor(t.status, t.due_date), fontWeight: 700, textTransform: 'capitalize' }}>{t.status.replace('_', ' ')}</div>
                        {t.due_date && (
                          <div style={{ color: '#94a3b8', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                            <Clock size={12} /> Due {fmtDate(t.due_date)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '8px', fontSize: '0.78rem', color: '#94a3b8' }}>
                      <span>{t.category}</span>
                      <span>·</span>
                      <span style={{ color: t.priority === 'critical' ? '#ef4444' : t.priority === 'high' ? '#f59e0b' : 'inherit' }}>{t.priority}</span>
                      {t.assigned_to && <><span>·</span><span>Owner: {t.assigned_to.split('@')[0]}</span></>}
                    </div>
                    {t.description && <p style={{ margin: '8px 0 0', fontSize: '0.85rem', color: '#cbd5e1' }}>{t.description}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'report' && (
          <form onSubmit={submit} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', padding: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <h3 style={{ margin: '0 0 0.5rem' }}>Report Maintenance Issue — {client.site}</h3>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>Photo is optional. Your site supervisor will be notified by email.</p>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Priority</label>
              <select value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }}>
                {['low', 'normal', 'high', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Title</label>
              <input required value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Description</label>
              <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={3}
                style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Requested deadline (optional)</label>
              <input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))}
                style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>CC email (optional)</label>
              <input type="email" value={form.cc_email} onChange={e => setForm(p => ({ ...p, cc_email: e.target.value }))}
                style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Photo (optional)</label>
              <input type="file" accept="image/*" onChange={e => setPhoto(e.target.files[0] || null)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <button type="submit" disabled={submitting}
                style={{ padding: '10px 20px', background: '#f59e0b', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                {submitting ? 'Submitting...' : 'Submit Ticket'}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

export default function ClientCMMSPortal() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [client, setClient] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CLIENT_KEY)); } catch { return null; }
  });

  const handleLogin = (t, c) => { setToken(t); setClient(c); };
  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CLIENT_KEY);
    setToken(null);
    setClient(null);
  };

  if (!token || !client) return <LoginScreen onLogin={handleLogin} />;
  return <Dashboard token={token} client={client} onLogout={handleLogout} />;
}
