import React, { useState, useEffect, useCallback } from 'react';
import {
    CreditCard, CheckCircle, Clock, AlertCircle, ChevronDown, ChevronRight,
    Building2, RefreshCw, ExternalLink, X, DollarSign, FileText, Send,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
const fmt = (v) => Math.round(parseFloat(v) || 0).toLocaleString('en-PK');
const Rs = (v) => `Rs. ${fmt(v)}`;

function getToken() { return localStorage.getItem('asil_hcm_token'); }

async function apiFetch(path, opts = {}) {
    const res = await fetch(`${API_URL}${path}`, {
        ...opts,
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
    }
    return res.json();
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── Confirm Payment Modal ────────────────────────────────────────────────────
function ConfirmPaymentModal({ title, totalAmount, employeeCount, onConfirm, onClose }) {
    // Only HBL and NBP for payroll payments
    const BANK_OPTIONS = [
        { id: 'hbl', name: 'Habib Bank Limited (HBL)', is_hbl: true },
        { id: 'nbp', name: 'National Bank of Pakistan (NBP)', is_hbl: false },
    ];
    const [bankId, setBankId] = useState('hbl');
    const [bankName, setBankName] = useState('Habib Bank Limited (HBL)');
    const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
    const [referenceNo, setReferenceNo] = useState('');
    const [notes, setNotes] = useState('');
    const [pushXero, setPushXero] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    const handleBankChange = (e) => {
        const id = e.target.value;
        setBankId(id);
        const b = BANK_OPTIONS.find(b => b.id === id);
        setBankName(b ? b.name : id);
    };

    const handleSubmit = async () => {
        if (!bankName) { setError('Please select a bank.'); return; }
        if (!paymentDate) { setError('Please set a payment date.'); return; }
        setSubmitting(true); setError(null);
        try {
            await onConfirm({ bank_id: bankId, bank_name: bankName, payment_date: paymentDate, reference_no: referenceNo, notes, push_to_xero: pushXero });
            onClose();
        } catch (e) { setError(e.message); setSubmitting(false); }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '2rem' }}>
            <div style={{ background: '#0f1823', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', width: '100%', maxWidth: '520px' }}>
                <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ margin: 0, color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <CreditCard size={18} color="#22c55e" /> Confirm Payment
                        </h3>
                        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.85rem' }}>{title}</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '1.75rem 2rem' }}>
                    {/* Amount summary */}
                    <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Payment</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#22c55e' }}>{Rs(totalAmount)}</div>
                            {employeeCount > 0 && <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>{employeeCount} employees</div>}
                        </div>
                        <DollarSign size={32} color="#22c55e" style={{ opacity: 0.4 }} />
                    </div>

                    <div style={{ display: 'grid', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' }}>Bank Account</label>
                            <select value={bankId} onChange={handleBankChange}
                                style={{ width: '100%', background: '#1a2535', border: '1px solid rgba(255,255,255,0.1)', color: '#f0f4f8', padding: '9px 12px', borderRadius: '8px', fontSize: '0.9rem' }}>
                                {BANK_OPTIONS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' }}>Payment Date</label>
                                <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                                    style={{ width: '100%', background: '#1a2535', border: '1px solid rgba(255,255,255,0.1)', color: '#f0f4f8', padding: '9px 12px', borderRadius: '8px', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' }}>Reference No.</label>
                                <input type="text" value={referenceNo} onChange={e => setReferenceNo(e.target.value)} placeholder="e.g. TT-2026-04-001"
                                    style={{ width: '100%', background: '#1a2535', border: '1px solid rgba(255,255,255,0.1)', color: '#f0f4f8', padding: '9px 12px', borderRadius: '8px', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' }}>Notes (optional)</label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Internal notes for this payment batch..."
                                style={{ width: '100%', background: '#1a2535', border: '1px solid rgba(255,255,255,0.1)', color: '#f0f4f8', padding: '9px 12px', borderRadius: '8px', fontSize: '0.9rem', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
                            <input type="checkbox" checked={pushXero} onChange={e => setPushXero(e.target.checked)}
                                style={{ width: '16px', height: '16px', accentColor: '#00B5C8' }} />
                            <span style={{ fontSize: '0.88rem', color: '#94a3b8' }}>
                                <strong style={{ color: '#00B5C8' }}>Push to Xero</strong> — Create invoice/bill in Xero automatically
                            </span>
                        </label>
                    </div>

                    {error && (
                        <div style={{ marginTop: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', color: '#f87171', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                        <button onClick={onClose} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                        <button onClick={handleSubmit} disabled={submitting}
                            style={{ flex: 2, background: submitting ? '#1a4024' : '#22c55e', border: 'none', color: submitting ? '#64748b' : 'white', padding: '10px', borderRadius: '8px', cursor: submitting ? 'not-allowed' : 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <CheckCircle size={16} /> {submitting ? 'Processing…' : 'Confirm Payment'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Payroll Queue Panel ──────────────────────────────────────────────────────
function PayrollQueuePanel() {
    const [queue, setQueue] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedMonth, setExpandedMonth] = useState(null);
    const [monthDetail, setMonthDetail] = useState({});
    const [confirmTarget, setConfirmTarget] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);

    const loadQueue = useCallback(async () => {
        setLoading(true);
        try {
            const d = await apiFetch('/api/ap/payroll-queue');
            setQueue(d.queue || []);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => { loadQueue(); }, [loadQueue]);

    const expandMonth = async (yr, mo, client, contract) => {
        const key = `${yr}-${mo}-${client||''}-${contract||''}`;
        if (expandedMonth === key) { setExpandedMonth(null); return; }
        setExpandedMonth(key);
        if (monthDetail[key]) return;
        try {
            const params = new URLSearchParams();
            if (client) params.set('client', client);
            if (contract) params.set('contract', contract);
            const d = await apiFetch(`/api/ap/payroll-queue/${yr}/${mo}?${params.toString()}`);
            setMonthDetail(prev => ({ ...prev, [key]: d }));
        } catch (e) { console.error(e); }
    };

    const handleConfirm = async (item, formData) => {
        formData.client_filter = item.client || null;
        formData.contract_filter = item.contract_name || null;
        await apiFetch(`/api/ap/payroll-queue/${item.year}/${item.month}/confirm`, {
            method: 'POST',
            body: JSON.stringify(formData),
        });
        setSuccessMsg(`Payment for ${item.contract_name || item.client || ''} — ${MONTH_NAMES[item.month - 1]} ${item.year} confirmed!`);
        loadQueue();
    };

    const statusBadge = (batchCount) => {
        if (parseInt(batchCount) > 0) return { label: 'Processed', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' };
        return { label: 'Pending AP', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                    <h3 style={{ margin: 0, color: '#f0f4f8', fontSize: '1.1rem' }}>Payroll Payment Queue</h3>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.83rem' }}>Locked payroll months awaiting bank transfer confirmation.</p>
                </div>
                <button onClick={loadQueue} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.83rem' }}>
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            {successMsg && (
                <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '10px', padding: '0.85rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '10px', color: '#22c55e', fontSize: '0.88rem' }}>
                    <CheckCircle size={16} /> {successMsg}
                    <button onClick={() => setSuccessMsg(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#22c55e', cursor: 'pointer' }}><X size={14} /></button>
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>Loading payroll queue…</div>
            ) : !queue.length ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                    <Clock size={40} style={{ opacity: 0.3, marginBottom: '1rem', display: 'block', margin: '0 auto 1rem' }} />
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>No locked payroll months yet</div>
                    <div style={{ fontSize: '0.83rem', marginTop: '0.4rem' }}>Lock a payroll month in the Payroll Sheet to see it here.</div>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {queue.map(item => {
                        const key = `${item.year}-${item.month}-${item.client||''}-${item.contract_name||''}`;
                        const isExpanded = expandedMonth === key;
                        const badge = statusBadge(item.batch_count);
                        const detail = monthDetail[key];

                        return (
                            <div key={key} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                                {/* Header row */}
                                <div style={{ display: 'flex', alignItems: 'center', padding: '1rem 1.25rem', gap: '1rem', cursor: 'pointer' }}
                                    onClick={() => expandMonth(item.year, item.month, item.client, item.contract_name)}>
                                    {isExpanded ? <ChevronDown size={16} color="#64748b" /> : <ChevronRight size={16} color="#64748b" />}
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, color: '#f0f4f8', fontSize: '0.95rem' }}>
                                            {MONTH_NAMES[item.month - 1]} {item.year}
                                            {item.contract_name && <span style={{ marginLeft: '8px', fontSize: '0.82rem', color: 'var(--primary)', fontWeight: 600 }}>· {item.contract_name}</span>}
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                                            {item.client && <span style={{ marginRight: '8px', color: '#94a3b8' }}>{item.client}</span>}
                                            {item.employee_count} employees · Locked by {item.locked_by || '—'}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 800, color: '#22c55e', fontSize: '1.05rem' }}>{Rs(item.total_net_pay)}</div>
                                        <div style={{ fontSize: '0.73rem', color: '#64748b' }}>Net Pay</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 700, color: '#a78bfa', fontSize: '0.95rem' }}>{Rs(item.total_invoice)}</div>
                                        <div style={{ fontSize: '0.73rem', color: '#64748b' }}>Invoice Value</div>
                                    </div>
                                    <span style={{ background: badge.bg, color: badge.color, padding: '4px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700, minWidth: '100px', textAlign: 'center' }}>
                                        {badge.label}
                                    </span>
                                    {parseInt(item.batch_count) === 0 && (
                                        <button
                                            onClick={e => { e.stopPropagation(); setConfirmTarget(item); }}
                                            style={{ background: '#22c55e', border: 'none', color: 'white', padding: '7px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                                            <CreditCard size={14} /> Confirm Payment
                                        </button>
                                    )}
                                </div>

                                {/* Expanded employee table */}
                                {isExpanded && (
                                    <div style={{ borderTop: '1px solid var(--border)', padding: '1rem 1.25rem' }}>
                                        {!detail ? (
                                            <div style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b', fontSize: '0.85rem' }}>Loading employee details…</div>
                                        ) : (
                                            <>
                                                {detail.batch && (
                                                    <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: '#22c55e', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                                                        <span>✓ <strong>Confirmed</strong></span>
                                                        <span>Bank: <strong>{detail.batch.bank_name}</strong></span>
                                                        <span>Date: <strong>{detail.batch.payment_date || '—'}</strong></span>
                                                        <span>Ref: <strong>{detail.batch.reference_no || '—'}</strong></span>
                                                        <span>Confirmed by: <strong>{detail.batch.created_by}</strong></span>
                                                    </div>
                                                )}
                                                <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                                        <thead style={{ background: 'var(--bg-dark)' }}>
                                                            <tr>{['Employee', 'Contract', 'Bank', 'Account', 'Gross', 'Net Pay', 'Invoice'].map(h => (
                                                                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Employee' || h === 'Contract' || h === 'Bank' ? 'left' : 'right', color: '#64748b', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                                                            ))}</tr>
                                                        </thead>
                                                        <tbody>
                                                            {(detail.employees || []).map((emp, i) => (
                                                                <tr key={i} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                                                                    <td style={{ padding: '7px 10px', fontWeight: 600, color: '#f0f4f8' }}>{emp.name}</td>
                                                                    <td style={{ padding: '7px 10px', color: '#64748b', fontSize: '0.78rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.contract_name || emp.client || '—'}</td>
                                                                    <td style={{ padding: '7px 10px', color: '#64748b' }}>{emp.bank_name || '—'}</td>
                                                                    <td style={{ padding: '7px 10px', color: '#64748b', fontFamily: 'monospace', fontSize: '0.78rem' }}>{emp.bank_account || '—'}</td>
                                                                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#94a3b8' }}>{fmt(emp.gross)}</td>
                                                                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: '#22c55e' }}>{fmt(emp.net)}</td>
                                                                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#a78bfa' }}>{fmt(emp.total_invoice)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                        <tfoot style={{ background: '#0a1018', fontWeight: 800, borderTop: '2px solid var(--border)' }}>
                                                            <tr>
                                                                <td colSpan={4} style={{ padding: '8px 10px', color: '#64748b' }}>TOTAL ({detail.employees?.length || 0} employees)</td>
                                                                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#94a3b8' }}>{fmt((detail.employees||[]).reduce((s,e)=>s+parseFloat(e.gross||0),0))}</td>
                                                                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#22c55e' }}>{fmt((detail.employees||[]).reduce((s,e)=>s+parseFloat(e.net||0),0))}</td>
                                                                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#a78bfa' }}>{fmt((detail.employees||[]).reduce((s,e)=>s+parseFloat(e.total_invoice||0),0))}</td>
                                                            </tr>
                                                        </tfoot>
                                                    </table>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {confirmTarget && (
                <ConfirmPaymentModal
                    title={`Payroll — ${MONTH_NAMES[confirmTarget.month - 1]} ${confirmTarget.year}`}
                    totalAmount={parseFloat(confirmTarget.total_net_pay) || 0}
                    employeeCount={parseInt(confirmTarget.employee_count) || 0}
                    onConfirm={(data) => handleConfirm(confirmTarget, data)}
                    onClose={() => setConfirmTarget(null)}
                />
            )}
        </div>
    );
}

// ─── Bills Queue Panel ────────────────────────────────────────────────────────
function BillsQueuePanel() {
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [confirmTarget, setConfirmTarget] = useState(null);
    const [billable, setBillable] = useState({});
    const [successMsg, setSuccessMsg] = useState(null);

    const loadBills = useCallback(async () => {
        setLoading(true);
        try {
            const d = await apiFetch('/api/ap/bills-queue');
            setBills(d.bills || []);
        } catch (e) { console.error(e); }
        setLoading(false);
    }, []);

    useEffect(() => { loadBills(); }, [loadBills]);

    const handleConfirm = async (bill, formData) => {
        formData.billable = billable[bill.id] !== false;
        await apiFetch(`/api/ap/bills/${bill.id}/confirm`, {
            method: 'POST',
            body: JSON.stringify(formData),
        });
        setSuccessMsg(`Payment for bill "${bill.id}" confirmed!`);
        loadBills();
    };

    const statusColor = (s) => {
        if (s === 'Approved') return { label: 'Approved', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' };
        if (s === 'Posted') return { label: 'Posted', color: '#38bdf8', bg: 'rgba(56,189,248,0.1)' };
        return { label: s || 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                    <h3 style={{ margin: 0, color: '#f0f4f8', fontSize: '1.1rem' }}>Bills Payment Queue</h3>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.83rem' }}>Approved bills pending AP/bank confirmation. Mark billable status before confirming.</p>
                </div>
                <button onClick={loadBills} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.83rem' }}>
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            {successMsg && (
                <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '10px', padding: '0.85rem 1.25rem', marginBottom: '1.25rem', color: '#22c55e', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <CheckCircle size={16} /> {successMsg}
                    <button onClick={() => setSuccessMsg(null)} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#22c55e', cursor: 'pointer' }}><X size={14} /></button>
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>Loading bills queue…</div>
            ) : !bills.length ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                    <FileText size={40} style={{ opacity: 0.3, marginBottom: '1rem', display: 'block', margin: '0 auto 1rem' }} />
                    <div style={{ fontWeight: 600, fontSize: '1rem' }}>No bills pending payment</div>
                    <div style={{ fontSize: '0.83rem', marginTop: '0.4rem' }}>Approved bills will appear here for AP confirmation.</div>
                </div>
            ) : (
                <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead style={{ background: 'var(--bg-dark)' }}>
                            <tr>{['ID', 'Vendor', 'Type', 'Amount', 'Status', 'Billable?', 'Actions'].map(h => (
                                <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Amount' ? 'right' : 'left', color: '#64748b', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}</tr>
                        </thead>
                        <tbody>
                            {bills.map((bill, i) => {
                                const badge = statusColor(bill.status);
                                const isBillable = billable[bill.id] !== false;
                                return (
                                    <tr key={bill.id} style={{ borderTop: '1px solid var(--border)', background: i % 2 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#94a3b8', fontSize: '0.78rem' }}>{bill.id}</td>
                                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#f0f4f8' }}>{bill.vendor || bill.client || '—'}</td>
                                        <td style={{ padding: '10px 12px', color: '#94a3b8' }}>{bill.bill_type || '—'}</td>
                                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#22c55e' }}>{Rs(bill.amount || bill.total || 0)}</td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <span style={{ background: badge.bg, color: badge.color, padding: '3px 8px', borderRadius: '12px', fontSize: '0.73rem', fontWeight: 700 }}>{badge.label}</span>
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    onClick={() => setBillable(p => ({ ...p, [bill.id]: true }))}
                                                    style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${isBillable ? '#22c55e' : 'rgba(255,255,255,0.1)'}`, background: isBillable ? 'rgba(34,197,94,0.15)' : 'transparent', color: isBillable ? '#22c55e' : '#64748b', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>
                                                    Billable
                                                </button>
                                                <button
                                                    onClick={() => setBillable(p => ({ ...p, [bill.id]: false }))}
                                                    style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${!isBillable ? '#f59e0b' : 'rgba(255,255,255,0.1)'}`, background: !isBillable ? 'rgba(245,158,11,0.15)' : 'transparent', color: !isBillable ? '#f59e0b' : '#64748b', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>
                                                    Non-Billable
                                                </button>
                                            </div>
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            {bill.status !== 'Posted' && (
                                                <button
                                                    onClick={() => setConfirmTarget(bill)}
                                                    style={{ background: '#22c55e', border: 'none', color: 'white', padding: '5px 12px', borderRadius: '7px', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                    <CreditCard size={13} /> Pay
                                                </button>
                                            )}
                                            {bill.status === 'Posted' && (
                                                <span style={{ color: '#38bdf8', fontSize: '0.78rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                    <CheckCircle size={13} /> Paid
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {confirmTarget && (
                <ConfirmPaymentModal
                    title={`Bill — ${confirmTarget.vendor || confirmTarget.client || confirmTarget.id}`}
                    totalAmount={parseFloat(confirmTarget.amount || confirmTarget.total) || 0}
                    employeeCount={0}
                    onConfirm={(data) => handleConfirm(confirmTarget, data)}
                    onClose={() => setConfirmTarget(null)}
                />
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AccountsPayable({ user }) {
    const [tab, setTab] = useState('payroll');

    const allowedRoles = ['ap_team', 'finance_manager', 'finance_approver', 'superadmin'];
    if (!allowedRoles.includes(user?.role)) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: '1rem', color: '#64748b' }}>
                <AlertCircle size={48} style={{ opacity: 0.4 }} />
                <h3 style={{ margin: 0 }}>Access Restricted</h3>
                <p style={{ margin: 0, fontSize: '0.88rem' }}>This module is available to AP Team and Finance Manager roles only.</p>
            </div>
        );
    }

    return (
        <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
            {/* Header */}
            <div style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '0.5rem' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, #22c55e, #16a34a)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CreditCard size={20} color="white" />
                    </div>
                    <div>
                        <h2 style={{ margin: 0, color: '#f0f4f8', fontSize: '1.3rem' }}>Accounts Payable</h2>
                        <p style={{ margin: 0, color: '#64748b', fontSize: '0.83rem' }}>Confirm and process payroll &amp; vendor payments · Bank selection · Xero integration</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px', marginBottom: '2rem', maxWidth: '480px' }}>
                {[
                    { id: 'payroll', label: '💰 Payroll Queue', icon: Building2 },
                    { id: 'bills', label: '📄 Bills Queue', icon: FileText },
                ].map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        style={{ flex: 1, padding: '8px 16px', borderRadius: '7px', border: 'none', background: tab === t.id ? 'var(--primary)' : 'transparent', color: tab === t.id ? 'white' : '#64748b', cursor: 'pointer', fontWeight: tab === t.id ? 700 : 600, fontSize: '0.88rem', transition: 'all 0.15s' }}>
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            {tab === 'payroll' && <PayrollQueuePanel />}
            {tab === 'bills' && <BillsQueuePanel />}
        </div>
    );
}
