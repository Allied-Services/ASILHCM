import React, { useState } from 'react';
import { FilePlus, Eye, Download, CheckCircle, Lock, Send, Printer, X, ExternalLink } from 'lucide-react';
import { api } from './api';

// ─── Sample approved sources ───────────────────────────────────────────────────
// In production these come from the payroll engine and billing module
const APPROVED_PAYROLLS = [
    { id: 'PAY-2026-03-BAHL', client: 'Bank Al Habib', contract: 'CTR-2026-BAHL-A1 — Security Services', period: 'March 2026', employees: 3, grossCost: 155000, employerCosts: 45193, totalPayrollCost: 200193, svcPct: 15, stPct: 17, used: false },
    { id: 'PAY-2026-03-WAFI', client: 'Wafi Energy Pakistan Limited', contract: 'CTR-2024-WFI-001 — Terminal Ops Bhakkar', period: 'March 2026', employees: 1, grossCost: 72245, employerCosts: 24000, totalPayrollCost: 96245, svcPct: 12, stPct: 17, used: false },
    { id: 'PAY-2026-02-BAHL', client: 'Bank Al Habib', contract: 'CTR-2026-BAHL-A1 — Security Services', period: 'February 2026', employees: 3, grossCost: 153000, employerCosts: 45000, totalPayrollCost: 198000, svcPct: 15, stPct: 17, used: true },
];
const APPROVED_DEBIT_NOTES = [
    { id: 'DN-2026-001', client: 'Wafi Energy Pakistan Limited', contract: 'CTR-2024-WFI-001 — Terminal Ops Bhakkar', description: 'Pump repair — Bhakkar Terminal', amount: 12500, gst: 2250, total: 14750, svcPct: 0, used: false },
    { id: 'DN-2026-002', client: 'Bank Al Habib', contract: 'CTR-2026-BAHL-A2 — Janitorial', description: 'Guard Uniforms Q1 2026', amount: 35000, gst: 6300, total: 41300, svcPct: 0, used: true },
    { id: 'DN-2026-003', client: 'Gul Ahmed Textile', contract: 'CTR-2025-GT-01 — Facilities Management', description: 'PPE Procurement', amount: 88000, gst: 15840, total: 103840, svcPct: 0, used: false },
];

// ─── Company details ───────────────────────────────────────────────────────────
const CO = {
    name: 'Allied Services (Pvt.) Ltd.',
    address: '301, 3rd Floor, Business Avenue, Shahrah-e-Faisal, Karachi – 75350',
    ntn: '7483900-1',
    strn: 'SRB-02-2024-XXXXX',
    phone: '(021) 3456-7890',
    email: 'accounts@alliedservices.com.pk',
};

const CLIENTS = ['Bank Al Habib', 'Wafi Energy Pakistan Limited', 'Pakistan State Oil Company', 'Gul Ahmed Textile'];
const CONTRACTS_MAP = {
    'Bank Al Habib': ['CTR-2026-BAHL-A1 — Security Services', 'CTR-2026-BAHL-A2 — Janitorial'],
    'Wafi Energy Pakistan Limited': ['CTR-2024-WFI-001 — Terminal Ops Bhakkar'],
    'Pakistan State Oil Company': ['CTR-2025-PSO-X9 — General Workers'],
    'Gul Ahmed Textile': ['CTR-2025-GT-01 — Facilities Management'],
};
const CLIENT_NTN = {
    'Bank Al Habib': '1234567-1',
    'Wafi Energy Pakistan Limited': '9876543-2',
    'Pakistan State Oil Company': '1112223-3',
    'Gul Ahmed Textile': '4445556-4',
};

const fmt = n => Math.round(parseFloat(n) || 0).toLocaleString('en-PK');
const Rs = n => `Rs. ${fmt(n)}`;
const today = () => new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });
let INV_COUNTER = 1;

// Generate rolling billing period options: 12 months back + 3 months forward
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function getBillingPeriods() {
    const periods = [];
    const now = new Date();
    for (let i = 12; i >= -3; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        periods.push(`${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`);
    }
    return periods;
}
const BILLING_PERIODS = getBillingPeriods();

