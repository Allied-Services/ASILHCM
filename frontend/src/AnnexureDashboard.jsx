import React, { useState } from 'react';
import { Search, Filter, CheckCircle, XCircle } from 'lucide-react';

const mockData = [
    { id: 'DN-26-001', location: 'Karachi Central', soId: 'SO-1092', cost: 1250000, margin: 15, status: 'Draft' },
    { id: 'DN-26-002', location: 'Lahore South', soId: 'SO-1104', cost: 840000, margin: 15, status: 'Approved' },
    { id: 'DN-26-003', location: 'Islamabad East', soId: 'SO-1092', cost: 450000, margin: 12, status: 'Draft' },
    { id: 'DN-26-004', location: 'Karachi Central', soId: 'SO-1105', cost: 620000, margin: 15, status: 'Draft' },
];

const AnnexureDashboard = () => {
    const [filterLoc, setFilterLoc] = useState('');
    const [filterSO, setFilterSO] = useState('');

    const filtered = mockData.filter(item =>
        (filterLoc === '' || item.location.includes(filterLoc)) &&
        (filterSO === '' || item.soId.includes(filterSO))
    );

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Annexure & Debit Note Approval</h1>
                <p className="page-subtitle">Grouped payroll costs mapped directly to client Service Orders</p>
            </div>

            <div className="glass-card" style={{ marginBottom: '24px' }}>
                <div className="controls-bar">
                    <div style={{ flex: 1, display: 'flex', gap: '12px' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <Search style={{ position: 'absolute', top: 10, left: 12, color: 'var(--text-muted)' }} size={18} />
                            <input
                                type="text"
                                className="input-glass"
                                placeholder="Filter by Location..."
                                value={filterLoc}
                                onChange={e => setFilterLoc(e.target.value)}
                                style={{ width: '100%', paddingLeft: '38px' }}
                            />
                        </div>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <Filter style={{ position: 'absolute', top: 10, left: 12, color: 'var(--text-muted)' }} size={18} />
                            <input
                                type="text"
                                className="input-glass"
                                placeholder="Filter by Service Order (SO-XXXX)..."
                                value={filterSO}
                                onChange={e => setFilterSO(e.target.value)}
                                style={{ width: '100%', paddingLeft: '38px' }}
                            />
                        </div>
                    </div>
                    <button className="btn-primary">Generate Final Annexure</button>
                </div>

                <div className="data-table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Debit Note #</th>
                                <th>Location</th>
                                <th>Service Order (SO)</th>
                                <th>Total Cost to Company</th>
                                <th>Service Margin (%)</th>
                                <th>Invoice Total</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((row, i) => {
                                const invoiceTotal = row.cost + (row.cost * (row.margin / 100));
                                return (
                                    <tr key={i}>
                                        <td style={{ fontWeight: '600', color: 'var(--primary)' }}>{row.id}</td>
                                        <td>{row.location}</td>
                                        <td>{row.soId}</td>
                                        <td>Rs. {row.cost.toLocaleString()}</td>
                                        <td>{row.margin}%</td>
                                        <td style={{ fontWeight: '700' }}>Rs. {invoiceTotal.toLocaleString()}</td>
                                        <td>
                                            {row.status === 'Approved' ? (
                                                <span className="badge badge-approved">Approved</span>
                                            ) : (
                                                <span className="badge badge-pending">Draft</span>
                                            )}
                                        </td>
                                        <td>
                                            {row.status !== 'Approved' && (
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--success)' }}>
                                                        <CheckCircle size={20} />
                                                    </button>
                                                    <button style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}>
                                                        <XCircle size={20} />
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan="8" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No matches found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AnnexureDashboard;
