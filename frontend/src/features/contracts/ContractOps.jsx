import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const ContractOps = () => {
    const [contracts, setContracts] = useState([]);
    const [selectedContract, setSelectedContract] = useState('');
    const [policy, setPolicy] = useState({});
    const [onboarding, setOnboarding] = useState(null);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        api.getContracts().then(setContracts).catch(() => {});
    }, []);

    useEffect(() => {
        if (!selectedContract) return;
        api.getContractPolicy(selectedContract).then(p => setPolicy(p || {})).catch(() => setPolicy({}));
        api.getOnboardingStatus(selectedContract).then(setOnboarding).catch(() => setOnboarding(null));
    }, [selectedContract]);

    const savePolicy = async () => {
        setError('');
        try {
            await api.saveContractPolicy({ ...policy, contract_id: selectedContract });
            setMsg('Policy saved (Trace: P2-OPS-005)');
            setTimeout(() => setMsg(''), 3000);
        } catch (e) {
            setError(e.message);
        }
    };

    const startOnboarding = async () => {
        try {
            const run = await api.startOnboarding({ contractId: selectedContract });
            setOnboarding(run);
            setMsg('Onboarding started (Trace: P2-OPS-006)');
        } catch (e) {
            setError(e.message);
        }
    };

    const completeTask = async (taskId) => {
        try {
            await api.completeOnboardingTask(taskId);
            const status = await api.getOnboardingStatus(selectedContract);
            setOnboarding(status);
        } catch (e) {
            setError(e.message);
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Contract Policies & Onboarding</h1>
                <p className="page-subtitle">Configure contract constraints and onboarding checklists</p>
            </div>

            {msg && <div className="glass-card" style={{ color: 'var(--success)', marginBottom: '1rem' }}>{msg}</div>}
            {error && <div className="glass-card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

            <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Select Contract</label>
                <select value={selectedContract} onChange={e => setSelectedContract(e.target.value)}
                    style={{ width: '100%', maxWidth: 400, background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, color: 'var(--text)' }}>
                    <option value="">— Choose contract —</option>
                    {contracts.map(c => <option key={c.id} value={c.id}>{c.contract_name || c.id}</option>)}
                </select>
            </div>

            {selectedContract && (
                <>
                    <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                        <h3 style={{ marginBottom: '1rem' }}>Contract Policy</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                            <label>OT Allowed<input type="checkbox" checked={policy.ot_allowed !== false} onChange={e => setPolicy(p => ({ ...p, ot_allowed: e.target.checked }))} /></label>
                            <label>OT Monthly Cap (hrs)<input type="number" value={policy.ot_monthly_cap_hours || ''} onChange={e => setPolicy(p => ({ ...p, ot_monthly_cap_hours: e.target.value }))}
                                style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} /></label>
                            <label>Medical Annual Cap (PKR)<input type="number" value={policy.medical_annual_cap || ''} onChange={e => setPolicy(p => ({ ...p, medical_annual_cap: e.target.value }))}
                                style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} /></label>
                            <label>Credit Days<input type="number" value={policy.credit_days || 30} onChange={e => setPolicy(p => ({ ...p, credit_days: e.target.value }))}
                                style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} /></label>
                            <label>Service Charge %<input type="number" step="0.01" value={policy.service_charge_pct ?? 0.18} onChange={e => setPolicy(p => ({ ...p, service_charge_pct: e.target.value }))}
                                style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} /></label>
                            <label>PO Required<input type="checkbox" checked={!!policy.po_required} onChange={e => setPolicy(p => ({ ...p, po_required: e.target.checked }))} /></label>
                        </div>
                        <button onClick={savePolicy} className="btn-primary" style={{ marginTop: '1rem' }}>Save Policy</button>
                    </div>

                    <div className="glass-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3>Onboarding Checklist</h3>
                            <button onClick={startOnboarding} className="btn-secondary">Start / Reset Onboarding</button>
                        </div>
                        {(onboarding?.tasks || []).length === 0 ? (
                            <p style={{ color: 'var(--text-muted)' }}>No onboarding run yet. Click Start to generate checklist tasks.</p>
                        ) : (
                            <table className="data-table">
                                <thead><tr><th>Task</th><th>Owner</th><th>Blocking</th><th>Status</th><th></th></tr></thead>
                                <tbody>
                                    {onboarding.tasks.map(t => (
                                        <tr key={t.id}>
                                            <td>{t.task_label}</td>
                                            <td>{t.default_owner_role || t.owner_role}</td>
                                            <td>{t.blocking ? 'Yes' : 'No'}</td>
                                            <td>{t.completed_at ? '✓ Done' : 'Pending'}</td>
                                            <td>{!t.completed_at && <button onClick={() => completeTask(t.id)} className="btn-secondary" style={{ fontSize: '0.8rem' }}>Complete</button>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default ContractOps;
