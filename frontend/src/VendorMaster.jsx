import React, { useState, useEffect, useCallback } from 'react';
import { Truck, Search, Plus, X, Save, Edit2, Trash2, ChevronLeft,
         CheckCircle, AlertCircle, Phone, Mail, Building, CreditCard,
         DollarSign, Shield, Users, FileText, Eye, ToggleLeft, ToggleRight } from 'lucide-react';
import { api } from './api';

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = [
    'Supply of Goods', 'Services', 'Execution of Contract / Works',
    'IT Services', 'Advertising Services', 'Transport / Freight',
    'Electricity & Gas', 'Cleaning & Janitorial', 'PPE & Safety Equipment',
    'Uniform & Clothing Supply', 'Office Supplies & Stationery',
    'Security Services', 'Catering & Food', 'Fuel & Petroleum',
    'Construction & Civil Works', 'Other',
];

const EMPTY_VENDOR = {
    name: '', category: '', ntn: '', strn: '', cnic: '',
    address: '', contact_person: '', phone: '', email: '',
    bank_name: '', bank_account: '', account_title: '',
    is_filer: true, is_active: true, payment_terms: 'Net 30', notes: '',
};

const Rs = n => `Rs. ${(parseFloat(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = d => d ? String(d).slice(0, 10) : '—';

// ─── Shared UI Helpers ────────────────────────────────────────────────────────
const Overlay = ({ children, wide = false }) => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '1.5rem', overflowY: 'auto' }}>
        <div style={{ background: 'var(--bg-card)', borderRadius: '16px', width: '100%',
            maxWidth: wide ? '1100px' : '720px', border: '1px solid var(--border)', marginBottom: '2rem' }}>
            {children}
        </div>
    </div>
);

const ModalHeader = ({ title, sub, onClose }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
        <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {sub && <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>{sub}</p>}
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={24} />
        </button>
    </div>
);

const SectionTitle = ({ label }) => (
    <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.09em', color: 'var(--primary)', margin: '1.5rem 0 0.75rem',
        paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)' }}>
        {label}
    </div>
);

const FRow = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        {children}
    </div>
);

const FInput = ({ value, onChange, ph = '', type = 'text', disabled = false }) => (
    <input type={type} value={value ?? ''} placeholder={ph} onChange={onChange}
        disabled={disabled}
        style={{ background: disabled ? 'rgba(255,255,255,0.02)' : 'var(--bg-dark)',
            border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px',
            color: 'var(--text)', fontSize: '0.88rem', outline: 'none', width: '100%', boxSizing: 'border-box' }} />
);

const FSelect = ({ value, onChange, opts }) => (
    <select value={value ?? ''} onChange={onChange}
        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px',
            padding: '8px 10px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none', width: '100%' }}>
        {opts.map(o => <option key={o}>{o}</option>)}
    </select>
);

// ─── WHT rate lookup (from FBR defaults — overridden by vendor's category) ────
const DEFAULT_WHT = {
    'Supply of Goods': { filer: 4, nonFiler: 8 },
    'Services': { filer: 8, nonFiler: 16 },
    'Execution of Contract / Works': { filer: 7, nonFiler: 7 },
    'IT Services': { filer: 8, nonFiler: 16 },
    'Advertising Services': { filer: 10, nonFiler: 20 },
    'Transport / Freight': { filer: 2, nonFiler: 4 },
    'Electricity & Gas': { filer: 7.5, nonFiler: 10 },
    'Cleaning & Janitorial': { filer: 8, nonFiler: 16 },
    'PPE & Safety Equipment': { filer: 4, nonFiler: 8 },
    'Uniform & Clothing Supply': { filer: 4, nonFiler: 8 },
    'Office Supplies & Stationery': { filer: 4, nonFiler: 8 },
    'Security Services': { filer: 8, nonFiler: 16 },
    'Catering & Food': { filer: 8, nonFiler: 16 },
    'Fuel & Petroleum': { filer: 4, nonFiler: 8 },
    'Construction & Civil Works': { filer: 7, nonFiler: 7 },
};

function getWHT(vendor) {
    const rates = DEFAULT_WHT[vendor.category] || { filer: 8, nonFiler: 16 };
    return vendor.is_filer ? rates.filer : rates.nonFiler;
}

// ─── Vendor Editor Modal ───────────────────────────────────────────────────────
function VendorEditor({ vendor, onSave, onCancel }) {
    const [form, setForm] = useState({ ...EMPTY_VENDOR, ...vendor });
    const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

    const save = () => {
        if (!form.name.trim()) return alert('Vendor name is required.');
        onSave(form);
    };

    const whtRate = getWHT(form);

    return (
        <Overlay wide>
            <ModalHeader
                title={vendor?.id ? `Edit Vendor: ${vendor.name}` : 'Register New Vendor'}
                sub="Maintain complete vendor profile including tax status for accurate WHT calculation"
                onClose={onCancel}
            />
            <div style={{ padding: '1.5rem 2rem 2rem', overflowY: 'auto', maxHeight: '75vh' }}>

                {/* Filer/Non-Filer Toggle — prominent */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '1rem 1.25rem',
                    background: form.is_filer ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${form.is_filer ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    borderRadius: '12px', marginBottom: '0.5rem' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: form.is_filer ? '#22c55e' : '#ef4444' }}>
                            FBR Status: {form.is_filer ? '✅ Active Filer' : '⚠️ Non-Filer'}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            WHT rate for "{form.category || 'Select category'}" → <strong style={{ color: 'var(--text)' }}>{whtRate}%</strong>
                            {!form.is_filer && <span style={{ color: '#ef4444', marginLeft: '8px' }}>(Non-Filer: doubled WHT applies)</span>}
                        </div>
                    </div>
                    <button onClick={() => set('is_filer', !form.is_filer)}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'transparent',
                            border: `1px solid ${form.is_filer ? '#22c55e' : '#ef4444'}`,
                            color: form.is_filer ? '#22c55e' : '#ef4444',
                            borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                        {form.is_filer ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                        {form.is_filer ? 'Mark as Non-Filer' : 'Mark as Filer'}
                    </button>
                    <button onClick={() => set('is_active', !form.is_active)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent',
                            border: `1px solid ${form.is_active ? 'var(--border)' : '#f59e0b'}`,
                            color: form.is_active ? 'var(--text-muted)' : '#f59e0b',
                            borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                        {form.is_active ? '🟢 Active' : '🔴 Inactive'}
                    </button>
                </div>

                {/* Basic Info */}
                <SectionTitle label="Vendor Identity" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                    <div style={{ gridColumn: '1/-1' }}>
                        <FRow label="Vendor / Supplier Name *"><FInput value={form.name} onChange={e => set('name', e.target.value)} ph="e.g. Al-Madina Uniforms (Pvt.) Ltd." /></FRow>
                    </div>
                    <FRow label="Service Category"><FSelect value={form.category} onChange={e => set('category', e.target.value)} opts={CATEGORIES} /></FRow>
                    <FRow label="NTN Number"><FInput value={form.ntn} onChange={e => set('ntn', e.target.value)} ph="XXXXXXX-X" /></FRow>
                    <FRow label="STRN Number"><FInput value={form.strn} onChange={e => set('strn', e.target.value)} ph="STRN-XXXXX" /></FRow>
                    <FRow label="CNIC (Proprietor)"><FInput value={form.cnic} onChange={e => set('cnic', e.target.value)} ph="XXXXX-XXXXXXX-X" /></FRow>
                    <div style={{ gridColumn: '2/-1' }}>
                        <FRow label="Address"><FInput value={form.address} onChange={e => set('address', e.target.value)} ph="Full registered address" /></FRow>
                    </div>
                </div>

                {/* Contact */}
                <SectionTitle label="Contact Details" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                    <FRow label="Contact Person"><FInput value={form.contact_person} onChange={e => set('contact_person', e.target.value)} ph="Name" /></FRow>
                    <FRow label="Phone / WhatsApp"><FInput value={form.phone} onChange={e => set('phone', e.target.value)} ph="0300-XXXXXXX" /></FRow>
                    <FRow label="Email Address"><FInput value={form.email} onChange={e => set('email', e.target.value)} ph="vendor@email.com" /></FRow>
                    <FRow label="Payment Terms"><FInput value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)} ph="e.g. Net 30" /></FRow>
                </div>

                {/* Banking */}
                <SectionTitle label="Banking Details" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                    <FRow label="Bank Name"><FInput value={form.bank_name} onChange={e => set('bank_name', e.target.value)} ph="e.g. HBL" /></FRow>
                    <FRow label="Account Number"><FInput value={form.bank_account} onChange={e => set('bank_account', e.target.value)} ph="Account number" /></FRow>
                    <FRow label="Account Title"><FInput value={form.account_title} onChange={e => set('account_title', e.target.value)} ph="Title on account" /></FRow>
                </div>

                {/* Notes */}
                <SectionTitle label="Internal Notes" />
                <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                    placeholder="Any internal notes about this vendor..."
                    style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)',
                        borderRadius: '8px', padding: '10px 12px', color: 'var(--text)', fontSize: '0.88rem',
                        resize: 'vertical', minHeight: '68px', outline: 'none', boxSizing: 'border-box' }} />

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                    <button onClick={onCancel} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)',
                        color: 'var(--text)', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>
                        Cancel
                    </button>
                    <button onClick={save} style={{ background: 'var(--primary)', border: 'none', color: 'white',
                        padding: '0.75rem 2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700,
                        display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Save size={16} /> {vendor?.id ? 'Save Changes' : 'Register Vendor'}
                    </button>
                </div>
            </div>
        </Overlay>
    );
}

// ─── Payment Modal ──────────────────────────────────────────────────────────────
function PaymentModal({ vendor, onSave, onClose }) {
    const defaultWHT = getWHT(vendor);
    const [form, setForm] = useState({
        payment_date: new Date().toISOString().slice(0, 10),
        amount: '', wht_rate: defaultWHT, description: '',
        bill_ref: '', category: vendor.category || '',
    });
    const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
    const amt = parseFloat(form.amount) || 0;
    const wht = parseFloat(form.wht_rate) || 0;
    const whtAmt = Math.round(amt * wht / 100 * 100) / 100;
    const netPay = amt - whtAmt;

    return (
        <Overlay>
            <ModalHeader title={`Record Payment — ${vendor.name}`}
                sub={`Filer: ${vendor.is_filer ? 'Yes ✅' : 'No ⚠️'} · Default WHT: ${defaultWHT}%`}
                onClose={onClose} />
            <div style={{ padding: '1.5rem 2rem 2rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <FRow label="Payment Date"><FInput type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} /></FRow>
                    <FRow label="Gross Invoice Amount (Rs.)"><FInput type="number" value={form.amount} onChange={e => set('amount', e.target.value)} ph="0.00" /></FRow>
                    <FRow label="WHT Rate (%)">
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <FInput type="number" value={form.wht_rate} onChange={e => set('wht_rate', e.target.value)} ph="%" />
                            <button onClick={() => set('wht_rate', defaultWHT)}
                                style={{ whiteSpace: 'nowrap', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)',
                                    color: 'var(--primary)', borderRadius: '6px', padding: '8px 10px', cursor: 'pointer', fontSize: '0.78rem' }}>
                                Reset to {defaultWHT}%
                            </button>
                        </div>
                    </FRow>
                    <FRow label="Bill / Voucher Ref"><FInput value={form.bill_ref} onChange={e => set('bill_ref', e.target.value)} ph="e.g. BILL-2026-001" /></FRow>
                    <div style={{ gridColumn: '1/-1' }}>
                        <FRow label="Description"><FInput value={form.description} onChange={e => set('description', e.target.value)} ph="Purpose of payment" /></FRow>
                    </div>
                </div>

                {/* WHT Working */}
                <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.18)',
                    borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.06em', color: 'var(--primary)', marginBottom: '0.75rem' }}>
                        WHT Working (Section 153)
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                        {[
                            ['Gross Invoice', Rs(amt)],
                            [`WHT @ ${wht}%`, Rs(whtAmt), '#ef4444'],
                            ['Net Payment', Rs(netPay), '#22c55e'],
                        ].map(([l, v, c]) => (
                            <div key={l} style={{ textAlign: 'center', padding: '0.6rem', background: 'var(--bg-dark)', borderRadius: '8px' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{l}</div>
                                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: c || 'var(--text)' }}>{v}</div>
                            </div>
                        ))}
                    </div>
                    <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {vendor.is_filer
                            ? '✅ Filer rate applied — as per Active Taxpayer List (ATL)'
                            : '⚠️ Non-Filer rate applied — 2× standard WHT. Update vendor status when ATL confirmed.'}
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                    <button onClick={onClose} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={() => { if (!form.amount) return alert('Enter amount.'); onSave(form); }}
                        style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.75rem 2rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Save size={16} /> Record Payment
                    </button>
                </div>
            </div>
        </Overlay>
    );
}

// ─── Vendor Profile (detail view) ─────────────────────────────────────────────
function VendorProfile({ vendor, onBack, onEdit, onPayment, payments, loadingPay }) {
    const whtRate = getWHT(vendor);
    const totalPaid = parseFloat(vendor.total_paid) || 0;
    const totalWHT = parseFloat(vendor.total_wht) || 0;

    return (
        <div className="dashboard">
            <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '8px',
                background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                marginBottom: '1.5rem', fontSize: '0.9rem', padding: 0 }}>
                <ChevronLeft size={18} /> All Vendors
            </button>

            {/* Header */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '14px',
                padding: '2rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{ width: '60px', height: '60px', borderRadius: '12px',
                        background: 'linear-gradient(135deg,var(--primary),#6366f1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', fontWeight: 800, fontSize: '1.4rem' }}>
                        {vendor.name[0]}
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{vendor.name}</h1>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700,
                                background: vendor.is_filer ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                                color: vendor.is_filer ? '#22c55e' : '#ef4444' }}>
                                {vendor.is_filer ? '✅ Active Filer' : '⚠️ Non-Filer'}
                            </span>
                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700,
                                background: vendor.is_active ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
                                color: vendor.is_active ? '#22c55e' : '#f59e0b' }}>
                                {vendor.is_active ? 'Active' : 'Inactive'}
                            </span>
                            {vendor.category && (
                                <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.75rem',
                                    background: 'var(--bg-dark)', color: 'var(--text-muted)' }}>
                                    {vendor.category}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button onClick={onEdit}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent',
                            border: '1px solid var(--primary)', color: 'var(--primary)',
                            padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                        <Edit2 size={14} /> Edit
                    </button>
                    <button onClick={onPayment}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)',
                            border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px',
                            cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                        <DollarSign size={14} /> Record Payment
                    </button>
                </div>
            </div>

            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    { l: 'Default WHT Rate', v: `${whtRate}%`, c: '#f59e0b', sub: `Sec. 153 · ${vendor.is_filer ? 'Filer' : 'Non-Filer'}` },
                    { l: 'Total Paid (Gross)', v: Rs(totalPaid), c: 'var(--text)' },
                    { l: 'Total WHT Deducted', v: Rs(totalWHT), c: '#ef4444' },
                    { l: 'Net Payments Made', v: Rs(totalPaid - totalWHT), c: '#22c55e' },
                ].map(card => (
                    <div key={card.l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: '12px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase',
                            letterSpacing: '0.04em', marginBottom: '4px' }}>{card.l}</div>
                        <div style={{ fontWeight: 800, fontSize: '1.1rem', color: card.c }}>{card.v}</div>
                        {card.sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{card.sub}</div>}
                    </div>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '1.5rem' }}>
                {/* Vendor Info */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 1rem', fontSize: '0.85rem', textTransform: 'uppercase',
                        letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Vendor Details</h3>
                    {[
                        ['NTN', vendor.ntn || '—'],
                        ['STRN', vendor.strn || '—'],
                        ['CNIC (Proprietor)', vendor.cnic || '—'],
                        ['Contact Person', vendor.contact_person || '—'],
                        ['Phone', vendor.phone || '—'],
                        ['Email', vendor.email || '—'],
                        ['Address', vendor.address || '—'],
                        ['Bank', `${vendor.bank_name || '—'} · ${vendor.bank_account || '—'}`],
                        ['Account Title', vendor.account_title || '—'],
                        ['Payment Terms', vendor.payment_terms || '—'],
                    ].map(([l, v]) => (
                        <div key={l} style={{ display: 'flex', justifyContent: 'space-between',
                            padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.88rem', gap: '1rem' }}>
                            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{l}</span>
                            <span style={{ fontWeight: 500, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
                        </div>
                    ))}
                    {vendor.notes && (
                        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg-dark)',
                            borderRadius: '8px', fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                            📝 {vendor.notes}
                        </div>
                    )}
                </div>

                {/* Payment History */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 1rem', fontSize: '0.85rem', textTransform: 'uppercase',
                        letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Payment History (WHT Working)</h3>
                    {loadingPay ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem' }}>Loading...</div>
                    ) : payments.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem',
                            textAlign: 'center', border: '2px dashed var(--border)', borderRadius: '10px' }}>
                            No payments recorded yet. Click "Record Payment" to begin.
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                        {['Date', 'Description', 'Gross', 'WHT%', 'WHT Amt', 'Net Pay'].map(h => (
                                            <th key={h} style={{ padding: '7px 8px', textAlign: h === 'Date' || h === 'Description' ? 'left' : 'right',
                                                color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.7rem',
                                                textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {payments.map(p => (
                                        <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>{fmt(p.payment_date)}</td>
                                            <td style={{ padding: '7px 8px', color: 'var(--text-muted)' }}>{p.description || p.bill_ref || '—'}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600 }}>Rs. {(parseFloat(p.amount)||0).toLocaleString()}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right', color: '#f59e0b' }}>{p.wht_rate}%</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right', color: '#ef4444' }}>Rs. {(parseFloat(p.wht_amount)||0).toLocaleString()}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color: '#22c55e' }}>Rs. {(parseFloat(p.net_payment)||0).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-dark)' }}>
                                        <td colSpan={2} style={{ padding: '7px 8px', fontWeight: 700 }}>TOTALS</td>
                                        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700 }}>Rs. {payments.reduce((a,p)=>a+(parseFloat(p.amount)||0),0).toLocaleString()}</td>
                                        <td></td>
                                        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color: '#ef4444' }}>Rs. {payments.reduce((a,p)=>a+(parseFloat(p.wht_amount)||0),0).toLocaleString()}</td>
                                        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color: '#22c55e' }}>Rs. {payments.reduce((a,p)=>a+(parseFloat(p.net_payment)||0),0).toLocaleString()}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Main VendorMaster ────────────────────────────────────────────────────────
export default function VendorMaster() {
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [filterFiler, setFilterFiler] = useState('All');
    const [selected, setSelected] = useState(null);
    const [payments, setPayments] = useState([]);
    const [loadingPay, setLoadingPay] = useState(false);
    const [showEditor, setShowEditor] = useState(false);
    const [editVendor, setEditVendor] = useState(null);
    const [showPayment, setShowPayment] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        setLoading(true);
        api.getVendors()
            .then(d => { setVendors(d.vendors); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    const loadPayments = useCallback(id => {
        setLoadingPay(true);
        api.getVendorPayments(id)
            .then(d => { setPayments(d.payments); setLoadingPay(false); })
            .catch(() => setLoadingPay(false));
    }, []);

    useEffect(() => {
        if (selected) loadPayments(selected.id);
    }, [selected, loadPayments]);

    const openProfile = v => {
        setSelected(v); setPayments([]);
    };

    const handleSave = async (form) => {
        setSaving(true);
        try {
            if (editVendor?.id) {
                const d = await api.updateVendor(editVendor.id, form);
                setVendors(p => p.map(v => v.id === editVendor.id ? d.vendor : v));
                if (selected?.id === editVendor.id) setSelected(d.vendor);
            } else {
                const d = await api.createVendor(form);
                setVendors(p => [...p, d.vendor]);
            }
            setShowEditor(false); setEditVendor(null);
        } catch (err) { alert('Save failed: ' + err.message); }
        setSaving(false);
    };

    const handleDelete = async (v, e) => {
        e.stopPropagation();
        if (!confirm(`Delete vendor "${v.name}"? This will also delete payment records.`)) return;
        try {
            await api.deleteVendor(v.id);
            setVendors(p => p.filter(x => x.id !== v.id));
            if (selected?.id === v.id) setSelected(null);
        } catch (err) { alert('Delete failed: ' + err.message); }
    };

    const handlePayment = async (form) => {
        setSaving(true);
        try {
            const d = await api.createVendorPayment(selected.id, form);
            setPayments(p => [d.payment, ...p]);
            // Refresh vendor totals
            const updated = await api.getVendors();
            const v = updated.vendors.find(x => x.id === selected.id);
            if (v) { setVendors(updated.vendors); setSelected(v); }
            setShowPayment(false);
        } catch (err) { alert('Payment failed: ' + err.message); }
        setSaving(false);
    };

    const filtered = vendors.filter(v => {
        const q = search.toLowerCase();
        const matchSearch = !search || v.name.toLowerCase().includes(q) ||
            (v.ntn || '').includes(search) || (v.category || '').toLowerCase().includes(q);
        const matchStatus = filterStatus === 'All' ||
            (filterStatus === 'Active' && v.is_active) ||
            (filterStatus === 'Inactive' && !v.is_active);
        const matchFiler = filterFiler === 'All' ||
            (filterFiler === 'Filer' && v.is_filer) ||
            (filterFiler === 'Non-Filer' && !v.is_filer);
        return matchSearch && matchStatus && matchFiler;
    });

    if (selected) return (
        <>
            <VendorProfile vendor={selected} payments={payments} loadingPay={loadingPay}
                onBack={() => setSelected(null)}
                onEdit={() => { setEditVendor(selected); setShowEditor(true); }}
                onPayment={() => setShowPayment(true)} />
            {showEditor && <VendorEditor vendor={editVendor} onSave={handleSave} onCancel={() => { setShowEditor(false); setEditVendor(null); }} />}
            {showPayment && <PaymentModal vendor={selected} onSave={handlePayment} onClose={() => setShowPayment(false)} />}
        </>
    );

    return (
        <div className="dashboard">
            <header className="header">
                <h1>Vendor & Supplier Master</h1>
                <p>Manage procurement vendors with FBR Filer/Non-Filer status, WHT rates, and complete payment history.</p>
            </header>

            {/* KPI Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    { l: 'Total Vendors', v: vendors.length, c: 'var(--primary)' },
                    { l: 'Active Filers', v: vendors.filter(v => v.is_filer && v.is_active).length, c: '#22c55e' },
                    { l: 'Non-Filers', v: vendors.filter(v => !v.is_filer).length, c: '#ef4444' },
                    { l: 'Inactive', v: vendors.filter(v => !v.is_active).length, c: '#f59e0b' },
                ].map(card => (
                    <div key={card.l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: '12px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase',
                            letterSpacing: '0.04em', marginBottom: '4px' }}>{card.l}</div>
                        <div style={{ fontWeight: 800, fontSize: '1.3rem', color: card.c }}>{card.v}</div>
                    </div>
                ))}
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center',
                    background: 'var(--bg-card)', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                    <Search size={18} color="var(--text-muted)" style={{ marginRight: '0.5rem', flexShrink: 0 }} />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search by name, NTN, or category..."
                        style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', outline: 'none' }} />
                </div>
                {[['Status', filterStatus, setFilterStatus, ['All', 'Active', 'Inactive']],
                  ['FBR', filterFiler, setFilterFiler, ['All', 'Filer', 'Non-Filer']]].map(([l, val, set, opts]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{l}:</span>
                        <select value={val} onChange={e => set(e.target.value)}
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px',
                                padding: '6px 10px', color: 'var(--text)', fontSize: '0.82rem', outline: 'none' }}>
                            {opts.map(o => <option key={o}>{o}</option>)}
                        </select>
                    </div>
                ))}
                <button onClick={() => { setEditVendor(null); setShowEditor(true); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)',
                        color: 'white', border: 'none', padding: '0.55rem 1.25rem', borderRadius: '8px',
                        cursor: 'pointer', fontWeight: 600 }}>
                    <Plus size={18} /> Register Vendor
                </button>
            </div>

            {/* Vendor Table */}
            {loading ? (<div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem' }}>Loading vendors...</div>)
            : filtered.length === 0 ? (
                <div style={{ background: 'var(--bg-card)', border: '2px dashed var(--border)', borderRadius: '16px',
                    padding: '4rem', textAlign: 'center' }}>
                    <Truck size={48} color="var(--text-muted)" style={{ marginBottom: '1rem' }} />
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                        {vendors.length === 0 ? 'No vendors registered yet' : 'No vendors match your filters'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                        {vendors.length === 0 ? 'Click "Register Vendor" to add your first supplier.' : 'Try changing the search or filters above.'}
                    </div>
                </div>
            ) : (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                            <thead>
                                <tr style={{ background: 'var(--bg-dark)' }}>
                                    {['Vendor Name', 'Category', 'NTN', 'FBR Status', 'WHT Rate', 'Total Paid', 'Status', 'Actions'].map(h => (
                                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem',
                                            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                                            color: 'var(--text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((v, i) => (
                                    <tr key={v.id} style={{ borderBottom: '1px solid var(--border)',
                                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                                        cursor: 'pointer', transition: 'background 0.15s' }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(56,189,248,0.04)'}
                                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'}>
                                        <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: '0.9rem' }}
                                            onClick={() => openProfile(v)}>{v.name}</td>
                                        <td style={{ padding: '10px 12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}
                                            onClick={() => openProfile(v)}>{v.category || '—'}</td>
                                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-muted)' }}
                                            onClick={() => openProfile(v)}>{v.ntn || '—'}</td>
                                        <td style={{ padding: '10px 12px' }} onClick={() => openProfile(v)}>
                                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.74rem', fontWeight: 700,
                                                background: v.is_filer ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                                                color: v.is_filer ? '#22c55e' : '#ef4444' }}>
                                                {v.is_filer ? 'Filer ✅' : 'Non-Filer ⚠️'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 12px', fontWeight: 700, color: '#f59e0b' }}
                                            onClick={() => openProfile(v)}>{getWHT(v)}%</td>
                                        <td style={{ padding: '10px 12px', fontWeight: 600 }}
                                            onClick={() => openProfile(v)}>Rs. {(parseFloat(v.total_paid)||0).toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px' }} onClick={() => openProfile(v)}>
                                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.74rem', fontWeight: 700,
                                                background: v.is_active ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
                                                color: v.is_active ? '#22c55e' : '#f59e0b' }}>
                                                {v.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button onClick={() => openProfile(v)}
                                                    style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)',
                                                        color: 'var(--primary)', borderRadius: '6px', padding: '5px 10px',
                                                        cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Eye size={13} /> View
                                                </button>
                                                <button onClick={() => { setEditVendor(v); setShowEditor(true); }}
                                                    style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                                                        borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Edit2 size={13} />
                                                </button>
                                                <button onClick={e => handleDelete(v, e)}
                                                    style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                                                        color: '#ef4444', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {showEditor && <VendorEditor vendor={editVendor} onSave={handleSave} onCancel={() => { setShowEditor(false); setEditVendor(null); }} />}
        </div>
    );
}
