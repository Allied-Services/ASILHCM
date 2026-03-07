import React, { useState } from 'react';
import { Building, Search, Plus, MapPin, Users, X, Phone, Mail, FileText, ChevronLeft, Edit2, Trash2, CheckCircle, AlertCircle, Save } from 'lucide-react';

// ── Sample Data ──────────────────────────────────────────────────────────────
const SERVICE_TYPES = [
    'Janitorial / Soft Services',
    'Hard Services',
    'Procurement (Fixed Supply)',
    'Manpower Services',
    'Facilities Management',
    'BPO / Back Office',
    'Imprest',
    'Mixed Services',
];

const STATUS_OPTS = ['Active', 'Expiring', 'Expired', 'Cancelled', 'Draft'];

const EMPTY_CONTRACT = {
    id: '', contractName: '', location: '', serviceType: 'Manpower Services', headcount: 0,
    status: 'Active', startDate: '', endDate: '',
    costs: { eobi: 1560, sessi: 2220, life_insurance: 500, medical_premium: 1200, uniform_cost: 300, shoes_cost: 150, ppe_cost: 200, opd: 500, dedicated_staff: 0, courier: 3000, other1_name: '', other1_amount: 0, other2_name: '', other2_amount: 0 },
    financials: { wht_pct: 7, sales_tax_pct: 17, service_charges_pct: 15 }
};

const SAMPLE_CLIENTS = [
    {
        id: 'CLT-001', name: 'Bank Al Habib', hq: 'Karachi', ntn: '7483920-1', strn: 'STRN-BAH-001', industry: 'Banking & Finance',
        contacts: [
            { id: 'c1', name: 'Mr. Tariq Mehmood', title: 'Head of Administration', phone: '0300-1234567', email: 'tariq@bahl.com.pk' },
            { id: 'c2', name: 'Ms. Nadia Rizvi', title: 'Procurement Officer', phone: '0321-9876543', email: 'nadia@bahl.com.pk' },
        ],
        contracts: [
            {
                id: 'CTR-2026-A1', contractName: 'Security Services — Clifton Branch SO-2025-047', location: 'KHI-Clifton Branch', serviceType: 'Manpower Services', headcount: 18, status: 'Active', startDate: '2025-01-01', endDate: '2026-12-31',
                costs: { eobi: 1560, sessi: 2220, life_insurance: 500, medical_premium: 1200, uniform_cost: 3600, shoes_cost: 1800, ppe_cost: 2400, opd: 6000, dedicated_staff: 50000, courier: 5000, other1_name: 'Transport Allowance', other1_amount: 3000, other2_name: 'Night Shift Allowance', other2_amount: 2000 },
                financials: { wht_pct: 7, sales_tax_pct: 17, service_charges_pct: 15 }
            },
            {
                id: 'CTR-2026-B3', contractName: 'Janitorial Services — IIG Branch SO-2025-061', location: 'KHI-IIG Branch', serviceType: 'Janitorial / Soft Services', headcount: 12, status: 'Active', startDate: '2025-03-01', endDate: '2026-02-28',
                costs: { eobi: 1560, sessi: 2220, life_insurance: 300, medical_premium: 800, uniform_cost: 4800, shoes_cost: 2400, ppe_cost: 4200, opd: 3600, dedicated_staff: 0, courier: 2000, other1_name: '', other1_amount: 0, other2_name: '', other2_amount: 0 },
                financials: { wht_pct: 7, sales_tax_pct: 17, service_charges_pct: 12 }
            },
        ]
    },
    {
        id: 'CLT-002', name: 'Gul Ahmed Textile', hq: 'Karachi', ntn: '7483921-2', strn: 'STRN-GAT-002', industry: 'Textile & Manufacturing',
        contacts: [{ id: 'c3', name: 'Mr. Irfan Shah', title: 'GM Operations', phone: '0333-5566778', email: 'irfan@gulahmadtextile.com' }],
        contracts: [
            {
                id: 'CTR-2025-X9', contractName: 'Driver Outsourcing — Gulberg Factory SO-2025-012', location: 'LHE-Gulberg Factory', serviceType: 'Manpower Services', headcount: 8, status: 'Expiring', startDate: '2025-01-01', endDate: '2026-03-31',
                costs: { eobi: 1560, sessi: 2220, life_insurance: 300, medical_premium: 600, uniform_cost: 3000, shoes_cost: 2400, ppe_cost: 1200, opd: 3600, dedicated_staff: 0, courier: 1500, other1_name: 'Fuel Allowance', other1_amount: 8000, other2_name: '', other2_amount: 0 },
                financials: { wht_pct: 5, sales_tax_pct: 17, service_charges_pct: 10 }
            },
        ]
    },
    {
        id: 'CLT-003', name: 'Fauji Fertilizer', hq: 'Rawalpindi', ntn: '7483922-3', strn: 'STRN-FFC-003', industry: 'Chemicals & Fertilizers',
        contacts: [{ id: 'c4', name: 'Col. (R) Amjad Ali', title: 'Admin Manager', phone: '051-9001234', email: 'amjad@ffc.com.pk' }],
        contracts: []
    },
];

