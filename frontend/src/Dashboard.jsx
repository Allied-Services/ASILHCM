import React, { useEffect, useState } from 'react';
import { Users, Truck, AlertTriangle, TrendingUp, Inbox } from 'lucide-react';
import { api } from './api';
import CashFlowView from './features/pnl/CashFlowView';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—' : `PKR ${Math.round(Number(n)).toLocaleString()}`;

const Dashboard = () => {
    const [pnl, setPnl] = useState([]);
    const [intake, setIntake] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshError, setRefreshError] = useState('');
    const now = new Date();
    const [pnlMonth, setPnlMonth] = useState(now.getMonth() + 1);
    const [pnlYear, setPnlYear] = useState(now.getFullYear());

    const loadPnl = () => api.getContractPnl().then(rows => setPnl(Array.isArray(rows) ? rows : [])).catch(() => setPnl([]));

    useEffect(() => {
        Promise.all([
            loadPnl(),
            api.getIntakeMessages('new').catch(() => []),
        ]).then(([, intakeRows]) => {
            setIntake(Array.isArray(intakeRows) ? intakeRows : []);
        }).finally(() => setLoading(false));
    }, []);

    const refreshPnl = async () => {
        setRefreshing(true);
        setRefreshError('');
        try {
            await api.refreshPnlAllocations(pnlMonth, pnlYear);
            await loadPnl();
        } catch (e) {
            setRefreshError(e.message);
        } finally {
            setRefreshing(false);
        }
    };

    const totalRevenue = pnl.reduce((s, r) => s + Number(r.total_revenue || 0), 0);
    const totalCost = pnl.reduce((s, r) => s + Number(r.total_cost || 0), 0);
    const margin = totalRevenue - totalCost;
    const overCap = pnl.filter(r => Number(r.margin_abs) < 0).length;

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Managing Director Overview</h1>
                <p className="page-subtitle">Live liability, margin, intake, and cash-flow</p>
            </div>

            <div className="grid-3">
                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stat-label">Portfolio Margin (MTD view)</span>
                        <span className="stat-icon"><TrendingUp size={20} /></span>
                    </div>
                    <div className="stat-value">{loading ? '…' : fmt(margin)}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                        Revenue {fmt(totalRevenue)} · Cost {fmt(totalCost)}
                    </div>
                </div>

                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stat-label">Contracts Tracked</span>
                        <span className="stat-icon"><Users size={20} /></span>
                    </div>
                    <div className="stat-value">{loading ? '…' : pnl.length}</div>
                    <div style={{ fontSize: '0.85rem', color: overCap ? 'var(--danger)' : 'var(--text-muted)', marginTop: '8px' }}>
                        {overCap ? `${overCap} contract(s) negative margin` : 'Run P&L refresh after payroll lock'}
                    </div>
                </div>

                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="stat-label">Intake Queue</span>
                        <span className="stat-icon"><Inbox size={20} /></span>
                    </div>
                    <div className="stat-value">{loading ? '…' : intake.length}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                        New emails awaiting processing
                    </div>
                </div>
            </div>

            <CashFlowView />

            <div className="glass-card" style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <h3 style={{ margin: 0 }}>P&L Allocations</h3>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select value={pnlMonth} onChange={e => setPnlMonth(Number(e.target.value))}
                            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)' }}>
                            {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString('default', { month: 'short' })}</option>)}
                        </select>
                        <input type="number" value={pnlYear} onChange={e => setPnlYear(Number(e.target.value))} style={{ width: 80, background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', color: 'var(--text)' }} />
                        <button type="button" className="btn-secondary" onClick={refreshPnl} disabled={refreshing}>
                            {refreshing ? 'Refreshing…' : 'Refresh P&L'}
                        </button>
                    </div>
                </div>
                {refreshError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{refreshError}</p>}
            </div>

            {!loading && pnl.length === 0 && (
                <div className="glass-card" style={{ marginTop: '1.5rem', textAlign: 'center', padding: '2rem' }}>
                    <Truck size={32} style={{ opacity: 0.25, margin: '0 auto 1rem', display: 'block' }} />
                    <p style={{ color: 'var(--text-muted)' }}>
                        P&L rows appear after migrations run and payroll allocations are refreshed from locked payroll.
                    </p>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
