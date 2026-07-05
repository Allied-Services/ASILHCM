import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const STAGES = ['cold', 'contacted', 'proposal', 'negotiation', 'won', 'lost'];

const BizDevPipeline = () => {
    const [tab, setTab] = useState('leads');
    const [leads, setLeads] = useState([]);
    const [renewals, setRenewals] = useState([]);
    const [contracts, setContracts] = useState([]);
    const [form, setForm] = useState({ company: '', contact_name: '', email: '', est_headcount: '', industry: '' });
    const [error, setError] = useState('');

    const load = () => {
        api.getBdLeads().then(r => setLeads(Array.isArray(r) ? r : [])).catch(() => {});
        api.getBdRenewals().then(r => setRenewals(Array.isArray(r) ? r : [])).catch(() => {});
        api.getContracts().then(setContracts).catch(() => {});
    };

    useEffect(load, []);

    const addLead = async (e) => {
        e.preventDefault();
        try {
            await api.createBdLead(form);
            setForm({ company: '', contact_name: '', email: '', est_headcount: '', industry: '' });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const moveStage = async (leadId, stage) => {
        let contractId = null;
        if (stage === 'won') {
            contractId = window.prompt('Enter contract ID for won lead (required for auto-onboarding):');
            if (!contractId) return;
        }
        try {
            await api.updateBdLeadStage(leadId, stage, contractId);
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">BD Pipeline</h1>
                <p className="page-subtitle">Leads, renewals, and contract onboarding triggers (Trace: P2-BD-001)</p>
            </div>

            {error && <div className="glass-card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {['leads', 'renewals'].map(t => (
                    <button key={t} onClick={() => setTab(t)}
                        style={{ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                            background: tab === t ? 'var(--primary)' : 'var(--bg-dark)', color: tab === t ? '#fff' : 'var(--text-muted)' }}>
                        {t === 'leads' ? 'Leads' : 'Renewals'}
                    </button>
                ))}
            </div>

            {tab === 'leads' && (
                <>
                    <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                        <h3 style={{ marginBottom: '1rem' }}>Add Lead</h3>
                        <form onSubmit={addLead} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
                            <input placeholder="Company *" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} required
                                style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                            <input placeholder="Contact" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                                style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                            <input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                            <input placeholder="Est. Headcount" type="number" value={form.est_headcount} onChange={e => setForm(f => ({ ...f, est_headcount: e.target.value }))}
                                style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                            <button type="submit" className="btn-primary">Add Lead</button>
                        </form>
                    </div>
                    <div className="glass-card">
                        <table className="data-table">
                            <thead><tr><th>Company</th><th>Contact</th><th>Headcount</th><th>Stage</th><th>Actions</th></tr></thead>
                            <tbody>
                                {leads.map(l => (
                                    <tr key={l.id}>
                                        <td>{l.company}</td>
                                        <td>{l.contact_name || l.email}</td>
                                        <td>{l.est_headcount || '—'}</td>
                                        <td>{l.stage}</td>
                                        <td>
                                            <select defaultValue={l.stage} onChange={e => moveStage(l.id, e.target.value)}
                                                style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 4, color: 'var(--text)', fontSize: '0.8rem' }}>
                                                {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {tab === 'renewals' && (
                <div className="glass-card">
                    <table className="data-table">
                        <thead><tr><th>Client</th><th>Contract</th><th>Renewal Date</th><th>Status</th></tr></thead>
                        <tbody>
                            {renewals.length === 0 ? (
                                <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No renewals tracked yet</td></tr>
                            ) : renewals.map(r => (
                                <tr key={r.id}>
                                    <td>{r.client_name}</td>
                                    <td>{r.contract_name}</td>
                                    <td>{r.renewal_date}</td>
                                    <td>{r.status || 'upcoming'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default BizDevPipeline;
