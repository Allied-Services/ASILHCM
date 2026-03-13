import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Save, RotateCcw, AlertCircle, CheckCircle, Plus, Trash2, Edit3 } from 'lucide-react';
import { api } from './api';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const Rs = n => `Rs. ${(parseFloat(n)||0).toLocaleString()}`;

function calcAnnualTax(annualSalary, slabs) {
    for (const s of slabs) {
        if (s.to === null || annualSalary <= s.to) {
            return s.base + ((annualSalary - s.from) * s.rate / 100);
        }
    }
    return 0;
}

function TaxCalculatorWidget({ slabs }) {
    const [salary, setSalary] = useState(75000);
    const monthly = parseFloat(salary) || 0;
    const annual = monthly * 12;
    const annualTax = Math.max(0, calcAnnualTax(annual, slabs));
    const monthlyTax = annualTax / 12;
    const effectiveRate = annual > 0 ? (annualTax / annual * 100).toFixed(2) : 0;
    const netMonthly = monthly - monthlyTax;
    const slab = slabs.find(s => annual >= s.from && (s.to === null || annual <= s.to));

    return (
        <div style={{ background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.2)',
            borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--primary)', marginBottom: '1rem' }}>
                🧮 Live Tax Calculator — Salaried Employee (FY 2025-26)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Monthly Gross Salary (Rs.)</label>
                    <input type="number" value={salary} onChange={e => setSalary(e.target.value)}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--primary)', borderRadius: '8px',
                            padding: '8px 12px', color: 'var(--text)', fontSize: '1rem', outline: 'none', width: '200px' }} />
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '20px' }}>
                    Annual Income: <strong style={{ color: 'var(--text)' }}>{Rs(annual)}</strong>
                    {slab && <span style={{ marginLeft: '12px', padding: '2px 8px', background: 'rgba(56,189,248,0.1)',
                        color: 'var(--primary)', borderRadius: '6px', fontSize: '0.78rem' }}>Slab: {slab.label}</span>}
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem' }}>
                {[
                    { l: 'Monthly Tax', v: Rs(monthlyTax), c: '#ef4444' },
                    { l: 'Annual Tax', v: Rs(annualTax), c: '#ef4444' },
                    { l: 'Effective Rate', v: `${effectiveRate}%`, c: '#f59e0b' },
                    { l: 'Net Monthly', v: Rs(netMonthly), c: '#22c55e' },
                ].map(card => (
                    <div key={card.l} style={{ background: 'var(--bg-card)', borderRadius: '10px', padding: '0.85rem 1rem',
                        border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase',
                            letterSpacing: '0.04em', marginBottom: '4px' }}>{card.l}</div>
                        <div style={{ fontWeight: 800, fontSize: '1.05rem', color: card.c }}>{card.v}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Individual Tax Slab Editor ───────────────────────────────────────────────
function IndividualTaxEditor({ slabs, onChange }) {
    const setVal = (i, k, v) => {
        const next = [...slabs];
        next[i] = { ...next[i], [k]: k === 'label' ? v : (parseFloat(v) || (v === '' ? '' : 0)) };
        onChange(next);
    };
    const addSlab = () => onChange([...slabs, { from: 0, to: null, rate: 0, base: 0, label: 'New Slab' }]);
    const remove = i => { if (window.confirm('Remove this slab?')) onChange(slabs.filter((_, j) => j !== i)); };

    return (
        <div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-dark)' }}>
                            {['Slab Label', 'From (Rs.)', 'To (Rs.)', 'Rate (%)', 'Fixed Base Tax (Rs.)', ''].map(h => (
                                <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.7rem',
                                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                                    color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {slabs.map((s, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '6px 8px' }}>
                                    <input value={s.label} onChange={e => setVal(i, 'label', e.target.value)}
                                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)',
                                            borderRadius: '5px', padding: '6px 8px', color: 'var(--text)',
                                            fontSize: '0.83rem', outline: 'none', width: '220px' }} />
                                </td>
                                {['from', 'to', 'rate', 'base'].map(k => (
                                    <td key={k} style={{ padding: '6px 8px' }}>
                                        <input type="number" value={s[k] ?? ''} placeholder={k === 'to' && s.to === null ? '∞ (Unlimited)' : ''}
                                            onChange={e => setVal(i, k, e.target.value)}
                                            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)',
                                                borderRadius: '5px', padding: '6px 8px', color: 'var(--text)',
                                                fontSize: '0.83rem', outline: 'none', width: '110px', textAlign: 'right' }} />
                                    </td>
                                ))}
                                <td style={{ padding: '6px 8px' }}>
                                    <button onClick={() => remove(i)}
                                        style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                                            color: '#ef4444', borderRadius: '5px', padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                        <Trash2 size={13} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <button onClick={addSlab}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '0.75rem',
                    background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)',
                    color: 'var(--primary)', padding: '6px 14px', borderRadius: '7px',
                    cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                <Plus size={14} /> Add Slab
            </button>
        </div>
    );
}