// ─── Invoice Preview / Print ───────────────────────────────────────────────────
function renderInvoiceHTML(inv) {
    const rows = [
        ...inv.payrolls.map(p => ({
            desc: `Manpower Services — ${p.contract.split('—')[1]?.trim() || p.contract} (${p.period}, ${p.employees} employees)`,
            amount: p.totalPayrollCost, svc: Math.round(p.totalPayrollCost * p.svcPct / 100), st: 0,
        })),
        ...inv.debitNotes.map(d => ({
            desc: `${d.description} [Debit Note ${d.id}]`,
            amount: d.total, svc: 0, st: 0,
        })),
    ].map(r => ({ ...r, lineTotal: r.amount + r.svc }));
    const subtotal = rows.reduce((a, r) => a + r.lineTotal, 0);
    const totalST = inv.payrolls.reduce((a, p) => a + Math.round(Math.round(p.totalPayrollCost * p.svcPct / 100) * p.stPct / 100), 0);
    const grandTotal = subtotal + totalST + (parseFloat(inv.whtOnServices) || 0) * -1; // WHT reduces client's liability shown
    const formattedTotal = grandTotal;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
body{font-family:Arial,sans-serif;font-size:11pt;color:#000;margin:0;padding:0}
.page{max-width:800px;margin:0 auto;padding:30px 40px}
.hdr{display:flex;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:16px;margin-bottom:20px}
.co{font-size:15pt;font-weight:bold;color:#1e3a5f}
.co-sub{font-size:9pt;color:#555;margin-top:2px}
.inv-title{text-align:right}
.inv-title h2{font-size:20pt;color:#1e3a5f;margin:0}
.inv-title p{font-size:9pt;color:#555;margin:2px 0}
.bill-section{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
.bill-to h4,.bill-from h4{font-size:8pt;text-transform:uppercase;letter-spacing:.06em;color:#888;margin:0 0 4px}
.bill-to p,.bill-from p{margin:2px 0;font-size:10pt}
table{width:100%;border-collapse:collapse;margin-bottom:16px}
th{background:#1e3a5f;color:#fff;padding:8px 10px;font-size:9pt;text-align:left}
td{padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:10pt}
.num{text-align:right}
.totals tr td{border:none;padding:4px 10px}
.grand{background:#1e3a5f;color:#fff;font-weight:bold;font-size:12pt}
.footer{margin-top:30px;font-size:9pt;color:#888;border-top:1px solid #e2e8f0;padding-top:12px}
</style></head><body><div class="page">
<div class="hdr">
  <div><div class="co">${CO.name}</div><div class="co-sub">${CO.address}</div><div class="co-sub">NTN: ${CO.ntn} | STRN: ${CO.strn}</div><div class="co-sub">${CO.phone} | ${CO.email}</div></div>
  <div class="inv-title"><h2>INVOICE</h2><p><strong>${inv.number}</strong></p><p>Date: ${today()}</p><p>Due: ${inv.dueDate}</p><p>Status: ${inv.status}</p></div>
</div>
<div class="bill-section">
  <div class="bill-to"><h4>Bill To</h4><p><strong>${inv.client}</strong></p><p>NTN: ${CLIENT_NTN[inv.client] || '—'}</p><p>${inv.contract}</p></div>
  <div class="bill-from"><h4>Period</h4><p>${inv.period}</p>${inv.poNumber ? `<p>PO/Reference: ${inv.poNumber}</p>` : ''}</div>
</div>
<table>
  <thead><tr><th>Description</th><th class="num">Base Amount</th><th class="num">Service Charges</th><th class="num">Line Total</th></tr></thead>
  <tbody>${rows.map(r => `<tr><td>${r.desc}</td><td class="num">${Rs(r.amount)}</td><td class="num">${Rs(r.svc)}</td><td class="num">${Rs(r.lineTotal)}</td></tr>`).join('')}</tbody>
</table>
<table class="totals"><tbody>
  <tr><td colspan="3" style="text-align:right">Sub-Total</td><td class="num" style="width:150px">${Rs(subtotal)}</td></tr>
  <tr><td colspan="3" style="text-align:right">Sales Tax on Service Charges</td><td class="num">${Rs(totalST)}</td></tr>
  ${inv.whtOnServices ? `<tr><td colspan="3" style="text-align:right;color:#dc2626">WHT Deduction (by client)</td><td class="num" style="color:#dc2626">- ${Rs(inv.whtOnServices)}</td></tr>` : ''}
  <tr class="grand"><td colspan="3" style="text-align:right">TOTAL PAYABLE</td><td class="num">${Rs(formattedTotal)}</td></tr>
</tbody></table>
<div style="background:#f8fafc;border-radius:8px;padding:16px;font-size:10pt;margin-bottom:20px">
  <strong>Bank Details for Payment:</strong><br/>
  Bank: Habib Bank Ltd. (HBL) | Account: 1037900000000 | Account Title: Allied Services (Pvt.) Ltd.<br/>
  Branch: Shahrah-e-Faisal | IBAN: PK36HABB0000010379000000
</div>
<div class="footer">This is a computer-generated invoice. Invoice No: ${inv.number} | Generated: ${today()} | Please quote invoice number in all correspondence.</div>
</div></body></html>`;
}

function printInvoice(inv) {
    const html = renderInvoiceHTML(inv);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Allow popups to print invoice.'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
}

// ─── Create Invoice Modal ─────────────────────────────────────────────────────
function CreateInvoiceModal({ onSave, onClose }) {
    const [client, setClient] = useState('');
    const [contract, setContract] = useState('');
    const now = new Date();
    const defaultPeriod = `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
    const [period, setPeriod] = useState(defaultPeriod);
    const [poNumber, setPoNumber] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [whtVal, setWhtVal] = useState('');
    const [selPay, setSelPay] = useState([]);
    const [selDN, setSelDN] = useState([]);

    const availPay = APPROVED_PAYROLLS.filter(p => !p.used && (!client || p.client === client) && (!contract || p.contract === contract));
    const availDN = APPROVED_DEBIT_NOTES.filter(d => !d.used && (!client || d.client === client) && (!contract || d.contract === contract));

    const togglePay = (id) => setSelPay(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    const toggleDN = (id) => setSelDN(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

    const selPayObjs = APPROVED_PAYROLLS.filter(p => selPay.includes(p.id));
    const selDNObjs = APPROVED_DEBIT_NOTES.filter(d => selDN.includes(d.id));
    const basePayroll = selPayObjs.reduce((a, p) => a + p.totalPayrollCost, 0);
    const svcCharges = selPayObjs.reduce((a, p) => a + Math.round(p.totalPayrollCost * p.svcPct / 100), 0);
    const stCharges = selPayObjs.reduce((a, p) => a + Math.round(Math.round(p.totalPayrollCost * p.svcPct / 100) * p.stPct / 100), 0);
    const dnTotal = selDNObjs.reduce((a, d) => a + d.total, 0);
    const grandTotal = basePayroll + svcCharges + stCharges + dnTotal - (parseFloat(whtVal) || 0);
    const canCreate = (selPay.length > 0 || selDN.length > 0) && client;

    const create = () => {
        const inv = {
            number: `ASIL/INV/2026/${String(INV_COUNTER++).padStart(3, '0')}`,
            client, contract, period, poNumber, dueDate, whtOnServices: parseFloat(whtVal) || 0,
            payrolls: selPayObjs, debitNotes: selDNObjs,
            subtotal: basePayroll + dnTotal, svcCharges, stCharges, grandTotal,
            status: 'Draft', createdAt: today(),
        };
        onSave(inv); onClose();
    };

    const SL = ({ opts, sel, toggle }) => (
        (opts.length === 0) ? <div style={{ padding: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: '8px' }}>No approved items for this selection.</div> :
            opts.map(item => (
                <div key={item.id} onClick={() => toggle(item.id)}
                    style={{ padding: '0.85rem 1rem', borderRadius: '10px', border: `2px solid ${sel.includes(item.id) ? 'var(--primary)' : 'var(--border)'}`, background: sel.includes(item.id) ? 'rgba(56,189,248,0.07)' : 'transparent', cursor: 'pointer', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', transition: 'all 0.15s' }}>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{item.id}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{item.description || (item.employees + ' employees · ' + item.period)}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.contract?.split('—')[1]?.trim()}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: sel.includes(item.id) ? 'var(--primary)' : 'var(--text)' }}>{Rs(item.totalPayrollCost || item.total)}</div>
                        {sel.includes(item.id) && <CheckCircle size={16} color="var(--primary)" style={{ marginTop: '4px' }} />}
                    </div>
                </div>
            ))
    );

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: '860px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0 }}>Create New Invoice</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
                </div>
                <div style={{ padding: '1.75rem 2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', maxHeight: '75vh', overflowY: 'auto' }}>
                    {/* Left — Select client, contract, meta */}
                    <div>
                        <div style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>1. Client & Contract</div>
                        {[['Client', client, setClient, CLIENTS], ['Contract', contract, setContract, CONTRACTS_MAP[client] || []]].map(([label, val, setter, opts]) => (
                            <div key={label} style={{ marginBottom: '0.85rem' }}>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '3px', fontWeight: 600 }}>{label}</label>
                                <select value={val} onChange={e => { setter(e.target.value); if (label === 'Client') { setContract(''); setSelPay([]); setSelDN([]); } }}
                                    style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none' }}>
                                    <option value="">— Select {label} —</option>
                                    {opts.map(o => <option key={o}>{o}</option>)}
                                </select>
                            </div>
                        ))}
                        {/* Billing Period — Dropdown */}
                        <div style={{ marginBottom: '0.85rem' }}>
                            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '3px', fontWeight: 600 }}>Billing Period</label>
                            <select value={period} onChange={e => setPeriod(e.target.value)}
                                style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none' }}>
                                {BILLING_PERIODS.map(p => <option key={p}>{p}</option>)}
                            </select>
                        </div>
                        {/* Other fields */}
                        {[['PO / Reference No.', setPoNumber, poNumber, 'text', "Client's PO number"], ['Payment Due Date', setDueDate, dueDate, 'date', ''], ['WHT to be deducted by client (PKR)', setWhtVal, whtVal, 'number', '0']].map(([label, setter, val, type, ph]) => (
                            <div key={label} style={{ marginBottom: '0.85rem' }}>
                                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '3px', fontWeight: 600 }}>{label}</label>
                                <input type={type} value={val} onChange={e => setter(e.target.value)} placeholder={ph}
                                    style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none' }} />
                            </div>
                        ))}
                    </div>

                    {/* Right — Select payroll runs + debit notes */}
                    <div>
                        <div style={{ fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>2. Select Items to Invoice</div>

                        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Approved Payroll Runs</div>
                        <SL opts={availPay} sel={selPay} toggle={togglePay} />

                        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.5rem', marginTop: '1rem' }}>Approved Debit Notes</div>
                        <SL opts={availDN} sel={selDN} toggle={toggleDN} />

                        {canCreate && (
                            <div style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '12px', padding: '1rem', marginTop: '1rem' }}>
                                <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Invoice Summary</div>
                                {[['Payroll Cost', Rs(basePayroll)], ['Service Charges', Rs(svcCharges)], ['Sales Tax (on svc charges)', Rs(stCharges)], ['Debit Note Items', Rs(dnTotal)], ['WHT Deduction', whtVal ? `- ${Rs(whtVal)}` : '—']].map(([l, v]) => (
                                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', padding: '3px 0', color: 'var(--text-muted)' }}>
                                        <span>{l}</span><strong style={{ color: 'var(--text)' }}>{v}</strong>
                                    </div>
                                ))}
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: '6px', marginTop: '6px', fontWeight: 800, fontSize: '1rem' }}>
                                    <span>TOTAL PAYABLE</span><span style={{ color: 'var(--primary)' }}>{Rs(grandTotal)}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ gridColumn: '1/-1', display: 'flex', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                        <button onClick={onClose} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={create} disabled={!canCreate}
                            style={{ flex: 3, background: canCreate ? 'var(--primary)' : '#334155', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: canCreate ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '0.95rem' }}>
                            Generate Invoice
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Invoice Preview Modal ────────────────────────────────────────────────────
function InvoicePreviewModal({ inv, onAction, onClose }) {
    const flow = { 'Draft': ['Send for Approval'], 'Pending Approval': ['Approve', 'Reject'], 'Approved': ['Mark as Sent'], 'Sent': ['Mark as Paid'], 'Paid': [], 'Rejected': [] };
    const actions = flow[inv.status] || [];
    const nextStatus = { 'Send for Approval': 'Pending Approval', 'Approve': 'Approved', 'Reject': 'Rejected', 'Mark as Sent': 'Sent', 'Mark as Paid': 'Paid' };
    const [xeroStatus, setXeroStatus] = useState(null); // null | 'sending' | 'sent' | 'error'
    const [xeroUrl, setXeroUrl]   = useState(null);
    const canSendXero = ['Approved', 'Sent', 'Paid'].includes(inv.status);

    const sendToXero = async () => {
        setXeroStatus('sending');
        try {
            const res = await api.post('/api/xero/invoices', { invoice: inv });
            if (res.data?.xeroUrl) setXeroUrl(res.data.xeroUrl);
            setXeroStatus('sent');
        } catch (e) {
            console.error('Xero push failed:', e);
            setXeroStatus('error');
        }
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: '920px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h3 style={{ margin: 0 }}>{inv.number}</h3>
                        <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.74rem', fontWeight: 700, background: inv.status === 'Paid' ? 'rgba(34,197,94,0.12)' : inv.status === 'Approved' || inv.status === 'Sent' ? 'rgba(56,189,248,0.12)' : 'rgba(100,116,139,0.12)', color: inv.status === 'Paid' ? '#22c55e' : inv.status === 'Approved' || inv.status === 'Sent' ? 'var(--primary)' : 'var(--text-muted)' }}>{inv.status}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {canSendXero && (
                            xeroStatus === 'sent' ? (
                                <a href={xeroUrl || 'https://go.xero.com/AccountsReceivable/Search.aspx'} target="_blank" rel="noreferrer"
                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#00B5C8', border: 'none', color: 'white', padding: '7px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
                                    <ExternalLink size={14} /> View in Xero ✓
                                </a>
                            ) : (
                                <button onClick={sendToXero} disabled={xeroStatus === 'sending'}
                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: xeroStatus === 'error' ? '#ef4444' : '#00B5C8', border: 'none', color: 'white', padding: '7px 14px', borderRadius: '7px', cursor: xeroStatus === 'sending' ? 'wait' : 'pointer', fontWeight: 600, fontSize: '0.85rem', opacity: xeroStatus === 'sending' ? 0.7 : 1 }}>
                                    <Send size={14} /> {xeroStatus === 'sending' ? 'Sending…' : xeroStatus === 'error' ? 'Retry Xero' : 'Send to Xero'}
                                </button>
                            )
                        )}
                        <button onClick={() => printInvoice(inv)}
                            style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#22c55e', border: 'none', color: 'white', padding: '7px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                            <Printer size={14} /> Print / PDF
                        </button>
                        <button onClick={onClose} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 12px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.85rem' }}>Close</button>
                    </div>
                </div>
                <div style={{ padding: '1.75rem 2rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                        {[['Client', inv.client], ['Contract', inv.contract?.split('—')[1]?.trim() || inv.contract], ['Period', inv.period], ['Grand Total', Rs(inv.grandTotal)]].map(([l, v]) => (
                            <div key={l}><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '2px' }}>{l}</div><div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{v}</div></div>
                        ))}
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Payroll Runs Included</div>
                        {inv.payrolls.map(p => (
                            <div key={p.id} style={{ padding: '0.7rem 1rem', background: 'var(--bg-dark)', borderRadius: '8px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                <span>{p.id} · {p.period} · {p.employees} employees</span>
                                <span style={{ fontWeight: 700 }}>{Rs(p.totalPayrollCost)}</span>
                            </div>
                        ))}
                    </div>
                    {inv.debitNotes.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Debit Notes Included</div>
                            {inv.debitNotes.map(d => (
                                <div key={d.id} style={{ padding: '0.7rem 1rem', background: 'var(--bg-dark)', borderRadius: '8px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                    <span>{d.id} · {d.description}</span>
                                    <span style={{ fontWeight: 700 }}>{Rs(d.total)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.5rem', background: 'rgba(56,189,248,0.07)', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem' }}>
                        {[['Payroll Cost', inv.subtotal], ['+ Service Charges', inv.svcCharges], ['+ Sales Tax', inv.stCharges], ['GRAND TOTAL', inv.grandTotal]].map(([l, v]) => (
                            <div key={l} style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '3px' }}>{l}</div>
                                <div style={{ fontWeight: 800, color: l === 'GRAND TOTAL' ? 'var(--primary)' : 'var(--text)' }}>{Rs(v)}</div>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {actions.map(a => (
                            <button key={a} onClick={() => { onAction(inv.number, nextStatus[a]); onClose(); }}
                                style={{ flex: 1, background: a === 'Approve' || a === 'Mark as Paid' ? '#22c55e' : a === 'Reject' ? '#ef4444' : 'var(--primary)', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                                {a}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function InvoiceSection() {
    const [invoices, setInvoices] = useState([]);
    const [showCreate, setShowCreate] = useState(false);
    const [previewInv, setPreviewInv] = useState(null);

    const addInvoice = (inv) => setInvoices(p => [inv, ...p]);
    const updateStatus = (num, status) => setInvoices(p => p.map(i => i.number === num ? { ...i, status } : i));

    const STATUS_STYLES = {
        'Draft': { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8' },
        'Pending Approval': { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
        'Approved': { bg: 'rgba(56,189,248,0.12)', color: '#38bdf8' },
        'Sent': { bg: 'rgba(99,102,241,0.12)', color: '#818cf8' },
        'Paid': { bg: 'rgba(34,197,94,0.12)', color: '#22c55e' },
        'Rejected': { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
    };

    return (
        <div className="dashboard">
            <header className="header">
                <h1>Invoices</h1>
                <p>Generate client invoices against approved payroll runs and debit notes. Service charges and taxes are auto-applied from contract terms.</p>
            </header>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1rem', flex: 1, marginRight: '1rem' }}>
                    {[
                        { l: 'Total Invoices', v: invoices.length, c: 'var(--primary)' },
                        { l: 'Pending Approval', v: invoices.filter(i => i.status === 'Pending Approval').length, c: '#f59e0b' },
                        { l: 'Sent to Client', v: invoices.filter(i => i.status === 'Sent').length, c: '#818cf8' },
                        { l: 'Total Invoiced', v: Rs(invoices.reduce((a, i) => a + (i.grandTotal || 0), 0)), c: '#22c55e' },
                    ].map(card => (
                        <div key={card.l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>{card.l}</div>
                            <div style={{ fontWeight: 800, fontSize: '1rem', color: card.c }}>{card.v}</div>
                        </div>
                    ))}
                </div>
                <button onClick={() => setShowCreate(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', border: 'none', color: 'white', padding: '11px 22px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem', flexShrink: 0 }}>
                    <FilePlus size={18} /> Create Invoice
                </button>
            </div>

            {invoices.length === 0 ? (
                <div style={{ background: 'var(--bg-card)', border: '2px dashed var(--border)', borderRadius: '16px', padding: '4rem', textAlign: 'center' }}>
                    <FilePlus size={48} color="var(--text-muted)" style={{ marginBottom: '1rem' }} />
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>No invoices yet</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Invoices are generated from approved payroll runs and debit notes.</div>
                    <button onClick={() => setShowCreate(true)}
                        style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                        Create First Invoice
                    </button>
                </div>
            ) : (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-dark)' }}>
                                {['Invoice No.', 'Client', 'Contract', 'Period', 'Payroll Runs', 'Debit Notes', 'Grand Total', 'Status', 'Actions'].map(h => (
                                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map((inv, i) => {
                                const ss = STATUS_STYLES[inv.status] || STATUS_STYLES['Draft'];
                                return (
                                    <tr key={inv.number} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                                        <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--primary)', fontSize: '0.85rem' }}>{inv.number}</td>
                                        <td style={{ padding: '10px 14px', fontSize: '0.85rem' }}>{inv.client}</td>
                                        <td style={{ padding: '10px 14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{inv.contract?.split('—')[1]?.trim() || '—'}</td>
                                        <td style={{ padding: '10px 14px', fontSize: '0.85rem' }}>{inv.period}</td>
                                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700 }}>{inv.payrolls?.length || 0}</td>
                                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700 }}>{inv.debitNotes?.length || 0}</td>
                                        <td style={{ padding: '10px 14px', fontWeight: 800, color: '#22c55e', whiteSpace: 'nowrap' }}>{Rs(inv.grandTotal)}</td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.74rem', fontWeight: 700, background: ss.bg, color: ss.color }}>{inv.status}</span>
                                        </td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <button onClick={() => setPreviewInv(inv)}
                                                style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', color: 'var(--primary)', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                                <Eye size={13} /> View
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {showCreate && <CreateInvoiceModal onSave={addInvoice} onClose={() => setShowCreate(false)} />}
            {previewInv && <InvoicePreviewModal inv={previewInv} onAction={updateStatus} onClose={() => setPreviewInv(null)} />}
        </div>
    );
}
