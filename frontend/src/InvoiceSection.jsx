import React, { useState, useEffect, useCallback } from 'react';
import {
    FilePlus, Eye, CheckCircle, Send, Printer, X, ExternalLink,
    RefreshCw, FileText, Edit3, AlertCircle, ChevronDown,
} from 'lucide-react';
import { api } from './api';

const fmt    = n => Math.round(parseFloat(n) || 0).toLocaleString('en-PK');
const fmtDec = n => (parseFloat(n) || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const Rs     = n => `Rs. ${fmt(n)}`;
const today  = () => new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'long', year: 'numeric' });

const CO = {
    name:         'Allied Services International (Pvt) Ltd',
    address1:     '6 Hilltop Arcade',
    address2:     '4D/2 Gizri Boulevard,',
    address3:     'Phase 4',
    address4:     'Karachi 75500,',
    address5:     'Pakistan',
    ntn:          '0520872-6',
    strn:         'S0520872-6',
    phone:        '(021) 3456-7890',
    email:        'accounts@alliedservices.com.pk',
    bankTitle:    'M S ALLIED SERVICES INT LTD',
    bankAccount:  '00270036548503',
    bankIBAN:     'PK32 HABB 0000 2700 3654 8503',
    bankCode:     '0027',
    bankName:     'Habib Bank Limited',
    bankBranch:   '49-A Block 6 P.E.C.H.S Shahrah-e-Faisal Karachi',
    signatory:    'Asif Awan',
    signatoryTitle: 'Manager Finance',
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

// ─── Invoice HTML renderer (print/PDF) — matches ASIL letterhead layout ───────
function renderInvoiceHTML(inv) {
    const items      = (inv.line_items || []);
    const subtotal   = parseFloat(inv.subtotal)        || 0;
    const svcCharges = parseFloat(inv.service_charges) || 0;
    const salesTax   = parseFloat(inv.sales_tax)       || 0;
    const wht        = parseFloat(inv.wht)             || 0;
    const grandTotal = parseFloat(inv.grand_total)     || (subtotal + svcCharges + salesTax - wht);
    const taxRate    = salesTax > 0 && subtotal > 0 ? Math.round((salesTax / subtotal) * 100) : 15;

    // Invoice date from record or today
    const invDate = inv.created_at
        ? new Date(inv.created_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })
        : today();

    // Per-line tax and unit price (line items may carry explicit qty/unit_price or we derive)
    const renderRows = items.length > 0
        ? items.map(li => {
            const qty       = li.quantity      || 1;
            const amount    = parseFloat(li.amount || li.unit_amount || 0);
            const unitPrice = li.unit_price    || (qty ? amount / qty : amount);
            const lineTax   = li.tax_rate      != null ? li.tax_rate : taxRate;
            return `<tr>
              <td style="color:#1155CC">${li.description || li.desc || ''}</td>
              <td class="num">${fmtDec(qty)}</td>
              <td class="num">${fmtDec(unitPrice)}</td>
              <td class="num">${lineTax}%</td>
              <td class="num">${fmtDec(amount)}</td>
            </tr>`;
          }).join('')
        : `<tr>
              <td style="color:#1155CC">Services — ${inv.contract || inv.client}</td>
              <td class="num">1.00</td>
              <td class="num">${fmtDec(subtotal)}</td>
              <td class="num">${taxRate}%</td>
              <td class="num">${fmtDec(subtotal)}</td>
           </tr>`;

    // ── Region-aware tax label (matches Xero CSV format) ─────────────────────
    const region = (inv.region || '').toLowerCase();
    let taxLabel, taxRateActual;
    if (region.includes('sindh')) {
        taxLabel = 'SINDH SALES TAX'; taxRateActual = 15;
    } else if (region.includes('punjab')) {
        taxLabel = 'PUNJAB SERVICES TAX'; taxRateActual = 16;
    } else if (region.includes('kpk') || region.includes('khyber')) {
        taxLabel = 'KPK SERVICES TAX'; taxRateActual = 15;
    } else if (region.includes('baloch')) {
        taxLabel = 'BALOCHISTAN SERVICES TAX'; taxRateActual = 15;
    } else if (region.includes('federal') || region.includes('islamabad')) {
        taxLabel = 'FEDERAL EXCISE DUTY'; taxRateActual = 13;
    } else {
        // Fall back to computed rate from sales_tax/subtotal
        taxRateActual = salesTax > 0 && (subtotal + svcCharges) > 0
            ? Math.round((salesTax / (subtotal + svcCharges)) * 100)
            : taxRate;
        taxLabel = taxRateActual === 16 ? 'PUNJAB SERVICES TAX' : 'SINDH SALES TAX';
    }
    const taxLabelFull = `TOTAL ${taxLabel} ${taxRateActual}%`;

    // ── Client address from enriched JOIN or fallback ─────────────────────────
    const clientAttn = inv.client_attention || '';
    const clientAddr = inv.client_hq        || inv.client_address || '';
    const clientNtn  = inv.client_ntn       || '';
    const clientStrn = inv.client_strn      || '';
    const poRef      = inv.po_number        || inv.reference || '';


    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Invoice ${inv.invoice_number || ''}</title>
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; margin: 0; padding: 0; }
  .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 0 18mm; display: flex; flex-direction: column; }
  /* Letterhead gap — top and bottom reserved for printed letterhead */
  .lh-top    { height: 42mm; flex-shrink: 0; }
  .lh-bottom { height: 28mm; flex-shrink: 0; margin-top: auto; }
  .body-content { flex: 1; padding-bottom: 10mm; }

  /* ── Header block ── */
  .inv-header { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; margin-bottom: 18pt; }
  .inv-title-cell { font-size: 28pt; font-weight: bold; color: #000; line-height: 1; display: flex; align-items: flex-end; padding-bottom: 4pt; }
  .inv-meta-cell  { font-size: 9pt; color: #000; }
  .inv-meta-cell .meta-label { font-weight: bold; margin-top: 6pt; }
  .inv-meta-cell .meta-label:first-child { margin-top: 0; }
  .inv-co-cell    { font-size: 9pt; color: #1155CC; text-align: left; }
  .inv-co-cell .co-name { color: #1155CC; font-weight: normal; }

  /* ── Bill-to block ── */
  .bill-to { margin-bottom: 18pt; font-size: 10pt; }
  .bill-to .client-name  { font-weight: bold; }
  .bill-to p { margin: 0; line-height: 1.5; }

  /* ── Items table ── */
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 0; }
  table.items thead tr { border-bottom: 2px solid #000; }
  table.items th { font-size: 9pt; font-weight: bold; padding: 5pt 6pt; text-align: left; border: none; background: none; color: #000; }
  table.items th.num { text-align: right; }
  table.items td { font-size: 10pt; padding: 5pt 6pt; border: none; border-bottom: 1px solid #d0d0d0; }
  table.items td.num { text-align: right; }
  table.items tbody tr:last-child td { border-bottom: none; }

  /* ── Totals ── */
  table.totals { width: 100%; border-collapse: collapse; border-top: 1px solid #000; margin-top: 2pt; }
  table.totals td { font-size: 10pt; padding: 4pt 6pt; border: none; }
  table.totals td.num { text-align: right; }
  .subtotal-row td { padding-top: 6pt; }
  .tax-row td  { color: #000; }
  .grand-row td { font-weight: bold; font-size: 11pt; border-top: 2px solid #000; padding-top: 6pt; }

  /* ── Footer ── */
  .inv-footer { font-size: 10pt; margin-top: 20pt; }
  .due-date   { font-weight: bold; color: #1155CC; font-size: 11pt; margin-bottom: 6pt; }
  .bank-details { font-size: 9.5pt; line-height: 1.6; margin-bottom: 16pt; }
  .bank-details strong { display: block; }
  .signature  { margin-top: 16pt; font-size: 10pt; }
  .signature .sig-name  { color: #1155CC; font-weight: normal; }
  .signature .sig-title { color: #1155CC; font-size: 9.5pt; }

  @media print {
    .page { width: 100%; }
    body  { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body>
<div class="page">
  <div class="lh-top"></div>
  <div class="body-content">

    <!-- ── Header: INVOICE | Meta | Company ── -->
    <div class="inv-header">
      <div class="inv-title-cell">INVOICE</div>

      <div class="inv-meta-cell">
        <div class="meta-label">Invoice Date</div>
        <div>${invDate}</div>
        <div class="meta-label">Invoice Number</div>
        <div>${inv.invoice_number || '—'}</div>
        ${poRef ? `<div class="meta-label">Reference</div><div>${poRef}</div>` : ''}
        <div class="meta-label">NTN</div>
        <div>${CO.ntn}</div>
      </div>

      <div class="inv-co-cell">
        <div class="co-name">${CO.name}</div>
        <div>${CO.address1}</div>
        <div>${CO.address2}</div>
        <div>${CO.address3}</div>
        <div>${CO.address4}</div>
        <div>${CO.address5}</div>
        <div>NTN: ${CO.ntn}</div>
        <div>SNTN: ${CO.strn}</div>
      </div>
    </div>

    <!-- ── Bill-to: client block ── -->
    <div class="bill-to">
      <p class="client-name">${inv.client || '—'}</p>
      ${clientAttn ? `<p>Attention: ${clientAttn}</p>` : ''}
      ${clientAddr ? `<p>${clientAddr.replace(/\n/g,'<br/>')}</p>` : ''}
      ${clientNtn  ? `<p>NTN: ${clientNtn}${clientStrn ? ' / STRN ' + clientStrn : ''}</p>` : ''}
    </div>

    <!-- ── Line Items ── -->
    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="num">Quantity</th>
          <th class="num">Unit Price</th>
          <th class="num">Tax</th>
          <th class="num">Amount PKR</th>
        </tr>
      </thead>
      <tbody>
        ${renderRows}
      </tbody>
    </table>

    <!-- ── Totals ── -->
    <table class="totals">
      <tbody>
        <tr class="subtotal-row">
          <td colspan="3"></td>
          <td class="num" style="width:120pt;font-weight:bold">Subtotal</td>
          <td class="num" style="width:100pt">${fmtDec(subtotal)}</td>
        </tr>
        ${svcCharges > 0
          ? `<tr class="tax-row">
               <td colspan="3"></td>
               <td class="num">TOTAL SERVICE CHARGES</td>
               <td class="num">${fmtDec(svcCharges)}</td>
             </tr>` : ''}
        ${salesTax > 0
          ? `<tr class="tax-row">
               <td colspan="3"></td>
               <td class="num">${taxLabelFull}</td>
               <td class="num">${fmtDec(salesTax)}</td>
             </tr>` : ''}

        ${wht > 0
          ? `<tr class="tax-row">
               <td colspan="3"></td>
               <td class="num" style="color:#c00">WHT Deduction</td>
               <td class="num" style="color:#c00">- ${fmtDec(wht)}</td>
             </tr>` : ''}
        <tr class="grand-row">
          <td colspan="3"></td>
          <td class="num">TOTAL PKR</td>
          <td class="num">${fmtDec(grandTotal)}</td>
        </tr>
      </tbody>
    </table>

    <!-- ── Footer ── -->
    <div class="inv-footer">
      ${inv.due_date ? `<div class="due-date">Due Date: ${inv.due_date}</div>` : ''}
      <div class="bank-details">
        <strong>Bank Details:</strong>
        Account Title: ${CO.bankTitle}<br/>
        Account No.: ${CO.bankAccount}<br/>
        IBAN #: ${CO.bankIBAN}<br/>
        Branch Code: ${CO.bankCode}<br/>
        Bank Name: ${CO.bankName}<br/>
        Branch Address: ${CO.bankBranch}
      </div>
      <div class="signature">
        <p style="margin:0 0 24pt">Yours Truly</p>
        <p style="margin:0" class="sig-name">${CO.signatory}</p>
        <p style="margin:0" class="sig-title">${CO.signatoryTitle}</p>
      </div>
    </div>

  </div>
  <div class="lh-bottom"></div>
</div>
</body></html>`;
}

function printInvoice(inv) {
    const html = renderInvoiceHTML(inv);
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Allow popups to print.'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 500);
}


// ─── 3-Step Payroll Invoice Wizard ───────────────────────────────────────────
function PayrollInvoiceWizard({ clients = [], contracts = [], onSave, onClose }) {
    const now = new Date();
    const [step,        setStep]       = useState(1);
    const [client,      setClient]     = useState('');
    const [contractId,  setContractId] = useState('');
    const [month,       setMonth]      = useState(now.getMonth() + 1);
    const [year,        setYear]       = useState(now.getFullYear());
    const [preview,     setPreview]    = useState(null);
    const [loading,     setLoading]    = useState(false);
    const [saving,      setSaving]     = useState(false);
    const [error,       setError]      = useState('');
    const [notes,       setNotes]      = useState('');
    const [generatedInvoices, setGeneratedInvoices] = useState([]);
    // Segregation options
    const [segRegion,    setSegRegion]    = useState(false);
    const [segBU,        setSegBU]        = useState(false);
    const [segPayroll,   setSegPayroll]   = useState(false);
    const [segOvertime,  setSegOvertime]  = useState(false);
    const [segOverheads, setSegOverheads] = useState(false);

    // self-load clients + contracts
    const [cls,  setCls]  = useState(clients);
    const [cts,  setCts]  = useState(contracts);
    useEffect(() => {
        if (cls.length && cts.length) return;
        Promise.all([api.getClients(), api.getContracts()]).then(([cr, ctr]) => {
            setCls(Array.isArray(cr) ? cr : (cr?.clients || []));
            setCts(Array.isArray(ctr) ? ctr : (ctr?.contracts || []));
        }).catch(() => {});
    }, []);

    const inp = { width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' };
    const F = ({ label, children }) => (
        <div style={{ marginBottom: '0.85rem' }}>
            <label style={{ display: 'block', fontSize: '0.73rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: '5px' }}>{label}</label>
            {children}
        </div>
    );

    // Contracts filtered + labelled with location/region to differentiate duplicates
    const clientContracts = cts.filter(c => {
        const cn = c.clientName || c.client_name || '';
        return !client || cn.toLowerCase() === client.toLowerCase();
    });

    const contractLabel = (c) => {
        const name = c.contractName || c.name || '';
        const loc  = c.location || c.regionProvince || '';
        return loc ? `${name} — ${loc}` : name;
    };

    // Step 1 → Step 2: fetch locked payroll preview with segregation params
    const handleFetch = async () => {
        if (!client) return setError('Please select a client.');
        setError(''); setLoading(true);
        try {
            const params = new URLSearchParams({ client });
            if (contractId)   params.set('contract_id', contractId);
            if (segRegion)    params.set('segregate_region',    'true');
            if (segBU)        params.set('segregate_bu',        'true');
            if (segPayroll)   params.set('segregate_payroll',   'true');
            if (segOvertime)  params.set('segregate_overtime',  'true');
            if (segOverheads) params.set('segregate_overheads', 'true');
            const token = localStorage.getItem('asil_hcm_token');
            const r = await fetch(`${import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com'}/api/payroll/${year}/${month}/preview-invoice?${params}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || 'Server error');
            setPreview(data);
            setStep(2);
        } catch (e) { setError(e.message); }
        finally { setLoading(false); }
    };

    // Step 2 → generate one invoice per group
    const handleGenerate = async () => {
        if (!preview?.found) return;
        setSaving(true); setError('');
        const selectedContract = cts.find(c => String(c.id) === String(contractId));
        const contractName = selectedContract ? (selectedContract.contractName || selectedContract.name) : '';
        const groups = preview.invoice_groups || [];
        const created = [];
        try {
            for (const grp of groups) {
                const t = grp.totals;
                // ── Xero-compatible line descriptions ──────────────────────────────
                const lineItems = [];
                const moFull = `${MONTH_NAMES[parseInt(month) - 1]} ${year}`;
                const regionLabel = grp.region && grp.region !== 'ALL' ? grp.region : null;

                if (grp.component === 'overtime') {
                    lineItems.push({ description: `Overtime${regionLabel ? ' in ' + regionLabel : ''} for the month of ${moFull}`, amount: t.overtime });
                } else if (grp.component === 'overheads') {
                    lineItems.push({ description: `Overheads${regionLabel ? ' in ' + regionLabel : ''} for the month of ${moFull}`, amount: t.overhead });
                } else {
                    const svcDesc = regionLabel
                        ? `Services in ${regionLabel} for the month of ${moFull}`
                        : `Services for the month of ${moFull}`;
                    if (t.gross > 0)         lineItems.push({ description: svcDesc, amount: t.gross });
                    if (t.eobi_ee > 0)       lineItems.push({ description: 'EOBI Employer Contribution', amount: t.eobi_ee });
                    if (t.opd_claim > 0)     lineItems.push({ description: 'OPD / Medical Claims', amount: t.opd_claim });
                    if (t.reimbursement > 0) lineItems.push({ description: 'Reimbursements', amount: t.reimbursement });
                    if (t.arrears > 0)       lineItems.push({ description: 'Arrears', amount: t.arrears });
                    if ((t.service_charges || 0) > 0) lineItems.push({ description: 'Service Charges', amount: t.service_charges });
                }
                const payload = {
                    client, contract: contractName,
                    contract_id: contractId ? parseInt(contractId) : null,
                    period_month: parseInt(month), period_year: parseInt(year),
                    po_number: grp.po_number || null,
                    po_id:     grp.po_id     || null,
                    due_date:  grp.due_date  || null,
                    notes:     [notes, grp.label !== 'Combined Invoice' ? grp.label : ''].filter(Boolean).join(' | ') || null,
                    region:    grp.region    || null,
                    bu:        grp.bu        || null,
                    component: grp.component,
                    line_items: lineItems.filter(l => l.amount > 0),
                    subtotal: t.gross + (t.eobi_ee||0) + (t.opd_claim||0) + (t.reimbursement||0) + (t.arrears||0) + (t.overtime||0) + (t.overhead||0),
                    service_charges: t.service_charges || 0,
                    sales_tax: t.sales_tax || 0,
                    wht:       t.wht        || 0,
                    grand_total: t.total_invoice,
                };


                const inv = await api.createClientInvoice(payload);
                created.push(inv);
            }
            setGeneratedInvoices(created);
            setStep(3);
            if (onSave) onSave();
        } catch (e) { setError(e.message); setSaving(false); }
    };

    const moName = MONTH_NAMES[parseInt(month) - 1];
    const moAbbr = moName?.slice(0,3).toUpperCase();
    const yr2    = String(year).slice(-2);

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: '800px', maxHeight: '92vh', overflowY: 'auto' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 2rem', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FilePlus size={18} color="var(--primary)" />
                            Generate Invoice from Payroll
                        </h3>
                        {/* Step indicators */}
                        <div style={{ display: 'flex', gap: '6px', marginLeft: '8px' }}>
                            {[1,2,3].map(s => (
                                <div key={s} style={{ width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700,
                                    background: step >= s ? (step > s ? '#22c55e' : 'var(--primary)') : 'var(--bg-dark)',
                                    color: step >= s ? '#fff' : '#64748b',
                                    border: `1px solid ${step >= s ? 'transparent' : 'var(--border)'}` }}>
                                    {step > s ? '✓' : s}
                                </div>
                            ))}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '1.75rem 2rem' }}>
                    {error && (
                        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', color: '#f87171', marginBottom: '1rem', fontSize: '0.85rem', display: 'flex', gap: '8px' }}>
                            <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} /> {error}
                        </div>
                    )}

                    {/* ── STEP 1: Selection ── */}
                    {step === 1 && (
                        <div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem', background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '10px', padding: '12px 16px' }}>
                                📋 Select the client, contract, and billing month. The system will pull all <strong>locked payroll</strong> for that period and calculate the invoice automatically.
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div style={{ gridColumn: '1/-1' }}>
                                    <F label="Client *">
                                        <select style={inp} value={client} onChange={e => { setClient(e.target.value); setContractId(''); }}>
                                            <option value="">— Select Client —</option>
                                            {cls.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                        </select>
                                    </F>
                                </div>
                                <div style={{ gridColumn: '1/-1' }}>
                                    <F label="Contract">
                                        <select style={inp} value={contractId} onChange={e => setContractId(e.target.value)} disabled={!client}>
                                            <option value="">{!client ? '— Select client first —' : '— All contracts for client —'}</option>
                                            {clientContracts.map(c => (
                                                <option key={c.id} value={c.id}>{contractLabel(c)}</option>
                                            ))}
                                        </select>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                            Contract name + location shown to differentiate. Leave blank to invoice all contracts together.
                                        </div>
                                    </F>
                                </div>
                                <F label="Billing Month">
                                    <select style={inp} value={month} onChange={e => setMonth(e.target.value)}>
                                        {MONTH_NAMES.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                                    </select>
                                </F>
                                <F label="Year">
                                    <select style={inp} value={year} onChange={e => setYear(e.target.value)}>
                                        {[2024,2025,2026,2027].map(y => <option key={y}>{y}</option>)}
                                    </select>
                                </F>
                            </div>

                            {/* ── Segregation Options ── */}
                            <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '12px', padding: '1rem 1.25rem', marginTop: '0.5rem' }}>
                                <div style={{ fontSize: '0.73rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#818cf8', marginBottom: '0.75rem' }}>Invoice Segregation Options</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>Select how to split the invoice. Each checked option creates a separate invoice document.</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                    {[
                                        ['By Region',    segRegion,    setSegRegion,    'Split one invoice per employee region (e.g. Sindh, Punjab)'],
                                        ['By Business Unit (BU)', segBU, setSegBU, 'Split one invoice per BU / division'],
                                        ['Payroll',      segPayroll,   setSegPayroll,   'Separate invoice for base payroll (excl. OT and overheads)'],
                                        ['Overtime',     segOvertime,  setSegOvertime,  'Separate invoice for overtime amounts only'],
                                        ['Overheads',    segOverheads, setSegOverheads, 'Separate invoice for fixed overhead charges'],
                                    ].map(([label, val, setter, hint]) => (
                                        <label key={label} onClick={() => setter(v => !v)}
                                            style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                                                background: val ? 'rgba(99,102,241,0.12)' : 'var(--bg-dark)',
                                                border: `1px solid ${val ? 'rgba(99,102,241,0.4)' : 'var(--border)'}` }}>
                                            <div style={{ width: '16px', height: '16px', borderRadius: '4px', border: `2px solid ${val ? '#6366f1' : '#475569'}`, background: val ? '#6366f1' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '1px' }}>
                                                {val && <span style={{ color: '#fff', fontSize: '10px', fontWeight: 900 }}>✓</span>}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: '0.82rem', color: val ? '#a5b4fc' : 'var(--text)' }}>{label}</div>
                                                <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)', marginTop: '2px' }}>{hint}</div>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                {(segRegion || segBU || segPayroll || segOvertime || segOverheads) && (
                                    <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#818cf8' }}>
                                        📄 Will generate {[segRegion&&'region',segBU&&'BU',segPayroll&&'payroll',segOvertime&&'overtime',segOverheads&&'overheads'].filter(Boolean).join(' + ')} split invoices
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                                <button onClick={onClose} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={handleFetch} disabled={!client || loading}
                                    style={{ flex: 3, background: 'var(--primary)', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, opacity: loading ? 0.7 : 1 }}>
                                    {loading ? 'Loading payroll data…' : `Preview Invoice for ${moName} ${year} →`}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── STEP 2: Preview & Confirm ── */}
                    {step === 2 && preview && (
                        <div>
                            {!preview.found ? (
                                <div style={{ textAlign: 'center', padding: '3rem', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '12px' }}>
                                    <AlertCircle size={40} color="#f59e0b" style={{ marginBottom: '1rem' }} />
                                    <div style={{ fontWeight: 700, marginBottom: '8px' }}>No Locked Payroll Found</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.5rem' }}>{preview.message}</div>
                                    <button onClick={() => setStep(1)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer' }}>← Go Back</button>
                                </div>
                            ) : (
                        <>
                                    {preview.already_invoiced && (
                                        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '10px 14px', marginBottom: '1rem', fontSize: '0.83rem', color: '#f87171' }}>
                                            ⚠ Invoice <strong>{preview.already_invoiced.invoice_number}</strong> is already <strong>{preview.already_invoiced.status}</strong> for this period. Generating will create additional draft invoices.
                                        </div>
                                    )}

                                    {/* PO summary banner */}
                                    {preview.po_summary && preview.po_summary.total_pos > 0 && (
                                        <div style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '8px', padding: '9px 14px', marginBottom: '1rem', fontSize: '0.8rem', color: '#86efac', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            📄 <span><strong>{preview.po_summary.matched}</strong> of {preview.invoice_groups.length} invoices matched to active POs automatically{preview.po_summary.unmatched > 0 ? ` (${preview.po_summary.unmatched} unmatched — will generate without PO)` : '.'}</span>
                                        </div>
                                    )}

                                    {/* Summary header */}
                                    <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                                        <div>
                                            <div style={{ fontWeight: 800, fontSize: '1rem' }}>{client}</div>
                                            {preview.contract && <div style={{ fontSize: '0.83rem', color: '#818cf8', marginTop: '2px' }}>{preview.contract.name}{preview.contract.location ? ` — ${preview.contract.location}` : ''}</div>}
                                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>{moName} {year} · {preview.employee_count} employees locked</div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>GRAND TOTAL</div>
                                            <div style={{ fontWeight: 900, fontSize: '1.3rem', color: '#22c55e' }}>{Rs(preview.totals.total_invoice)}</div>
                                            <div style={{ fontSize: '0.72rem', color: '#818cf8', marginTop: '2px' }}>{preview.invoice_groups.length} invoice{preview.invoice_groups.length !== 1 ? 's' : ''} will be created</div>
                                        </div>
                                    </div>

                                    {/* Invoice group cards */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '1.25rem' }}>
                                        {(preview.invoice_groups || []).map((grp, i) => (
                                            <div key={grp.group_key} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderLeft: `3px solid ${grp.component==='overtime'?'#f59e0b':grp.component==='overheads'?'#a78bfa':'#6366f1'}`, borderRadius: '10px', padding: '0.9rem 1.1rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                    <div>
                                                        <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '3px' }}>
                                                            Invoice {i+1}: {grp.label}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '3px' }}>
                                                            {grp.region && <span>📍 {grp.region}</span>}
                                                            {grp.bu     && <span>🏢 {grp.bu}</span>}
                                                            <span>👥 {grp.employee_count} employees</span>
                                                            <span>📅 Due: {grp.due_date}</span>
                                                        </div>
                                                        {/* Auto-matched PO badge */}
                                                        <div style={{ marginTop: '6px' }}>
                                                            {grp.po_number
                                                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '6px', padding: '2px 8px', fontSize: '0.72rem', color: '#86efac', fontFamily: 'monospace' }}>
                                                                    ✓ PO: {grp.po_number}{grp.po_expiry ? ` · exp ${grp.po_expiry.slice(0,10)}` : ''}
                                                                  </span>
                                                                : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', padding: '2px 8px', fontSize: '0.72rem', color: '#fbbf24' }}>
                                                                    ⚠ No matching PO found
                                                                  </span>
                                                            }
                                                        </div>
                                                    </div>
                                                    <div style={{ textAlign: 'right' }}>
                                                        <div style={{ fontWeight: 800, color: '#22c55e', fontSize: '1rem' }}>{Rs(grp.totals.total_invoice || grp.totals.overtime || grp.totals.overhead)}</div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                            {grp.component === 'overtime' ? `OT: ${Rs(grp.totals.overtime)}` :
                                                             grp.component === 'overheads' ? `Overhead: ${Rs(grp.totals.overhead)}` :
                                                             `Gross: ${Rs(grp.totals.gross)}`}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Notes only (PO is auto-matched) */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                        <F label="Payment Due Date">
                                            <input style={{ ...inp, background: 'rgba(34,197,94,0.05)' }} value={preview.due_date} readOnly />
                                            <div style={{ fontSize: '0.71rem', color: '#22c55e', marginTop: '3px' }}>Auto from contract: {preview.credit_cycle_days}-day terms</div>
                                        </F>
                                        <F label="Internal Notes (optional)">
                                            <input style={inp} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Applied to all invoices in this batch..." />
                                        </F>
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                                        <button onClick={() => { setStep(1); setPreview(null); setError(''); }} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>← Back</button>
                                        <button onClick={handleGenerate} disabled={saving}
                                            style={{ flex: 3, background: saving ? '#334155' : 'linear-gradient(135deg,#6366f1,#22c55e)', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.95rem' }}>
                                            {saving ? 'Generating…' : `✓ Confirm & Generate ${preview.invoice_groups.length} Invoice${preview.invoice_groups.length !== 1 ? 's' : ''}`}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {step === 3 && (
                        <div style={{ textAlign: 'center', padding: '3rem 2rem' }}>
                            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '2px solid #22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                                <CheckCircle size={32} color="#22c55e" />
                            </div>
                            <div style={{ fontWeight: 800, fontSize: '1.2rem', marginBottom: '8px' }}>
                                {generatedInvoices.length > 1 ? `${generatedInvoices.length} Invoices Generated!` : 'Invoice Generated!'}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                                {generatedInvoices.length > 1
                                    ? `${generatedInvoices.length} draft invoices have been saved and are ready to raise.`
                                    : 'The draft invoice has been saved. You can view and raise it from the invoice list.'}
                            </div>
                            <button onClick={onClose} style={{ background: 'var(--primary)', border: 'none', color: '#fff', padding: '12px 32px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem' }}>
                                View Invoice List →
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}


// ─── Invoice Preview Modal ────────────────────────────────────────────────────
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

    const isSuperAdmin  = user?.role === 'superadmin';
    // Finance Approver AND Finance Proposer both have full AR access per MD directive
    const isAR          = ['ar_team','finance_manager','finance_approver','finance_proposer','superadmin'].includes(user?.role);
    const canApprove    = ['ar_team','finance_manager','finance_approver','superadmin'].includes(user?.role);

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

            {/* Finance Proposer notice — can create but not approve */}
            {user?.role === 'finance_proposer' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '12px', padding: '12px 18px', marginBottom: '1.5rem' }}>
                    <AlertCircle size={16} color="#38bdf8" />
                    <div style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.5 }}>
                        <strong style={{ color: '#38bdf8' }}>Finance Proposer:</strong> You can create and submit draft invoices. Final approval and "Raise" status requires the Finance Approver or Finance Manager.
                    </div>
                </div>
            )}

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
                <PayrollInvoiceWizard
                    clients={clients}
                    contracts={contracts}
                    onSave={loadInvoices}
                    onClose={() => setShowCreate(false)}
                />
            )}
            {editInv && (
                <PayrollInvoiceWizard
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
