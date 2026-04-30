import React, { useState, useEffect, useCallback } from 'react';
import { Building, Search, Plus, MapPin, Users, X, Phone, Mail, FileText, ChevronLeft, Edit2, Trash2, CheckCircle, AlertCircle, Save, BarChart2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from './api';

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
    costs: {
        eobi: 2000,           // EOBI employer (flat statutory Rs.2,000)
        life_insurance: 500,  // Life insurance per head/month
        medical_ee: 800,      // Medical premium — Employee (Self)
        medical_sp: 600,      // Medical premium — Spouse
        medical_child: 300,   // Medical premium — per Child (max 2)
        bonus_months: 1,      // Bonus = X months of gross per year
        bonus_min_months: 12, // Min service months for full bonus (0 = always pro-rata)
        uniform_cost: 300, shoes_cost: 150, ppe_cost: 200, opd: 500,
        dedicated_staff: 0, courier: 3000,
        other1_name: '', other1_amount: 0, other2_name: '', other2_amount: 0,
        // End of Service Benefit type — drives monthly EOSB accrual in payroll
        eosb_type: 'None',   // 'None' | 'Gratuity' | 'Provident Fund'
        overhead_per_employee: 0, // Fixed monthly overhead charged per employee (e.g. management fee)
    },
    financials: { wht_pct: 7, service_charges_pct: 15, credit_cycle_days: 30, invoice_segregation: 'combined' }
};

