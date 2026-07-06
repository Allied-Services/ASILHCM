import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const ClaimsQueue = () => {
    const [claims, setClaims] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [utilization, setUtilization] = useState({});
    const [form, setForm] = useState({ employeeId: '', claimType: 'overtime', contractId: '', focalEmail: '', ot2: 0, ot3: 0, amount: 0 });

    const load = () => {
        setLoading(true);
        api.getEmployeeClaims()
            .then(async rows => {
                const list = Array.isArray(rows) ? rows : [];
                setClaims(list);
                const utilMap = {};
                for (const c of list.filter(x => x.claim_type === 'medical' && x.employee_id)) {
                    try {
                        utilMap[c.id] = await api.getMedicalUtilization(c.employee_id, c.contract_id);
                    } catch { /* ignore */ }
                }
                setUtilization(utilMap);
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    const assignEmployee = async (claimId) => {
        const employeeId = window.prompt('Enter employee ID to assign:');
        if (!employeeId) return;
        try {
            await api.assignClaim(claimId, employeeId);
            load();
        } catch (e) {
            setError(e.message);
        }
    };

    const submitClaim = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const items = form.claimType === 'overtime'
                ? [{ ot2: Number(form.ot2), ot3: Number(form.ot3) }]
                : [{ amount: Number(form.amount) }];
            await api.createClaim({
                employeeId: form.employeeId,
                claimType: form.claimType,
                contractId: form.contractId,
                focalEmail: form.focalEmail,
                items,
            });
            setForm(f => ({ ...f, employeeId: '', ot2: 0, ot3: 0, amount: 0 }));
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Claims Queue</h1>
                <p className="page-subtitle">Employee OT, expense & medical claims with focal verification (Trace: P2-OPS-003)</p>
            </div>

            {error && <div className="glass-card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

            <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>New Claim</h3>
                <form onSubmit={submitClaim} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                    <input placeholder="Employee ID" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} required
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                    <input placeholder="Contract ID" value={form.contractId} onChange={e => setForm(f => ({ ...f, contractId: e.target.value }))}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                    <input placeholder="Client Focal Email" value={form.focalEmail} onChange={e => setForm(f => ({ ...f, focalEmail: e.target.value }))}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                    <select value={form.claimType} onChange={e => setForm(f => ({ ...f, claimType: e.target.value }))}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }}>
                        <option value="overtime">Overtime</option>
                        <option value="medical">Medical</option>
                        <option value="expense">Expense</option>
                    </select>
                    {form.claimType === 'overtime' ? (
                        <>
                            <input type="number" placeholder="OT 2x hours" value={form.ot2} onChange={e => setForm(f => ({ ...f, ot2: e.target.value }))}
                                style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                            <input type="number" placeholder="OT 3x hours" value={form.ot3} onChange={e => setForm(f => ({ ...f, ot3: e.target.value }))}
                                style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                        </>
                    ) : (
                        <input type="number" placeholder="Amount PKR" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                    )}
                    <button type="submit" className="btn-primary">Submit Claim</button>
                </form>
            </div>

            <div className="glass-card">
                {loading ? <p className="text-muted">Loading…</p> : (
                    <table className="data-table">
                        <thead>
                            <tr><th>ID</th><th>Employee</th><th>Type</th><th>Status</th><th>Medical cap</th><th>Focal</th><th>Created</th><th></th></tr>
                        </thead>
                        <tbody>
                            {claims.map(c => (
                                <tr key={c.id}>
                                    <td>{c.id}</td>
                                    <td>{c.employee_name || c.employee_id || <em>Unassigned</em>}</td>
                                    <td>{c.claim_type}</td>
                                    <td>{c.status}</td>
                                    <td>
                                        {c.claim_type === 'medical' && utilization[c.id]
                                            ? `Used ${Number(utilization[c.id].used_amount || 0).toLocaleString()} of ${Number(utilization[c.id].cap_amount || 0).toLocaleString()}`
                                            : '—'}
                                    </td>
                                    <td>{c.focal_email || '—'}</td>
                                    <td>{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                                    <td>
                                        {!c.employee_id && (
                                            <button type="button" className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => assignEmployee(c.id)}>Assign employee</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default ClaimsQueue;
