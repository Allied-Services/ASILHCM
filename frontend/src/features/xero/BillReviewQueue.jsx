import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { api } from '../../api';

const TRACKING_OPTIONS = ['BPO', 'FM', 'Wafi Procurement', 'Wafi Imprest'];

export default function BillReviewQueue() {
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');
    const [editing, setEditing] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const d = await api.getXeroReviewQueue();
            setBills(d.bills || []);
        } catch (e) {
            setError(e.message);
        }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const sync = async () => {
        setSyncing(true);
        setError('');
        try {
            const r = await api.syncXeroBills();
            setMsg(`Synced: ${r.imported || 0} imported, ${r.review || 0} need review`);
            load();
        } catch (e) {
            setError(e.message);
        }
        setSyncing(false);
    };

    const resolve = async (billId, payload) => {
        try {
            await api.resolveXeroBillReview(billId, payload);
            setMsg(payload.exclude ? 'Bill excluded from future syncs' : 'Bill classified');
            load();
        } catch (e) {
            setError(e.message);
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                    <h3 style={{ margin: 0, color: '#f0f4f8' }}>Xero Bill Import</h3>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.83rem' }}>
                        Sync ACCPAY bills from Xero. Unmatched bills appear here for finance review.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={load} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.83rem' }}>
                        <RefreshCw size={14} /> Refresh
                    </button>
                    <button onClick={sync} disabled={syncing} style={{ background: '#00B5C8', border: 'none', color: 'white', padding: '7px 16px', borderRadius: '8px', cursor: syncing ? 'wait' : 'pointer', fontWeight: 700, fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <RefreshCw size={14} /> {syncing ? 'Syncing…' : 'Sync from Xero'}
                    </button>
                </div>
            </div>

            {msg && (
                <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '10px', padding: '0.85rem 1.25rem', marginBottom: '1rem', color: '#22c55e', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CheckCircle size={16} /> {msg}
                </div>
            )}
            {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '0.85rem 1.25rem', marginBottom: '1rem', color: '#f87171', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>Loading review queue…</div>
            ) : !bills.length ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                    <CheckCircle size={40} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                    <div>No bills need review</div>
                </div>
            ) : (
                <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ background: 'var(--bg-dark)' }}>
                            <tr>{['Vendor', 'Amount', 'Tracking', 'Site', 'Category', 'Actions'].map(h => (
                                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>
                            ))}</tr>
                        </thead>
                        <tbody>
                            {bills.map((b, i) => {
                                const ed = editing[b.id] || { category: b.tracking_category || 'FM', site: b.site || '', client: b.client || 'Wafi Energy' };
                                return (
                                    <tr key={b.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{b.vendor}</td>
                                        <td style={{ padding: '10px 12px', color: '#22c55e', fontWeight: 700 }}>{Number(b.total || 0).toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', color: '#94a3b8' }}>{b.tracking_category || '—'}</td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <input value={ed.site} onChange={e => setEditing(p => ({ ...p, [b.id]: { ...ed, site: e.target.value } }))}
                                                style={{ background: '#1a2535', border: '1px solid rgba(255,255,255,0.1)', color: '#f0f4f8', padding: '4px 8px', borderRadius: '6px', width: '120px' }} />
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <select value={ed.category} onChange={e => setEditing(p => ({ ...p, [b.id]: { ...ed, category: e.target.value } }))}
                                                style={{ background: '#1a2535', border: '1px solid rgba(255,255,255,0.1)', color: '#f0f4f8', padding: '4px 8px', borderRadius: '6px' }}>
                                                {TRACKING_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                            </select>
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button onClick={() => resolve(b.id, { category: ed.category, site: ed.site, client: ed.client, bill_type: ed.category })}
                                                    style={{ background: '#22c55e', border: 'none', color: 'white', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>
                                                    Accept
                                                </button>
                                                <button onClick={() => resolve(b.id, { exclude: true })}
                                                    style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem' }}>
                                                    <XCircle size={12} style={{ verticalAlign: 'middle' }} /> Not ours
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