const EMPTY_CLIENT = { name: '', hq: '', ntn: '', strn: '', industry: '' };
const EMPTY_CONTACT = { name: '', title: '', phone: '', email: '' };

const ST_CLR = { Active: '#22c55e', Expiring: '#eab308', Expired: '#ef4444', Cancelled: '#dc2626', Draft: '#94a3b8' };

// Total employees per client (in real system would come from DB query)
const EMP_COUNTS = { 'CLT-001': 30, 'CLT-002': 8, 'CLT-003': 0 };

// ── Reusable helpers ─────────────────────────────────────────────────────────
const Overlay = ({ children, wide = false }) => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '1.5rem', overflowY: 'auto' }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', width: '100%', maxWidth: wide ? '1100px' : '680px', border: '1px solid var(--border)', marginBottom: '2rem' }}>{children}</div>
    </div>
);

const ModalHeader = ({ title, sub, onClose }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
        <div><h2 style={{ margin: 0 }}>{title}</h2>{sub && <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>{sub}</p>}</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={24} /></button>
    </div>
);

const FRow = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        {children}
    </div>
);
const FInput = ({ value, onChange, ph = '', type = 'text' }) => (
    <input type={type} value={value} placeholder={ph} onChange={onChange} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
);
const FSelect = ({ value, onChange, opts = [] }) => (
    <select value={value} onChange={onChange} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none', width: '100%' }}>
        {opts.map(o => <option key={o}>{o}</option>)}
    </select>
);

