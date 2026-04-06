import React, { useState, useEffect, useCallback } from 'react';
import {
    FilePlus, Eye, CheckCircle, Send, Printer, X, ExternalLink,
    RefreshCw, FileText, Edit3, AlertCircle, ChevronDown,
} from 'lucide-react';
import { api } from './api';

const fmt = n => Math.round(parseFloat(n) || 0).toLocaleString('en-PK');
const Rs  = n => `Rs. ${fmt(n)}`;
const today = () => new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });

const CO = {
    name:    'Allied Services (Pvt.) Ltd.',
    address: '301, 3rd Floor, Business Avenue, Shahrah-e-Faisal, Karachi – 75350',
    ntn:     '7483900-1',
    strn:    'SRB-02-2024-XXXXX',
    phone:   '(021) 3456-7890',
    email:   'accounts@alliedservices.com.pk',
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const STATUS_STYLES = {
    'Draft':   { bg: 'rgba(100,116,139,0.12)', color: '#94a3b8' },
    'Raised':  { bg: 'rgba(56,189,248,0.12)',  color: '#38bdf8' },
    'Sent':    { bg: 'rgba(99,102,241,0.12)',   color: '#818cf8' },
    'Paid':    { bg: 'rgba(34,197,94,0.12)',    color: '#22c55e' },
    'Voided':  { bg: 'rgba(239,68,68,0.12)',    color: '#ef4444' },
};

// Status flow: what actions are available per status
const STATUS_FLOW = {
    'Draft':  ['Raise Invoice', 'Void'],
    'Raised': ['Mark as Sent', 'Void'],
    'Sent':   ['Mark as Paid', 'Void'],
    'Paid':   [],
    'Voided': [],
};
const STATUS_NEXT = {
    'Raise Invoice': 'Raised',
    'Mark as Sent':  'Sent',
    'Mark as Paid':  'Paid',
    'Void':          'Voided',
};

// ─── Invoice HTML renderer (print/PDF) ───────────────────────────────────────
function renderInvoiceHTML(inv) {
    const items = (inv.line_items || []);
    const subtotal     = parseFloat(inv.subtotal)        || 0;
    const svcCharges   = parseFloat(inv.service_charges) || 0;
    const salesTax     = parseFloat(inv.sales_tax)       || 0;
    const wht          = parseFloat(inv.wht)             || 0;
    const grandTotal   = parseFloat(inv.grand_total)     || (subtotal + svcCharges + salesTax - wht);

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
body{font-family:Arial,sans-serif;font-size:11pt;color:#000;margin:0;padding:0}
.page{max-width:800px;margin:0 auto;padding:30px 40px}
.hdr{display:flex;justify-content:space-between;border-bottom:3px solid #1e3a5f;padding-bottom:16px;margin-bottom:20px}
.co{font-size:15pt;font-weight:bold;color:#1e3a5f}.co-sub{font-size:9pt;color:#555;margin-top:2px}
.inv-title{text-align:right}.inv-title h2{font-size:20pt;color:#1e3a5f;margin:0}
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
  <div><div class="co">${CO.name}</div><div class="co-sub">${CO.address}</div>
  <div class="co-sub">NTN: ${CO.ntn} | STRN: ${CO.strn}</div>
  <div class="co-sub">${CO.phone} | ${CO.email}</div></div>
  <div class="inv-title"><h2>INVOICE</h2>
    <p><strong>${inv.invoice_number}</strong></p>
    <p>Date: ${today()}</p>
    <p>${inv.due_date ? 'Due: ' + inv.due_date : ''}</p>
    <p>Status: ${inv.status}</p></div>
</div>
<div class="bill-section">
  <div class="bill-to"><h4>Bill To</h4>
    <p><strong>${inv.client}</strong></p>
    ${inv.contract ? `<p>${inv.contract}</p>` : ''}
    ${inv.po_number ? `<p>PO/Ref: ${inv.po_number}</p>` : ''}
  </div>
  <div class="bill-from"><h4>Billing Period</h4>
    <p>${inv.period_month ? MONTH_NAMES[inv.period_month - 1] + ' ' + inv.period_year : '—'}</p>
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th class="num">Amount (PKR)</th></tr></thead>
  <tbody>
    ${items.length > 0
        ? items.map(li => `<tr><td>${li.description || li.desc || ''}</td><td class="num">${Rs(li.amount || li.unit_amount || 0)}</td></tr>`).join('')
        : `<tr><td>Services — ${inv.contract || inv.client}</td><td class="num">${Rs(subtotal)}</td></tr>`
    }
  </tbody>
</table>
<table class="totals"><tbody>
  <tr><td colspan="3" style="text-align:right">Sub-Total</td><td class="num" style="width:150px">${Rs(subtotal)}</td></tr>
  ${svcCharges > 0 ? `<tr><td colspan="3" style="text-align:right">Service Charges</td><td class="num">${Rs(svcCharges)}</td></tr>` : ''}
  ${salesTax   > 0 ? `<tr><td colspan="3" style="text-align:right">Sales Tax on Service Charges</td><td class="num">${Rs(salesTax)}</td></tr>` : ''}
  ${wht        > 0 ? `<tr><td colspan="3" style="text-align:right;color:#dc2626">WHT Deduction (by client)</td><td class="num" style="color:#dc2626">- ${Rs(wht)}</td></tr>` : ''}
  <tr class="grand"><td colspan="3" style="text-align:right">TOTAL PAYABLE</td><td class="num">${Rs(grandTotal)}</td></tr>
</tbody></table>
<div style="background:#f8fafc;border-radius:8px;padding:16px;font-size:10pt;margin-bottom:20px">
  <strong>Bank Details for Payment:</strong><br/>
  Bank: Habib Bank Ltd. (HBL) | Account Title: Allied Services (Pvt.) Ltd.<br/>
  IBAN: PK36HABB0000010379000000 | Branch: Shahrah-e-Faisal, Karachi
</div>
<div class="footer">Computer-generated invoice. No. ${inv.invoice_number} | Generated: ${today()} | Quote invoice number in all correspondence.</div>
</div></body></html>`;
}

function printInvoice(inv) {
    const html = renderInvoiceHTML(inv);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Allow popups to print.'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
}

// ─── Create / Edit Invoice Modal ─────────────────────────────────────────────
function InvoiceFormModal({ existing = null, clients = [], contracts = [], onSave, onClose }) {
    const isEdit = !!existing;
    const now = new Date();

    const [client,         setClient]         = useState(existing?.client        || '');
    const [contract,       setContract]       = useState(existing?.contract      || '');
    const [invNumber,      setInvNumber]      = useState(existing?.invoice_number|| '');
    const [numberLocked,   setNumberLocked]   = useState(isEdit);  // existing numbers locked by default
    const [periodMonth,    setPeriodMonth]    = useState(existing?.period_month  || now.getMonth() + 1);
    const [periodYear,     setPeriodYear]     = useState(existing?.period_year   || now.getFullYear());
    const [poNumber,       setPoNumber]       = useState(existing?.po_number     || '');
    const [dueDate,        setDueDate]        = useState(existing?.due_date      || '');
    const [subtotal,       setSubtotal]       = useState(parseFloat(existing?.subtotal)        || '');
    const [svcCharges,     setSvcCharges]     = useState(parseFloat(existing?.service_charges) || '');
    const [salesTax,       setSalesTax]       = useState(parseFloat(existing?.sales_tax)       || '');
    const [wht,            setWht]            = useState(parseFloat(existing?.wht)             || '');
    const [notes,          setNotes]          = useState(existing?.notes         || '');
    const [lineItems,      setLineItems]      = useState(
        (existing?.line_items || []).length > 0
            ? existing.line_items
            : [{ description: '', amount: '' }]
    );
    const [saving,         setSaving]         = useState(false);
    const [error,          setError]          = useState(null);
    const [suggestedNum,   setSuggestedNum]   = useState('');

    // Fetch suggested invoice number when month/year changes
    useEffect(() => {
        if (isEdit) return;
        // We'll get the suggestion from the server after save with blank invoice_number
        const mo = String(periodMonth).padStart(0,'');
        const moAbbr = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][parseInt(periodMonth)-1];
        const yr2 = String(periodYear).slice(-2);
        setSuggestedNum(`INV-${moAbbr}${yr2}-???`);
    }, [periodMonth, periodYear, isEdit]);

    // Clients from DB
    const clientList  = clients.map(c => c.name || c);
    const contractMap = {};
    contracts.forEach(c => {
        if (!contractMap[c.client_name || c.clientName]) contractMap[c.client_name || c.clientName] = [];
        contractMap[c.client_name || c.clientName].push(c.name || c.reference || c);
    });
    const contractsForClient = contractMap[client] || [];

    // Computed totals from line items
    const lineTotal = lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0);
    const computedSvc = parseFloat(svcCharges) || 0;
    const computedST  = parseFloat(salesTax)   || 0;
    const computedWHT = parseFloat(wht)        || 0;
    const grandTotal  = (parseFloat(subtotal) || lineTotal) + computedSvc + computedST - computedWHT;

    const addLine     = () => setLineItems(p => [...p, { description: '', amount: '' }]);
    const updateLine  = (i, k, v) => setLineItems(p => p.map((li, idx) => idx === i ? { ...li, [k]: v } : li));
    const removeLine  = (i) => setLineItems(p => p.filter((_, idx) => idx !== i));

    const handleSave = async () => {
        if (!client) { setError('Please select a client.'); return; }
        setSaving(true); setError(null);
        try {
            const items = lineItems.filter(li => li.description || li.amount);
            const payload = {
                client, contract: contract || null,
                invoice_number: (numberLocked ? invNumber : null) || undefined,
                period_month: parseInt(periodMonth),
                period_year: parseInt(periodYear),
                po_number: poNumber || null,
                due_date: dueDate || null,
                line_items: items,
                subtotal: parseFloat(subtotal) || lineTotal,
                service_charges: computedSvc,
                sales_tax: computedST,
                wht: computedWHT,
                grand_total: grandTotal,
                notes: notes || null,
            };
            if (isEdit) {
                if (numberLocked && invNumber !== existing.invoice_number) {
                    // Number override
                    await api.updateClientInvoice(existing.id, { invoice_number: invNumber, ...payload });
                } else {
                    await api.updateClientInvoice(existing.id, payload);
                }
            } else {
                await api.createClientInvoice(payload);
            }
            onSave();
            onClose();
        } catch (e) { setError(e.message); setSaving(false); }
    };

    const F = ({ label, children }) => (
        <div style={{ marginBottom: '0.85rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '5px' }}>{label}</label>
            {children}
        </div>
    );
    const inp = { width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: '860px', maxHeight: '92vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 5 }}>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FilePlus size={18} color="var(--primary)" />
                        {isEdit ? `Edit Invoice — ${existing.invoice_number}` : 'Create New Invoice'}
                    </h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '1.75rem 2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                    {/* Left col — metadata */}
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem' }}>
                            1 — Client &amp; Period
                        </div>

                        <F label="Client *">
                            <select value={client} onChange={e => { setClient(e.target.value); setContract(''); }} style={inp}>
                                <option value="">— Select Client —</option>
                                {clientList.map(c => <option key={c}>{c}</option>)}
                            </select>
                        </F>

                        <F label="Contract">
                            <select value={contract} onChange={e => setContract(e.target.value)} style={inp}>
                                <option value="">— Select Contract (optional) —</option>
                                {contractsForClient.map(c => <option key={c}>{c}</option>)}
                            </select>
                        </F>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <F label="Billing Month">
                                <select value={periodMonth} onChange={e => setPeriodMonth(e.target.value)} style={inp}>
                                    {MONTH_NAMES.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                                </select>
                            </F>
                            <F label="Year">
                                <select value={periodYear} onChange={e => setPeriodYear(e.target.value)} style={inp}>
                                    {[2024,2025,2026,2027].map(y => <option key={y}>{y}</option>)}
                                </select>
                            </F>
                        </div>

                        <F label="PO / Client Reference">
                            <input type="text" value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="Client PO or reference number" style={inp} />
                        </F>

                        <F label="Payment Due Date">
                            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={inp} />
                        </F>

                        {/* Invoice Number — editable override */}
                        <div style={{ background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '10px', padding: '0.85rem 1rem', marginBottom: '0.85rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                <label style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase' }}>
                                    Invoice Number {!isEdit && !numberLocked && `(system will generate)`}
                                </label>
                                {!isEdit && (
                                    <button onClick={() => setNumberLocked(v => !v)}
                                        style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, textDecoration: 'underline' }}>
                                        <Edit3 size={12} /> {numberLocked ? 'Use auto-generate' : 'Override (historical)'}
                                    </button>
                                )}
                            </div>
                            {numberLocked ? (
                                <input type="text" value={invNumber} onChange={e => setInvNumber(e.target.value)}
                                    placeholder={isEdit ? existing?.invoice_number : 'e.g. INV-APR26-001'}
                                    style={{ ...inp, background: '#0f1823', fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }} />
                            ) : (
                                <div style={{ fontFamily: 'monospace', fontSize: '0.95rem', color: '#94a3b8', padding: '8px 12px', background: '#0f1823', borderRadius: '6px' }}>
                                    {suggestedNum} <span style={{ fontSize: '0.72rem', color: '#475569' }}>(assigned on save)</span>
                                </div>
                            )}
                        </div>

                        <F label="Internal Notes">
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                                placeholder="Notes for internal reference only..."
                                style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
                        </F>
                    </div>

                    {/* Right col — line items + financials */}
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem' }}>
                            2 — Line Items &amp; Financials
                        </div>

                        {/* Line items */}
                        <div style={{ marginBottom: '0.5rem' }}>
                            {lineItems.map((li, i) => (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                                    <input type="text" value={li.description} onChange={e => updateLine(i, 'description', e.target.value)}
                                        placeholder="Description..." style={inp} />
                                    <input type="number" value={li.amount} onChange={e => updateLine(i, 'amount', e.target.value)}
                                        placeholder="Amount" min={0} style={{ ...inp, width: '120px' }} />
                                    {lineItems.length > 1 && (
                                        <button onClick={() => removeLine(i)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}><X size={14} /></button>
                                    )}
                                </div>
                            ))}
                            <button onClick={addLine} style={{ background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-muted)', padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', width: '100%' }}>
                                + Add Line Item
                            </button>
                        </div>

                        {/* Totals */}
                        <div style={{ background: 'var(--bg-dark)', borderRadius: '10px', padding: '1rem', marginTop: '1.25rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.75rem' }}>Financials</div>
                            {[
                                ['Sub-Total (PKR)', subtotal, setSubtotal, `Auto: ${fmt(lineTotal)} from lines above`],
                                ['Service Charges (PKR)', svcCharges, setSvcCharges, 'e.g. 15% of payroll cost'],
                                ['Sales Tax on Svc Charges (PKR)', salesTax, setSalesTax, '17% of service charges'],
                                ['WHT to be deducted by client (PKR)', wht, setWht, 'Withholding tax'],
                            ].map(([label, val, setter, ph]) => (
                                <div key={label} style={{ marginBottom: '0.6rem' }}>
                                    <label style={{ display: 'block', fontSize: '0.73rem', color: '#64748b', fontWeight: 600, marginBottom: '3px' }}>{label}</label>
                                    <input type="number" value={val} onChange={e => setter(e.target.value)} placeholder={ph} min={0}
                                        style={{ ...inp, padding: '7px 10px' }} />
                                </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.75rem' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-muted)' }}>GRAND TOTAL</span>
                                <span style={{ fontWeight: 900, fontSize: '1.1rem', color: '#22c55e' }}>{Rs(grandTotal)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {error && (
                    <div style={{ margin: '0 2rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', color: '#f87171', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertCircle size={15} /> {error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', padding: '1rem 2rem 1.5rem', borderTop: '1px solid var(--border)' }}>
                    <button onClick={onClose} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={handleSave} disabled={saving}
                        style={{ flex: 3, background: saving ? '#334155' : 'var(--primary)', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.95rem' }}>
                        {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Generate Invoice'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Invoice Preview Modal ────────────────────────────────────────────────────
function InvoicePreviewModal({ inv, onAction, onClose }) {
    const [xeroStatus, setXeroStatus] = useState(inv.xero_invoice_id ? 'sent' : null);
    const [xeroUrl,    setXeroUrl]    = useState(inv.xero_url   || null);
    const [updating,   setUpdating]   = useState(false);

    const actions   = STATUS_FLOW[inv.status] || [];
    const canXero   = ['Raised','Sent','Paid'].includes(inv.status);

    const sendToXero = async () => {
        setXeroStatus('sending');
        try {
            const r = await api.pushClientInvoiceXero(inv.id);
            if (r.xeroUrl) setXeroUrl(r.xeroUrl);
            setXeroStatus('sent');
        } catch (e) {
            console.error('Xero push failed:', e);
            setXeroStatus('error');
        }
    };

    const doAction = async (action) => {
        setUpdating(true);
        try {
            await api.updateClientInvoice(inv.id, { status: STATUS_NEXT[action] });
            onAction(inv.id, STATUS_NEXT[action]);
            onClose();
        } catch (e) { alert('Status update failed: ' + e.message); setUpdating(false); }
    };

    const ss = STATUS_STYLES[inv.status] || STATUS_STYLES['Draft'];
    const month = inv.period_month ? `${MONTH_NAMES[inv.period_month - 1]} ${inv.period_year}` : '—';
    const grandTotal = parseFloat(inv.grand_total) || 0;

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: '860px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h3 style={{ margin: 0, fontFamily: 'monospace', fontSize: '1rem' }}>{inv.invoice_number}</h3>
                        <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.74rem', fontWeight: 700, background: ss.bg, color: ss.color }}>{inv.status}</span>
                        {inv.xero_invoice_id && (
                            <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(0,181,200,0.12)', color: '#00B5C8' }}>
                                ✓ In Xero
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        {canXero && (
                            xeroStatus === 'sent' ? (
                                <a href={xeroUrl || 'https://go.xero.com/AccountsReceivable/Search.aspx'} target="_blank" rel="noreferrer"
                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#00B5C8', border: 'none', color: 'white', padding: '7px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>
                                    <ExternalLink size={14} /> View in Xero ✓
                                </a>
                            ) : (
                                <button onClick={sendToXero} disabled={xeroStatus === 'sending'}
                                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: xeroStatus === 'error' ? '#ef4444' : '#00B5C8', border: 'none', color: 'white', padding: '7px 14px', borderRadius: '7px', cursor: xeroStatus === 'sending' ? 'wait' : 'pointer', fontWeight: 600, fontSize: '0.85rem', opacity: xeroStatus === 'sending' ? 0.7 : 1 }}>
                                    <Send size={14} /> {xeroStatus === 'sending' ? 'Pushing…' : xeroStatus === 'error' ? 'Retry Xero' : 'Push to Xero'}
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
                        {[['Client', inv.client], ['Contract', inv.contract || '—'], ['Period', month], ['Grand Total', Rs(grandTotal)]].map(([l, v]) => (
                            <div key={l}>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '3px' }}>{l}</div>
                                <div style={{ fontWeight: 700, fontSize: '0.9rem', wordBreak: 'break-word' }}>{v}</div>
                            </div>
                        ))}
                    </div>

                    {/* Line items */}
                    {(inv.line_items || []).length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Line Items</div>
                            <div style={{ background: 'var(--bg-dark)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                {inv.line_items.map((li, i) => (
                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.7rem 1rem', borderBottom: i < inv.line_items.length - 1 ? '1px solid var(--border)' : 'none', fontSize: '0.85rem' }}>
                                        <span>{li.description || li.desc}</span>
                                        <span style={{ fontWeight: 700 }}>{Rs(li.amount || li.unit_amount || 0)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Financial summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '0.5rem', background: 'rgba(56,189,248,0.07)', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem' }}>
                        {[
                            ['Subtotal', inv.subtotal],
                            ['+ Svc Charges', inv.service_charges],
                            ['+ Sales Tax', inv.sales_tax],
                            ['- WHT', inv.wht],
                            ['GRAND TOTAL', inv.grand_total],
                        ].map(([l, v]) => (
                            <div key={l} style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '3px', textTransform: 'uppercase' }}>{l}</div>
                                <div style={{ fontWeight: 800, color: l === 'GRAND TOTAL' ? '#22c55e' : l === '- WHT' ? '#f87171' : 'var(--text)', fontSize: l === 'GRAND TOTAL' ? '1rem' : '0.9rem' }}>{Rs(v || 0)}</div>
                            </div>
                        ))}
                    </div>

                    {inv.po_number && <div style={{ marginBottom: '0.5rem', fontSize: '0.83rem', color: 'var(--text-muted)' }}>PO / Reference: <strong style={{ color: 'var(--text)' }}>{inv.po_number}</strong></div>}
                    {inv.due_date  && <div style={{ marginBottom: '0.5rem', fontSize: '0.83rem', color: 'var(--text-muted)' }}>Due Date: <strong style={{ color: 'var(--text)' }}>{inv.due_date}</strong></div>}
                    {inv.notes     && <div style={{ marginBottom: '0.5rem', fontSize: '0.83rem', color: 'var(--text-muted)' }}>Notes: <em>{inv.notes}</em></div>}

                    {/* Status actions */}
                    {actions.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                            {actions.map(a => (
                                <button key={a} onClick={() => doAction(a)} disabled={updating}
                                    style={{ flex: 1, background: a === 'Void' ? 'rgba(239,68,68,0.15)' : a === 'Mark as Paid' ? '#22c55e' : 'var(--primary)', border: a === 'Void' ? '1px solid rgba(239,68,68,0.4)' : 'none', color: a === 'Void' ? '#f87171' : 'white', padding: '10px', borderRadius: '8px', cursor: updating ? 'not-allowed' : 'pointer', fontWeight: 700, opacity: updating ? 0.6 : 1 }}>
                                    {a}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN — InvoiceSection
// ═══════════════════════════════════════════════════════════════════════════════
export default function InvoiceSection({ user }) {
    const [invoices,    setInvoices]    = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [showCreate,  setShowCreate]  = useState(false);
    const [editInv,     setEditInv]     = useState(null);
    const [previewInv,  setPreviewInv]  = useState(null);
    const [clients,     setClients]     = useState([]);
    const [contracts,   setContracts]   = useState([]);
    const [filterStatus,setFilterStatus]= useState('All');
    const [filterClient,setFilterClient]= useState('All');
    const [error,       setError]       = useState(null);

    const isSuperAdmin = user?.role === 'superadmin';
    const isAR         = ['ar_team','finance_manager','superadmin'].includes(user?.role);

    const loadInvoices = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const d = await api.getClientInvoices();
            setInvoices(d.invoices || []);
        } catch (e) { setError(e.message); }
        setLoading(false);
    }, []);

    useEffect(() => {
        loadInvoices();
        api.getClients().then(d => setClients(d.clients || [])).catch(() => {});
        api.getContracts().then(d => setContracts(d.contracts || [])).catch(() => {});
    }, [loadInvoices]);

    const handleStatusUpdate = (id, newStatus) => {
        setInvoices(p => p.map(i => i.id === id ? { ...i, status: newStatus } : i));
    };

    const deleteInvoice = async (inv) => {
        if (!isSuperAdmin) return;
        if (!window.confirm(`⚠️ Permanently void invoice ${inv.invoice_number}?\n\nThis cannot be undone.`)) return;
        try {
            await api.updateClientInvoice(inv.id, { status: 'Voided' });
            setInvoices(p => p.map(i => i.id === inv.id ? { ...i, status: 'Voided' } : i));
        } catch (e) { alert('Failed: ' + e.message); }
    };

    // Filtered list
    const filtered = invoices.filter(i => {
        if (filterStatus !== 'All' && i.status !== filterStatus) return false;
        if (filterClient !== 'All' && i.client !== filterClient) return false;
        return true;
    });

    const allClientNames = [...new Set(invoices.map(i => i.client).filter(Boolean))];
    const totalInvoiced  = invoices.filter(i => i.status !== 'Voided').reduce((s, i) => s + (parseFloat(i.grand_total) || 0), 0);
    const totalCollected = invoices.filter(i => i.status === 'Paid').reduce((s, i) => s + (parseFloat(i.grand_total) || 0), 0);
    const totalOutstanding = invoices
        .filter(i => ['Raised','Sent'].includes(i.status))
        .reduce((s, i) => s + (parseFloat(i.grand_total) || 0), 0);

    return (
        <div className="dashboard">
            <header className="header">
                <h1>Invoices (AR)</h1>
                <p>Client invoice management — raise, track, and push to Xero. System-generated numbers with manual override for historical invoices.</p>
            </header>

            {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '0.85rem 1.25rem', marginBottom: '1.5rem', color: '#f87171', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <AlertCircle size={16} /> {error}
                    <button onClick={loadInvoices} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #f87171', color: '#f87171', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}>Retry</button>
                </div>
            )}

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    { l: 'Total Invoices',   v: invoices.length,                                                    c: 'var(--primary)' },
                    { l: 'Draft',            v: invoices.filter(i => i.status === 'Draft').length,                  c: '#94a3b8' },
                    { l: 'Outstanding',      v: Rs(totalOutstanding),                                               c: '#f59e0b' },
                    { l: 'Collected (Paid)', v: Rs(totalCollected),                                                 c: '#22c55e' },
                    { l: 'Total Invoiced',   v: Rs(totalInvoiced),                                                  c: '#a78bfa' },
                ].map(card => (
                    <div key={card.l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>{card.l}</div>
                        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: card.c }}>{card.v}</div>
                    </div>
                ))}
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Status filter */}
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 12px', borderRadius: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <option value="All">All Statuses</option>
                        {Object.keys(STATUS_STYLES).map(s => <option key={s}>{s}</option>)}
                    </select>
                    {/* Client filter */}
                    <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '7px 12px', borderRadius: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <option value="All">All Clients</option>
                        {allClientNames.map(c => <option key={c}>{c}</option>)}
                    </select>
                    {(filterStatus !== 'All' || filterClient !== 'All') && (
                        <button onClick={() => { setFilterStatus('All'); setFilterClient('All'); }}
                            style={{ fontSize: '0.75rem', color: '#ef4444', background: 'transparent', border: '1px solid #ef444440', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>
                            Clear
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={loadInvoices}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <RefreshCw size={14} /> Refresh
                    </button>
                    {isAR && (
                        <button onClick={() => setShowCreate(true)}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', border: 'none', color: 'white', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem' }}>
                            <FilePlus size={16} /> Create Invoice
                        </button>
                    )}
                </div>
            </div>

            {/* Invoice Table */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '4rem', color: '#64748b' }}>Loading invoices…</div>
            ) : filtered.length === 0 ? (
                <div style={{ background: 'var(--bg-card)', border: '2px dashed var(--border)', borderRadius: '16px', padding: '4rem', textAlign: 'center' }}>
                    <FileText size={48} color="var(--text-muted)" style={{ marginBottom: '1rem' }} />
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                        {filterStatus !== 'All' || filterClient !== 'All' ? 'No invoices match your filters' : 'No invoices yet'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                        {isAR ? 'Create your first invoice to get started.' : 'No invoices have been raised yet.'}
                    </div>
                    {isAR && filterStatus === 'All' && filterClient === 'All' && (
                        <button onClick={() => setShowCreate(true)}
                            style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                            Create First Invoice
                        </button>
                    )}
                </div>
            ) : (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-dark)' }}>
                                {['Invoice No.','Client','Contract','Period','Grand Total','Status','Xero','Actions'].map(h => (
                                    <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Grand Total' ? 'right' : 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((inv, i) => {
                                const ss = STATUS_STYLES[inv.status] || STATUS_STYLES['Draft'];
                                const month = inv.period_month ? `${MONTH_NAMES[inv.period_month - 1].slice(0,3)} ${inv.period_year}` : '—';
                                return (
                                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', opacity: inv.status === 'Voided' ? 0.5 : 1 }}>
                                        <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--primary)', fontSize: '0.82rem', fontFamily: 'monospace' }}>{inv.invoice_number}</td>
                                        <td style={{ padding: '10px 14px', fontSize: '0.85rem', fontWeight: 600 }}>{inv.client}</td>
                                        <td style={{ padding: '10px 14px', fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.contract || '—'}</td>
                                        <td style={{ padding: '10px 14px', fontSize: '0.83rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{month}</td>
                                        <td style={{ padding: '10px 14px', fontWeight: 800, color: '#22c55e', textAlign: 'right', whiteSpace: 'nowrap' }}>{Rs(inv.grand_total)}</td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.73rem', fontWeight: 700, background: ss.bg, color: ss.color, whiteSpace: 'nowrap' }}>{inv.status}</span>
                                        </td>
                                        <td style={{ padding: '10px 14px' }}>
                                            {inv.xero_invoice_id
                                                ? <a href={inv.xero_url || 'https://go.xero.com'} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: '#00B5C8', textDecoration: 'none', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}><ExternalLink size={12} /> Xero</a>
                                                : <span style={{ fontSize: '0.73rem', color: '#475569' }}>—</span>
                                            }
                                        </td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                                                <button onClick={() => setPreviewInv(inv)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', color: 'var(--primary)', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                                                    <Eye size={12} /> View
                                                </button>
                                                {isAR && inv.status === 'Draft' && (
                                                    <button onClick={() => setEditInv(inv)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                                                        <Edit3 size={12} /> Edit
                                                    </button>
                                                )}
                                                {isSuperAdmin && inv.status !== 'Voided' && (
                                                    <button onClick={() => deleteInvoice(inv)} title="Void invoice"
                                                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}>
                                                        🗑
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr style={{ background: 'var(--bg-dark)', borderTop: '2px solid var(--border)' }}>
                                <td colSpan={4} style={{ padding: '8px 14px', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                                    {filtered.length} invoices shown {filtered.length !== invoices.length && `(of ${invoices.length} total)`}
                                </td>
                                <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 900, color: '#22c55e', fontSize: '0.9rem' }}>
                                    {Rs(filtered.filter(i => i.status !== 'Voided').reduce((s, i) => s + (parseFloat(i.grand_total) || 0), 0))}
                                </td>
                                <td colSpan={3} />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {/* Modals */}
            {showCreate && (
                <InvoiceFormModal
                    clients={clients}
                    contracts={contracts}
                    onSave={loadInvoices}
                    onClose={() => setShowCreate(false)}
                />
            )}
            {editInv && (
                <InvoiceFormModal
                    existing={editInv}
                    clients={clients}
                    contracts={contracts}
                    onSave={loadInvoices}
                    onClose={() => setEditInv(null)}
                />
            )}
            {previewInv && (
                <InvoicePreviewModal
                    inv={previewInv}
                    onAction={handleStatusUpdate}
                    onClose={() => setPreviewInv(null)}
                />
            )}
        </div>
    );
}
