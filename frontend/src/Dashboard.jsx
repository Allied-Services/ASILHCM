import React from 'react';
import { Users, Truck, AlertTriangle, TrendingUp } from 'lucide-react';

const Dashboard = () => {
    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Managing Director Overview</h1>
                <p className="page-subtitle">High-level summary of BPO & FM Operations</p>
            </div>

            <div className="grid-3">
                {/* Total Payroll Cost */}
                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stat-label">Total Payroll Cost</span>
                        <span className="stat-icon"><Users size={20} /></span>
                    </div>
                    <div className="stat-value">Rs. 14,250,500</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <TrendingUp size={14} /> +2.4% vs last month
                    </div>
                    <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Includes Allied Team & Client Services Side
                    </div>
                </div>

                {/* Total Procurement Volume */}
                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stat-label">Procurement Volume</span>
                        <span className="stat-icon"><Truck size={20} /></span>
                    </div>
                    <div className="stat-value">Rs. 3,180,200</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        84 Processed Invoices (MTD)
                    </div>
                    <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Primary Vendors: 12 Active
                    </div>
                </div>

                {/* Pending Uniform/PPE Replacements */}
                <div className="glass-card" style={{ border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stat-label" style={{ color: 'var(--warning)' }}>Pending Replacements</span>
                        <span className="stat-icon warning"><AlertTriangle size={20} /></span>
                    </div>
                    <div className="stat-value">42</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Asset Life Cycle Trigger Alert
                    </div>
                    <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        - 28 Uniforms (6 mos expiry)<br />
                        - 14 PPE Sets (12 mos expiry)
                    </div>
                </div>
            </div>

            <div className="glass-card">
                <h2 style={{ fontSize: '1.25rem', marginBottom: '16px', fontWeight: '600' }}>Recent Financial Operations</h2>
                <div className="data-table-container">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Operation ID</th>
                                <th>Category</th>
                                <th>Amount (PKR)</th>
                                <th>Status</th>
                                <th>Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>PAY-2026-07-A</td>
                                <td>Payroll Run - Site A</td>
                                <td>2,450,000</td>
                                <td><span className="badge badge-approved">Completed</span></td>
                                <td>01 Jul 2026</td>
                            </tr>
                            <tr>
                                <td>PROC-INV-8921</td>
                                <td>Raw Material Restock</td>
                                <td>120,400</td>
                                <td><span className="badge badge-pending">In Audit</span></td>
                                <td>03 Jul 2026</td>
                            </tr>
                            <tr>
                                <td>PAY-2026-07-B</td>
                                <td>Payroll Run - HO</td>
                                <td>1,800,000</td>
                                <td><span className="badge badge-approved">Completed</span></td>
                                <td>01 Jul 2026</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
