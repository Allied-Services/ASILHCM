import React from 'react';
import { Users, Truck, AlertTriangle, TrendingUp, BarChart2 } from 'lucide-react';

const Dashboard = () => {
    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Managing Director Overview</h1>
                <p className="page-subtitle">High-level summary of BPO &amp; FM Operations</p>
            </div>

            <div className="grid-3">
                {/* Total Payroll Cost */}
                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stat-label">Total Payroll Cost</span>
                        <span className="stat-icon"><Users size={20} /></span>
                    </div>
                    <div className="stat-value" style={{ color: 'var(--text-muted)', fontSize: '1.4rem' }}>—</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                        Will populate after first payroll run
                    </div>
                </div>

                {/* Procurement Volume */}
                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stat-label">Procurement Volume</span>
                        <span className="stat-icon"><Truck size={20} /></span>
                    </div>
                    <div className="stat-value" style={{ color: 'var(--text-muted)', fontSize: '1.4rem' }}>—</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                        Will populate after bills are entered
                    </div>
                </div>

                {/* Pending Replacements */}
                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stat-label">Pending Actions</span>
                        <span className="stat-icon"><AlertTriangle size={20} /></span>
                    </div>
                    <div className="stat-value" style={{ color: 'var(--text-muted)', fontSize: '1.4rem' }}>—</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                        No pending items
                    </div>
                </div>
            </div>

            {/* Empty state */}
            <div className="glass-card" style={{ marginTop: '1.5rem', textAlign: 'center', padding: '4rem 2rem' }}>
                <BarChart2 size={48} style={{ opacity: 0.2, margin: '0 auto 1.5rem', display: 'block' }} />
                <h2 style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: '0.75rem' }}>
                    Dashboard Ready
                </h2>
                <p style={{ color: 'var(--text-muted)', maxWidth: '460px', margin: '0 auto', lineHeight: 1.6 }}>
                    This dashboard will automatically show live payroll totals, procurement figures,
                    and operational summaries once you start entering real data — employees, clients, bills, and payroll runs.
                </p>
            </div>
        </div>
    );
};

export default Dashboard;