// ─── Vendor WHT Table Editor ───────────────────────────────────────────────────
function VendorWHTEditor({ rates, onChange }) {
    const setVal = (i, k, v) => {
        const next = [...rates];
        next[i] = { ...next[i], [k]: k === 'category' || k === 'section' ? v : (parseFloat(v) || 0) };
        onChange(next);
    };
    const add = () => onChange([...rates, { category: 'New Category', filer: 0, nonFiler: 0, section: '153' }]);
    const remove = i => { if (window.confirm('Remove this entry?')) onChange(rates.filter((_, j) => j !== i)); };

    return (
        <div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-dark)' }}>
                            {['Category / Service', 'Filer WHT (%)', 'Non-Filer WHT (%)', 'FBR Section', ''].map(h => (
                                <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.7rem',
                                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                                    color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rates.map((r, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '6px 8px' }}>
                                    <input value={r.category} onChange={e => setVal(i, 'category', e.target.value)}
                                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)',
                                            borderRadius: '5px', padding: '6px 8px', color: 'var(--text)',
                                            fontSize: '0.83rem', outline: 'none', width: '250px' }} />
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <input type="number" value={r.filer}
                                            onChange={e => setVal(i, 'filer', e.target.value)}
                                            style={{ background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.3)',
                                                borderRadius: '5px', padding: '6px 8px', color: '#22c55e',
                                                fontSize: '0.83rem', outline: 'none', width: '70px', textAlign: 'right', fontWeight: 700 }} />
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>%</span>
                                    </div>
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <input type="number" value={r.nonFiler}
                                            onChange={e => setVal(i, 'nonFiler', e.target.value)}
                                            style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.3)',
                                                borderRadius: '5px', padding: '6px 8px', color: '#ef4444',
                                                fontSize: '0.83rem', outline: 'none', width: '70px', textAlign: 'right', fontWeight: 700 }} />
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>%</span>
                                    </div>
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                    <input value={r.section} onChange={e => setVal(i, 'section', e.target.value)}
                                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)',
                                            borderRadius: '5px', padding: '6px 8px', color: 'var(--text)',
                                            fontSize: '0.83rem', outline: 'none', width: '100px' }} />
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                    <button onClick={() => remove(i)}
                                        style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                                            color: '#ef4444', borderRadius: '5px', padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                        <Trash2 size={13} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <button onClick={add}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '0.75rem',
                    background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)',
                    color: 'var(--primary)', padding: '6px 14px', borderRadius: '7px',
                    cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                <Plus size={14} /> Add Category
            </button>
        </div>
    );
}

