import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const ACTION_COLOR = (action) => {
    if (/delete|purge|reset/i.test(action)) return 'var(--danger)';
    if (/approve|confirm|lock/i.test(action)) return 'var(--success, #22c55e)';
    if (/unlock|reject/i.test(action)) return 'var(--warning, #f59e0b)';
    return 'var(--text)';
};

const AuditLogViewer = () => {
    const [logs, setLogs] = useState([]);
    const [actionFilter, setActionFilter] = useState('');
    const [emailFilter, setEmailFilter] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const load = () => {
        setLoading(true);
        setError('');
        api.getAuditLog({ action: actionFilter, user_email: emailFilter, limit: 200 })
            .then(d => setLogs(d.logs || []))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Audit Log</h1>
                <p className="page-subtitle">Record of destructive and status-changing actions across the system (superadmin only)</p>
            </div>

            {error && <div className="glass-card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

            <div className="glass-card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input placeholder="Filter by action type (e.g. employee_delete)" value={actionFilter}
                    onChange={e => setActionFilter(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && load()}
                    style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)', minWidth: 260 }} />
                <input placeholder="Filter by user email" value={emailFilter}
                    onChange={e => setEmailFilter(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && load()}
                    style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)', minWidth: 220 }} />
                <button onClick={load} className="btn-primary">Apply Filters</button>
                <button onClick={() => { setActionFilter(''); setEmailFilter(''); }} className="btn-secondary">Clear</button>
            </div>

            <div className="glass-card">
                <h3 style={{ marginBottom: '1rem' }}>Recent Actions {logs.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.85rem' }}>({logs.length} shown, most recent first)</span>}</h3>
                {loading ? <p className="text-muted">Loading…</p> : logs.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>No audit log entries match these filters.</p>
                ) : (
                    <table className="data-table">
                        <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity Type</th><th>Entity ID</th></tr></thead>
                        <tbody>
                            {logs.map((r, i) => (
                                <tr key={r.id ?? i}>
                                    <td style={{ whiteSpace: 'nowrap' }}>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                                    <td>{r.user_email || '—'}</td>
                                    <td style={{ color: ACTION_COLOR(r.action_type || ''), fontWeight: 600 }}>{r.action_type}</td>
                                    <td>{r.entity_type}</td>
                                    <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{r.entity_id}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default AuditLogViewer;
