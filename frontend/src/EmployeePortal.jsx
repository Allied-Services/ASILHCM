import React, { useState, useEffect } from 'react';
import { User, FileText, CreditCard, Umbrella, Phone, Home, LogOut, Clock, CheckCircle, AlertCircle, Download, ChevronRight, MapPin, Briefcase, Mail, Shield } from 'lucide-react';
import { api } from './api';
import { activeStatusLabel } from './employeeActive';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
const PORTAL_TOKEN_KEY = 'asil_portal_token';
const PORTAL_EMP_KEY   = 'asil_portal_emp';

// ─── Phone normaliser ─────────────────────────────────────────────────────────
function normalisePhone(raw = '') {
    const d = raw.replace(/\D/g, '');
    if (d.startsWith('92') && d.length === 12) return '0' + d.slice(2);
    if (d.startsWith('3')  && d.length === 10) return '0' + d;
    return d;
}

// ─── Portal API helpers ───────────────────────────────────────────────────────
async function portalFetch(path, token, opts = {}) {
    const r = await fetch(`${API}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const Rs = n => 'Rs. ' + Math.round(parseFloat(n) || 0).toLocaleString('en-PK');
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const monthName = m => MONTHS[(parseInt(m)||1) - 1];
const fmtDate = s => s ? new Date(s).toLocaleDateString('en-PK', { day:'2-digit', month:'short', year:'numeric' }) : '—';

// Native <select> dropdowns use OS popup colors; force readable dark options on Windows.
const selectStyle = {
    padding: '10px',
    background: '#0f172a',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px',
    color: '#e2e8f0',
    colorScheme: 'dark',
};
const optionStyle = { background: '#0f172a', color: '#e2e8f0' };
const inputStyle = {
    padding: '10px',
    background: '#0f172a',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '8px',
    color: '#e2e8f0',
};

const OFFICE_LOCATIONS = [
    {
        city: 'Karachi (Head Office)',
        address: '6 Hilltop Arcade, 4D/2 Gizri Blvd Rd, D.H.A. Phase 4, Karachi, 75500',
        maps: 'https://maps.app.goo.gl/qH3zwWfDYKFPhwGA6',
    },
    {
        city: 'Rawalpindi',
        address: 'C73, opposite Bilal Hospital, Satellite Town Block C, Rawalpindi',
        maps: 'https://maps.app.goo.gl/DYb6K8tMZRy2ThZr9',
    },
    {
        city: 'Lahore',
        address: '30, Sabzazar Block D, Sabzazar Housing Scheme Phase 1 & 2, Lahore, 54000',
        maps: 'https://maps.app.goo.gl/xFu2DA45xsNVEDbk9',
    },
    {
        city: 'Dubai',
        address: 'Allied Services FZ LLC — Boulevard Plaza, Downtown Dubai, UAE',
        maps: null,
    },
    {
        city: 'Riyadh',
        address: 'Olaya Street, Riyadh, KSA',
        maps: null,
    },
];

// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
    const [phase, setPhase] = useState('identify'); // identify | otp
    const [identifier, setIdentifier] = useState('');
    const [otp, setOtp] = useState('');
    const [empName, setEmpName] = useState('');
    const [employeeId, setEmployeeId] = useState('');
    const [channel, setChannel] = useState('email');
    const [destinationMasked, setDestinationMasked] = useState('');
    const [fallbackAvailable, setFallbackAvailable] = useState(false);
    const [fallbackMsg, setFallbackMsg] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [dupes, setDupes] = useState([]);

    function parseIdentifier(raw) {
        const t = (raw || '').trim();
        if (!t) return {};
        const digits = t.replace(/\D/g, '');
        if (/[A-Za-z]/.test(t)) return { employeeId: t };
        if (digits.length >= 10) return { phone: normalisePhone(t) };
        return { employeeId: t };
    }

    async function requestOtp(e, { preferSms = false, forcedEmployeeId } = {}) {
        if (e?.preventDefault) e.preventDefault();
        setError(''); setLoading(true); setDupes([]); setFallbackMsg('');
        try {
            const body = forcedEmployeeId
                ? { employeeId: forcedEmployeeId, preferSms }
                : { ...parseIdentifier(identifier), preferSms };
            if (!body.phone && !body.employeeId) throw new Error('Enter your employee code or mobile number');

            let res;
            try {
                res = await fetch(`${API}/api/portal/request-otp`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } catch {
                throw new Error('Cannot reach the server (network/CORS). Please try again in a minute, or use https://hcm.asil.com.pk/portal/');
            }
            const data = await res.json().catch(() => ({}));
            if (res.status === 409 && data.employees?.length) {
                setDupes(data.employees);
                throw new Error(data.error || 'Multiple matches — pick your employee code');
            }
            if (res.status === 409 && data.code) {
                throw new Error(data.error || 'Unable to send login code. Contact HR.');
            }
            if (!res.ok) throw new Error(data.error || 'Failed to send OTP');
            setEmpName(data.employeeName);
            setEmployeeId(data.employeeId || body.employeeId || '');
            setChannel(data.channel || 'sms');
            setDestinationMasked(data.destinationMasked || '');
            setFallbackAvailable(!!data.fallbackAvailable);
            if (data.channel === 'sms' && data.fallbackReason && data.fallbackReason !== 'no_email') {
                setFallbackMsg(data.message || 'Could not email you — code sent by SMS.');
            }
            setPhase('otp');
        } catch (err) { setError(err.message); }
        setLoading(false);
    }

    async function verifyOtp(e) {
        e.preventDefault();
        setError(''); setLoading(true);
        try {
            const body = {
                otp,
                employeeId: employeeId || undefined,
                ...(!employeeId ? parseIdentifier(identifier) : {}),
            };
            const res = await fetch(`${API}/api/portal/verify-otp`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (res.status === 409 && data.code) {
                throw new Error(data.error || 'Unable to sign in. Contact HR.');
            }
            if (!res.ok) throw new Error(data.error);
            localStorage.setItem(PORTAL_TOKEN_KEY, data.token);
            localStorage.setItem(PORTAL_EMP_KEY, JSON.stringify(data.employee));
            onLogin(data.token, data.employee);
        } catch (err) { setError(err.message); }
        setLoading(false);
    }

    return (
        <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div style={{ width: '100%', maxWidth: '420px' }}>
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{ width: 64, height: 64, background: 'linear-gradient(135deg, #38bdf8, #6366f1)', borderRadius: '16px', margin: '0 auto 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Shield size={32} color="white" />
                    </div>
                    <h1 style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>Employee Portal</h1>
                    <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: '0.9rem' }}>Allied Services International (Pvt.) Ltd.</p>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', padding: '2rem' }}>
                    {phase === 'identify' ? (
                        <form onSubmit={(e) => requestOtp(e)}>
                            <h2 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.25rem', fontSize: '1.1rem' }}>Sign In</h2>
                            <p style={{ color: '#94a3b8', fontSize: '0.83rem', marginBottom: '1.5rem' }}>
                                Enter your employee code or registered mobile. We email a code when an email is on file; otherwise we text your phone.
                            </p>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Employee Code or Mobile</label>
                            <input
                                type="text" value={identifier} onChange={e => setIdentifier(e.target.value)}
                                placeholder="ASIL-001 or 0300 0000000" required autoFocus
                                style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '12px 16px', color: '#fff', fontSize: '1rem', outline: 'none', boxSizing: 'border-box' }}
                            />
                            {dupes.length > 0 && (
                                <div style={{ marginTop: '12px' }}>
                                    <p style={{ color: '#fbbf24', fontSize: '0.8rem', marginBottom: '8px' }}>Multiple employees share this phone — select yours:</p>
                                    {dupes.map(d => (
                                        <button key={d.id} type="button" onClick={() => requestOtp(null, { forcedEmployeeId: d.id })}
                                            style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: '6px', padding: '10px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#e2e8f0', cursor: 'pointer' }}>
                                            {d.name} · {d.id}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {error && <p style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '8px' }}>{error}</p>}
                            <button type="submit" disabled={loading}
                                style={{ width: '100%', marginTop: '1rem', background: 'linear-gradient(135deg, #38bdf8, #6366f1)', border: 'none', color: '#fff', padding: '13px', borderRadius: '10px', fontWeight: 700, fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                                {loading ? 'Sending code...' : 'Send login code →'}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={verifyOtp}>
                            <h2 style={{ color: '#fff', fontWeight: 700, marginBottom: '0.25rem', fontSize: '1.1rem' }}>Welcome, {empName || 'Employee'}</h2>
                            <p style={{ color: '#94a3b8', fontSize: '0.83rem', marginBottom: '0.75rem' }}>
                                Enter the 6-digit code sent by {channel === 'email' ? 'email' : 'SMS'} to {destinationMasked || 'your contact'}.
                            </p>
                            {fallbackMsg && <p style={{ color: '#fbbf24', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{fallbackMsg}</p>}
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>One-Time Password</label>
                            <input
                                type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g,'').slice(0,6))}
                                placeholder="• • • • • •" required maxLength={6} autoFocus
                                style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', padding: '12px 16px', color: '#fff', fontSize: '1.5rem', letterSpacing: '0.3em', textAlign: 'center', outline: 'none', boxSizing: 'border-box' }}
                            />
                            {error && <p style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '8px' }}>{error}</p>}
                            <button type="submit" disabled={loading || otp.length < 6}
                                style={{ width: '100%', marginTop: '1rem', background: 'linear-gradient(135deg, #38bdf8, #6366f1)', border: 'none', color: '#fff', padding: '13px', borderRadius: '10px', fontWeight: 700, fontSize: '1rem', cursor: (loading || otp.length < 6) ? 'not-allowed' : 'pointer', opacity: (loading || otp.length < 6) ? 0.7 : 1 }}>
                                {loading ? 'Verifying...' : 'Verify & Sign In →'}
                            </button>
                            {channel === 'email' && fallbackAvailable && (
                                <button type="button" onClick={() => requestOtp(null, { preferSms: true, forcedEmployeeId: employeeId })}
                                    style={{ width: '100%', marginTop: '0.5rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', padding: '10px', borderRadius: '10px', cursor: 'pointer', fontSize: '0.85rem' }}>
                                    Send code to my phone instead
                                </button>
                            )}
                            <button type="button" onClick={() => { setPhase('identify'); setOtp(''); setError(''); setFallbackMsg(''); }}
                                style={{ width: '100%', marginTop: '0.5rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', padding: '10px', borderRadius: '10px', cursor: 'pointer', fontSize: '0.85rem' }}>
                                ← Change ID / number
                            </button>
                        </form>
                    )}
                </div>
                <p style={{ textAlign: 'center', color: '#475569', fontSize: '0.75rem', marginTop: '1.5rem' }}>© 2026 Allied Services International (Pvt.) Ltd.</p>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTAL DASHBOARD (after login)
// ═══════════════════════════════════════════════════════════════════════════════
function PortalDashboard({ token, empBasic, onLogout }) {
    const [activeTab, setActiveTab] = useState('home');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [leaveData, setLeaveData] = useState(null);
    const [leaveForm, setLeaveForm] = useState({ leave_type: 'CL', from_date: '', to_date: '', reason: '' });
    const [leaveMsg, setLeaveMsg] = useState('');
    const [myRequests, setMyRequests] = useState([]);
    const [changeField, setChangeField] = useState('present_address');
    const [changeValue, setChangeValue] = useState('');
    const [changeMsg, setChangeMsg] = useState('');
    const [photoBusy, setPhotoBusy] = useState(false);
    const [photoObjectUrl, setPhotoObjectUrl] = useState(null);

    const reloadMe = () => portalFetch('/api/portal/me', token).then(setData);

    useEffect(() => {
        portalFetch('/api/portal/me', token)
            .then(setData)
            .catch(err => { setError(err.message); if (err.message.includes('expired') || err.message.includes('portal')) onLogout(); })
            .finally(() => setLoading(false));
        api.portalGetMyRequests(token).then(d => setMyRequests(d.requests || [])).catch(() => {});
    }, [token]);

    useEffect(() => {
        if (activeTab === 'leaves' && token) {
            api.portalLeaveBalance(token).then(setLeaveData).catch(() => {});
        }
        if (activeTab === 'profile' && token) {
            api.portalGetMyRequests(token).then(d => setMyRequests(d.requests || [])).catch(() => {});
        }
    }, [activeTab, token]);

    useEffect(() => {
        let revoked = false;
        let url;
        async function loadPhoto() {
            if (!data?.employee?.hasPhoto || !token) { setPhotoObjectUrl(null); return; }
            try {
                const r = await fetch(`${API}/api/portal/me/photo`, { headers: { Authorization: `Bearer ${token}` } });
                if (!r.ok) return;
                const blob = await r.blob();
                url = URL.createObjectURL(blob);
                if (!revoked) setPhotoObjectUrl(url);
            } catch { /* ignore */ }
        }
        loadPhoto();
        return () => { revoked = true; if (url) URL.revokeObjectURL(url); };
    }, [data?.employee?.hasPhoto, data?.employee?.photo_file_id, token]);

    const TABS = [
        { id: 'home', label: 'Home', icon: Home },
        { id: 'payslips', label: 'My Payslips', icon: FileText },
        { id: 'profile', label: 'My Profile', icon: User },
        { id: 'leaves', label: 'Leave & Time Off', icon: Umbrella },
        { id: 'advances', label: 'My Advances', icon: CreditCard },
        { id: 'contact', label: 'Contact HR', icon: Phone },
    ];

    if (loading) return (
        <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ color: '#94a3b8', textAlign: 'center' }}><div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>Loading your profile…</div>
        </div>
    );
    if (error) return (
        <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ color: '#f87171', textAlign: 'center' }}><AlertCircle size={32} style={{ marginBottom: '0.5rem' }} /><div>{error}</div></div>
        </div>
    );

    const emp = data?.employee || {};
    const payslips = data?.payslips || [];
    const advances = data?.advances || [];
    const latestPayslip = payslips[0];

    return (
        <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: "'Inter', sans-serif" }}>
            {/* Top Nav */}
            <div style={{ background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px', position: 'sticky', top: 0, zIndex: 100 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #38bdf8, #6366f1)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Shield size={16} color="white" />
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>ASIL Employee Portal</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {photoObjectUrl && <img src={photoObjectUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.15)' }} />}
                    <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Welcome, <strong style={{ color: '#e2e8f0' }}>{emp.name || empBasic?.name}</strong></span>
                    <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem' }}>
                        <LogOut size={14} /> Sign Out
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', minHeight: 'calc(100vh - 60px)' }}>
                {/* Sidebar */}
                <nav style={{ width: '220px', flexShrink: 0, background: 'rgba(255,255,255,0.03)', borderRight: '1px solid rgba(255,255,255,0.07)', padding: '1.5rem 0.75rem' }}>
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px', border: 'none', background: active ? 'rgba(56,189,248,0.12)' : 'transparent', color: active ? '#38bdf8' : '#94a3b8', fontWeight: active ? 700 : 500, fontSize: '0.875rem', cursor: 'pointer', marginBottom: '4px', transition: 'all 0.15s', textAlign: 'left' }}>
                                <Icon size={18} />
                                {tab.label}
                                {active && <ChevronRight size={14} style={{ marginLeft: 'auto' }} />}
                            </button>
                        );
                    })}
                </nav>

                {/* Main Content */}
                <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
                    {/* ── HOME ────────────────────────────────────────── */}
                    {activeTab === 'home' && (
                        <div>
                            <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.3rem', fontWeight: 800 }}>
                                Good day, {(emp.name||'').split(' ')[0]} 👋
                            </h2>
                            {/* Summary Cards */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                                {[
                                    { label: 'This Month Net Pay', value: latestPayslip ? Rs(latestPayslip.net) : '—', icon: CreditCard, color: '#22c55e', sub: latestPayslip ? `${monthName(latestPayslip.month)} ${latestPayslip.year}` : 'No payslip yet' },
                                    { label: 'Designation', value: emp.designation || '—', icon: Briefcase, color: '#38bdf8', sub: emp.client || '—' },
                                    { label: 'Location', value: emp.location || '—', icon: MapPin, color: '#a78bfa', sub: emp.province || '' },
                                    { label: 'Pending Requests', value: myRequests.filter(r => r.status === 'Pending').length, icon: AlertCircle, color: '#f59e0b', sub: 'Data change requests awaiting HCM' },
                                ].map(card => {
                                    const Icon = card.icon;
                                    return (
                                        <div key={card.label} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                <Icon size={16} color={card.color} />
                                                <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>{card.label}</span>
                                            </div>
                                            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#e2e8f0' }}>{card.value}</div>
                                            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>{card.sub}</div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Recent Payslips */}
                            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
                                <h3 style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>Recent Payslips</h3>
                                {payslips.length === 0 ? <p style={{ color: '#475569', fontSize: '0.875rem' }}>No payslip records found.</p> : (
                                    payslips.slice(0,4).map((p, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{monthName(p.month)} {p.year}</div>
                                                <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>Gross: {Rs(p.gross)} · WHT: {Rs(p.wht)}</div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontWeight: 800, color: '#22c55e', fontSize: '0.95rem' }}>{Rs(p.net)}</div>
                                                <div style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '99px', background: p.status === 'Paid' ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.12)', color: p.status === 'Paid' ? '#22c55e' : '#94a3b8', display: 'inline-block', marginTop: '2px' }}>{p.status}</div>
                                            </div>
                                        </div>
                                    ))
                                )}
                                {payslips.length > 0 && <button onClick={() => setActiveTab('payslips')} style={{ marginTop: '0.75rem', background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>View All Payslips →</button>}
                            </div>
                        </div>
                    )}

                    {/* ── PAYSLIPS ─────────────────────────────────────── */}
                    {activeTab === 'payslips' && (
                        <div>
                            <div style={{ background: '#fef3c7', color: '#92400e', padding: '12px 16px', borderRadius: 10, marginBottom: '1rem', fontSize: '0.85rem' }}>
                                <strong>TRIAL MODE</strong> — Payslips are in trial until November 2026. If anything looks wrong, report to ops-support@asil.com.pk.
                            </div>
                            <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.2rem', fontWeight: 800 }}>My Payslips</h2>
                            {payslips.length === 0 ? <div style={{ color: '#475569', padding: '3rem', textAlign: 'center' }}>No payslip records found.</div> : (
                                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', overflow: 'hidden' }}>
                                    {payslips.map((p, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: i < payslips.length-1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '4px' }}>{monthName(p.month)} {p.year}</div>
                                                <div style={{ display: 'flex', gap: '16px', fontSize: '0.78rem', color: '#64748b' }}>
                                                    <span>Gross: {Rs(p.gross)}</span>
                                                    <span>WHT: {Rs(p.wht)}</span>
                                                    <span>EOBI: {Rs(p.eobi)}</span>
                                                    {p.advance > 0 && <span>Advance: {Rs(p.advance)}</span>}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontWeight: 800, color: '#22c55e', fontSize: '1.05rem' }}>{Rs(p.net)}</div>
                                                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Net Pay</div>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        api.downloadPayslipPdf(emp.id, p.month, p.year, token)
                                                            .catch(() => alert('Payslip not available yet. Open with CNIC password after HR sends payslips.'));
                                                    }}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', color: '#38bdf8', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                                    <Download size={13} /> Download PDF
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── PROFILE ──────────────────────────────────────── */}
                    {activeTab === 'profile' && (
                        <div>
                            <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.2rem', fontWeight: 800 }}>My Profile</h2>

                            <div style={{ marginBottom: '1.5rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
                                <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 700 }}>Request a data change</h3>
                                <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: '#64748b' }}>
                                    Changes are reviewed by Allied HCM before they apply to your record.
                                </p>
                                <form onSubmit={async (e) => {
                                    e.preventDefault();
                                    setChangeMsg('');
                                    try {
                                        const res = await api.portalSubmitChangeRequest(token, changeField, changeValue);
                                        if (res.error) throw new Error(res.error);
                                        setChangeMsg('Request submitted. Allied HCM will review it shortly.');
                                        setChangeValue('');
                                        const d = await api.portalGetMyRequests(token);
                                        setMyRequests(d.requests || []);
                                    } catch (err) { setChangeMsg(err.message); }
                                }} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.75rem' }}>
                                    <select value={changeField} onChange={e => setChangeField(e.target.value)} style={selectStyle}>
                                        <option value="present_address" style={optionStyle}>Present Address</option>
                                        <option value="permanent_address" style={optionStyle}>Permanent Address</option>
                                        <option value="primary_contact" style={optionStyle}>Primary Contact</option>
                                        <option value="emergency_contact" style={optionStyle}>Emergency Contact</option>
                                        <option value="email" style={optionStyle}>Email Address</option>
                                        <option value="bank_name" style={optionStyle}>Bank Name</option>
                                        <option value="bank_account" style={optionStyle}>Bank Account Number</option>
                                        <option value="account_title" style={optionStyle}>Account Title</option>
                                        <option value="nok_name" style={optionStyle}>Next of Kin Name</option>
                                        <option value="nok_relation" style={optionStyle}>Next of Kin Relation</option>
                                        <option value="nok_contact" style={optionStyle}>Next of Kin Contact</option>
                                    </select>
                                    <input required value={changeValue} onChange={e => setChangeValue(e.target.value)} placeholder="New value" style={inputStyle} />
                                    <button type="submit" style={{ padding: '10px 16px', background: 'linear-gradient(135deg,#38bdf8,#6366f1)', border: 'none', borderRadius: '8px', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Submit</button>
                                </form>
                                {changeMsg && <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: changeMsg.includes('submitted') ? '#22c55e' : '#f87171' }}>{changeMsg}</p>}

                                {myRequests.length > 0 && (
                                    <div style={{ marginTop: '1.25rem' }}>
                                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>My requests</h4>
                                        {myRequests.slice(0, 10).map(r => (
                                            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.82rem' }}>
                                                <span>{r.field_label}: <span style={{ color: '#94a3b8' }}>{r.old_value || '—'} → </span>{r.new_value}</span>
                                                <span style={{ color: r.status === 'Approved' ? '#22c55e' : r.status === 'Rejected' ? '#f87171' : '#f59e0b', fontWeight: 600 }}>{r.status}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
                                <div style={{ width: 88, height: 88, borderRadius: '50%', overflow: 'hidden', background: 'rgba(56,189,248,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '2px solid rgba(56,189,248,0.3)' }}>
                                    {photoObjectUrl
                                        ? <img src={photoObjectUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <User size={36} color="#38bdf8" />}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>Profile photo</div>
                                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '10px' }}>JPEG, PNG or WebP · max 2 MB. Visible to Allied HCM.</div>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <label style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.25)', color: '#38bdf8', padding: '7px 14px', borderRadius: '8px', cursor: photoBusy ? 'wait' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                            {photoBusy ? 'Uploading…' : 'Upload photo'}
                                            <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={photoBusy}
                                                onChange={async (e) => {
                                                    const file = e.target.files?.[0];
                                                    e.target.value = '';
                                                    if (!file) return;
                                                    setPhotoBusy(true);
                                                    try {
                                                        await api.portalUploadPhoto(token, file);
                                                        await reloadMe();
                                                    } catch (err) { alert(err.message); }
                                                    setPhotoBusy(false);
                                                }} />
                                        </label>
                                        {emp.hasPhoto && (
                                            <button type="button" disabled={photoBusy} onClick={async () => {
                                                setPhotoBusy(true);
                                                try { await api.portalDeletePhoto(token); await reloadMe(); setPhotoObjectUrl(null); }
                                                catch (err) { alert(err.message); }
                                                setPhotoBusy(false);
                                            }} style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                                {[
                                    { title: 'Employment Details', fields: [
                                        ['Employee Code', emp.id], ['Business Unit', emp.bu], ['Client', emp.client], ['Department', emp.dept],
                                        ['Designation', emp.designation], ['Location', emp.location], ['Province', emp.province],
                                        ['Date of Joining', fmtDate(emp.doj)], ['Employment Status', activeStatusLabel(emp.active)],
                                    ]},
                                    { title: 'Personal Information', fields: [
                                        ['Full Name', emp.name], ['Father\'s Name', emp.father_name], ['Mother\'s Name', emp.mother_name],
                                        ['Date of Birth', fmtDate(emp.dob)], ['Place of Birth', emp.place_of_birth],
                                        ['Religion', emp.religion], ['Marital Status', emp.marital_status],
                                    ]},
                                    { title: 'Contact Information', fields: [
                                        ['Primary Phone', emp.primary_contact], ['Emergency Contact', emp.emergency_contact],
                                        ['Email', emp.email], ['Present Address', emp.present_address],
                                    ]},
                                    { title: 'Bank & Salary', fields: [
                                        ['Bank Name', emp.bank_name], ['Account Title', emp.account_title],
                                        ['Account Number', emp.bankAccountMasked || '****'],
                                        ['Gross Salary', emp.salary ? Rs(emp.salary) : '—'],
                                        ['EOBI Number', emp.eobi_no],
                                    ]},
                                    { title: 'Family', fields: [
                                        ['Spouse Name', emp.spouse_name], ['Spouse Age', emp.spouse_age],
                                        ['Child 1', emp.child1_name ? `${emp.child1_name} (${emp.child1_age||'?'} yrs)` : '—'],
                                        ['Child 2', emp.child2_name ? `${emp.child2_name} (${emp.child2_age||'?'} yrs)` : '—'],
                                    ]},
                                    { title: 'Medical & Insurance', fields: [
                                        ['Medical Type', emp.medical_type], ['Total Coverage', emp.total_medical_coverage ? Rs(emp.total_medical_coverage) : '—'],
                                        ['Maternity Cover', emp.medical_maternity], ['Insurance Policy #', emp.insurance_policy_no || '—'],
                                        ['ID Card Status', emp.id_card_status || '—'],
                                    ]},
                                    { title: 'Next of Kin', fields: [
                                        ['NOK Name', emp.nok_name], ['Relation', emp.nok_relation], ['NOK Contact', emp.nok_contact],
                                    ]},
                                ].map(section => (
                                    <div key={section.title} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
                                        <h3 style={{ margin: '0 0 1rem', fontSize: '0.85rem', fontWeight: 700 }}>{section.title}</h3>
                                        {section.fields.map(([label, val]) => (
                                            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.83rem' }}>
                                                <span style={{ color: '#64748b' }}>{label}</span>
                                                <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '55%' }}>{val || '—'}</span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── LEAVES ───────────────────────────────────────── */}
                    {activeTab === 'leaves' && (
                        <div>
                            <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.2rem', fontWeight: 800 }}>Leave & Time Off</h2>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                                {['CL', 'ML', 'EL'].map(lt => {
                                    const bal = leaveData?.balances?.[lt];
                                    const entitled = parseFloat(bal?.entitled) || (lt === 'CL' ? 10 : lt === 'ML' ? 8 : 14);
                                    const used = parseFloat(bal?.used) || 0;
                                    const remaining = entitled - used;
                                    const colors = { CL: '#38bdf8', ML: '#a78bfa', EL: '#22c55e' };
                                    return (
                                        <div key={lt} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.5rem', textAlign: 'center' }}>
                                            <div style={{ fontSize: '2rem', fontWeight: 900, color: colors[lt] }}>{remaining}</div>
                                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{lt}</div>
                                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{used} used of {entitled}</div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
                                <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', fontWeight: 700 }}>Request Leave</h3>
                                <form onSubmit={async (e) => {
                                    e.preventDefault();
                                    setLeaveMsg('');
                                    try {
                                        const res = await api.portalLeaveRequest(token, leaveForm);
                                        if (res.error) throw new Error(res.error);
                                        setLeaveMsg('Leave request submitted. Allied focal will review shortly.');
                                        setLeaveForm({ leave_type: 'CL', from_date: '', to_date: '', reason: '' });
                                        api.portalLeaveBalance(token).then(setLeaveData);
                                    } catch (err) { setLeaveMsg(err.message); }
                                }} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                    <select value={leaveForm.leave_type} onChange={e => setLeaveForm(p => ({ ...p, leave_type: e.target.value }))} style={selectStyle}>
                                        <option value="CL" style={optionStyle}>Casual Leave</option>
                                        <option value="ML" style={optionStyle}>Medical Leave</option>
                                        <option value="EL" style={optionStyle}>Earned Leave</option>
                                    </select>
                                    <input type="date" required value={leaveForm.from_date} onChange={e => setLeaveForm(p => ({ ...p, from_date: e.target.value }))} style={{ ...inputStyle, colorScheme: 'dark' }} />
                                    <input type="date" required value={leaveForm.to_date} onChange={e => setLeaveForm(p => ({ ...p, to_date: e.target.value }))} style={{ ...inputStyle, colorScheme: 'dark' }} />
                                    <input placeholder="Reason" value={leaveForm.reason} onChange={e => setLeaveForm(p => ({ ...p, reason: e.target.value }))} style={inputStyle} />
                                    <button type="submit" style={{ gridColumn: '1/-1', padding: '12px', background: 'linear-gradient(135deg,#38bdf8,#6366f1)', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Submit Leave Request</button>
                                </form>
                                {leaveMsg && <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: leaveMsg.includes('submitted') ? '#22c55e' : '#f87171' }}>{leaveMsg}</p>}
                            </div>
                            {(leaveData?.history || []).length > 0 && (
                                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
                                    <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>My Requests</h3>
                                    {leaveData.history.map(l => (
                                        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '0.82rem' }}>
                                            <span>{l.leave_type} · {l.from_date} → {l.to_date}</span>
                                            <span style={{ color: l.status === 'approved' ? '#22c55e' : l.status === 'pending' ? '#f59e0b' : '#94a3b8' }}>{l.status}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── ADVANCES ─────────────────────────────────────── */}
                    {activeTab === 'advances' && (
                        <div>
                            <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.2rem', fontWeight: 800 }}>My Advances & Loans</h2>
                            {advances.length === 0 ? (
                                <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '3rem', textAlign: 'center', color: '#475569' }}>
                                    <CheckCircle size={32} color="#22c55e" style={{ marginBottom: '0.75rem' }} />
                                    <div style={{ fontWeight: 700 }}>No outstanding advances or loans</div>
                                </div>
                            ) : advances.map(adv => {
                                const progress = adv.totalInstallments > 0 ? (adv.paidInstallments / adv.totalInstallments) * 100 : 0;
                                return (
                                    <div key={adv.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.25rem 1.5rem', marginBottom: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '2px' }}>{adv.type} — {adv.reason || 'No reason specified'}</div>
                                                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Installment {adv.paidInstallments + 1} of {adv.totalInstallments} · {Rs(adv.installmentAmt)} / month</div>
                                            </div>
                                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.72rem', fontWeight: 700, background: adv.status === 'Settled' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)', color: adv.status === 'Settled' ? '#22c55e' : '#f59e0b' }}>{adv.status}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '2rem', fontSize: '0.83rem', marginBottom: '0.75rem' }}>
                                            <div><div style={{ color: '#64748b', marginBottom: '2px' }}>Total Amount</div><div style={{ fontWeight: 700 }}>{Rs(adv.totalAmount)}</div></div>
                                            <div><div style={{ color: '#64748b', marginBottom: '2px' }}>Remaining</div><div style={{ fontWeight: 700, color: '#f59e0b' }}>{Rs(adv.remaining)}</div></div>
                                            <div><div style={{ color: '#64748b', marginBottom: '2px' }}>Paid</div><div style={{ fontWeight: 700, color: '#22c55e' }}>{Rs(adv.totalAmount - adv.remaining)}</div></div>
                                        </div>
                                        <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '99px', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #38bdf8, #22c55e)', borderRadius: '99px', transition: 'width 0.5s' }} />
                                        </div>
                                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>{Math.round(progress)}% repaid</div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ── CONTACT HR ───────────────────────────────────── */}
                    {activeTab === 'contact' && (
                        <div>
                            <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.2rem', fontWeight: 800 }}>Contact HR</h2>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                {[
                                    { icon: Mail, label: 'Email', value: 'ops-support@asil.com.pk', href: 'mailto:ops-support@asil.com.pk', color: '#38bdf8' },
                                    { icon: Clock, label: 'Office Hours', value: 'Mon–Fri: 9am – 6pm', color: '#f59e0b' },
                                ].map(c => {
                                    const Icon = c.icon;
                                    return (
                                        <div key={c.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ width: 44, height: 44, background: `${c.color}18`, borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <Icon size={20} color={c.color} />
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '2px' }}>{c.label}</div>
                                                {c.href
                                                    ? <a href={c.href} style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e2e8f0', textDecoration: 'none' }}>{c.value}</a>
                                                    : <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.value}</div>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <h3 style={{ margin: '0 0 1rem', fontWeight: 700, fontSize: '0.95rem' }}>Office Address</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                                {OFFICE_LOCATIONS.map(loc => (
                                    <div key={loc.city} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.25rem 1.5rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                            <MapPin size={16} color="#eab308" />
                                            {loc.maps
                                                ? <a href={loc.maps} target="_blank" rel="noreferrer" style={{ fontWeight: 700, fontSize: '0.95rem', color: '#eab308', textDecoration: 'none' }}>{loc.city}</a>
                                                : <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#eab308' }}>{loc.city}</span>}
                                        </div>
                                        <div style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.45 }}>{loc.address}</div>
                                        {loc.maps && (
                                            <a href={loc.maps} target="_blank" rel="noreferrer"
                                                style={{ display: 'inline-block', marginTop: '10px', fontSize: '0.78rem', fontWeight: 600, color: '#38bdf8', textDecoration: 'none' }}>
                                                Open in Google Maps →
                                            </a>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '1.5rem' }}>
                                <h3 style={{ margin: '0 0 1rem', fontWeight: 700 }}>Quick Requests</h3>
                                {[
                                    { label: 'Salary Certificate', desc: 'Bank salary letter or employment certificate' },
                                    { label: 'EOBI Certificate', desc: 'For personal or property documentation' },
                                    { label: 'NOC / Experience Letter', desc: 'After at least 6 months of service' },
                                    { label: 'Advance Request', desc: 'Submit a new advance or loan request' },
                                ].map(r => (
                                    <div key={r.label} style={{ padding: '0.85rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{r.label}</div>
                                            <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '2px' }}>{r.desc}</div>
                                        </div>
                                        <button onClick={() => { window.location.href = 'mailto:ops-support@asil.com.pk?subject=' + encodeURIComponent(r.label); }}
                                            style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', color: '#38bdf8', padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, flexShrink: 0 }}>
                                            Email Ops →
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT — manages login state
// ═══════════════════════════════════════════════════════════════════════════════
export default function EmployeePortal() {
    const [token, setToken] = useState(() => localStorage.getItem(PORTAL_TOKEN_KEY));
    const [empBasic, setEmpBasic] = useState(() => {
        try { return JSON.parse(localStorage.getItem(PORTAL_EMP_KEY)); } catch { return null; }
    });

    function handleLogin(t, e) { setToken(t); setEmpBasic(e); }
    function handleLogout() {
        localStorage.removeItem(PORTAL_TOKEN_KEY);
        localStorage.removeItem(PORTAL_EMP_KEY);
        setToken(null); setEmpBasic(null);
    }

    if (!token) return <LoginScreen onLogin={handleLogin} />;
    return <PortalDashboard token={token} empBasic={empBasic} onLogout={handleLogout} />;
}
