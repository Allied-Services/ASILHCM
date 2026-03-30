import React, { useState, useEffect } from 'react';
import { Shield, UserCheck, Clock, RefreshCcw, AlertTriangle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';

const ROLE_LABELS = {
    superadmin:            { label: 'Super Admin',            color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    operations:            { label: 'Operations',             color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
    procurement_proposer:  { label: 'Procurement Proposer',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
    procurement_approver:  { label: 'Procurement Approver',  color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
    finance_proposer:      { label: 'Finance Proposer',      color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    finance_approver:      { label: 'Finance Approver',      color: '#14b8a6', bg: 'rgba(20,184,166,0.12)' },
    pending:               { label: 'Pending',                color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
};

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, { label }]) => ({ value, label }));

function RoleBadge({ role }) {
    const { label, color, bg } = ROLE_LABELS[role] || ROLE_LABELS.pending;
    return (
        <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700, color, background: bg }}>
            {label}
        </span>
    );
}

export default function UserManagement() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(null);
    const [toast, setToast] = useState('');
    const [error, setError] = useState('');

    const token = localStorage.getItem('asil_hcm_token');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const [addEmail, setAddEmail] = useState('');
    const [addRole, setAddRole] = useState('pending');
    const [addLoading, setAddLoading] = useState(false);

    const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

    const load = () => {
        setLoading(true);
        fetch(`${API}/api/users`, { headers })
            .then(r => r.json())
            .then(d => { setUsers(d.users || []); setError(''); })
            .catch(() => setError('Failed to load users'))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    const addUser = async () => {
        if (!addEmail.trim()) return;
        setAddLoading(true);
        try {
            const r = await fetch(`${API}/api/users`, {
                method: 'POST', headers, body: JSON.stringify({ email: addEmail.trim().toLowerCase(), role: addRole }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Failed');
            setUsers(prev => [...prev.filter(u => u.email !== d.user.email), d.user]);
            setAddEmail('');
            setAddRole('pending');
            showToast(`✅ ${d.user.email} added as ${ROLE_LABELS[addRole]?.label}`);
        } catch (e) { showToast(`❌ ${e.message}`); }
        setAddLoading(false);
    };

    const changeRole = async (userId, newRole, userName) => {
        setSaving(userId);
        try {
            const r = await fetch(`${API}/api/users/${userId}/role`, {
                method: 'PATCH', headers, body: JSON.stringify({ role: newRole }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || 'Failed');
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
            showToast(`✅ ${userName}'s role updated to ${ROLE_LABELS[newRole]?.label}`);
        } catch (e) {
            showToast(`❌ ${e.message}`);
        }
        setSaving(null);
    };

    const pendingCount = users.filter(u => u.role === 'pending').length;

    return (
        <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
            {/* Toast */}
            {toast && (
                <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
                    background: toast.startsWith('✅') ? '#22c55e' : '#ef4444',
                    color: 'white', padding: '12px 20px', borderRadius: '10px',
                    fontWeight: 700, fontSize: '0.88rem', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                    {toast}
                </div>
            )}

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '44px', height: '44px', background: 'rgba(99,102,241,0.15)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Shield size={22} color="#6366f1" />
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>User Management</h1>
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>Assign roles to @asil.com.pk Google accounts</p>
                    </div>
                </div>
                <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <RefreshCcw size={14} /> Refresh
                </button>
            </div>

            {/* Pending alert */}
            {pendingCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '1.5rem' }}>
                    <AlertTriangle size={18} color="#f59e0b" />
                    <span style={{ color: '#f59e0b', fontWeight: 600, fontSize: '0.88rem' }}>
                        {pendingCount} user{pendingCount > 1 ? 's' : ''} waiting for role assignment
                    </span>
                </div>
            )}

            {/* Add User form */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.85rem' }}>Add / Pre-Register User</div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 2, minWidth: '220px' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Email (@asil.com.pk)</label>
                        <input
                            type="email"
                            value={addEmail}
                            onChange={e => setAddEmail(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addUser()}
                            placeholder="name@asil.com.pk"
                            style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none' }}
                        />
                    </div>
                    <div style={{ flex: 1, minWidth: '180px' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Assign Role</label>
                        <select value={addRole} onChange={e => setAddRole(e.target.value)}
                            style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 12px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none' }}>
                            {ROLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                    </div>
                    <button onClick={addUser} disabled={!addEmail.trim() || addLoading}
                        style={{ padding: '8px 20px', borderRadius: '8px', background: addEmail.trim() ? '#6366f1' : '#334155', border: 'none', color: 'white', fontWeight: 700, cursor: addEmail.trim() ? 'pointer' : 'not-allowed', fontSize: '0.88rem', whiteSpace: 'nowrap' }}>
                        {addLoading ? 'Adding…' : '+ Add User'}
                    </button>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    User will get this role immediately when they log in with their Google account. Only @asil.com.pk addresses are accepted.
                </p>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Loading users…</div>
            ) : error ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#ef4444' }}>{error}</div>
            ) : (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '14px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['User', 'Email', 'Current Role', 'Last Login', 'Assign Role'].map(h => (
                                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u, i) => (
                                <tr key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--border)' : 'none', background: u.role === 'pending' ? 'rgba(245,158,11,0.04)' : 'transparent' }}>
                                    <td style={{ padding: '12px 16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            {u.avatar
                                                ? <img src={u.avatar} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
                                                : <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#4f46e5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.75rem', fontWeight: 700 }}>{u.name?.[0]?.toUpperCase()}</div>
                                            }
                                            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{u.name}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px 16px', fontSize: '0.83rem', color: 'var(--text-muted)' }}>{u.email}</td>
                                    <td style={{ padding: '12px 16px' }}><RoleBadge role={u.role} /></td>
                                    <td style={{ padding: '12px 16px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        {u.last_login ? new Date(u.last_login).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <select
                                            value={u.role}
                                            disabled={saving === u.id}
                                            onChange={e => changeRole(u.id, e.target.value, u.name)}
                                            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 10px', borderRadius: '8px', fontSize: '0.83rem', cursor: 'pointer', opacity: saving === u.id ? 0.6 : 1 }}>
                                            {ROLE_OPTIONS.map(opt => (
                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                        </select>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Role reference */}
            <div style={{ marginTop: '1.75rem' }}>
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.75rem' }}>ROLE REFERENCE</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    {ROLE_OPTIONS.filter(r => r.value !== 'pending').map(r => {
                        const { color, bg } = ROLE_LABELS[r.value];
                        const descriptions = {
                            superadmin: 'Full access + delete permissions',
                            operations: 'Employee master data management',
                            procurement_proposer: 'Create bills, quotes, vendors',
                            procurement_approver: 'Approve bills and quotes',
                            finance_proposer: 'Run payroll, create invoices',
                            finance_approver: 'Approve payroll and invoices',
                        };
                        return (
                            <div key={r.value} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 14px' }}>
                                <div style={{ fontWeight: 700, fontSize: '0.83rem', color, marginBottom: '4px' }}>{r.label}</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{descriptions[r.value]}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
