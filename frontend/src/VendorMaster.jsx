import React from 'react';
import { Truck, Search, Plus, Filter, Tag, Hash, FileSpreadsheet } from 'lucide-react';

function VendorMaster() {
    return (
        <div className="dashboard">
            <header className="header">
                <h1>Vendor Supplier Master</h1>
                <p>Register and manage procurement vendors, assess Katcha Bill statuses, and track material costs.</p>
            </header>

            <div className="toolbar" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                <div className="search-bar" style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--bg-card)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <Search size={20} color="var(--text-muted)" style={{ marginRight: '0.5rem' }} />
                    <input type="text" placeholder="Search suppliers by name, NTN, or category..." style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none' }} />
                </div>
                <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0 1rem', borderRadius: '8px' }}>
                    <Filter size={20} />
                    Filters
                </button>
                <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: 'white', border: 'none', padding: '0 1rem', borderRadius: '8px', cursor: 'pointer' }}>
                    <Plus size={20} />
                    Register Vendor
                </button>
            </div>

            <div className="recent-operations section" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem', marginBottom: '2rem' }}>
                <h2>Active Suppliers</h2>
                <div className="table-responsive" style={{ overflowX: 'auto', marginTop: '1rem' }}>
                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                                <th style={{ padding: '1rem 0.5rem' }}>VENDOR ID</th>
                                <th style={{ padding: '1rem 0.5rem' }}>NAME</th>
                                <th style={{ padding: '1rem 0.5rem' }}>CATEGORY</th>
                                <th style={{ padding: '1rem 0.5rem' }}>NTN/STRN</th>
                                <th style={{ padding: '1rem 0.5rem' }}>MTD VOLUME</th>
                                <th style={{ padding: '1rem 0.5rem' }}>STATUS</th>
                                <th style={{ padding: '1rem 0.5rem' }}>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[
                                { id: 'VND-3021', name: 'Al-Madina Uniforms', category: 'PPE / Uniforms', ntn: '1234567-8', vol: 'Rs. 450,000', status: 'Approved' },
                                { id: 'VND-3044', name: 'Zain Electronics', category: 'Hardware/IT', ntn: '7654321-2', vol: 'Rs. 1,200,000', status: 'Pending Review' },
                                { id: 'VND-3089', name: 'Karachi Hygiene Co.', category: 'Janitorial Supplies', ntn: '9876543-1', vol: 'Rs. 185,200', status: 'Approved' },
                            ].map((vendor, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid var(--border-light)' }}>
                                    <td style={{ padding: '1rem 0.5rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{vendor.id}</td>
                                    <td style={{ padding: '1rem 0.5rem', fontWeight: 600, color: 'var(--text)' }}>{vendor.name}</td>
                                    <td style={{ padding: '1rem 0.5rem' }}><span style={{ background: 'var(--bg-dark)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}><Tag size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />{vendor.category}</span></td>
                                    <td style={{ padding: '1rem 0.5rem', color: 'var(--text-muted)' }}><Hash size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />{vendor.ntn}</td>
                                    <td style={{ padding: '1rem 0.5rem', fontWeight: 600 }}>{vendor.vol}</td>
                                    <td style={{ padding: '1rem 0.5rem' }}>
                                        <span style={{ color: vendor.status === 'Approved' ? '#22c55e' : '#eab308', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}>
                                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: vendor.status === 'Approved' ? '#22c55e' : '#eab308' }}></span>
                                            {vendor.status}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem 0.5rem' }}>
                                        <button className="btn btn-text" style={{ color: 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <FileSpreadsheet size={16} /> Ledger
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default VendorMaster;
