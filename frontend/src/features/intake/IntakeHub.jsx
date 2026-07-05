import React, { useEffect, useState } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';
import { api } from '../../api';

const STATUS_COLORS = {
    new: '#38bdf8',
    processing: '#f59e0b',
    processed: '#22c55e',
    failed: '#ef4444',
};

const IntakeHub = () => {
    const [messages, setMessages] = useState([]);
    const [statusFilter, setStatusFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [polling, setPolling] = useState(false);
    const [error, setError] = useState('');

    const load = () => {
        setLoading(true);
        api.getIntakeMessages(statusFilter || undefined)
            .then(rows => setMessages(Array.isArray(rows) ? rows : []))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(load, [statusFilter]);

    const pollNow = async () => {
        setPolling(true);
        try {
            await api.triggerIntakePoll();
            load();
        } catch (e) {
            setError(e.message);
        } finally {
            setPolling(false);
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 className="page-title">Intake Hub</h1>
                    <p className="page-subtitle">Unified email intake — attendance, claims, procurement, client alerts (Trace: P2-OPS-001)</p>
                </div>
                <button onClick={pollNow} disabled={polling} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={16} className={polling ? 'spin' : ''} /> Poll Now
                </button>
            </div>

            {error && <div className="glass-card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

            <div className="glass-card" style={{ marginBottom: '1rem' }}>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text)' }}>
                    <option value="">All statuses</option>
                    <option value="new">New</option>
                    <option value="processing">Processing</option>
                    <option value="processed">Processed</option>
                    <option value="failed">Failed</option>
                </select>
            </div>

            <div className="glass-card">
                {loading ? <p className="text-muted">Loading…</p> : messages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                        <Inbox size={32} style={{ opacity: 0.3, margin: '0 auto 1rem' }} />
                        No intake messages yet. Configure INTAKE_EMAIL_* env vars on Render to enable IMAP polling.
                    </div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Received</th>
                                <th>From</th>
                                <th>Subject</th>
                                <th>Classification</th>
                                <th>Status</th>
                                <th>Ref</th>
                            </tr>
                        </thead>
                        <tbody>
                            {messages.map(m => (
                                <tr key={m.id}>
                                    <td>{m.received_at ? new Date(m.received_at).toLocaleString() : '—'}</td>
                                    <td>{m.from_address}</td>
                                    <td>{m.subject}</td>
                                    <td><span style={{ color: '#a78bfa' }}>{m.classification || 'unknown'}</span></td>
                                    <td><span style={{ color: STATUS_COLORS[m.status] || '#94a3b8' }}>{m.status}</span></td>
                                    <td>{m.ack_reference || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default IntakeHub;