// ─── EOBI / SESSI Reference Panel ────────────────────────────────────────────
function StatutoryReferencePanel() {
    const items = [
        { label: 'EOBI — Employer Contribution', rate: '5% of gross salary (min Rs. 250/month)', section: 'EOBI Act 1976' },
        { label: 'EOBI — Employee Contribution', rate: '1% of gross salary', section: 'EOBI Act 1976' },
        { label: 'SESSI — Employer (Sindh)', rate: 'Rs. 2,220/month flat (as of 2025)', section: 'SESSI Act 2012' },
        { label: 'SESSI — Employee (Sindh)', rate: '1% of wages', section: 'SESSI Act 2012' },
        { label: 'ESSI — Employer (Punjab)', rate: '5% of wages', section: 'ESSI Act 1952' },
        { label: 'Gratuity', rate: '1/30th of last month basic × years served', section: 'EOB Ord 1968' },
        { label: 'Sales Tax on Services', rate: '15%-16% (province-specific)', section: 'SPST / PPST' },
        { label: 'Advance Tax on Salary (244A)', rate: 'Monthly deduction per FBR slabs above', section: 'ITO 2001, Sec 149' },
    ];
    return (
        <div>
            <div style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.18)',
                borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1rem', fontSize: '0.82rem', color: '#f59e0b' }}>
                ⚠️ <strong>Statutory Reference Only</strong> — These rates are sourced from FBR, EOBI, and provincial Social Security authorities. Always verify the latest notifications on <strong>fbr.gov.pk</strong> and <strong>eobi.gov.pk</strong>.
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-dark)' }}>
                            {['Contribution / Levy', 'Rate / Amount', 'Governing Law'].map(h => (
                                <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: '0.7rem',
                                    fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                                    color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((it, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                                <td style={{ padding: '9px 12px', fontWeight: 600 }}>{it.label}</td>
                                <td style={{ padding: '9px 12px', color: 'var(--primary)', fontWeight: 600 }}>{it.rate}</td>
                                <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.78rem' }}>{it.section}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ─── Main SystemConfig ────────────────────────────────────────────────────────
const TABS = ['Employee Taxes', 'Vendor WHT Rates', 'Statutory Reference'];

const DEFAULT_SLABS = [
    { from: 0, to: 600000, rate: 0, base: 0, label: 'Up to Rs. 600,000' },
    { from: 600001, to: 1200000, rate: 5, base: 0, label: 'Rs. 600,001 – 1,200,000' },
    { from: 1200001, to: 2200000, rate: 15, base: 30000, label: 'Rs. 1,200,001 – 2,200,000' },
    { from: 2200001, to: 3200000, rate: 25, base: 180000, label: 'Rs. 2,200,001 – 3,200,000' },
    { from: 3200001, to: 4100000, rate: 30, base: 430000, label: 'Rs. 3,200,001 – 4,100,000' },
    { from: 4100001, to: null, rate: 35, base: 700000, label: 'Above Rs. 4,100,000' },
];

const DEFAULT_WHT = [
    { category: 'Supply of Goods', filer: 4, nonFiler: 8, section: '153(1)(a)' },
    { category: 'Services', filer: 8, nonFiler: 16, section: '153(1)(b)' },
    { category: 'Execution of Contract / Works', filer: 7, nonFiler: 7, section: '153(1)(c)' },
    { category: 'IT Services', filer: 8, nonFiler: 16, section: '153A' },
    { category: 'Advertising Services', filer: 10, nonFiler: 20, section: '153(1)(b)' },
    { category: 'Transport / Freight', filer: 2, nonFiler: 4, section: '153(1)(b)' },
    { category: 'Electricity & Gas', filer: 7.5, nonFiler: 10, section: '235' },
    { category: 'Cleaning & Janitorial', filer: 8, nonFiler: 16, section: '153(1)(b)' },
    { category: 'PPE & Safety Equipment', filer: 4, nonFiler: 8, section: '153(1)(a)' },
    { category: 'Uniform & Clothing Supply', filer: 4, nonFiler: 8, section: '153(1)(a)' },
    { category: 'Office Supplies & Stationery', filer: 4, nonFiler: 8, section: '153(1)(a)' },
    { category: 'Security Services', filer: 8, nonFiler: 16, section: '153(1)(b)' },
    { category: 'Catering & Food', filer: 8, nonFiler: 16, section: '153(1)(b)' },
    { category: 'Fuel & Petroleum', filer: 4, nonFiler: 8, section: '153(1)(a)' },
    { category: 'Construction & Civil Works', filer: 7, nonFiler: 7, section: '153(1)(c)' },
];

export default function SystemConfig() {
    const [tab, setTab] = useState(TABS[0]);
    const [slabs, setSlabs] = useState(DEFAULT_SLABS);
    const [whtRates, setWhtRates] = useState(DEFAULT_WHT);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState('');
    const [toast, setToast] = useState('');

    const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

    useEffect(() => {
        Promise.all([
            api.getConfig('fbr_individual_tax').catch(() => null),
            api.getConfig('fbr_vendor_wht').catch(() => null),
        ]).then(([iTaxRes, vWHTRes]) => {
            if (iTaxRes?.config?.value) setSlabs(iTaxRes.config.value);
            if (vWHTRes?.config?.value) setWhtRates(vWHTRes.config.value);
            setLoading(false);
        });
    }, []);

    const saveSlabs = async () => {
        setSaving('slabs');
        try {
            await api.updateConfig('fbr_individual_tax', slabs);
            showToast('✅ Employee tax slabs saved successfully');
        } catch (err) { alert('Save failed: ' + err.message); }
        setSaving('');
    };

    const saveWHT = async () => {
        setSaving('wht');
        try {
            await api.updateConfig('fbr_vendor_wht', whtRates);
            showToast('✅ Vendor WHT rates saved successfully');
        } catch (err) { alert('Save failed: ' + err.message); }
        setSaving('');
    };

    return (
        <div className="dashboard">
            <header className="header">
                <h1>System Configuration</h1>
                <p>FBR tax slabs for salaried individuals, vendor withholding tax rates, and statutory reference — all editable to reflect latest notifications.</p>
            </header>

            {/* Toast */}
            {toast && (
                <div style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
                    background: '#22c55e', color: 'white', padding: '12px 20px', borderRadius: '10px',
                    fontWeight: 700, fontSize: '0.88rem', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                    {toast}
                </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '1.75rem' }}>
                {TABS.map(t => (
                    <button key={t} onClick={() => setTab(t)}
                        style={{ padding: '0.85rem 1.75rem', background: 'transparent', border: 'none',
                            borderBottom: `2px solid ${tab === t ? 'var(--primary)' : 'transparent'}`,
                            color: tab === t ? 'var(--primary)' : 'var(--text-muted)',
                            cursor: 'pointer', fontWeight: tab === t ? 700 : 400, fontSize: '0.95rem' }}>
                        {t}
                    </button>
                ))}
            </div>

            {loading && tab !== TABS[2] && (
                <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading configuration...</div>
            )}

            {/* ── Employee Taxes Tab ────────────────────────────────────────── */}
            {!loading && tab === TABS[0] && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>FBR Individual Tax Slabs — Salaried Employees</h2>
                            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                ITO 2001, Section 149 — Finance Act 2024 (FY 2025-26). Edit directly and save.
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button onClick={() => setSlabs(DEFAULT_SLABS)}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent',
                                    border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '8px 16px',
                                    borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                                <RotateCcw size={14} /> Reset to FBR Defaults
                            </button>
                            <button onClick={saveSlabs} disabled={saving === 'slabs'}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)',
                                    border: 'none', color: 'white', padding: '8px 20px', borderRadius: '8px',
                                    cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                                    opacity: saving === 'slabs' ? 0.6 : 1 }}>
                                <Save size={14} /> {saving === 'slabs' ? 'Saving...' : 'Save Slabs'}
                            </button>
                        </div>
                    </div>

                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px',
                        padding: '1.5rem', marginBottom: '1.5rem' }}>
                        <IndividualTaxEditor slabs={slabs} onChange={setSlabs} />
                    </div>

                    <TaxCalculatorWidget slabs={slabs} />

                    <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
                        borderRadius: '10px', padding: '1rem 1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        <strong style={{ color: '#818cf8' }}>📌 Year-End Reconciliation:</strong> Income tax is deducted monthly on an estimated basis.
                        At financial year-end (30 June), actual annual income is compared to estimates and any difference
                        is adjusted. Employees who earn variable bonuses may have a refund or surcharge applied in June.
                        The payroll module uses these exact slabs for monthly deductions.
                    </div>
                </div>
            )}

            {/* ── Vendor WHT Tab ────────────────────────────────────────────── */}
            {!loading && tab === TABS[1] && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Vendor Withholding Tax Rates — Section 153</h2>
                            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                FBR WHT rates applied to vendor payments. Green = Filer rate. Red = Non-Filer rate (typically 2×).
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button onClick={() => setWhtRates(DEFAULT_WHT)}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent',
                                    border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '8px 16px',
                                    borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                                <RotateCcw size={14} /> Reset to FBR Defaults
                            </button>
                            <button onClick={saveWHT} disabled={saving === 'wht'}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)',
                                    border: 'none', color: 'white', padding: '8px 20px', borderRadius: '8px',
                                    cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                                    opacity: saving === 'wht' ? 0.6 : 1 }}>
                                <Save size={14} /> {saving === 'wht' ? 'Saving...' : 'Save WHT Rates'}
                            </button>
                        </div>
                    </div>

                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px',
                        padding: '1.5rem', marginBottom: '1rem' }}>
                        <VendorWHTEditor rates={whtRates} onChange={setWhtRates} />
                    </div>

                    <div style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)',
                        borderRadius: '10px', padding: '1rem 1.25rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        <strong style={{ color: '#f59e0b' }}>⚠️ Usage:</strong> These rates are automatically applied when you record a payment in Vendor Master.
                        If a vendor's FBR filing status changes, update it in the vendor profile — the correct Filer or Non-Filer rate will then apply to all future payments.
                        Past payments retain their original WHT rate for audit accuracy.
                    </div>
                </div>
            )}

            {/* ── Statutory Reference Tab ───────────────────────────────────── */}
            {tab === TABS[2] && (
                <div>
                    <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem' }}>Statutory Contributions & Levies — Quick Reference</h2>
                    <StatutoryReferencePanel />
                </div>
            )}
        </div>
    );
}
