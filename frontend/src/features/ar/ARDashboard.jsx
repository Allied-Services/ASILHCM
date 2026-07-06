import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const ARDashboard = () => {
    const [schedules, setSchedules] = useState([]);
    const [dunningLog, setDunningLog] = useState([]);
    const [poId, setPoId] = useState('');
    const [poBalance, setPoBalance] = useState(null);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const load = () => {
        api.getInvoiceSchedules().then(setSchedules).catch(() => setSchedules([]));
        api.getDunningLog().then(setDunningLog).catch(() => setDunningLog([]));
    };

    useEffect(load, []);

    const checkPo = async () => {
        if (!poId) return;
        try {
            setPoBalance(await api.getPOBalance(poId));
        } catch (e) {
            setError(e.message);
        }
    };

    const runDunning = async () => {
        try {
            const result = await api.runDunning();
            setMsg(`Dunning run: ${result.remindersSent || 0} reminder(s) sent`);
            load();
        } catch (e) {
            setError(e.message);
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">AR & Collections</h1>
                <p className="page-subtitle">PO balances, invoice schedules, and dunning log</p>
            </div>

            {msg && <div className="glass-card" style={{ color: 'var(--success)', marginBottom: '1rem' }}>{msg}</div>}
            {error && <div className="glass-card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

            <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>PO Balance Check</h3>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input placeholder="PO ID" value={poId} onChange={e => setPoId(e.target.value)}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} />
                    <button type="button" className="btn-secondary" onClick={checkPo}>Check balance</button>
                </div>
                {poBalance && (
                    <p style={{ marginTop: '1rem' }}>PO value: {Number(poBalance.poValue || 0).toLocaleString()} · Utilized: {Number(poBalance.utilized || 0).toLocaleString()} · Balance: {Number(poBalance.balance || 0).toLocaleString()}</p>
                )}
            </div>

            <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0 }}>Dunning Log</h3>
                    <button type="button" className="btn-primary" onClick={runDunning}>Run Dunning Now</button>
                </div>
                <table className="data-table">
                    <thead><tr><th>Invoice</th><th>Client</th><th>Stage</th><th>Recipient</th><th>Sent</th></tr></thead>
                    <tbody>
                        {dunningLog.length === 0 ? <tr><td colSpan={5} style={{ color: 'var(--text-muted)' }}>No dunning emails logged yet</td></tr> : dunningLog.map(d => (
                            <tr key={d.id}>
                                <td>{d.invoice_number || d.invoice_id}</td>
                                <td>{d.client}</td>
                                <td>{d.stage}</td>
                                <td>{d.recipient}</td>
                                <td>{d.sent_at ? new Date(d.sent_at).toLocaleString() : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="glass-card">
                <h3 style={{ marginBottom: '1rem' }}>Invoice Schedules</h3>
                <table className="data-table">
                    <thead><tr><th>Contract</th><th>Period</th><th>Status</th></tr></thead>
                    <tbody>
                        {schedules.length === 0 ? (
                            <tr><td colSpan={3} style={{ color: 'var(--text-muted)' }}>No schedules yet. Schedules generate nightly from contract policies with monthly invoicing.</td></tr>
                        ) : schedules.map(s => (
                            <tr key={s.id}>
                                <td>{s.contract_name}</td>
                                <td>{s.period_month}/{s.period_year}</td>
                                <td style={{ color: s.status === 'overdue_to_generate' ? 'var(--danger)' : undefined }}>{s.status || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ARDashboard;
