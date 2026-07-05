import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const CashFlowView = () => {
    const [buckets, setBuckets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        api.getWeeklyCashflow(8)
            .then(setBuckets)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <p className="text-muted">Loading cash-flow forecast…</p>;
    if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;

    const tightWeeks = buckets.filter(b => b.netPosition < 0);

    return (
        <div className="glass-card" style={{ marginTop: '1.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>8-Week Cash Flow</h2>
            {tightWeeks.length > 0 && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                    {tightWeeks.length} week(s) projected tight — outflows exceed expected inflows.
                </div>
            )}
            <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Week</th>
                            <th>Expected In</th>
                            <th>Committed Out</th>
                            <th>Net</th>
                        </tr>
                    </thead>
                    <tbody>
                        {buckets.map(b => (
                            <tr key={b.weekStart}>
                                <td>{b.weekStart} → {b.weekEnd}</td>
                                <td>{Number(b.expectedInflows).toLocaleString()}</td>
                                <td>{Number(b.committedOutflows).toLocaleString()}</td>
                                <td style={{ color: b.netPosition < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>
                                    {Number(b.netPosition).toLocaleString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CashFlowView;
