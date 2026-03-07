import React from 'react';
import { Briefcase, Search, Plus, Building2, CheckCircle, Clock } from 'lucide-react';

function ClientMaster() {
    return (
        <div className="dashboard">
            <header className="header">
                <h1>Client Master (Contracts)</h1>
                <p>Manage individual service contracts, billing multipliers (margins), and location-specific setups.</p>
            </header>

            <div className="toolbar" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                <div className="search-bar" style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--bg-card)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <Search size={20} color="var(--text-muted)" style={{ marginRight: '0.5rem' }} />
                    <input type="text" placeholder="Search contracts by ID, location, or client..." style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none' }} />
                </div>
                <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: 'white', border: 'none', padding: '0 1rem', borderRadius: '8px', cursor: 'pointer' }}>
                    <Plus size={20} />
                    New Contract
                </button>
            </div>

            <div className="grid">
                {[
                    { id: 'CTR-2026-A1', client: 'Bank Al Habib', type: 'Security Services', margin: '12%', status: 'Active', color: 'rgba(56, 189, 248, 0.1)', textColor: 'var(--primary)', loc: 'KHI-Clifton' },
                    { id: 'CTR-2026-B3', client: 'Bank Al Habib', type: 'Janitorial Services', margin: '15%', status: 'Active', color: 'rgba(56, 189, 248, 0.1)', textColor: 'var(--primary)', loc: 'KHI-IIG' },
                    { id: 'CTR-2025-X9', client: 'Gul Ahmed Textile', type: 'Driver Outsourcing', margin: '10%', status: 'Expiring', color: 'rgba(234, 179, 8, 0.1)', textColor: '#eab308', loc: 'LHE-Gulberg' },
                ].map((contract, i) => (
                    <div key={i} className="card contract-card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{contract.id}</span>
                                <h3 style={{ margin: '4px 0', fontSize: '1.1rem' }}>{contract.client}</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem', color: 'var(--text-regular)' }}>
                                    <Briefcase size={14} color="var(--primary)" /> {contract.type}
                                </div>
                            </div>
                            <span className="badge" style={{ background: contract.color, color: contract.textColor, padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {contract.status === 'Active' ? <CheckCircle size={12} /> : <Clock size={12} />}
                                {contract.status}
                            </span>
                        </div>

                        <div style={{ background: 'var(--bg-dark)', padding: '1rem', borderRadius: '8px', fontSize: '0.9rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Service Location</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Building2 size={14} color="var(--primary)" /> {contract.loc}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Service Margin</div>
                                <div style={{ fontWeight: '600', fontSize: '1.1rem', color: 'var(--text)' }}>{contract.margin}</div>
                            </div>
                        </div>

                        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>32 Assigned Employees</span>
                            <button className="btn btn-text" style={{ color: 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600 }}>Manage Billing</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default ClientMaster;