// No sample data — loaded from Neon DB

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
function ContractEditor({ contract, onSave, onCancel, allClients = [], currentClientId }) {
    const [c, setC] = useState({ ...EMPTY_CONTRACT, ...contract, costs: { ...EMPTY_CONTRACT.costs, ...(contract?.costs || {}) }, financials: { ...EMPTY_CONTRACT.financials, ...(contract?.financials || {}) }, assignedClientId: currentClientId });

    const set = (path, val) => {
        if (path.includes('.')) {
            const [grp, key] = path.split('.');
            setC(p => ({ ...p, [grp]: { ...p[grp], [key]: val } }));
        } else setC(p => ({ ...p, [path]: val }));
    };

    const costFields = [
        ['life_insurance', 'Life Insurance Premium (Rs. / head / month)'],
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
                        {allClients.length > 0 && (
                            <div style={{ gridColumn: '1/-1' }}>
                                <FRow label="Assigned Client (Reassign if needed)">
                                    <select value={c.assignedClientId || ''} onChange={e => setC(p => ({ ...p, assignedClientId: e.target.value }))} style={{ background: 'var(--bg-dark)', border: '1px solid #f59e0b', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none', width: '100%' }}>
                                        {allClients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                                    </select>
                                </FRow>
                            </div>
                        )}
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

                    {/* Medical Insurance — separate per member */}
                    <div style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', marginBottom: '0.75rem' }}>Medical Insurance Premiums (Rs./head/month)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                            <FRow label="Employee (Self)">
                                <FInput type="number" value={c.costs.medical_ee ?? 0} onChange={e => set('costs.medical_ee', parseFloat(e.target.value) || 0)} ph="0" />
                            </FRow>
                            <FRow label="Spouse">
                                <FInput type="number" value={c.costs.medical_sp ?? 0} onChange={e => set('costs.medical_sp', parseFloat(e.target.value) || 0)} ph="0" />
                            </FRow>
                            <FRow label="Per Child (max 2 covered)">
                                <FInput type="number" value={c.costs.medical_child ?? 0} onChange={e => set('costs.medical_child', parseFloat(e.target.value) || 0)} ph="0" />
                            </FRow>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Auto-applied per employee based on their HR family data. Children capped at 2.</div>
                    </div>

                    {/* Bonus policy */}
                    <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#f59e0b', marginBottom: '0.75rem' }}>Annual Bonus Policy</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <FRow label="Bonus = X months of Gross Salary">
                                <FInput type="number" value={c.costs.bonus_months ?? 1} onChange={e => set('costs.bonus_months', parseFloat(e.target.value) || 0)} ph="1" />
                            </FRow>
                            <FRow label="Min. service months for full bonus (0 = always pro-rata)">
                                <FInput type="number" value={c.costs.bonus_min_months ?? 12} onChange={e => set('costs.bonus_min_months', parseFloat(e.target.value) || 0)} ph="12" />
                            </FRow>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>e.g. 1 month bonus. If min=12, must work full year. If min=0, pro-rated from day 1. Partial year = gross × months × service_months/12.</div>
                    </div>

                    {/* Overhead Per Employee */}
                    <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#ef4444', marginBottom: '0.75rem' }}>Fixed Overhead Per Employee (Rs./head/month)</div>
                        <FRow label="Overhead Amount (added to every employee's cost)">
                            <FInput type="number" value={c.costs.overhead_per_employee ?? 0} onChange={e => set('costs.overhead_per_employee', parseFloat(e.target.value) || 0)} ph="0" />
                        </FRow>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Fixed monthly overhead per head billed to client (e.g. management fee, admin overhead). Added directly to Total Payroll Cost before service charges.</div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {costFields.map(([key, label]) => (
                            <FRow key={key} label={label}>
                                <FInput type="number" value={c.costs[key] ?? 0} onChange={e => set(`costs.${key}`, parseFloat(e.target.value) || 0)} ph="0" />
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

                {/* End of Service Benefits (EOSB) */}
                <div style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#f59e0b' }}>End of Service Benefits (EOSB)</h3>
                    <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Determines how monthly EOSB is calculated and shown in payroll &amp; invoice.</p>
                    <FRow label="EOSB / Retirement Scheme *">
                        <select value={c.costs.eosb_type || 'None'} onChange={e => set('costs.eosb_type', e.target.value)}
                            style={{ background: 'var(--bg-dark)', border: '1px solid #f59e0b', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none', width: '100%' }}>
                            <option value="None">None — No EOSB (0)</option>
                            <option value="Gratuity">Gratuity — Gross ÷ 12 per month (employer accrual only)</option>
                            <option value="Provident Fund">Provident Fund — Gross ÷ 24 employee deduction + employer match</option>
                        </select>
                    </FRow>
                    <div style={{ marginTop: '0.75rem', fontSize: '0.79rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                        {(c.costs.eosb_type || 'None') === 'None' && '⬛ No monthly EOSB accrual or employee deduction.'}
                        {c.costs.eosb_type === 'Gratuity' && '🟡 Employer accrues Gross ÷ 12 per month (8.33%). Paid at termination as Last Gross × Years of Service. No employee deduction.'}
                        {c.costs.eosb_type === 'Provident Fund' && '🟢 Employee deduction: Gross ÷ 24/month (4.17%). Employer matches Gross ÷ 24/month. Total monthly cost = Gross ÷ 12.'}
                    </div>
                </div>

                {/* Contract Financials */}
                <div style={{ background: 'var(--bg-dark)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Contract Financials &amp; Tax</h3>
                    <p style={{ margin: '0 0 1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Service Charges % is the margin applied on cost to derive the billing amount.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <FRow label="Service Charges / Margin (%)"><FInput type="number" value={c.financials.service_charges_pct} onChange={e => set('financials.service_charges_pct', parseFloat(e.target.value) || 0)} ph="e.g. 15" /></FRow>
                        <FRow label="Withholding Tax — WHT (%)"><FInput type="number" value={c.financials.wht_pct} onChange={e => set('financials.wht_pct', parseFloat(e.target.value) || 0)} ph="e.g. 7" /></FRow>
                    </div>
                    <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '8px', fontSize: '0.82rem', color: 'var(--primary)' }}>
                        🏛️ <strong>Sales Tax is province-based (auto).</strong> Rate is determined by each employee’s Province field:<br />
                        Punjab → PRA 16% &nbsp;&bull;&nbsp; Sindh → SRB 13% &nbsp;&bull;&nbsp; KPK → KPRA 15% &nbsp;&bull;&nbsp; Balochistan → BRA 15% &nbsp;&bull;&nbsp; Federal/Other → 13%
                    </div>
                </div>

                {/* Billing Settings — Credit Cycle + Invoice Segregation */}
                <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#818cf8' }}>Billing Settings</h3>
                    <p style={{ margin: '0 0 1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Controls payment terms and how invoices are split for this client.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                        <FRow label="Credit / Payment Cycle (Days)">
                            <FInput type="number" value={c.financials.credit_cycle_days ?? 30}
                                onChange={e => set('financials.credit_cycle_days', parseInt(e.target.value) || 30)} ph="30" />
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '4px' }}>Invoice date + {c.financials.credit_cycle_days ?? 30} days = Payment Due Date (auto-calculated)</div>
                        </FRow>
                    </div>
                    <FRow label="Invoice Segregation Preference">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                            {[
                                { value: 'combined',     label: 'All Payroll in One Invoice',                      hint: 'Single invoice per client/contract/month' },
                                { value: 'opd_separate', label: 'OPD + Reimbursements Separate (rest together)',   hint: '2 invoices: Core payroll and OPD/Reimb' },
                                { value: 'fully_split',  label: 'Fully Segregated: OPD | Reimb | Arrears | Core', hint: 'Up to 4 invoices with unique numbers per month' },
                            ].map(opt => (
                                <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                                    background: (c.financials.invoice_segregation || 'combined') === opt.value ? 'rgba(99,102,241,0.12)' : 'var(--bg-dark)',
                                    border: `1px solid ${(c.financials.invoice_segregation || 'combined') === opt.value ? 'rgba(99,102,241,0.5)' : 'var(--border)'}` }}>
                                    <input type="radio" name="inv_seg" value={opt.value}
                                        checked={(c.financials.invoice_segregation || 'combined') === opt.value}
                                        onChange={() => set('financials.invoice_segregation', opt.value)}
                                        style={{ marginTop: '2px', accentColor: '#818cf8' }} />
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{opt.label}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{opt.hint}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </FRow>
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

const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_NAMES_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const fmt = n => Math.round(parseFloat(n)||0).toLocaleString('en-PK');
const Rs  = n => `Rs. ${fmt(n)}`;

// ── Contract Bid Tracking Panel ──────────────────────────────────────────────
function ContractBidPanel({ contract }) {
    const [bidItems,    setBidItems]    = useState([]);
    const [actuals,     setActuals]     = useState([]);    // flat array from API
    const [loading,     setLoading]     = useState(true);
    const [year,        setYear]        = useState(new Date().getFullYear());
    const [showAddItem, setShowAddItem] = useState(false);
    const [editItem,    setEditItem]    = useState(null);
    const [newItem,     setNewItem]     = useState({ item_name: '', unit: 'Nos', bid_qty: '', bid_unit_price: '', notes: '' });
    // Monthly actual entry
    const [actualModal, setActualModal] = useState(null); // { month, existing }
    const [actualForm,  setActualForm]  = useState({ total_amount: '', notes: '', is_itemized: false, items: [] });
    const [saving,      setSaving]      = useState(false);
    const [error,       setError]       = useState(null);

    const loadData = useCallback(async () => {
        if (!contract?.id) return;
        setLoading(true);
        try {
            const [bi, ac] = await Promise.all([
                api.getBidItems(contract.id),
                api.getBidActuals(contract.id, year),
            ]);
            setBidItems(bi.items || []);
            setActuals(ac.actuals || []);
        } catch (e) { setError(e.message); }
        setLoading(false);
    }, [contract?.id, year]);

    useEffect(() => { loadData(); }, [loadData]);

    // Group actuals by month
    const actualByMonth = {};
    actuals.forEach(a => { actualByMonth[a.month] = a; });

    // Budget totals
    const totalBidValue = bidItems.reduce((s, i) => s + (parseFloat(i.bid_qty)||0) * (parseFloat(i.bid_unit_price)||0), 0);
    const totalActualYTD = actuals.reduce((s, a) => s + (parseFloat(a.total_amount)||0), 0);
    const variance = totalBidValue - totalActualYTD;

    const saveItem = async () => {
        if (!newItem.item_name) { setError('Item name required'); return; }
        setSaving(true); setError(null);
        try {
            if (editItem) {
                await api.updateBidItem(contract.id, editItem.id, newItem);
            } else {
                await api.createBidItem(contract.id, newItem);
            }
            await loadData();
            setShowAddItem(false); setEditItem(null);
            setNewItem({ item_name: '', unit: 'Nos', bid_qty: '', bid_unit_price: '', notes: '' });
        } catch (e) { setError(e.message); }
        setSaving(false);
    };

    const deleteItem = async (id) => {
        if (!window.confirm('Delete this bid item?')) return;
        try { await api.deleteBidItem(contract.id, id); await loadData(); }
        catch (e) { alert(e.message); }
    };

    const openActualModal = (monthIdx) => {
        const existing = actualByMonth[monthIdx + 1];
        setActualForm({
            total_amount: existing?.total_amount || '',
            notes: existing?.notes || '',
            is_itemized: !!existing?.line_items?.length,
            items: existing?.line_items?.length
                ? existing.line_items
                : bidItems.map(bi => ({ bid_item_id: bi.id, item_name: bi.item_name, unit: bi.unit, qty: '', unit_price: bi.bid_unit_price || '', amount: '' })),
        });
        setActualModal({ month: monthIdx + 1, monthName: MONTH_NAMES_FULL[monthIdx], existing });
    };

    const saveActual = async () => {
        setSaving(true); setError(null);
        try {
            let total = parseFloat(actualForm.total_amount) || 0;
            let lineItems = null;
            if (actualForm.is_itemized) {
                lineItems = actualForm.items.filter(i => parseFloat(i.amount) > 0);
                total = lineItems.reduce((s, i) => s + (parseFloat(i.amount)||0), 0);
            }
            await api.upsertBidActual(contract.id, {
                month: actualModal.month,
                year,
                total_amount: total,
                notes: actualForm.notes,
                line_items: lineItems,
            });
            await loadData();
            setActualModal(null);
        } catch (e) { setError(e.message); }
        setSaving(false);
    };

    const updateActualItem = (i, k, v) => {
        setActualForm(p => {
            const items = [...p.items];
            items[i] = { ...items[i], [k]: v };
            if (k === 'qty' || k === 'unit_price') {
                items[i].amount = String((parseFloat(items[i].qty)||0) * (parseFloat(items[i].unit_price)||0));
            }
            return { ...p, items };
        });
    };

    const inpStyle = { background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '7px 10px', color: 'var(--text)', fontSize: '0.85rem', outline: 'none', width: '100%', boxSizing: 'border-box' };

    if (!contract?.id) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Select a contract to view bid tracking.</div>;

    return (
        <div>
            {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', color: '#f87171', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                    {error} <button onClick={() => setError(null)} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer' }}><X size={14} /></button>
                </div>
            )}

            {/* ── Summary Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    { l: 'Total Bid Value',    v: Rs(totalBidValue),   c: 'var(--primary)' },
                    { l: `Actual YTD (${year})`, v: Rs(totalActualYTD), c: '#f59e0b' },
                    { l: 'Remaining Budget',   v: Rs(Math.max(0, variance)), c: variance >= 0 ? '#22c55e' : '#ef4444' },
                    { l: 'Bid Line Items',     v: bidItems.length,     c: '#a78bfa' },
                ].map(card => (
                    <div key={card.l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '0.9rem 1.1rem' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{card.l}</div>
                        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: card.c }}>{card.v}</div>
                    </div>
                ))}
            </div>

            {/* ── Section 1: Bid Items Master ── */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', marginBottom: '1.5rem', overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-dark)' }}>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f0f4f8' }}>📋 Bid Items — Contract Schedule of Rates</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Items, quantities and unit prices as per the original bid / tender</div>
                    </div>
                    <button onClick={() => { setShowAddItem(true); setEditItem(null); setNewItem({ item_name: '', unit: 'Nos', bid_qty: '', bid_unit_price: '', notes: '' }); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)', border: 'none', color: 'white', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }}>
                        <Plus size={14} /> Add Item
                    </button>
                </div>

                {loading ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading bid items…</div>
                ) : bidItems.length === 0 ? (
                    <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <BarChart2 size={36} style={{ opacity: 0.25, marginBottom: '0.75rem', display: 'block', margin: '0 auto 0.75rem' }} />
                        <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>No bid items yet</div>
                        <div style={{ fontSize: '0.82rem' }}>Add the items, quantities and prices from your contract bid / Schedule of Rates.</div>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
                            <tr>{['Item / Description','Unit','Bid Qty','Unit Price (Rs.)','Total Bid Value','Notes',''].map(h => (
                                <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Bid Qty' || h === 'Unit Price (Rs.)' || h === 'Total Bid Value' ? 'right' : 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}</tr>
                        </thead>
                        <tbody>
                            {bidItems.map((item, i) => {
                                const lineVal = (parseFloat(item.bid_qty)||0) * (parseFloat(item.bid_unit_price)||0);
                                return (
                                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                                        <td style={{ padding: '8px 12px', fontWeight: 600, color: '#f0f4f8' }}>{item.item_name}</td>
                                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{item.unit}</td>
                                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(item.bid_qty)}</td>
                                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt(item.bid_unit_price)}</td>
                                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>{Rs(lineVal)}</td>
                                        <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '0.78rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.notes || '—'}</td>
                                        <td style={{ padding: '8px 12px' }}>
                                            <div style={{ display: 'flex', gap: '5px' }}>
                                                <button onClick={() => { setEditItem(item); setNewItem({ item_name: item.item_name, unit: item.unit, bid_qty: item.bid_qty, bid_unit_price: item.bid_unit_price, notes: item.notes || '' }); setShowAddItem(true); }}
                                                    style={{ background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '3px 8px', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem' }}><Edit2 size={11} /></button>
                                                <button onClick={() => deleteItem(item.id)}
                                                    style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '3px 8px', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem' }}><Trash2 size={11} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot style={{ background: 'var(--bg-dark)', borderTop: '2px solid var(--border)' }}>
                            <tr>
                                <td colSpan={4} style={{ padding: '8px 12px', fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-muted)' }}>TOTAL BID VALUE</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 900, color: 'var(--primary)', fontSize: '0.95rem' }}>{Rs(totalBidValue)}</td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    </table>
                )}
            </div>

            {/* ── Section 2: Monthly Actuals ── */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-dark)' }}>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f0f4f8' }}>📅 Monthly Delivery Actuals — Procurement Entries</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Procurement team logs actual items/costs delivered each month</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <select value={year} onChange={e => setYear(parseInt(e.target.value))}
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: '6px', fontSize: '0.82rem', cursor: 'pointer' }}>
                            {[2024,2025,2026,2027].map(y => <option key={y}>{y}</option>)}
                        </select>
                        <button onClick={loadData} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.82rem' }}>
                            <RefreshCw size={12} /> Refresh
                        </button>
                    </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
                            <tr>{['Month','Actual Amount (Rs.)','vs Budget','Status','Notes','Action'].map(h => (
                                <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Actual Amount (Rs.)' || h === 'vs Budget' ? 'right' : 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}</tr>
                        </thead>
                        <tbody>
                            {MONTH_NAMES_SHORT.map((mo, idx) => {
                                const actual = actualByMonth[idx + 1];
                                const amt = parseFloat(actual?.total_amount) || 0;
                                const monthBudget = totalBidValue / 12;
                                const diff = monthBudget - amt;
                                const pct = monthBudget > 0 ? (amt / monthBudget * 100).toFixed(0) : null;
                                return (
                                    <tr key={mo} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '9px 12px', fontWeight: 600, color: '#f0f4f8' }}>{MONTH_NAMES_FULL[idx]} {year}</td>
                                        <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: actual ? 700 : 400, color: actual ? '#22c55e' : 'var(--text-muted)' }}>
                                            {actual ? Rs(amt) : '—'}
                                        </td>
                                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                                            {actual && pct ? (
                                                <span style={{ color: diff >= 0 ? '#22c55e' : '#f87171', fontSize: '0.78rem', fontWeight: 700 }}>
                                                    {diff >= 0 ? `▼ ${Rs(diff)} under` : `▲ ${Rs(Math.abs(diff))} over`} ({pct}%)
                                                </span>
                                            ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '9px 12px' }}>
                                            {actual?.line_items?.length > 0 && (
                                                <span style={{ fontSize: '0.72rem', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', padding: '2px 7px', borderRadius: '10px', fontWeight: 700 }}>Itemized</span>
                                            )}
                                            {actual && !actual?.line_items?.length && (
                                                <span style={{ fontSize: '0.72rem', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', padding: '2px 7px', borderRadius: '10px', fontWeight: 700 }}>Lump Sum</span>
                                            )}
                                            {!actual && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Not entered</span>}
                                        </td>
                                        <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontSize: '0.78rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{actual?.notes || '—'}</td>
                                        <td style={{ padding: '9px 12px' }}>
                                            <button onClick={() => openActualModal(idx)}
                                                style={{ background: actual ? 'rgba(245,158,11,0.1)' : 'rgba(56,189,248,0.1)', border: `1px solid ${actual ? 'rgba(245,158,11,0.3)' : 'rgba(56,189,248,0.3)'}`, color: actual ? '#f59e0b' : '#38bdf8', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                                                {actual ? '✏ Edit' : '+ Enter'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot style={{ background: 'var(--bg-dark)', borderTop: '2px solid var(--border)' }}>
                            <tr>
                                <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-muted)' }}>YTD TOTAL {year}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 900, color: '#f59e0b', fontSize: '0.95rem' }}>{Rs(totalActualYTD)}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                                    <span style={{ color: variance >= 0 ? '#22c55e' : '#f87171', fontWeight: 700, fontSize: '0.82rem' }}>
                                        {variance >= 0 ? `▼ ${Rs(variance)} under budget` : `▲ ${Rs(Math.abs(variance))} over budget`}
                                    </span>
                                </td>
                                <td colSpan={3} />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* ── Add/Edit Bid Item Modal ── */}
            {showAddItem && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '2rem' }}>
                    <div style={{ background: '#0f1823', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', width: '100%', maxWidth: '520px' }}>
                        <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontSize: '1rem', color: '#f0f4f8' }}>{editItem ? 'Edit Bid Item' : 'Add Bid Item'}</h3>
                            <button onClick={() => { setShowAddItem(false); setEditItem(null); }} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={18} /></button>
                        </div>
                        <div style={{ padding: '1.5rem 1.75rem', display: 'grid', gap: '0.85rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>Item / Description *</label>
                                <input value={newItem.item_name} onChange={e => setNewItem(p => ({ ...p, item_name: e.target.value }))} placeholder="e.g. Cleaning Chemical (Floor Cleaner)" style={inpStyle} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>Unit</label>
                                    <select value={newItem.unit} onChange={e => setNewItem(p => ({ ...p, unit: e.target.value }))} style={inpStyle}>
                                        {['Nos','Kg','Litre','Box','Pack','Set','Roll','Month','Lump Sum'].map(u => <option key={u}>{u}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>Bid Qty</label>
                                    <input type="number" value={newItem.bid_qty} onChange={e => setNewItem(p => ({ ...p, bid_qty: e.target.value }))} placeholder="0" style={inpStyle} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>Unit Price (Rs.)</label>
                                    <input type="number" value={newItem.bid_unit_price} onChange={e => setNewItem(p => ({ ...p, bid_unit_price: e.target.value }))} placeholder="0" style={inpStyle} />
                                </div>
                            </div>
                            {newItem.bid_qty && newItem.bid_unit_price && (
                                <div style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Total Bid Line Value</span>
                                    <strong style={{ color: 'var(--primary)' }}>{Rs((parseFloat(newItem.bid_qty)||0)*(parseFloat(newItem.bid_unit_price)||0))}</strong>
                                </div>
                            )}
                            <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>Notes (optional)</label>
                                <input value={newItem.notes} onChange={e => setNewItem(p => ({ ...p, notes: e.target.value }))} placeholder="Any notes on this item..." style={inpStyle} />
                            </div>
                            {error && <div style={{ color: '#f87171', fontSize: '0.82rem' }}>{error}</div>}
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                                <button onClick={() => { setShowAddItem(false); setEditItem(null); }} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '9px', borderRadius: '7px', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={saveItem} disabled={saving} style={{ flex: 2, background: saving ? '#334155' : 'var(--primary)', border: 'none', color: 'white', padding: '9px', borderRadius: '7px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
                                    {saving ? 'Saving…' : editItem ? 'Save Changes' : 'Add Item'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Monthly Actual Entry Modal ── */}
            {actualModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '2rem', overflowY: 'auto' }}>
                    <div style={{ background: '#0f1823', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', width: '100%', maxWidth: '680px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#0f1823', zIndex: 2 }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1rem', color: '#f0f4f8' }}>Procurement Entry — {actualModal.monthName} {year}</h3>
                                <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#64748b' }}>Log supplies delivered/purchased this month against this contract</p>
                            </div>
                            <button onClick={() => setActualModal(null)} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={18} /></button>
                        </div>
                        <div style={{ padding: '1.5rem 1.75rem' }}>
                            {/* Toggle: lump sum vs itemized */}
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
                                <button onClick={() => setActualForm(p => ({ ...p, is_itemized: false }))}
                                    style={{ flex: 1, padding: '8px', borderRadius: '7px', border: `1px solid ${!actualForm.is_itemized ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}`, background: !actualForm.is_itemized ? 'rgba(56,189,248,0.1)' : 'transparent', color: !actualForm.is_itemized ? 'var(--primary)' : '#64748b', cursor: 'pointer', fontWeight: 700, fontSize: '0.83rem' }}>
                                    💰 Lump Sum Total
                                </button>
                                <button onClick={() => setActualForm(p => ({
                                    ...p, is_itemized: true,
                                    items: p.items.length ? p.items : bidItems.map(bi => ({ bid_item_id: bi.id, item_name: bi.item_name, unit: bi.unit, qty: '', unit_price: bi.bid_unit_price || '', amount: '' }))
                                }))}
                                    style={{ flex: 1, padding: '8px', borderRadius: '7px', border: `1px solid ${actualForm.is_itemized ? '#22c55e' : 'rgba(255,255,255,0.1)'}`, background: actualForm.is_itemized ? 'rgba(34,197,94,0.1)' : 'transparent', color: actualForm.is_itemized ? '#22c55e' : '#64748b', cursor: 'pointer', fontWeight: 700, fontSize: '0.83rem' }}>
                                    📋 Itemized Breakdown
                                </button>
                            </div>

                            {!actualForm.is_itemized ? (
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '5px' }}>Total Amount (Rs.) *</label>
                                    <input type="number" value={actualForm.total_amount} onChange={e => setActualForm(p => ({ ...p, total_amount: e.target.value }))} placeholder="Total amount for this month" style={{ ...inpStyle, fontSize: '1.1rem', fontWeight: 700 }} />
                                </div>
                            ) : (
                                <div style={{ marginBottom: '1rem' }}>
                                    <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Item-wise Deliveries</div>
                                    {actualForm.items.map((li, i) => (
                                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 100px 100px', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                                            <div style={{ fontSize: '0.82rem', color: '#94a3b8', padding: '6px 0' }}>{li.item_name}</div>
                                            <input type="number" value={li.qty} onChange={e => updateActualItem(i, 'qty', e.target.value)} placeholder="Qty" style={{ ...inpStyle, padding: '6px 8px', textAlign: 'right' }} />
                                            <input type="number" value={li.unit_price} onChange={e => updateActualItem(i, 'unit_price', e.target.value)} placeholder="Unit Price" style={{ ...inpStyle, padding: '6px 8px', textAlign: 'right' }} />
                                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--primary)', textAlign: 'right', padding: '6px 0' }}>{Rs(li.amount || 0)}</div>
                                        </div>
                                    ))}
                                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.25rem', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>TOTAL</span>
                                        <span style={{ color: '#22c55e', fontSize: '0.95rem' }}>{Rs(actualForm.items.reduce((s,li) => s + (parseFloat(li.amount)||0), 0))}</span>
                                    </div>
                                </div>
                            )}

                            <div style={{ marginBottom: '1.25rem' }}>
                                <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '5px' }}>Notes (optional)</label>
                                <textarea value={actualForm.notes} onChange={e => setActualForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Any notes about this month's delivery or purchase…" style={{ ...inpStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                            </div>

                            {error && <div style={{ color: '#f87171', fontSize: '0.82rem', marginBottom: '0.75rem' }}>{error}</div>}

                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button onClick={() => setActualModal(null)} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '10px', borderRadius: '7px', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={saveActual} disabled={saving} style={{ flex: 2, background: saving ? '#334155' : '#22c55e', border: 'none', color: 'white', padding: '10px', borderRadius: '7px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
                                    <CheckCircle size={15} style={{ marginRight: '6px', verticalAlign: 'middle' }} />{saving ? 'Saving…' : 'Save Procurement Entry'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Client Profile View ──────────────────────────────────────────────────────
function ClientProfile({ client, onChange, onBack, allClients = [], onContractReassigned }) {
    const [tab, setTab] = useState('overview');
    const [editContract, setEditContract] = useState(null);
    const [viewContract, setViewContract] = useState(null);
    const [bidContract,  setBidContract]  = useState(null); // which contract is open in bid tab
    const [showAddContact, setShowAddContact] = useState(false);
    const [newContact, setNewContact] = useState(EMPTY_CONTACT);

    const saveContract = async (ct) => {
        // Handle client reassignment
        if (ct.assignedClientId && ct.assignedClientId !== client.id && ct.id) {
            if (!window.confirm(`Move this contract to "${allClients.find(c => c.id === ct.assignedClientId)?.name}"?`)) return;
            try {
                await api.reassignContract(ct.id, ct.assignedClientId);
                // Remove from current client
                onChange({ ...client, contracts: client.contracts.filter(c => c.id !== ct.id) });
                if (onContractReassigned) onContractReassigned();
                setEditContract(null);
                return;
            } catch (err) { alert('Reassign failed: ' + err.message); return; }
        }
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

    const deleteContract = async (id) => {
        if (!window.confirm('Permanently delete this contract?')) return;
        try {
            await api.deleteContract(id);
            onChange({ ...client, contracts: client.contracts.filter(c => c.id !== id) });
        } catch (err) { alert('Delete failed: ' + err.message); }
    };

    const addContact = () => {
        onChange({ ...client, contacts: [...client.contacts, { ...newContact, id: `ct-${Date.now()}` }] });
        setNewContact(EMPTY_CONTACT); setShowAddContact(false);
    };

    const TABS = ['overview', 'contacts', 'contracts', 'bid tracking'];

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
            <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '2rem', overflowX: 'auto' }}>
                {TABS.map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{ padding: '0.85rem 1.75rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t ? 'var(--primary)' : 'transparent'}`, color: tab === t ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: tab === t ? 700 : 400, fontSize: '0.9rem', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                        {t === 'bid tracking' ? '📊 Bid Tracking' : t.charAt(0).toUpperCase() + t.slice(1)}
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
                                    {ct.costs?.eosb_type && ct.costs.eosb_type !== 'None' && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginTop: '5px', padding: '2px 10px', borderRadius: '10px', fontSize: '0.75rem', fontWeight: 700,
                                            background: ct.costs.eosb_type === 'Provident Fund' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                                            color: ct.costs.eosb_type === 'Provident Fund' ? '#22c55e' : '#f59e0b',
                                            border: `1px solid ${ct.costs.eosb_type === 'Provident Fund' ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
                                            {ct.costs.eosb_type === 'Provident Fund' ? '🟢' : '🟡'} EOSB: {ct.costs.eosb_type}
                                        </span>
                                    )}
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
                                        {[
                                            ['WHT', ct.financials?.wht_pct + '%'],
                                            ['Sales Tax', 'Province-based (auto)'],
                                            ['Service Charges / Margin', ct.financials?.service_charges_pct + '%'],
                                            ['EOSB Type', ct.costs?.eosb_type || 'None'],
                                        ].map(([l, v]) => (
                                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', padding: '3px 0' }}>
                                                <span style={{ color: 'var(--text-muted)' }}>{l}</span>
                                                <span style={{ fontWeight: 600, color: l === 'EOSB Type' ? (v === 'Provident Fund' ? '#22c55e' : v === 'Gratuity' ? '#f59e0b' : 'var(--text-muted)') : 'var(--primary)' }}>{v}</span>
                                            </div>
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
            {editContract && <ContractEditor contract={editContract} onSave={saveContract} onCancel={() => setEditContract(null)} allClients={allClients} currentClientId={client.id} />}

            {/* Bid Tracking Tab */}
            {tab === 'bid tracking' && (
                <div>
                    {!bidContract && (
                        <div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Select a contract to view and manage bid tracking:</div>
                            {client.contracts.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No contracts for this client yet.</p>}
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                {client.contracts.map(ct => (
                                    <button key={ct.id} onClick={() => setBidContract(ct)}
                                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem 1.25rem', cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s' }}
                                        onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--primary)'}
                                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                                        <div>
                                            <div style={{ fontWeight: 700, color: '#f0f4f8', marginBottom: '3px' }}>{ct.contractName || ct.id}</div>
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{ct.id} · {ct.serviceType} · {ct.location}</div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '0.75rem', background: (ST_CLR[ct.status]||'#94a3b8') + '20', color: ST_CLR[ct.status]||'#94a3b8', padding: '3px 8px', borderRadius: '8px', fontWeight: 700 }}>{ct.status}</span>
                                            <ChevronRight size={16} color="var(--text-muted)" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {bidContract && (
                        <div>
                            <button onClick={() => setBidContract(null)}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '1.25rem', fontSize: '0.88rem', padding: 0 }}>
                                <ChevronLeft size={16} /> Back to contract list
                            </button>
                            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontWeight: 700, color: '#f0f4f8' }}>{bidContract.contractName || bidContract.id}</div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{bidContract.id} · {bidContract.serviceType} · {bidContract.location}</div>
                                </div>
                                <span style={{ fontSize: '0.75rem', background: (ST_CLR[bidContract.status]||'#94a3b8') + '20', color: ST_CLR[bidContract.status]||'#94a3b8', padding: '3px 10px', borderRadius: '10px', fontWeight: 700 }}>{bidContract.status}</span>
                            </div>
                            <ContractBidPanel contract={bidContract} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Main ClientInformation ───────────────────────────────────────────────────
export default function ClientInformation() {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState(EMPTY_CLIENT);
    const [editingClient, setEditingClient] = useState(null); // client being edited
    const [editForm, setEditForm] = useState(EMPTY_CLIENT);

    const loadClients = () => {
        setLoading(true);
        api.getClients()
            .then(data => { setClients(data.clients); setLoading(false); })
            .catch(() => setLoading(false));
    };

    // ── Load clients from DB on mount ─────────────────────────────────────
    useEffect(() => { loadClients(); }, []);

    const updateClient = async (updated) => {
        setClients(p => p.map(c => c.id === updated.id ? updated : c));
        setSelected(updated);
        try { await api.updateClient(updated.id, updated); } catch (err) { console.error('Sync error:', err.message); }
    };

    const deleteClient = async (cl) => {
        if (!window.confirm(`Delete client "${cl.name}" and ALL their contracts? This cannot be undone.`)) return;
        try {
            await api.deleteClient(cl.id);
            setClients(p => p.filter(c => c.id !== cl.id));
            if (selected?.id === cl.id) setSelected(null);
        } catch (err) { alert('Delete failed: ' + err.message); }
    };

    const openEditClient = (cl, e) => {
        e.stopPropagation();
        setEditingClient(cl);
        setEditForm({ name: cl.name, hq: cl.hq || '', ntn: cl.ntn || '', strn: cl.strn || '', industry: cl.industry || '' });
    };

    const saveEditClient = async () => {
        if (!editForm.name) return alert('Client name is required.');
        try {
            const updated = { ...editingClient, ...editForm };
            await api.updateClient(editingClient.id, updated);
            setClients(p => p.map(c => c.id === editingClient.id ? updated : c));
            if (selected?.id === editingClient.id) setSelected(updated);
            setEditingClient(null);
        } catch (err) { alert('Save failed: ' + err.message); }
    };

    const addClient = async () => {
        if (!form.name) return alert('Client name is required.');
        try {
            const data = await api.createClient({ ...form, id: `CLT-${Date.now()}`, contacts: [], contracts: [] });
            setClients(p => [...p, data.client]);
            setForm(EMPTY_CLIENT); setShowAdd(false);
        } catch (err) { alert('Save failed: ' + err.message); }
    };

    if (selected) return <ClientProfile client={selected} onChange={updateClient} onBack={() => setSelected(null)} allClients={clients} onContractReassigned={loadClients} />;

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
                        {/* Action row */}
                        <div style={{ display: 'flex', gap: '0.6rem' }}>
                            <button onClick={(e) => openEditClient(cl, e)} title="Edit Client" style={{ flex: '0 0 auto', background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '0.55rem 0.9rem', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem', fontWeight: 600 }}>
                                <Edit2 size={14} /> Edit
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); deleteClient(cl); }} title="Delete Client" style={{ flex: '0 0 auto', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '0.55rem 0.9rem', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem' }}>
                                <Trash2 size={14} />
                            </button>
                            <button onClick={() => setSelected(cl)} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '0.55rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                Open Profile →
                            </button>
                        </div>
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

            {/* Edit Client Modal */}
            {editingClient && (
                <Overlay>
                    <ModalHeader title={`Edit Client: ${editingClient.name}`} sub="Update the client's master information" onClose={() => setEditingClient(null)} />
                    <div style={{ padding: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                        <FRow label="Client Name *"><FInput value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} ph="e.g. Bank Al Habib" /></FRow>
                        <FRow label="Industry"><FInput value={editForm.industry} onChange={e => setEditForm(p => ({ ...p, industry: e.target.value }))} ph="e.g. Banking &amp; Finance" /></FRow>
                        <FRow label="Headquarters City"><FInput value={editForm.hq} onChange={e => setEditForm(p => ({ ...p, hq: e.target.value }))} ph="e.g. Karachi" /></FRow>
                        <FRow label="NTN Number"><FInput value={editForm.ntn} onChange={e => setEditForm(p => ({ ...p, ntn: e.target.value }))} ph="XXXXXXX-X" /></FRow>
                        <FRow label="STRN Number"><FInput value={editForm.strn} onChange={e => setEditForm(p => ({ ...p, strn: e.target.value }))} ph="STRN-XXXXX" /></FRow>
                    </div>
                    <div style={{ padding: '0 2rem 2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                        <button onClick={() => setEditingClient(null)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={saveEditClient} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.75rem 2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Save size={16} /> Save Changes
                        </button>
                    </div>
                </Overlay>
            )}
        </div>
    );
}
