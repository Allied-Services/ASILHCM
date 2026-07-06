import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const BUDGET_CATEGORIES = ['supplies', 'maintenance', 'utilities', 'travel', 'other'];

const ContractOps = () => {
    const [contracts, setContracts] = useState([]);
    const [selectedContract, setSelectedContract] = useState('');
    const [policy, setPolicy] = useState({});
    const [onboarding, setOnboarding] = useState(null);
    const [budgetLines, setBudgetLines] = useState([]);
    const [rateCards, setRateCards] = useState([]);
    const [budgetForm, setBudgetForm] = useState({ category: 'supplies', name: '', monthlyCap: '' });
    const [rateCardForm, setRateCardForm] = useState({ roleTitle: '', billRate: '', costRate: '' });
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const loadBudgetLines = () => {
        if (!selectedContract) return;
        api.getBudgetLines(selectedContract).then(setBudgetLines).catch(() => setBudgetLines([]));
    };

    const loadRateCards = () => {
        if (!selectedContract) return;
        api.getRateCards(selectedContract).then(setRateCards).catch(() => setRateCards([]));
    };

    useEffect(() => {
        api.getContracts().then(d => setContracts(d.contracts || d || [])).catch(() => {});
    }, []);

    useEffect(() => {
        if (!selectedContract) return;
        api.getContractPolicy(selectedContract).then(p => setPolicy(p || {})).catch(() => setPolicy({}));
        api.getOnboardingStatus(selectedContract).then(setOnboarding).catch(() => setOnboarding(null));
        loadBudgetLines();
        loadRateCards();
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

    const applyWafiDefaults = () => {
        setPolicy(p => ({
            ...p,
            medical_annual_cap: 20000,
            ot_allowed: true,
            ot_divisor_days: 26,
            ot_divisor_hours: 8,
            standard_month_days: 30,
            service_charge_pct: 0.18,
            credit_days: 30,
        }));
        setMsg('Wafi defaults applied — click Save Policy to persist');
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

    const addBudgetLine = async () => {
        setError('');
        if (!budgetForm.name.trim()) {
            setError('Budget line name is required');
            return;
        }
        try {
            await api.createBudgetLine({
                contractId: selectedContract,
                category: budgetForm.category,
                name: budgetForm.name.trim(),
                monthlyCap: budgetForm.monthlyCap || null,
            });
            setBudgetForm({ category: 'supplies', name: '', monthlyCap: '' });
            loadBudgetLines();
            setMsg('Budget line added (Trace: P4-PROC-001)');
            setTimeout(() => setMsg(''), 3000);
        } catch (e) {
            setError(e.message);
        }
    };

    const removeBudgetLine = async (id) => {
        if (!window.confirm('Remove this budget line?')) return;
        try {
            await api.deleteBudgetLine(id);
            loadBudgetLines();
        } catch (e) {
            setError(e.message);
        }
    };

    const addRateCard = async () => {
        setError('');
        if (!rateCardForm.roleTitle.trim() || !rateCardForm.billRate) {
            setError('Designation and bill rate are required');
            return;
        }
        try {
            await api.saveRateCard({
                contractId: selectedContract,
                roleTitle: rateCardForm.roleTitle.trim(),
                billRate: Number(rateCardForm.billRate),
                costRate: rateCardForm.costRate ? Number(rateCardForm.costRate) : null,
            });
            setRateCardForm({ roleTitle: '', billRate: '', costRate: '' });
            loadRateCards();
            setMsg('Rate card added');
            setTimeout(() => setMsg(''), 3000);
        } catch (e) {
            setError(e.message);
        }
    };

    const removeRateCard = async (id) => {
        if (!window.confirm('Remove this rate card?')) return;
        try {
            await api.deleteRateCard(id);
            loadRateCards();
        } catch (e) {
            setError(e.message);
        }
    };

    const inputStyle = { width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' };

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
                    {contracts.map(c => <option key={c.id} value={c.id}>{c.contractName || c.contract_name || c.id}</option>)}
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
                        <button onClick={savePolicy} className="btn-primary" style={{ marginTop: '1rem', marginRight: '0.5rem' }}>Save Policy</button>
                        <button type="button" onClick={applyWafiDefaults} className="btn-secondary" style={{ marginTop: '1rem' }}>Apply Wafi defaults</button>
                    </div>

                    <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                        <h3 style={{ marginBottom: '1rem' }}>Billing Rate Cards</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                            Per-designation bill rates used by Payroll Run when employee designation matches.
                        </p>
                        {rateCards.length > 0 ? (
                            <table className="data-table" style={{ marginBottom: '1rem' }}>
                                <thead>
                                    <tr><th>Designation</th><th>Monthly Bill Rate</th><th>Cost Rate</th><th>Effective From</th><th></th></tr>
                                </thead>
                                <tbody>
                                    {rateCards.map(rc => (
                                        <tr key={rc.id}>
                                            <td>{rc.role_title}</td>
                                            <td>{Number(rc.bill_rate || 0).toLocaleString()}</td>
                                            <td>{rc.cost_rate != null ? Number(rc.cost_rate).toLocaleString() : '—'}</td>
                                            <td>{rc.effective_from?.slice?.(0, 10) || rc.effective_from}</td>
                                            <td><button type="button" onClick={() => removeRateCard(rc.id)} className="btn-secondary" style={{ fontSize: '0.8rem' }}>Remove</button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>No rate cards — payroll uses cost-plus billing.</p>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                            <input placeholder="Designation (matches employee)" value={rateCardForm.roleTitle} onChange={e => setRateCardForm(f => ({ ...f, roleTitle: e.target.value }))} style={inputStyle} />
                            <input type="number" placeholder="Monthly bill rate" value={rateCardForm.billRate} onChange={e => setRateCardForm(f => ({ ...f, billRate: e.target.value }))} style={inputStyle} />
                            <input type="number" placeholder="Cost rate (optional)" value={rateCardForm.costRate} onChange={e => setRateCardForm(f => ({ ...f, costRate: e.target.value }))} style={inputStyle} />
                            <button type="button" onClick={addRateCard} className="btn-primary">Add rate card</button>
                        </div>
                    </div>

                    <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                        <h3 style={{ marginBottom: '1rem' }}>Procurement Budget Lines</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                            Katcha bills are matched to these lines during Bill Verification. Set monthly caps per category.
                        </p>
                        {budgetLines.length > 0 ? (
                            <table className="data-table" style={{ marginBottom: '1rem' }}>
                                <thead>
                                    <tr><th>Category</th><th>Name</th><th>Monthly Cap (PKR)</th><th>Used</th><th>Remaining</th><th></th></tr>
                                </thead>
                                <tbody>
                                    {budgetLines.map(bl => (
                                        <tr key={bl.id}>
                                            <td>{bl.category}</td>
                                            <td>{bl.name}</td>
                                            <td>{bl.monthly_cap != null ? Number(bl.monthly_cap).toLocaleString() : '—'}</td>
                                            <td>{Number(bl.used_amount || 0).toLocaleString()}</td>
                                            <td>{bl.remaining != null ? Number(bl.remaining).toLocaleString() : '—'}</td>
                                            <td>
                                                <button type="button" onClick={() => removeBudgetLine(bl.id)} className="btn-secondary" style={{ fontSize: '0.8rem' }}>Remove</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>No budget lines yet for this contract.</p>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                            <label>
                                Category
                                <select value={budgetForm.category} onChange={e => setBudgetForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                                    {BUDGET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </label>
                            <label>
                                Line name
                                <input value={budgetForm.name} onChange={e => setBudgetForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Office supplies" style={inputStyle} />
                            </label>
                            <label>
                                Monthly cap (PKR)
                                <input type="number" value={budgetForm.monthlyCap} onChange={e => setBudgetForm(f => ({ ...f, monthlyCap: e.target.value }))} placeholder="Optional" style={inputStyle} />
                            </label>
                            <button type="button" onClick={addBudgetLine} className="btn-primary">Add budget line</button>
                        </div>
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
