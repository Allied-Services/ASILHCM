import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const now = new Date();

const ComplianceLedger = () => {
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [ledger, setLedger] = useState([]);
    const [computed, setComputed] = useState(null);
    const [filing, setFiling] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const loadLedger = () => {
        setLoading(true);
        api.getComplianceLedger(month, year)
            .then(setLedger)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(loadLedger, [month, year]);

    const compute = async () => {
        try {
            const result = await api.computeCompliance(month, year);
            setComputed(result);
            loadLedger();
        } catch (e) {
            setError(e.message);
        }
    };

    const generateFiling = async () => {
        try {
            const result = await api.generateFilingPreview(month, year);
            setFiling(result.filing);
        } catch (e) {
            setError(e.message);
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Compliance & Tax Ledger</h1>
                <p className="page-subtitle">EOBI, SESSI, income tax — ready-to-file returns (Trace: P5-FIN-001)</p>
            </div>

            {error && <div className="glass-card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

            <div className="glass-card" style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={month} onChange={e => setMonth(Number(e.target.value))}
                    style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }}>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{new Date(2000, m-1).toLocaleString('en', { month: 'long' })}</option>)}
                </select>
                <input type="number" value={year} onChange={e => setYear(Number(e.target.value))}
                    style={{ width: 100, background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: 'var(--text)' }} />
                <button onClick={compute} className="btn-primary">Compute from Locked Payroll</button>
                <button onClick={generateFiling} className="btn-secondary">Generate Filing Preview</button>
            </div>

            {computed && (
                <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
                    <div className="glass-card">
                        <div className="stat-label">EOBI Total</div>
                        <div className="stat-value">PKR {Number(computed.eobi?.total || 0).toLocaleString()}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{computed.headcount} employees</div>
                    </div>
                    <div className="glass-card">
                        <div className="stat-label">SESSI Total</div>
                        <div className="stat-value">PKR {Number(computed.sessi?.total || 0).toLocaleString()}</div>
                    </div>
                    <div className="glass-card">
                        <div className="stat-label">Income Tax</div>
                        <div className="stat-value">PKR {Number(computed.incomeTax || 0).toLocaleString()}</div>
                    </div>
                </div>
            )}

            <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem' }}>Statutory Ledger</h3>
                {loading ? <p className="text-muted">Loading…</p> : ledger.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)' }}>No ledger entries. Compute from locked payroll first.</p>
                ) : (
                    <table className="data-table">
                        <thead><tr><th>Authority</th><th>Employee Share</th><th>Employer Share</th><th>Period</th></tr></thead>
                        <tbody>
                            {ledger.map(r => (
                                <tr key={r.id}>
                                    <td>{r.authority}</td>
                                    <td>{Number(r.employee_share || 0).toLocaleString()}</td>
                                    <td>{Number(r.employer_share || 0).toLocaleString()}</td>
                                    <td>{r.period_month}/{r.period_year}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {filing && (
                <div className="glass-card">
                    <h3 style={{ marginBottom: '1rem' }}>Filing Preview (Trace: P5-FIN-002)</h3>
                    <pre style={{ background: 'var(--bg-dark)', padding: '1rem', borderRadius: 8, overflow: 'auto', fontSize: '0.8rem', color: 'var(--text)' }}>
                        {JSON.stringify(filing, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
};

export default ComplianceLedger;