// ── Contract Editor ─────────────────────────────────────────────────────────
function ContractEditor({ contract, onSave, onCancel }) {
    const [c, setC] = useState({ ...EMPTY_CONTRACT, ...contract, costs: { ...EMPTY_CONTRACT.costs, ...(contract?.costs || {}) }, financials: { ...EMPTY_CONTRACT.financials, ...(contract?.financials || {}) } });

    const set = (path, val) => {
        if (path.includes('.')) {
            const [grp, key] = path.split('.');
            setC(p => ({ ...p, [grp]: { ...p[grp], [key]: val } }));
        } else setC(p => ({ ...p, [path]: val }));
    };

    const costFields = [
        ['eobi', 'EOBI — Employer Share (Rs. / head / month)'],
        ['sessi', 'SESSI (Rs. / head / month)'],
        ['life_insurance', 'Life Insurance Premium (Rs. / head / month)'],
        ['medical_premium', 'Medical / Group Health Premium (Rs. / head / month)'],
        ['uniform_cost', 'Uniform Cost (Rs. / head / YEAR)'],
        ['shoes_cost', 'Shoes Cost (Rs. / head / YEAR)'],
        ['ppe_cost', 'PPEs Cost (Rs. / head / YEAR)'],
        ['opd', 'OPD Allowance (Rs. / head / YEAR)'],
        ['dedicated_staff', 'Internal Dedicated Staff Cost (total / month)'],
        ['courier', 'Approximate Monthly Courier Cost'],
    ];

    return (
        <Overlay wide={true}>
            <ModalHeader title={contract?.id ? `Edit Contract: ${contract.id}` : 'New Contract'} sub="Define all costs, financials and billing parameters for this contract" onClose={onCancel} />
            <div style={{ padding: '2rem', overflowY: 'auto', maxHeight: '75vh' }}>

                {/* Basic Info */}
                <div style={{ background: 'var(--bg-dark)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Contract Details</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                        <div style={{ gridColumn: '1/-1' }}>
                            <FRow label="Contract Name (as per Client Service Order) *">
                                <FInput value={c.contractName || ''} onChange={e => set('contractName', e.target.value)} ph="e.g. Security Services — Clifton Branch SO-2025-047" />
                            </FRow>
                        </div>
                        <FRow label="Service Location / Site"><FInput value={c.location} onChange={e => set('location', e.target.value)} ph="e.g. KHI-Clifton Branch" /></FRow>
                        <FRow label="Service Type"><FSelect value={c.serviceType} onChange={e => set('serviceType', e.target.value)} opts={SERVICE_TYPES} /></FRow>
                        <FRow label="Headcount"><FInput type="number" value={c.headcount} onChange={e => set('headcount', e.target.value)} ph="No. of employees" /></FRow>
                        <FRow label="Status"><FSelect value={c.status} onChange={e => set('status', e.target.value)} opts={STATUS_OPTS} /></FRow>
                        <FRow label="Start Date"><FInput type="date" value={c.startDate} onChange={e => set('startDate', e.target.value)} /></FRow>
                        <FRow label="End Date"><FInput type="date" value={c.endDate} onChange={e => set('endDate', e.target.value)} /></FRow>
                    </div>
                </div>

                {/* Per-Head Costs */}
                <div style={{ background: 'var(--bg-dark)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Operational Costs (PKR)</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {costFields.map(([key, label]) => (
                            <FRow key={key} label={label}>
                                <FInput type="number" value={c.costs[key]} onChange={e => set(`costs.${key}`, parseFloat(e.target.value) || 0)} ph="0" />
                            </FRow>
                        ))}
                    </div>
                    {/* Custom Cost 1 */}
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>Other Cost 1 — Name</div>
                            <FInput value={c.costs.other1_name} onChange={e => set('costs.other1_name', e.target.value)} ph="e.g. Transport Allowance" />
                        </div>
                        <FRow label="Other Cost 1 — Amount (Rs.)">
                            <FInput type="number" value={c.costs.other1_amount} onChange={e => set('costs.other1_amount', parseFloat(e.target.value) || 0)} ph="0" />
                        </FRow>
                        <div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>Other Cost 2 — Name</div>
                            <FInput value={c.costs.other2_name} onChange={e => set('costs.other2_name', e.target.value)} ph="e.g. Night Shift Allowance" />
                        </div>
                        <FRow label="Other Cost 2 — Amount (Rs.)">
                            <FInput type="number" value={c.costs.other2_amount} onChange={e => set('costs.other2_amount', parseFloat(e.target.value) || 0)} ph="0" />
                        </FRow>
                    </div>
                </div>

                {/* Contract Financials */}
                <div style={{ background: 'var(--bg-dark)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Contract Financials &amp; Tax</h3>
                    <p style={{ margin: '0 0 1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Service Charges % is the margin applied on cost to derive the billing amount.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                        <FRow label="Service Charges / Margin (%)"><FInput type="number" value={c.financials.service_charges_pct} onChange={e => set('financials.service_charges_pct', parseFloat(e.target.value) || 0)} ph="e.g. 15" /></FRow>
                        <FRow label="Withholding Tax — WHT (%)"><FInput type="number" value={c.financials.wht_pct} onChange={e => set('financials.wht_pct', parseFloat(e.target.value) || 0)} ph="e.g. 7" /></FRow>
                        <FRow label="Sales Tax (%)"><FInput type="number" value={c.financials.sales_tax_pct} onChange={e => set('financials.sales_tax_pct', parseFloat(e.target.value) || 0)} ph="e.g. 17" /></FRow>
                    </div>
                </div>

                {/* Cost Summary */}
                <div style={{ background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 0.25rem', fontSize: '0.85rem', color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Monthly Cost Summary Preview (per head)</h3>
                    <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Uniform, Shoes, PPEs &amp; OPD are yearly — divided by 12 for monthly view.</p>
                    {(() => {
                        const co = c.costs;
                        const yearly12 = (co.uniform_cost + co.shoes_cost + co.ppe_cost + co.opd) / 12;
                        const perHead = co.eobi + co.sessi + co.life_insurance + co.medical_premium + yearly12;
                        const shared = (co.dedicated_staff + co.courier + co.other1_amount + co.other2_amount) / (c.headcount || 1);
                        const totalPerHead = perHead + shared;
                        return (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>Per-Head Compliance Costs</div><div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Rs. {perHead.toLocaleString()}</div></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>Shared Costs (÷ headcount)</div><div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Rs. {shared.toLocaleString()}</div></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>Total Overhead / Head</div><div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>Rs. {totalPerHead.toLocaleString()}</div></div>
                            </div>
                        );
                    })()}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                    <button onClick={onCancel} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={() => onSave(c)} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.75rem 2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Save size={16} /> Save Contract
                    </button>
                </div>
            </div>
        </Overlay>
    );
}

// ── Client Profile View ──────────────────────────────────────────────────────
function ClientProfile({ client, onChange, onBack }) {
    const [tab, setTab] = useState('overview');
    const [editContract, setEditContract] = useState(null); // null | EMPTY_CONTRACT | existing
    const [viewContract, setViewContract] = useState(null);
    const [showAddContact, setShowAddContact] = useState(false);
    const [newContact, setNewContact] = useState(EMPTY_CONTACT);

    const saveContract = (ct) => {
        let updated;
        if (!ct.id) {
            ct.id = `CTR-${Date.now()}`;
            updated = { ...client, contracts: [...client.contracts, ct] };
        } else {
            updated = { ...client, contracts: client.contracts.map(c => c.id === ct.id ? ct : c) };
        }
        onChange(updated);
        setEditContract(null);
    };

    const deleteContract = (id) => {
        if (!window.confirm('Delete this contract?')) return;
        onChange({ ...client, contracts: client.contracts.filter(c => c.id !== id) });
    };

    const addContact = () => {
        onChange({ ...client, contacts: [...client.contacts, { ...newContact, id: `ct-${Date.now()}` }] });
        setNewContact(EMPTY_CONTACT); setShowAddContact(false);
    };

    const TABS = ['overview', 'contacts', 'contracts'];

    return (
        <div className="dashboard">
            {/* Back bar */}
            <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '1.5rem', fontSize: '0.9rem', padding: 0 }}>
                <ChevronLeft size={18} /> All Clients
            </button>

            {/* Client Header */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '14px', padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{ width: '60px', height: '60px', borderRadius: '12px', background: 'linear-gradient(135deg,var(--primary),#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '1.4rem' }}>
                        {client.name[0]}
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.6rem' }}>{client.name}</h1>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>{client.industry} · <MapPin size={13} style={{ verticalAlign: 'middle' }} /> {client.hq}</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                    {[['NTN', client.ntn], ['STRN', client.strn], ['Active Contracts', client.contracts.filter(c => c.status === 'Active').length], ['Open Contacts', client.contacts.length]].map(([l, v]) => (
                        <div key={l} style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{v}</div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{l}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '2rem' }}>
                {TABS.map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{ padding: '0.85rem 1.75rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t ? 'var(--primary)' : 'transparent'}`, color: tab === t ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: tab === t ? 700 : 400, fontSize: '0.95rem', textTransform: 'capitalize' }}>
                        {t}
                    </button>
                ))}
            </div>

            {/* Overview Tab */}
            {tab === 'overview' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem' }}>
                        <h3 style={{ margin: '0 0 1rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Client Details</h3>
                        {[['Client ID', client.id], ['Industry', client.industry], ['Headquarters', client.hq], ['NTN', client.ntn], ['STRN', client.strn]].map(([l, v]) => (
                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.9rem' }}>
                                <span style={{ color: 'var(--text-muted)' }}>{l}</span><span style={{ fontWeight: 500 }}>{v}</span>
                            </div>
                        ))}
                    </div>
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem' }}>
                        <h3 style={{ margin: '0 0 1rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Contracts Summary</h3>
                        {client.contracts.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No contracts yet.</p> : client.contracts.map(c => (
                            <div key={c.id} style={{ padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-dark)', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.location}</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{c.serviceType} · {c.headcount} heads</div>
                                </div>
                                <span style={{ background: ST_CLR[c.status] + '20', color: ST_CLR[c.status], padding: '3px 10px', borderRadius: '10px', fontSize: '0.78rem', fontWeight: 600 }}>{c.status}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Contacts Tab */}
            {tab === 'contacts' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.25rem' }}>
                        <button onClick={() => setShowAddContact(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Plus size={16} /> Add Contact
                        </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                        {client.contacts.map(ct => (
                            <div key={ct.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg,var(--primary),#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700 }}>
                                        {ct.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                                    </div>
                                    <div><div style={{ fontWeight: 700 }}>{ct.name}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{ct.title}</div></div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.88rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}><Phone size={14} /> {ct.phone}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}><Mail size={14} /> {ct.email}</div>
                                </div>
                            </div>
                        ))}
                        {client.contacts.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No contacts yet.</p>}
                    </div>

                    {showAddContact && (
                        <Overlay>
                            <ModalHeader title="Add Contact" onClose={() => setShowAddContact(false)} />
                            <div style={{ padding: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                <FRow label="Full Name"><FInput value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} ph="Mr. John Smith" /></FRow>
                                <FRow label="Job Title"><FInput value={newContact.title} onChange={e => setNewContact(p => ({ ...p, title: e.target.value }))} ph="e.g. Procurement Officer" /></FRow>
                                <FRow label="Phone"><FInput value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} ph="0300-XXXXXXX" /></FRow>
                                <FRow label="Email"><FInput value={newContact.email} onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))} ph="email@company.com" /></FRow>
                            </div>
                            <div style={{ padding: '0 2rem 2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                <button onClick={() => setShowAddContact(false)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={addContact} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Add Contact</button>
                            </div>
                        </Overlay>
                    )}
                </div>
            )}

            {/* Contracts Tab */}
            {tab === 'contracts' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.25rem' }}>
                        <button onClick={() => setEditContract({ ...EMPTY_CONTRACT })} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Plus size={16} /> New Contract
                        </button>
                    </div>

                    {client.contracts.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No contracts for this client yet.</p>}

                    {client.contracts.map(ct => (
                        <div key={ct.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                                        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{ct.contractName || ct.id}</h3>
                                        <span style={{ background: (ST_CLR[ct.status] || '#94a3b8') + '20', color: ST_CLR[ct.status] || '#94a3b8', padding: '3px 10px', borderRadius: '10px', fontSize: '0.78rem', fontWeight: 600 }}>{ct.status}</span>
                                    </div>
                                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.86rem' }}>{ct.id} &nbsp;·&nbsp; {ct.serviceType} &nbsp;·&nbsp; <strong>{ct.headcount}</strong> employees &nbsp;·&nbsp; {ct.location}</p>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button onClick={() => setViewContract(viewContract?.id === ct.id ? null : ct)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                                        {viewContract?.id === ct.id ? '▲ Collapse' : '▼ Expand'}
                                    </button>
                                    <button onClick={() => setEditContract(ct)} style={{ background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Edit2 size={14} /> Edit
                                    </button>
                                    <button onClick={() => deleteContract(ct.id)} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            {viewContract?.id === ct.id && (
                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.25rem' }}>
                                    <div>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Operational Costs (Rs./head)</div>
                                        {[['EOBI', ct.costs.eobi], ['SESSI', ct.costs.sessi], ['Life Insurance', ct.costs.life_insurance], ['Medical Premium', ct.costs.medical_premium], ['Uniform', ct.costs.uniform_cost], ['Shoes', ct.costs.shoes_cost], ['PPEs', ct.costs.ppe_cost], ['OPD', ct.costs.opd]].map(([l, v]) => (
                                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', padding: '3px 0' }}><span style={{ color: 'var(--text-muted)' }}>{l}</span><span>Rs. {(v || 0).toLocaleString()}</span></div>
                                        ))}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Shared / Other Costs (Rs./month)</div>
                                        {[['Dedicated Staff', ct.costs.dedicated_staff], ['Courier', ct.costs.courier], [ct.costs.other1_name || 'Other Cost 1', ct.costs.other1_amount], [ct.costs.other2_name || 'Other Cost 2', ct.costs.other2_amount]].map(([l, v], i) => (
                                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', padding: '3px 0' }}><span style={{ color: 'var(--text-muted)' }}>{l}</span><span>Rs. {(v || 0).toLocaleString()}</span></div>
                                        ))}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Contract Financials (%)</div>
                                        {[['WHT', ct.financials.wht_pct + '%'], ['Sales Tax', ct.financials.sales_tax_pct + '%'], ['Service Charges / Margin', ct.financials.service_charges_pct + '%']].map(([l, v]) => (
                                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', padding: '3px 0' }}><span style={{ color: 'var(--text-muted)' }}>{l}</span><span style={{ fontWeight: 600, color: 'var(--primary)' }}>{v}</span></div>
                                        ))}
                                        <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--bg-dark)', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Contract Period</div>
                                            <div style={{ fontSize: '0.9rem' }}>{ct.startDate} → {ct.endDate || 'Open-ended'}</div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Contract Editor Modal */}
            {editContract && <ContractEditor contract={editContract} onSave={saveContract} onCancel={() => setEditContract(null)} />}
        </div>
    );
}

// ── Main ClientInformation ───────────────────────────────────────────────────
export default function ClientInformation() {
    const [clients, setClients] = useState(SAMPLE_CLIENTS);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState(EMPTY_CLIENT);

    const updateClient = (updated) => {
        setClients(p => p.map(c => c.id === updated.id ? updated : c));
        setSelected(updated);
    };

    const addClient = () => {
        if (!form.name) return alert('Client name is required.');
        const nc = { ...form, id: `CLT-${Date.now()}`, contacts: [], contracts: [] };
        setClients(p => [...p, nc]);
        setForm(EMPTY_CLIENT); setShowAdd(false);
    };

    if (selected) return <ClientProfile client={selected} onChange={updateClient} onBack={() => setSelected(null)} />;

    const filtered = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.ntn.includes(search));

    return (
        <div className="dashboard">
            <header className="header">
                <h1>Client Information</h1>
                <p>Manage corporate clients. Click a client to view their profile, contacts, and contracts.</p>
            </header>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', background: 'var(--bg-card)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <Search size={18} color="var(--text-muted)" style={{ marginRight: '0.5rem', flexShrink: 0 }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients by name or NTN..." style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none' }} />
                </div>
                <button onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', color: 'white', border: 'none', padding: '0 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                    <Plus size={18} /> Add Client
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: '1.5rem' }}>
                {filtered.map(cl => (
                    <div key={cl.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', transition: 'border-color 0.2s,box-shadow 0.2s' }} onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.boxShadow = '0 0 0 1px var(--primary)'; }} onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                            <div style={{ width: '48px', height: '48px', borderRadius: '10px', background: 'linear-gradient(135deg,var(--primary),#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '1.2rem', flexShrink: 0 }}>{cl.name[0]}</div>
                            <div><h3 style={{ margin: 0, fontSize: '1.1rem' }}>{cl.name}</h3><span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{cl.industry}</span></div>
                        </div>
                        <div style={{ background: 'var(--bg-dark)', borderRadius: '8px', padding: '1rem', fontSize: '0.88rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}><MapPin size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> HQ</span><span>{cl.hq}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>NTN</span><span style={{ fontFamily: 'monospace' }}>{cl.ntn}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}><FileText size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Contracts</span><span style={{ fontWeight: 700 }}>{cl.contracts.length}</span></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}><Users size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Total Employees</span><span style={{ fontWeight: 700, color: 'var(--primary)' }}>{EMP_COUNTS[cl.id] || cl.contracts.reduce((s, c) => s + (c.headcount || 0), 0)}</span></div>
                        </div>
                        <button onClick={() => setSelected(cl)} style={{ background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '0.6rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            Open Profile →
                        </button>
                    </div>
                ))}
            </div>

            {/* Add Client Modal */}
            {showAdd && (
                <Overlay>
                    <ModalHeader title="Add New Client" sub="Enter the client's master information" onClose={() => { setShowAdd(false); setForm(EMPTY_CLIENT); }} />
                    <div style={{ padding: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                        <FRow label="Client Name *"><FInput value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} ph="e.g. Bank Al Habib" /></FRow>
                        <FRow label="Industry"><FInput value={form.industry} onChange={e => setForm(p => ({ ...p, industry: e.target.value }))} ph="e.g. Banking & Finance" /></FRow>
                        <FRow label="Headquarters City"><FInput value={form.hq} onChange={e => setForm(p => ({ ...p, hq: e.target.value }))} ph="e.g. Karachi" /></FRow>
                        <FRow label="NTN Number"><FInput value={form.ntn} onChange={e => setForm(p => ({ ...p, ntn: e.target.value }))} ph="XXXXXXX-X" /></FRow>
                        <FRow label="STRN Number"><FInput value={form.strn} onChange={e => setForm(p => ({ ...p, strn: e.target.value }))} ph="STRN-XXXXX" /></FRow>
                    </div>
                    <div style={{ padding: '0 2rem 2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                        <button onClick={() => { setShowAdd(false); setForm(EMPTY_CLIENT); }} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={addClient} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.75rem 2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Add Client</button>
                    </div>
                </Overlay>
            )}
        </div>
    );
}
