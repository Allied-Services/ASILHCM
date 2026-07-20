import React, { useState, useRef, useEffect } from 'react';
import { FileText, Upload, Edit3, CheckCircle, Loader, Eye, AlertTriangle } from 'lucide-react';
import { api } from './api';
import ConfirmModal from './components/ConfirmModal';

// ─── Bill Type Definitions ───────────────────────────────────────────────────
const BILL_TYPE_DEFS = [
    {
        id: 'Debit Note / Imprest',
        icon: '💼',
        desc: 'Cash advance, imprest top-up, or debit note — always billed back to client',
        billable: true,
        billableLocked: true,
        requiresClient: true,
        requiresContract: false,
        color: '#a78bfa',
    },
    {
        id: 'Client Procurement',
        icon: '🏭',
        desc: 'Supply purchase for a specific client contract — always billable',
        billable: true,
        billableLocked: true,
        requiresClient: true,
        requiresContract: true,
        color: '#38bdf8',
    },
    {
        id: 'Contractual Purchasing',
        icon: '📦',
        desc: 'Monthly consumables per Bid Tracking contract — references contract + period',
        billable: null, // user chooses
        billableLocked: false,
        requiresClient: true,
        requiresContract: true,
        requiresPeriod: true,
        color: '#22c55e',
    },
    {
        id: 'Internal Expense',
        icon: '🏢',
        desc: 'Internal company cost — admin, travel, utilities, office supplies',
        billable: false,
        billableLocked: false,
        requiresClient: false,
        requiresContract: false,
        color: '#f59e0b',
    },
];
const BILL_TYPES = BILL_TYPE_DEFS.map(t => t.id);
const PURPOSES = ['Office Supplies', 'Maintenance & Repair', 'Fuel & Transport', 'Safety Equipment', 'Monthly Consumables', 'Equipment', 'Catering', 'Utilities', 'Other'];

const STATUS_COLORS = {
    'Draft':           { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' },
    'Pending Approval':{ bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b' },
    'Pending':         { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b' },
    'Approved':        { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e' },
    'Rejected':        { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444' },
    'Pushed to Xero':  { bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
    'Posted':          { bg: 'rgba(99,102,241,0.12)',  color: '#818cf8' },
    'Paid':            { bg: 'rgba(16,185,129,0.15)',  color: '#10b981' },
};

const Badge = ({ status }) => {
    const s = STATUS_COLORS[status] || STATUS_COLORS['Draft'];
    return <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.74rem', fontWeight: 700, background: s.bg, color: s.color }}>{status}</span>;
};

const fmt = n => Math.round(parseFloat(n) || 0).toLocaleString('en-PK');
const Rs = n => `Rs. ${fmt(n)}`;

// ─── Shared form helpers ──────────────────────────────────────────────────────
const SI = ({ style, ...props }) => (
    <input {...props} style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '7px 9px', color: 'var(--text)', fontSize: '0.85rem', outline: 'none', ...style }} />
);
const SS = ({ value, onChange, opts }) => (
    <select value={value} onChange={onChange} style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '7px 9px', color: 'var(--text)', fontSize: '0.85rem', outline: 'none' }}>
        <option value="">— Select —</option>
        {opts.map(o => <option key={o}>{o}</option>)}
    </select>
);
const FL = ({ label, children, span }) => (
    <div style={{ gridColumn: span || 'span 1', marginBottom: '0.75rem' }}>
        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '3px', fontWeight: 600 }}>{label}</label>
        {children}
    </div>
);

// ─── OCR Modal ────────────────────────────────────────────────────────────────
function OCRModal({ onSave, onClose, clientsList = [], contractsList = [], vendorsList = [] }) {
    const fileRef = useRef();
    const [phase, setPhase] = useState('upload'); // upload | scanning | review
    const [manualMode, setManualMode] = useState(false);
    const [scanStatus, setScanStatus] = useState('');
    const [pages, setPages] = useState([]);
    const [pageIdx, setPageIdx] = useState(0);
    const [client, setClient] = useState('');
    const [contractId, setContractId] = useState('');
    const [bu, setBu] = useState('');
    const [site, setSite] = useState('');
    const [billType, setBillType] = useState('Client Debit Note');
    const [purpose, setPurpose] = useState('');
    const [note, setNote] = useState('');
    // Manual-mode fields
    const [manualVendor, setManualVendor] = useState('');
    const [manualAmount, setManualAmount] = useState('');
    const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);
    const [manualInvoiceNo, setManualInvoiceNo] = useState('');
    const [manualNote, setManualNote] = useState('');
    const manualFileRef = useRef();

    // Derived — contracts filtered by selected client
    const filteredContracts = contractsList.filter(ct => !client || ct.clientName === client);
    const selectedCt = contractsList.find(ct => ct.id === contractId);
    const clientBUs = [...new Set(clientsList.flatMap(c => c.businessUnits || []).filter(Boolean))];

    const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';

    // Converts a canvas to base64 JPEG
    const canvasToBase64 = (canvas) => canvas.toDataURL('image/jpeg', 0.92).split(',')[1];

    // Sends one base64 image to the OCR API
    const ocrImage = async (base64, mimeType = 'image/jpeg') => {
        const token = localStorage.getItem('asil_hcm_token');
        const resp = await fetch(`${API}/api/bills/ocr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ imageBase64: base64, mimeType }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'OCR failed');
        return data.extracted;
    };

    const handleFile = async e => {
        const f = e.target.files[0]; if (!f) return;
        setPhase('scanning'); setScanStatus('Reading file…');

        try {
            if (f.type === 'application/pdf') {
                // ── PDF: render each page via PDF.js ──────────────────────────
                const pdfjsLib = await import('pdfjs-dist');
                pdfjsLib.GlobalWorkerOptions.workerSrc =
                    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

                const arrayBuffer = await f.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const numPages = pdf.numPages;
                const results = [];

                for (let p = 1; p <= numPages; p++) {
                    setScanStatus(`Scanning page ${p} of ${numPages}…`);
                    const page = await pdf.getPage(p);
                    const viewport = page.getViewport({ scale: 2.0 }); // 2x for quality
                    const canvas = document.createElement('canvas');
                    canvas.width = viewport.width; canvas.height = viewport.height;
                    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

                    const imgDataUrl = canvas.toDataURL('image/jpeg', 0.92);
                    const base64 = imgDataUrl.split(',')[1];

                    let extracted;
                    try {
                        extracted = await ocrImage(base64);
                    } catch (err) {
                        extracted = { vendor: '', date: new Date().toISOString().split('T')[0], items: [{ desc: '', qty: 1, unit: 0, total: 0 }], subtotal: 0, gst: 0, grandTotal: 0, confidence: 0, raw: `❌ OCR failed: ${err.message}` };
                    }
                    results.push({ img: imgDataUrl, extracted });
                }
                setPages(results); setPageIdx(0); setPhase('review');

            } else {
                // ── Single image ──────────────────────────────────────────────
                setScanStatus('Extracting data with AI…');
                const imgDataUrl = await new Promise((res, rej) => {
                    const r = new FileReader();
                    r.onload = () => res(r.result);
                    r.onerror = rej;
                    r.readAsDataURL(f);
                });
                const base64 = imgDataUrl.split(',')[1];
                let extracted;
                try {
                    extracted = await ocrImage(base64, f.type || 'image/jpeg');
                } catch (err) {
                    extracted = { vendor: '', date: new Date().toISOString().split('T')[0], items: [{ desc: '', qty: 1, unit: 0, total: 0 }], subtotal: 0, gst: 0, grandTotal: 0, confidence: 0, raw: `❌ OCR failed: ${err.message}` };
                }
                setPages([{ img: imgDataUrl, extracted }]); setPageIdx(0); setPhase('review');
            }
        } catch (err) {
            alert('File read error: ' + err.message);
            setPhase('upload');
        }
    };

    const cur = pages[pageIdx] || null;

    const setItem = (i, field, v) => {
        setPages(prev => {
            const next = [...prev];
            const items = [...next[pageIdx].extracted.items];
            items[i] = { ...items[i], [field]: v };
            if (field === 'qty' || field === 'unit') items[i].total = Math.round((parseFloat(field === 'qty' ? v : items[i].qty) || 0) * (parseFloat(field === 'unit' ? v : items[i].unit) || 0));
            const subtotal = items.reduce((a, it) => a + (parseFloat(it.total) || 0), 0);
            next[pageIdx] = { ...next[pageIdx], extracted: { ...next[pageIdx].extracted, items, subtotal, grandTotal: subtotal + (next[pageIdx].extracted.gst || 0) } };
            return next;
        });
    };

    const setExt = (patch) => setPages(prev => {
        const next = [...prev];
        next[pageIdx] = { ...next[pageIdx], extracted: { ...next[pageIdx].extracted, ...patch } };
        return next;
    });

    const saveCurrent = () => {
        if (!cur) return;
        const ex = cur.extracted;
        const ct = contractsList.find(c => c.id === contractId);
        onSave({ id: `BILL-${Date.now()}-${pageIdx}`, type: 'OCR / Katcha', client, contract: ct?.contractName || '', contractId, bu, site, vendor: ex.vendor, date: ex.date, items: ex.items, amount: ex.subtotal, gst: ex.gst, total: ex.grandTotal, purpose, billType, status: 'Draft', note });
    };

    const saveAllAndClose = () => {
        const ct = contractsList.find(c => c.id === contractId);
        pages.forEach((pg, i) => {
            const ex = pg.extracted;
            onSave({ id: `BILL-${Date.now()}-${i}`, type: 'OCR / Katcha', client, contract: ct?.contractName || '', contractId, bu, site, vendor: ex.vendor, date: ex.date, items: ex.items, amount: ex.subtotal, gst: ex.gst, total: ex.grandTotal, purpose, billType, status: 'Draft', note });
        });
        onClose();
    };

    const saveManual = () => {
        const ct = contractsList.find(c => c.id === contractId);
        const amt = parseFloat(manualAmount) || 0;
        onSave({ id: `BILL-${Date.now()}`, type: 'Manual (Katcha)', client, contract: ct?.contractName || '', contractId, bu, site, vendor: manualVendor, date: manualDate, invoiceNo: manualInvoiceNo, items: [{ desc: manualNote || 'Manual entry', qty: 1, unit: amt, total: amt }], amount: amt, gst: 0, total: amt, purpose, billType, status: 'Draft', note: manualNote });
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: '900px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <h3 style={{ margin: 0 }}>Katcha Bill / OCR Upload</h3>
                        <p style={{ margin: '3px 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Upload a photo or PDF of a bill • English &amp; Urdu supported • Multi-page PDF = multiple bills</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button onClick={() => setManualMode(m => !m)}
                            style={{ padding: '5px 14px', borderRadius: '7px', border: `1px solid ${manualMode ? '#22c55e' : 'var(--border)'}`, background: manualMode ? 'rgba(34,197,94,0.12)' : 'var(--bg-dark)', color: manualMode ? '#22c55e' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                            {manualMode ? '✓ Manual Entry' : 'Manual Entry (Skip OCR)'}
                        </button>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
                    </div>
                </div>
                <div style={{ padding: '1.75rem 2rem', display: 'grid', gridTemplateColumns: (phase === 'upload' || phase === 'scanning' || manualMode) ? '1fr' : '1fr 1fr', gap: '1.5rem' }}>

                    {manualMode && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Manual Bill Entry — attach file optionally</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem 1rem' }}>
                                <FL label="Vendor / Supplier" span="span 2"><SI value={manualVendor} onChange={e => setManualVendor(e.target.value)} placeholder="Vendor name" /></FL>
                                <FL label="Amount (PKR)"><SI type="number" value={manualAmount} onChange={e => setManualAmount(e.target.value)} placeholder="0" /></FL>
                                <FL label="Date"><SI type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} /></FL>
                                <FL label="Invoice No."><SI value={manualInvoiceNo} onChange={e => setManualInvoiceNo(e.target.value)} placeholder="Optional" /></FL>
                                <FL label="Client">
                                    <select value={client} onChange={e => { setClient(e.target.value); setContractId(''); setBu(''); }} style={{ width:'100%', background:'var(--bg-dark)', border:'1px solid var(--border)', borderRadius:'6px', padding:'7px 9px', color:'var(--text)', fontSize:'0.85rem' }}>
                                        <option value="">— Select Client —</option>
                                        {clientsList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                </FL>
                                <FL label="Contract">
                                    <select value={contractId} onChange={e => setContractId(e.target.value)} style={{ width:'100%', background:'var(--bg-dark)', border:'1px solid var(--border)', borderRadius:'6px', padding:'7px 9px', color:'var(--text)', fontSize:'0.85rem' }}>
                                        <option value="">— Select Contract —</option>
                                        {filteredContracts.map(ct => <option key={ct.id} value={ct.id}>{ct.contractName}</option>)}
                                    </select>
                                </FL>
                                <FL label="Purpose"><SS value={purpose} onChange={e => setPurpose(e.target.value)} opts={PURPOSES} /></FL>
                                <FL label="Bill Type"><SS value={billType} onChange={e => setBillType(e.target.value)} opts={BILL_TYPES} /></FL>
                                <FL label="Internal Note" span="span 2"><SI value={manualNote} onChange={e => setManualNote(e.target.value)} placeholder="Optional" /></FL>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                                <button onClick={() => manualFileRef.current?.click()} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '6px 14px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.82rem' }}>📎 Attach File (optional)</button>
                                <input ref={manualFileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} />
                                <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>PDF or image attachment (stored for reference)</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                                <button onClick={onClose} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={saveManual} disabled={!manualVendor || !manualAmount} style={{ flex: 3, background: manualVendor && manualAmount ? '#22c55e' : '#334155', border: 'none', color: 'white', padding: '9px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Save Bill (Draft)</button>
                            </div>
                        </div>
                    )}

                    {!manualMode && phase === 'upload' && (
                        <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', border: '2px dashed var(--border)', borderRadius: '12px', padding: '3rem', cursor: 'pointer', background: 'rgba(56,189,248,0.03)' }}>
                            <Upload size={36} color="var(--primary)" />
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontWeight: 700, marginBottom: '4px' }}>Upload Bill Photo or PDF</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>JPG, PNG, WEBP or PDF · Handwritten OK · Urdu/English · Multi-page PDF supported</div>
                            </div>
                            <input type="file" accept="image/*,application/pdf" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
                            <div style={{ background: 'var(--primary)', color: 'white', padding: '8px 20px', borderRadius: '8px', fontWeight: 700 }}>Choose File</div>
                        </label>
                    )}

                    {phase === 'scanning' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '3rem' }}>
                            <Loader size={32} color="var(--primary)" style={{ animation: 'spin 1s linear infinite' }} />
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontWeight: 600, marginBottom: '4px' }}>{scanStatus}</div>
                                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Reading vendor, items, amounts — Urdu &amp; English</div>
                            </div>
                            <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
                        </div>
                    )}

                    {phase === 'review' && cur && (<>
                        {/* Left: image + raw text + confidence */}
                        <div>
                            {/* Page navigator for multi-page PDFs */}
                            {pages.length > 1 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', background: 'rgba(56,189,248,0.07)', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                                    <button onClick={() => setPageIdx(p => Math.max(0, p - 1))} disabled={pageIdx === 0} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer' }}>‹</button>
                                    <span style={{ flex: 1, textAlign: 'center', fontSize: '0.82rem', fontWeight: 600 }}>Page {pageIdx + 1} of {pages.length}</span>
                                    <button onClick={() => setPageIdx(p => Math.min(pages.length - 1, p + 1))} disabled={pageIdx === pages.length - 1} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '3px 10px', borderRadius: '6px', cursor: 'pointer' }}>›</button>
                                </div>
                            )}
                            {cur.img && <img src={cur.img} alt="Bill" style={{ width: '100%', maxHeight: '420px', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--border)' }} />}
                            <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '0.75rem', marginTop: '0.75rem', fontSize: '0.76rem', fontFamily: 'monospace', color: '#94a3b8', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: '140px', overflowY: 'auto' }}>{cur.extracted.raw}</div>
                            <div style={{ marginTop: '0.5rem', padding: '0.6rem 0.75rem', background: cur.extracted.confidence > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.12)', border: `1px solid ${cur.extracted.confidence > 0 ? '#22c55e40' : '#ef444460'}`, borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                {cur.extracted.confidence > 0 ? <CheckCircle size={15} color="#22c55e" style={{ flexShrink: 0, marginTop: '1px' }} /> : <AlertTriangle size={15} color="#ef4444" style={{ flexShrink: 0, marginTop: '1px' }} />}
                                <div style={{ fontSize: '0.77rem', color: cur.extracted.confidence > 0 ? '#22c55e' : '#ef4444', lineHeight: 1.5 }}>
                                    {cur.extracted.confidence > 0 ? <><strong>AI Confidence: {Math.round(cur.extracted.confidence * 100)}%</strong> — Verify all values before saving.</> : <><strong>OCR unavailable.</strong> Please fill in manually.</>}
                                </div>
                            </div>
                        </div>

                        {/* Right: editable form */}
                        <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: '4px' }}>
                            <div style={{ fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.9rem' }}>Extracted Data — Verify &amp; Edit</div>
                            <FL label="Vendor">
                                <select value={cur.extracted.vendorId || ''} onChange={e => {
                                    const v = vendorsList.find(v => v.id === parseInt(e.target.value));
                                    setExt({ vendorId: e.target.value, vendor: v?.name || '' });
                                }} style={{ width:'100%', background:'var(--bg-dark)', border:'1px solid var(--border)', borderRadius:'6px', padding:'7px 9px', color:'var(--text)', fontSize:'0.85rem', marginBottom: '4px' }}>
                                    <option value="">— Match to Registered Vendor —</option>
                                    {vendorsList.map(v => <option key={v.id} value={v.id}>{v.name}{v.category ? ` (${v.category})` : ''}</option>)}
                                </select>
                                {!cur.extracted.vendorId && <SI value={cur.extracted.vendor} onChange={e => setExt({ vendor: e.target.value })} placeholder="OCR-extracted name — edit or match above" />}
                            </FL>
                            <FL label="Date"><SI type="date" value={cur.extracted.date} onChange={e => setExt({ date: e.target.value })} /></FL>

                            <div style={{ fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                Line Items
                                <button onClick={() => setPages(prev => { const next = [...prev]; next[pageIdx] = { ...next[pageIdx], extracted: { ...next[pageIdx].extracted, items: [...next[pageIdx].extracted.items, { desc: '', qty: 1, unit: 0, total: 0 }] } }; return next; })} style={{ fontSize: '0.75rem', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', color: 'var(--primary)', padding: '2px 8px', borderRadius: '5px', cursor: 'pointer' }}>+ Add</button>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                                <thead><tr style={{ background: 'var(--bg-dark)' }}>{['Description', 'Qty', 'Unit', 'Total'].map(h => <th key={h} style={{ padding: '5px 7px', textAlign: h === 'Description' ? 'left' : 'right', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>{h}</th>)}</tr></thead>
                                <tbody>{cur.extracted.items.map((item, i) => (
                                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                        {['desc', 'qty', 'unit', 'total'].map(f => (
                                            <td key={f} style={{ padding: '3px 4px' }}>
                                                <SI value={item[f]} onChange={e => setItem(i, f, e.target.value)} style={{ textAlign: f === 'desc' ? 'left' : 'right', fontSize: '0.78rem', padding: '4px 6px' }} />
                                            </td>
                                        ))}
                                    </tr>
                                ))}</tbody>
                            </table>

                            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(56,189,248,0.07)', borderRadius: '8px', padding: '0.6rem 0.9rem', fontWeight: 700, marginBottom: '1rem' }}>
                                <span>Grand Total</span><span style={{ color: 'var(--primary)' }}>{Rs(cur.extracted.grandTotal)}</span>
                            </div>

                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                                <div style={{ fontWeight: 700, marginBottom: '0.6rem', fontSize: '0.85rem' }}>Classify This Bill</div>
                                <FL label="Client">
                                    <select value={client} onChange={e => { setClient(e.target.value); setContractId(''); setBu(''); }} style={{ width:'100%', background:'var(--bg-dark)', border:'1px solid var(--border)', borderRadius:'6px', padding:'7px 9px', color:'var(--text)', fontSize:'0.85rem' }}>
                                        <option value="">— Select Client —</option>
                                        {clientsList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                </FL>
                                <FL label="Contract">
                                    <select value={contractId} onChange={e => setContractId(e.target.value)} style={{ width:'100%', background:'var(--bg-dark)', border:'1px solid var(--border)', borderRadius:'6px', padding:'7px 9px', color:'var(--text)', fontSize:'0.85rem' }}>
                                        <option value="">— Select Contract —</option>
                                        {filteredContracts.map(ct => <option key={ct.id} value={ct.id}>{ct.contractName}</option>)}
                                    </select>
                                </FL>
                                <FL label="Site / Location"><SI value={site} onChange={e => setSite(e.target.value)} placeholder="e.g. Karachi Office" /></FL>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                    <FL label="Bill Type"><SS value={billType} onChange={e => setBillType(e.target.value)} opts={BILL_TYPES} /></FL>
                                    <FL label="Purpose"><SS value={purpose} onChange={e => setPurpose(e.target.value)} opts={PURPOSES} /></FL>
                                </div>
                                <FL label="Internal Note"><SI value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" /></FL>
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <button onClick={onClose} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                    {pages.length > 1 ? (<>
                                        <button onClick={() => { saveCurrent(); if (pageIdx < pages.length - 1) setPageIdx(p => p + 1); }} disabled={!client || !billType} style={{ flex: 2, background: client && billType ? 'var(--primary)' : '#334155', border: 'none', color: 'white', padding: '9px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                                            Save Page {pageIdx + 1} & Next →
                                        </button>
                                        {pageIdx === pages.length - 1 && <button onClick={saveAllAndClose} disabled={!client || !billType} style={{ flex: 2, background: client && billType ? '#22c55e' : '#334155', border: 'none', color: 'white', padding: '9px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Save All & Done ✓</button>}
                                    </>) : (
                                        <button onClick={() => { saveCurrent(); onClose(); }} disabled={!client || !billType} style={{ flex: 2, background: client && billType ? 'var(--primary)' : '#334155', border: 'none', color: 'white', padding: '9px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Save Bill (Draft)</button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>)}
                </div>
            </div>
        </div>
    );
}


// ─── Manual Bill Modal — with line items ──────────────────────────────────────
function ManualBillModal({ onSave, onClose, clientsList = [], contractsList = [], vendorsList = [] }) {
    const emptyItem = () => ({ desc: '', qty: 1, unit: '', total: 0 });
    const [form, setForm] = useState({
        vendorId: '', vendor: '', date: new Date().toISOString().split('T')[0],
        invoiceNo: '', gstPct: '17', client: '', contractId: '', bu: '', site: '',
        billType: 'Debit Note / Imprest', purpose: '', note: '', billCategory: 'official', vendorFiler: '',
        billable: true, periodMonth: new Date().getMonth() + 1, periodYear: new Date().getFullYear(),
    });
    const [items, setItems] = useState([emptyItem()]);
    const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
    const billTypeDef = BILL_TYPE_DEFS.find(t => t.id === form.billType) || BILL_TYPE_DEFS[0];
    const filteredContracts = contractsList.filter(ct => !form.client || ct.clientName === form.client);
    const vendorName = vendorsList.find(v => v.id === parseInt(form.vendorId))?.name || form.vendor || '';

    const setItem = (i, k, v) => setItems(p => {
        const next = [...p]; next[i] = { ...next[i], [k]: v };
        if (k === 'qty' || k === 'unit') next[i].total = Math.round((parseFloat(k === 'qty' ? v : next[i].qty) || 0) * (parseFloat(k === 'unit' ? v : next[i].unit) || 0));
        return next;
    });

    const subtotal = items.reduce((a, it) => a + (parseFloat(it.total) || 0), 0);
    // Unofficial bills: no GST or WHT regardless of bill type
    const isUnofficial = form.billCategory === 'unofficial';
    const gstAmount = isUnofficial ? 0 : Math.round(subtotal * (parseFloat(form.gstPct) || 0) / 100);
    // WHT: for Official bills based on vendor filer status (filer=5%, non-filer=10%)
    const whtPct = !isUnofficial ? (form.vendorFiler === 'filer' ? 5 : form.vendorFiler === 'non-filer' ? 10 : 0) : 0;
    const whtAmount = Math.round(subtotal * whtPct / 100);
    const grandTotal = subtotal + gstAmount - whtAmount;

    const save = () => {
        const ct = contractsList.find(c => c.id === form.contractId);
        const resolvedVendor = vendorsList.find(v => v.id === parseInt(form.vendorId))?.name || form.vendor;
        onSave({ id: `BILL-${Date.now()}`, type: 'Manual', ...form,
            vendor: resolvedVendor,
            contract: ct?.contractName || '', items, amount: subtotal, gst: gstAmount, total: grandTotal, status: 'Draft',
            billable: billTypeDef.billableLocked ? billTypeDef.billable : form.billable,
            billCategory: form.billCategory || 'official',
            whtAmount,
            gstExempt: form.billCategory === 'unofficial',
        });
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: '860px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0 }}>Manual Bill Entry</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
                </div>
                <div style={{ padding: '1.5rem 2rem', maxHeight: '78vh', overflowY: 'auto' }}>
                    {/* Header fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 1rem' }}>

                        {/* Bill Type — first choice determines all other logic */}
                        <div style={{ gridColumn: 'span 3', marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Bill Type — select one</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem' }}>
                                {BILL_TYPE_DEFS.map(t => (
                                    <button key={t.id} onClick={() => {
                                        set('billType', t.id);
                                        if (t.billableLocked) set('billable', t.billable);
                                        if (!t.requiresClient) { set('client', ''); set('contractId', ''); }
                                    }}
                                        style={{ padding: '10px 8px', borderRadius: '10px', border: `2px solid ${form.billType === t.id ? t.color : 'var(--border)'}`, background: form.billType === t.id ? `${t.color}18` : 'transparent', cursor: 'pointer', textAlign: 'center' }}>
                                        <div style={{ fontSize: '1.2rem', marginBottom: '3px' }}>{t.icon}</div>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: form.billType === t.id ? t.color : 'var(--text-muted)' }}>{t.id}</div>
                                    </button>
                                ))}
                            </div>
                            {billTypeDef && (
                                <div style={{ marginTop: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', padding: '6px 10px', background: `${billTypeDef.color}10`, borderRadius: '6px', border: `1px solid ${billTypeDef.color}30` }}>
                                    {billTypeDef.icon} {billTypeDef.desc}
                                    {billTypeDef.billableLocked && <strong style={{ color: billTypeDef.color }}> · Billable to client (locked ON)</strong>}
                                </div>
                            )}
                        </div>

                        {/* Vendor Dropdown */}
                        <FL label="Vendor / Supplier" span="span 2">
                            <select value={form.vendorId} onChange={e => {
                                const v = vendorsList.find(v => v.id === parseInt(e.target.value));
                                set('vendorId', e.target.value);
                                set('vendor', v?.name || '');
                            }} style={{ width:'100%', background:'var(--bg-dark)', border:'1px solid var(--border)', borderRadius:'6px', padding:'7px 9px', color:'var(--text)', fontSize:'0.85rem' }}>
                                <option value="">— Select Registered Vendor —</option>
                                {vendorsList.map(v => <option key={v.id} value={v.id}>{v.name}{v.category ? ` (${v.category})` : ''}</option>)}
                            </select>
                            {!form.vendorId && <input value={form.vendor} onChange={e => set('vendor', e.target.value)} placeholder="Or type vendor name if not registered" style={{ marginTop: '4px', width:'100%', background:'rgba(245,158,11,0.04)', border:'1px dashed rgba(245,158,11,0.4)', borderRadius:'6px', padding:'5px 9px', color:'#f59e0b', fontSize:'0.8rem' }} />}
                        </FL>
                        <FL label="Bill Date"><SI type="date" value={form.date} onChange={e => set('date', e.target.value)} /></FL>
                        <FL label="Invoice No." span="span 1"><SI value={form.invoiceNo} onChange={e => set('invoiceNo', e.target.value)} placeholder="Optional" /></FL>
                        {billTypeDef.requiresClient && (
                            <FL label="Client">
                                <select value={form.client} onChange={e => { set('client', e.target.value); set('contractId', ''); set('bu',''); }} style={{ width:'100%', background:'var(--bg-dark)', border:'1px solid var(--border)', borderRadius:'6px', padding:'7px 9px', color:'var(--text)', fontSize:'0.85rem' }}>
                                    <option value="">— Select Client —</option>
                                    {clientsList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                </select>
                            </FL>
                        )}
                        {billTypeDef.requiresContract && (
                            <FL label="Contract">
                                <select value={form.contractId} onChange={e => set('contractId', e.target.value)} style={{ width:'100%', background:'var(--bg-dark)', border:'1px solid var(--border)', borderRadius:'6px', padding:'7px 9px', color:'var(--text)', fontSize:'0.85rem' }}>
                                    <option value="">— Select Contract —</option>
                                    {filteredContracts.map(ct => <option key={ct.id} value={ct.id}>{ct.contractName}</option>)}
                                </select>
                            </FL>
                        )}
                        {billTypeDef.requiresPeriod && (
                            <FL label="Period Month">
                                <select value={form.periodMonth} onChange={e => set('periodMonth', e.target.value)} style={{ width:'100%', background:'var(--bg-dark)', border:'1px solid var(--border)', borderRadius:'6px', padding:'7px 9px', color:'var(--text)', fontSize:'0.85rem' }}>
                                    {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                                </select>
                            </FL>
                        )}
                        <FL label="Site / Location"><SI value={form.site} onChange={e => set('site', e.target.value)} placeholder="e.g. Karachi" /></FL>
                        <FL label="Purpose" span="span 2"><SS value={form.purpose} onChange={e => set('purpose', e.target.value)} opts={PURPOSES} /></FL>
                        <FL label="GST %"><SI type="number" value={isUnofficial ? '0' : form.gstPct} onChange={e => set('gstPct', e.target.value)} placeholder="17" disabled={isUnofficial} style={{ opacity: isUnofficial ? 0.45 : 1 }} /></FL>

                        {/* Bill Nature — Official / Unofficial (applies to ALL bill types) */}
                        <div style={{ gridColumn: 'span 3', marginBottom: '0.75rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>Bill Nature — Official or Unofficial</div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                {[
                                    { id: 'official', label: '📄 Official', desc: 'Registered vendor · GST applicable · WHT based on filer status', color: '#38bdf8' },
                                    { id: 'unofficial', label: '✋ Unofficial', desc: 'No GST · No WHT · No filer verification required', color: '#f59e0b' },
                                ].map(opt => (
                                    <button key={opt.id} onClick={() => set('billCategory', opt.id)}
                                        style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: `2px solid ${form.billCategory === opt.id ? opt.color : 'var(--border)'}`,
                                            background: form.billCategory === opt.id ? `${opt.color}15` : 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                                        <div style={{ fontWeight: 700, color: form.billCategory === opt.id ? opt.color : 'var(--text-muted)', marginBottom: '3px', fontSize: '0.88rem' }}>{opt.label}</div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{opt.desc}</div>
                                    </button>
                                ))}
                            </div>
                            {form.billCategory === 'unofficial' && (
                                <div style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '8px', fontSize: '0.78rem', color: '#f59e0b' }}>
                                    ⚠ Unofficial bill — GST and WHT will NOT be applied. No filer/non-filer check required.
                                </div>
                            )}
                            {form.billCategory === 'official' && (
                                <div style={{ marginTop: '8px' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '5px' }}>Vendor Filer Status (for WHT)</div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        {[['filer', 'Filer (WHT 5%)', '#22c55e'], ['non-filer', 'Non-Filer (WHT 10%)', '#ef4444'], ['', 'Unknown / Skip WHT', '#64748b']].map(([val, lbl, col]) => (
                                            <button key={val} onClick={() => set('vendorFiler', val)}
                                                style={{ flex: 1, padding: '6px 8px', borderRadius: '8px', border: `1px solid ${form.vendorFiler === val ? col : 'var(--border)'}`,
                                                    background: form.vendorFiler === val ? `${col}18` : 'transparent', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700, color: form.vendorFiler === val ? col : 'var(--text-muted)' }}>
                                                {lbl}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Billable toggle — locked for types 1 & 2 */}
                        <div style={{ gridColumn: 'span 3', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', background: form.billable ? 'rgba(34,197,94,0.07)' : 'rgba(245,158,11,0.07)', border: `1px solid ${form.billable ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
                            <input type="checkbox" checked={!!form.billable} disabled={billTypeDef.billableLocked}
                                onChange={e => !billTypeDef.billableLocked && set('billable', e.target.checked)}
                                style={{ width: '16px', height: '16px', accentColor: '#22c55e', cursor: billTypeDef.billableLocked ? 'not-allowed' : 'pointer' }} />
                            <span style={{ fontSize: '0.85rem', color: form.billable ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
                                {form.billable ? '✅ Billable to Client' : '🏢 Internal (Non-Billable)'}
                                {billTypeDef.billableLocked && <span style={{ fontSize: '0.75rem', marginLeft: '8px', opacity: 0.7 }}>(locked for this bill type)</span>}
                            </span>
                        </div>
                    </div>

                    {/* Line items table */}
                    <div style={{ marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Line Items</div>
                            <button onClick={() => setItems(p => [...p, emptyItem()])}
                                style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', color: 'var(--primary)', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                + Add Item
                            </button>
                        </div>
                        <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead><tr style={{ background: 'var(--bg-dark)' }}>
                                    {['Description', 'Qty', 'Unit Price (PKR)', 'Total (PKR)', ''].map(h => (
                                        <th key={h} style={{ padding: '7px 9px', textAlign: h === 'Description' ? 'left' : 'right', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                    ))}
                                </tr></thead>
                                <tbody>
                                    {items.map((item, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '4px 6px', width: '42%' }}>
                                                <SI value={item.desc} onChange={e => setItem(i, 'desc', e.target.value)} placeholder="Item description" style={{ fontSize: '0.82rem' }} />
                                            </td>
                                            <td style={{ padding: '4px 6px', width: '10%' }}>
                                                <SI type="number" value={item.qty} onChange={e => setItem(i, 'qty', e.target.value)} style={{ textAlign: 'right', fontSize: '0.82rem' }} />
                                            </td>
                                            <td style={{ padding: '4px 6px', width: '22%' }}>
                                                <SI type="number" value={item.unit} onChange={e => setItem(i, 'unit', e.target.value)} placeholder="0" style={{ textAlign: 'right', fontSize: '0.82rem' }} />
                                            </td>
                                            <td style={{ padding: '4px 12px', textAlign: 'right', fontWeight: 700, fontSize: '0.88rem', whiteSpace: 'nowrap', width: '18%' }}>
                                                Rs.&nbsp;{Math.round(parseFloat(item.total) || 0).toLocaleString('en-PK')}
                                            </td>
                                            <td style={{ padding: '4px 6px', width: '8%', textAlign: 'center' }}>
                                                {items.length > 1 && (
                                                    <button onClick={() => setItems(p => p.filter((_, j) => j !== i))}
                                                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', padding: '2px 4px' }}>×</button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Totals */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '5px 1rem', background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: '10px', padding: '0.85rem 1rem', marginBottom: '1rem' }}>
                        {(() => {
                            const rows = [['Subtotal', Rs(subtotal)], ...(whtAmount > 0 ? [['WHT Deduction', '-' + Rs(whtAmount)]] : []), [`GST (${form.gstPct || 0}%)`, Rs(gstAmount)], ['GRAND TOTAL', Rs(grandTotal)]];
                            const lastIdx = rows.length - 1;
                            return rows.map(([l, v], i) => (
                                <React.Fragment key={l}>
                                    <span style={{ fontSize: '0.85rem', fontWeight: i === lastIdx ? 700 : 400, color: i === lastIdx ? 'var(--text)' : 'var(--text-muted)' }}>{l}</span>
                                    <span style={{ textAlign: 'right', fontWeight: i === lastIdx ? 900 : 600, color: i === lastIdx ? 'var(--primary)' : 'var(--text)', fontSize: i === lastIdx ? '1.05rem' : '0.88rem' }}>{v}</span>
                                </React.Fragment>
                            ));
                        })()}
                    </div>

                    <FL label="Internal Note"><SI value={form.note} onChange={e => set('note', e.target.value)} placeholder="Optional note for auditors..." /></FL>

                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                        <button onClick={onClose} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                        <button onClick={save} disabled={!form.vendor || items.every(it => !it.desc)}
                            style={{ flex: 3, background: form.vendor ? 'var(--primary)' : '#334155', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                            Save Bill (Draft)
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Import Quotation Modal ───────────────────────────────────────────────────
function ImportQuotationModal({ onSave, onClose }) {
    const fileRef = useRef();
    const [stage, setStage] = useState('upload');
    const [parsed, setParsed] = useState(null);
    const [form, setForm] = useState({ client: '', contract: '', site: '', billType: 'Client Debit Note', purpose: 'Procurement — Fixed Supply', note: '' });
    const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

    const downloadTemplate = () => {
        const csv = 'Description,Quantity,Unit Price\nSafety Helmets,10,850\nSafety Boots,10,1200\nReflective Vests,10,450';
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'quotation_template.csv'; a.click();
    };

    const handleFile = e => {
        const f = e.target.files[0]; if (!f) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const lines = ev.target.result.replace(/\r/g, '').split('\n').filter(Boolean);
            const hdrs = lines[0].split(',').map(h => h.trim());
            const items = lines.slice(1).map(line => {
                const vals = line.split(',').map(v => v.trim());
                const obj = {}; hdrs.forEach((h, i) => { obj[h] = vals[i] || ''; });
                const qty = parseFloat(obj['Quantity']) || 1;
                const unit = parseFloat(obj['Unit Price']) || 0;
                return { desc: obj['Description'] || '—', qty, unit, total: Math.round(qty * unit) };
            }).filter(it => it.desc !== '—');
            const sub = items.reduce((a, it) => a + it.total, 0);
            const gst = Math.round(sub * 0.17);
            setParsed({ items, subtotal: sub, gst, grandTotal: sub + gst, vendor: f.name.replace('.csv', '') });
            setStage('review');
        };
        reader.readAsText(f);
    };

    const save = () => {
        onSave({ id: `BILL-${Date.now()}`, type: 'Quotation', vendor: parsed.vendor, date: new Date().toISOString().split('T')[0], items: parsed.items, amount: parsed.subtotal, gst: parsed.gst, total: parsed.grandTotal, ...form, status: 'Draft' });
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box" style={{ maxWidth: '760px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <h3 style={{ margin: 0 }}>Import Quotation</h3>
                        <p style={{ margin: '3px 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Upload a CSV quotation from a vendor — auto-calculates line totals and GST</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
                </div>
                <div style={{ padding: '1.5rem 2rem', maxHeight: '78vh', overflowY: 'auto' }}>
                    {stage === 'upload' && (
                        <>
                            <button onClick={downloadTemplate} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                                ↓ Download CSV Template
                            </button>
                            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', border: '2px dashed var(--border)', borderRadius: '12px', padding: '2.5rem', cursor: 'pointer', background: 'rgba(56,189,248,0.03)' }}>
                                <div style={{ fontSize: '2.5rem' }}>📄</div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>Upload Quotation CSV</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>Columns: Description, Quantity, Unit Price</div>
                                </div>
                                <input type="file" accept=".csv" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
                                <div style={{ background: 'var(--primary)', color: 'white', padding: '8px 20px', borderRadius: '8px', fontWeight: 700 }}>Choose CSV File</div>
                            </label>
                        </>
                    )}

                    {stage === 'review' && parsed && (
                        <>
                            {/* Classify */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 1rem', marginBottom: '0.5rem' }}>
                                <FL label="Client">
                                    <SS value={form.client} onChange={e => { set('client', e.target.value); set('contract', ''); }} opts={CLIENTS} />
                                </FL>
                                <FL label="Contract">
                                    <SS value={form.contract} onChange={e => set('contract', e.target.value)} opts={CONTRACTS[form.client] || []} />
                                </FL>
                                <FL label="Site"><SS value={form.site} onChange={e => set('site', e.target.value)} opts={SITES} /></FL>
                            </div>

                            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', marginBottom: '1rem' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr style={{ background: 'var(--bg-dark)' }}>
                                        {['Description', 'Qty', 'Unit Price', 'Total'].map(h => (
                                            <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Description' ? 'left' : 'right', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                        ))}
                                    </tr></thead>
                                    <tbody>
                                        {parsed.items.map((it, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '7px 10px', fontSize: '0.85rem' }}>{it.desc}</td>
                                                <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: '0.85rem' }}>{it.qty}</td>
                                                <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: '0.85rem' }}>{Rs(it.unit)}</td>
                                                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>{Rs(it.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '2rem', background: 'rgba(56,189,248,0.06)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
                                {[['Subtotal', Rs(parsed.subtotal)], ['GST (17%)', Rs(parsed.gst)], ['GRAND TOTAL', Rs(parsed.grandTotal)]].map(([l, v]) => (
                                    <div key={l} style={{ textAlign: 'right' }}><div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>{l}</div><div style={{ fontWeight: 800, color: 'var(--primary)' }}>{v}</div></div>
                                ))}
                            </div>

                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <button onClick={() => setStage('upload')} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>← Back</button>
                                <button onClick={save} style={{ flex: 3, background: 'var(--primary)', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Import as Quotation (Draft)</button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Bill Detail Modal ─────────────────────────────────────────────────
function BillDetailModal({ bill, onAction, onXero, onClose, isApprover, generateChallan, onCreateInvoice }) {
    const flow = {
        'Draft':            ['Submit for Approval'],
        'Pending Approval': ['Approve', 'Reject'],
        'Pending':          ['Approve', 'Reject'],
        'Approved':         ['Post to Ledger', 'Mark as Paid'],
        'Posted':           ['Mark as Paid'],
        'Pushed to Xero':   ['Mark as Paid'],
        'Rejected':         ['Archive'],
        'Paid':             [],
    };
    const actions = flow[bill.status] || [];

    const xeroStub = () => {
        console.log('[Xero Stub] Syncing bill to Xero:', bill);
        onXero(bill.id, 'Pushed to Xero');
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                            <h3 style={{ margin: 0 }}>{bill.id}</h3><Badge status={bill.status} />
                        </div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{bill.type} · {bill.date}</div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
                </div>
                <div style={{ padding: '1.5rem 2rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 2rem', marginBottom: '1.25rem' }}>
                        {[['Vendor', bill.vendor], ['Client', bill.client], ['Contract', bill.contract], ['Site', bill.site], ['Purpose', bill.purpose], ['Bill Type', bill.billType], ['Invoice No', bill.invoiceNo || '—'], ['Amount (excl. GST)', Rs(bill.amount)], ['GST', Rs(bill.gst)], ['Note', bill.note || '—']].map(([l, v]) => (
                            <div key={l}><div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '2px' }}>{l}</div><div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{v}</div></div>
                        ))}
                    </div>

                    {bill.items && bill.items.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Line Items</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', fontSize: '0.83rem' }}>
                                <thead><tr style={{ background: 'var(--bg-dark)' }}>
                                    {['Description', 'Qty', 'Unit Price', 'Total'].map(h => <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Description' ? 'left' : 'right', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>{h}</th>)}
                                </tr></thead>
                                <tbody>{bill.items.map((it, i) => (
                                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                        <td style={{ padding: '6px 10px' }}>{it.desc}</td>
                                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{it.qty}</td>
                                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{Rs(it.unit)}</td>
                                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>{Rs(it.total)}</td>
                                    </tr>
                                ))}</tbody>
                            </table>
                        </div>
                    )}

                    <div style={{ background: 'rgba(56,189,248,0.07)', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600 }}>Total (incl. GST)</span>
                        <span style={{ fontWeight: 900, fontSize: '1.2rem', color: 'var(--primary)' }}>{Rs(bill.total)}</span>
                    </div>

                    {/* Bill type contextual info */}
                    {(() => {
                        const btDef = BILL_TYPE_DEFS.find(t => t.id === bill.billType);
                        if (!btDef) return null;
                        return <div style={{ background: `${btDef.color}10`, border: `1px solid ${btDef.color}30`, borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.84rem' }}>
                            <strong style={{ color: btDef.color }}>{btDef.icon} {btDef.id}:</strong> {btDef.desc}
                        </div>;
                    })()}

                    {bill.status === 'Paid' && (
                        <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.84rem', color: '#10b981' }}>
                            🔒 <strong>This bill is PAID and locked.</strong> Use “Unlock” from the bill list to make changes.
                        </div>
                    )}

                    {/* Create Invoice — for billable bill types with a client assigned */}
                    {['Debit Note / Imprest', 'Client Procurement', 'Contractual Purchasing'].includes(bill.billType) && bill.billable !== false && bill.client && (
                        <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.28)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                            <div style={{ fontSize: '0.83rem' }}>
                                <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: '2px' }}>🧾 Ready to Invoice</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Billable {bill.billType} for <strong>{bill.client}</strong>. Auto-create a draft client invoice from this bill.</div>
                            </div>
                            <button onClick={() => { onCreateInvoice && onCreateInvoice(bill); onClose(); }}
                                style={{ background: '#22c55e', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                                🧾 Create Invoice
                            </button>
                        </div>
                    )}

                    {/* Xero stub — visible to approvers when Approved */}
                    {isApprover && bill.status === 'Approved' && (
                        <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontSize: '0.83rem' }}>
                                <div style={{ fontWeight: 700, color: '#818cf8', marginBottom: '2px' }}>📊 Xero Integration (Stub)</div>
                                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Click to mark as synced. Full Xero OAuth is pending implementation.</div>
                            </div>
                            <button onClick={() => { onXero(bill.id, 'Pushed to Xero'); onClose(); }} style={{ background: '#6366f1', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>Approve &amp; Sync to Xero →</button>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button onClick={onClose} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>Close</button>
                        <button onClick={() => generateChallan && generateChallan(bill)}
                            style={{ flex: 1, background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                            📄 Delivery Challan
                        </button>
                        {actions.map(a => (
                            <button key={a} onClick={() => { onAction(bill.id, a); onClose(); }}
                                style={{ flex: 2, background: a === 'Approve' || a === 'Post to Ledger' ? '#22c55e' : a === 'Reject' ? '#ef4444' : 'var(--primary)', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
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
// MAIN COMPONENT — starts with empty register (no mock data)
// ═══════════════════════════════════════════════════════════════════════════════
export default function BillingProcurement({ user }) {
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showOCR, setShowOCR] = useState(false);
    const [showManual, setShowManual] = useState(false);
    const [showQuote, setShowQuote] = useState(false);
    const [detailBill, setDetailBill] = useState(null);
    const [filterType, setFilterType] = useState('All');
    const [filterClient, setFilterClient] = useState('All');
    const [filterStatus, setFilterStatus] = useState('All');
    const [filterBillType, setFilterBillType] = useState('All');
    const [invCreated, setInvCreated] = useState(null); // { invoice_number, bill_id }

    const [clientsList, setClientsList]     = useState([]);
    const [contractsList, setContractsList] = useState([]);
    const [vendorsList, setVendorsList]     = useState([]);
    const [activeTab, setActiveTab]         = useState('active'); // 'active' | 'paid'
    const [unlockTarget, setUnlockTarget]   = useState(null); // bill to unlock
    const [paymentModal, setPaymentModal] = useState(null); // { billId, action } when Mark as Paid clicked
    const [paymentMethod, setPaymentMethod] = useState('HBL');
    const [paymentAccount, setPaymentAccount] = useState('');
    const [unlockPwd, setUnlockPwd]         = useState('');
    const [unlockError, setUnlockError]     = useState(null);
    const [unlockLoading, setUnlockLoading] = useState(false);
    const [overrideBill, setOverrideBill] = useState(null);
    useEffect(() => {
        api.getBills()
            .then(data => setBills(Array.isArray(data) ? data : []))
            .catch(err => console.error('Bills load error:', err.message))
            .finally(() => setLoading(false));
        api.getClients().then(d => setClientsList(d.clients || [])).catch(() => {});
        api.getContracts().then(d => setContractsList(d.contracts || [])).catch(() => {});
        api.getVendors().then(d => setVendorsList(d.vendors || [])).catch(() => {});
    }, []);

    const filtered = bills.filter(b =>
        (filterType === 'All' || b.type === filterType) &&
        (filterClient === 'All' || b.client === filterClient) &&
        (filterStatus === 'All' || b.status === filterStatus) &&
        (filterBillType === 'All' || b.billType === filterBillType)
    );
    const totals = filtered.reduce((a, b) => ({ total: a.total + b.total, gst: a.gst + b.gst }), { total: 0, gst: 0 });

    const addBill = async b => {
        try {
            const { bill } = await api.saveBill(b);
            setBills(p => [bill, ...p]);
        } catch (err) { alert('Failed to save bill: ' + err.message); }
    };

    const doAction = async (id, action) => {
        if (action === 'Mark as Paid') {
            setPaymentModal({ billId: id });
            return; // payment modal handles the actual PATCH
        }
        const map = {
            'Submit for Approval': 'Pending Approval',
            'Approve': 'Approved',
            'Mark as Paid': 'Paid',
            'Post to Ledger': 'Posted',
            'Reject': 'Rejected',
            'Archive': 'Rejected',
        };
        const newStatus = map[action];
        if (!newStatus) return;
        try {
            await api.updateBillStatus(id, newStatus);
            setBills(p => p.map(b => b.id === id ? { ...b, status: newStatus } : b));
        } catch (err) { alert('Status update failed: ' + err.message); }
    };

    const doPayment = async () => {
        if (!paymentModal) return;
        try {
            const token = localStorage.getItem('asil_hcm_token');
            const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
            const r = await fetch(`${API}/api/bills/${paymentModal.billId}/status`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Paid', paymentMethod, paymentAccount }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || 'Payment update failed');
            setBills(p => p.map(b => b.id === paymentModal.billId ? { ...b, status: 'Paid', paymentMethod, paymentAccount } : b));
            setPaymentModal(null); setPaymentMethod('HBL'); setPaymentAccount('');
        } catch (err) { alert('Payment failed: ' + err.message); }
    };

    const generateChallan = async (bill) => {
        const delivDate = window.prompt('Delivery date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
        if (!delivDate) return;
        try {
            const token = localStorage.getItem('asil_hcm_token');
            const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
            const r = await fetch(`${API}/api/bills/${bill.id}/challan`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ delivery_date: delivDate }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            const ch = data.challan;
            // Open print window
            const html = `<!DOCTYPE html><html><head><title>Delivery Challan ${ch.challan_no}</title>
<style>body{font-family:Arial,sans-serif;padding:30px;max-width:700px;margin:0 auto}
h1{color:#1e293b}table{width:100%;border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:8px 10px}th{background:#f1f5f9}@media print{button{display:none}}</style></head>
<body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
  <div><h1 style="margin:0">Delivery Challan</h1><div style="color:#64748b">${ch.challan_no}</div></div>
  <div style="text-align:right"><strong>ASIL</strong><br>Allied Services International Ltd<br>Date: ${ch.delivery_date || new Date().toISOString().split('T')[0]}</div>
</div>
<table style="margin-bottom:20px"><tr><td><strong>Client</strong></td><td>${ch.client || '—'}</td><td><strong>Vendor</strong></td><td>${ch.vendor || '—'}</td></tr>
<tr><td><strong>Contract</strong></td><td>${ch.contract || '—'}</td><td><strong>Site</strong></td><td>${ch.site || '—'}</td></tr></table>
<h3>Items</h3>
<table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>
${(ch.items||[]).map(it=>`<tr><td>${it.desc||''}</td><td>${it.qty||1}</td><td>PKR ${(it.unit||0).toLocaleString()}</td><td>PKR ${(it.total||0).toLocaleString()}</td></tr>`).join('')}
</tbody><tfoot><tr><td colspan="3" style="text-align:right"><strong>Grand Total</strong></td><td><strong>PKR ${(ch.total||0).toLocaleString()}</strong></td></tr></tfoot></table>
<div style="margin-top:60px;display:grid;grid-template-columns:1fr 1fr;gap:40px">
  <div style="border-top:1px solid #000;padding-top:8px">Prepared By</div>
  <div style="border-top:1px solid #000;padding-top:8px">Received By &amp; Signature</div>
</div>
<button onclick="window.print()" style="margin-top:20px;padding:10px 24px;background:#1e40af;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px">🖨️ Print Challan</button>
</body></html>`;
            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
        } catch (e) { alert('Challan error: ' + e.message); }
    };

    const doUnlock = async () => {
        if (!unlockTarget) return;
        setUnlockLoading(true); setUnlockError(null);
        try {
            const token = localStorage.getItem('asil_hcm_token');
            const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
            const r = await fetch(`${API}/api/bills/${unlockTarget.id}/unlock`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: unlockPwd }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            setBills(p => p.map(b => b.id === unlockTarget.id ? { ...b, status: 'Approved' } : b));
            setUnlockTarget(null); setUnlockPwd('');
        } catch (e) { setUnlockError(e.message); }
        setUnlockLoading(false);
    };

    const deleteBill = async (bill) => {
        if (!window.confirm(`⚠️ Permanently delete bill ${bill.id}?\n\nThis action cannot be undone.`)) return;
        try {
            const token = localStorage.getItem('asil_hcm_token');
            const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
            const r = await fetch(`${API}/api/bills/${bill.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
            if (!r.ok) throw new Error((await r.json()).error || 'Delete failed');
            setBills(p => p.filter(b => b.id !== bill.id));
        } catch (err) { alert('Delete failed: ' + err.message); }
    };

    const isSuperAdmin   = user?.role === 'superadmin';
    const isFinanceApprover = ['finance_approver','superadmin','finance_manager'].includes(user?.role);

    const createInvoiceFromBill = async (bill) => {
        try {
            const token = localStorage.getItem('asil_hcm_token');
            const API_URL = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
            const r = await fetch(`${API_URL}/api/bills/${bill.id}/create-invoice`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || 'Failed to create invoice');
            setInvCreated({ invoice_number: data.invoice_number, bill_id: bill.id });
        } catch (err) { alert('Invoice creation failed: ' + err.message); }
    };

    const doQuickApprove = async (bill) => {
        if (!window.confirm(`Approve bill from ${bill.vendor || bill.id}?`)) return;
        const tryApprove = async (overrideReason) => {
            await api.updateBillStatus(bill.id, 'Approved', overrideReason ? { overrideReason } : {});
            setBills(p => p.map(b => b.id === bill.id ? { ...b, status: 'Approved' } : b));
        };
        try {
            await tryApprove();
        } catch (err) {
            const msg = err.message || '';
            if (msg.includes('BUDGET_UNMATCHED') || msg.includes('budget line')) {
                setOverrideBill(bill);
            } else {
                alert('Approve failed: ' + msg);
            }
        }
    };

    const TYPES     = ['All', 'OCR / Katcha', 'Manual', 'Quotation'];
    const STATUSES  = ['All', 'Draft', 'Pending', 'Pending Approval', 'Approved', 'Posted', 'Rejected'];
    const BILL_TYPES_FILTER = ['All', ...BILL_TYPES];

    return (
        <div className="dashboard">
            <ConfirmModal
                open={!!overrideBill}
                title="Budget override required"
                body="Match this bill to a budget line in Bill Verification, or enter an override reason to approve anyway."
                showInput
                inputLabel="Override reason"
                inputPlaceholder="e.g. Emergency purchase approved by MD"
                confirmLabel="Approve with override"
                onConfirm={async (reason) => {
                    const bill = overrideBill;
                    setOverrideBill(null);
                    if (!reason?.trim()) return;
                    try {
                        await api.updateBillStatus(bill.id, 'Approved', { overrideReason: reason.trim() });
                        setBills(p => p.map(b => b.id === bill.id ? { ...b, status: 'Approved' } : b));
                    } catch (e2) { alert('Approve failed: ' + e2.message); }
                }}
                onCancel={() => setOverrideBill(null)}
            />
            <header className="header">
                <h1>Bills & Procurement</h1>
                <p>Capture bills from Katcha receipts, manual entry, or quotations. Route expenses to client debit notes or internal ledger.</p>
            </header>

            {/* Capture buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                <button onClick={() => setShowOCR(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--primary)', border: 'none', color: 'white', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700 }}>
                    <Upload size={16} /> Katcha Bill / OCR Upload
                </button>
                <button onClick={() => setShowManual(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600 }}>
                    <Edit3 size={16} /> Manual Bill Entry
                </button>
                <button onClick={() => setShowQuote(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600 }}>
                    <FileText size={16} /> Import Quotation (CSV)
                </button>
            </div>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    { l: 'Total Bills', v: bills.length, c: 'var(--primary)' },
                    { l: 'Pending Approval', v: bills.filter(b => b.status === 'Pending Approval' || b.status === 'Pending').length, c: '#f59e0b' },
                    { l: 'Approved', v: bills.filter(b => b.status === 'Approved').length, c: '#22c55e' },
                    { l: 'Paid', v: bills.filter(b => b.status === 'Paid').length, c: '#10b981' },
                    { l: 'Total Value', v: Rs(bills.reduce((a, b) => a + b.total, 0)), c: 'var(--text)' },
                ].map(card => (
                    <div key={card.l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '5px' }}>{card.l}</div>
                        <div style={{ fontWeight: 800, fontSize: '1rem', color: card.c }}>{card.v}</div>
                    </div>
                ))}
            </div>

            {/* Active / Paid Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '1rem', background: 'var(--bg-dark)', borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
                {[['active', '📋 Active Bills'], ['paid', '✅ Paid / Archived']].map(([id, label]) => (
                    <button key={id} onClick={() => setActiveTab(id)}
                        style={{ padding: '7px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.83rem',
                            background: activeTab === id ? 'var(--primary)' : 'transparent',
                            color: activeTab === id ? 'white' : 'var(--text-muted)' }}>
                        {label} <span style={{ marginLeft: '4px', fontSize: '0.75rem', opacity: 0.75 }}>({activeTab === id
                            ? (id === 'paid' ? bills.filter(b => b.status === 'Paid').length : bills.filter(b => b.status !== 'Paid').length)
                            : (id === 'paid' ? bills.filter(b => b.status === 'Paid').length : bills.filter(b => b.status !== 'Paid').length)})</span>
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {[['Type', filterType, setFilterType, TYPES], ['Client', filterClient, setFilterClient, ['All', ...clientsList.map(c => c.name)]], ['Status', filterStatus, setFilterStatus, STATUSES], ['Bill Type', filterBillType, setFilterBillType, BILL_TYPES_FILTER]].map(([label, val, setter, opts]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{label}:</span>
                        <select value={val} onChange={e => setter(e.target.value)}
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 10px', color: 'var(--text)', fontSize: '0.82rem', outline: 'none' }}>
                            {opts.map(o => <option key={o}>{o}</option>)}
                        </select>
                    </div>
                ))}
                <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{filtered.length} bills · Total: <strong style={{ color: 'var(--text)' }}>{Rs(totals.total)}</strong></span>
            </div>

            {/* Paid bills notice */}
            {activeTab === 'paid' && (
                <div style={{ padding: '10px 14px', borderRadius: '8px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', fontSize: '0.83rem', color: '#10b981', marginBottom: '1rem' }}>
                    🔒 <strong>Paid bills are locked.</strong> To edit or delete a paid bill, click <strong>Unlock</strong> and enter the secure password. Contact your Finance Manager for the password.
                </div>
            )}

            {/* Bill Table */}
            {bills.length === 0 ? (
                <div style={{ background: 'var(--bg-card)', border: '2px dashed var(--border)', borderRadius: '16px', padding: '4rem', textAlign: 'center' }}>
                    <FileText size={48} color="var(--text-muted)" style={{ marginBottom: '1rem' }} />
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>No bills yet</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Add a Katcha bill, manual entry, or import a CSV quotation above.</div>
                </div>
            ) : (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                            <thead><tr style={{ background: 'var(--bg-dark)' }}>
                                {['Bill ID', 'Type', 'Vendor', 'Client / Contract', 'Bill Type', 'Amount', 'Billable', 'Status', 'Actions'].map(h => (
                                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                ))}
                            </tr></thead>
                            <tbody>
                                {filtered
                                    .filter(b => activeTab === 'paid' ? b.status === 'Paid' : b.status !== 'Paid')
                                    .map((b, i) => {
                                    const btDef = BILL_TYPE_DEFS.find(t => t.id === b.billType);
                                    const isPaid = b.status === 'Paid';
                                    return (
                                    <tr key={b.id} style={{ borderBottom: '1px solid var(--border)', background: isPaid ? 'rgba(16,185,129,0.03)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                                        <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--primary)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                                            {isPaid && <span title="Paid & Locked" style={{ marginRight: '4px' }}>🔒</span>}
                                            {b.id.slice(0, 16)}
                                        </td>
                                        <td style={{ padding: '9px 12px', fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{b.type}</td>
                                        <td style={{ padding: '9px 12px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{b.vendor}</td>
                                        <td style={{ padding: '9px 12px', fontSize: '0.8rem' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.83rem' }}>{b.client || '—'}</div>
                                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{b.contract}</div>
                                        </td>
                                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                                            <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 700,
                                                background: `${btDef?.color || '#94a3b8'}18`, color: btDef?.color || '#94a3b8' }}>
                                                {btDef?.icon} {b.billType || '—'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '9px 12px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right', fontSize: '0.88rem' }}>{Rs(b.total)}</td>
                                        <td style={{ padding: '9px 12px', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                                            {b.billable !== false
                                                ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✅ Billable</span>
                                                : <span style={{ color: '#f59e0b', fontWeight: 700 }}>🏢 Internal</span>}
                                        </td>
                                        <td style={{ padding: '9px 12px' }}><Badge status={b.status} /></td>
                                        <td style={{ padding: '9px 12px' }}>
                                            <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <button onClick={() => setDetailBill(b)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', color: 'var(--primary)', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                                                    <Eye size={12} /> View
                                                </button>
                                                {/* Quick Approve for finance_approver on pending bills */}
                                                {isFinanceApprover && ['Pending Approval','Pending','Draft'].includes(b.status) && (
                                                    <button onClick={() => doQuickApprove(b)}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>
                                                        ✅ Approve
                                                    </button>
                                                )}
                                                <button onClick={() => generateChallan(b)} title="Generate Delivery Challan"
                                                    style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)', color: '#a78bfa', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                                                    📄 Challan
                                                </button>
                                                {isPaid && isSuperAdmin && (
                                                    <button onClick={() => { setUnlockTarget(b); setUnlockPwd(''); setUnlockError(null); }}
                                                        style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>
                                                        🔓 Unlock
                                                    </button>
                                                )}
                                                {(isSuperAdmin || (b.created_by === user?.email && ['Draft','Pending Approval','Pending'].includes(b.status))) && !isPaid && (
                                                    <button onClick={() => deleteBill(b)} title="Delete"
                                                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', padding: '5px 7px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem' }}>🗑</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    );
                                })}
                                {filtered.filter(b => activeTab === 'paid' ? b.status === 'Paid' : b.status !== 'Paid').length === 0 && (
                                    <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                        {activeTab === 'paid' ? 'No paid bills yet.' : 'No bills match the current filters.'}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Password Unlock Modal */}
            {unlockTarget && (
                <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setUnlockTarget(null)}>
                    <div className="modal-box" style={{ maxWidth: '420px' }}>
                        <div style={{ padding: '1.5rem 2rem' }}>
                            <h3 style={{ margin: '0 0 0.5rem' }}>🔓 Unlock Paid Bill</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                                Bill <strong style={{ color: 'var(--primary)' }}>{unlockTarget.id.slice(0,16)}</strong> is marked as Paid and locked.
                                Enter the secure password to unlock it for editing.
                            </p>
                            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: '5px' }}>Unlock Password</label>
                            <input type="password" value={unlockPwd} onChange={e => setUnlockPwd(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && doUnlock()}
                                placeholder="Enter secure password"
                                style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text)', fontSize: '0.9rem', marginBottom: '0.75rem', boxSizing: 'border-box' }} />
                            {unlockError && <div style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: '0.75rem' }}>⚠️ {unlockError}</div>}
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button onClick={() => setUnlockTarget(null)}
                                    style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '9px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={doUnlock} disabled={!unlockPwd || unlockLoading}
                                    style={{ flex: 2, background: unlockPwd ? '#f59e0b' : '#334155', border: 'none', color: 'white', padding: '9px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                                    {unlockLoading ? 'Checking…' : '🔓 Unlock Bill'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {/* Payment Method Modal — shown when Mark as Paid is clicked */}
            {paymentModal && (
                <div className='modal-overlay' onClick={e => e.target === e.currentTarget && setPaymentModal(null)}>
                    <div className='modal-box' style={{ maxWidth: '440px' }}>
                        <div style={{ padding: '1.5rem 2rem' }}>
                            <h3 style={{ margin: '0 0 0.25rem' }}>💳 Record Payment</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                                Select the payment method and account used to settle this bill.
                            </p>
                            <div style={{ marginBottom: '1.25rem' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Payment Method</div>
                                <div style={{ display: 'flex', gap: '0.75rem' }}>
                                    {[
                                        { id: 'HBL', label: '🏦 HBL', desc: 'Habib Bank Limited', color: '#38bdf8' },
                                        { id: 'NBP', label: '🏛 NBP', desc: 'National Bank of Pakistan', color: '#22c55e' },
                                        { id: 'Cash', label: '💵 Cash', desc: 'Physical cash payment', color: '#f59e0b' },
                                    ].map(m => (
                                        <button key={m.id} onClick={() => { setPaymentMethod(m.id); setPaymentAccount(''); }}
                                            style={{ flex: 1, padding: '10px 8px', borderRadius: '10px', border: `2px solid ${paymentMethod === m.id ? m.color : 'var(--border)'}`,
                                                background: paymentMethod === m.id ? `${m.color}18` : 'transparent', cursor: 'pointer', textAlign: 'center' }}>
                                            <div style={{ fontSize: '1.1rem', marginBottom: '3px' }}>{m.label.split(' ')[0]}</div>
                                            <div style={{ fontWeight: 700, fontSize: '0.8rem', color: paymentMethod === m.id ? m.color : 'var(--text-muted)' }}>{m.id}</div>
                                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{m.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {paymentMethod !== 'Cash' && (
                                <div style={{ marginBottom: '1.25rem' }}>
                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: '5px' }}>
                                        {paymentMethod} Account / Reference No. (Optional)
                                    </label>
                                    <input value={paymentAccount} onChange={e => setPaymentAccount(e.target.value)}
                                        placeholder={paymentMethod === 'HBL' ? 'e.g. HBL-0012-xxxx or Cheque #' : 'e.g. NBP Account or Cheque #'}
                                        style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', color: 'var(--text)', fontSize: '0.88rem', boxSizing: 'border-box' }} />
                                </div>
                            )}
                            {paymentMethod === 'Cash' && (
                                <div style={{ marginBottom: '1.25rem', padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '8px', fontSize: '0.8rem', color: '#f59e0b' }}>
                                    💵 Cash payment will be recorded against the <strong>Cash Account</strong>. Ensure a receipt or acknowledgment is filed.
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button onClick={() => setPaymentModal(null)}
                                    style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>
                                    Cancel
                                </button>
                                <button onClick={doPayment}
                                    style={{ flex: 2, background: '#10b981', border: 'none', color: 'white', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                                    ✅ Confirm Payment via {paymentMethod}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showOCR    && <OCRModal    onSave={addBill} onClose={() => setShowOCR(false)}    clientsList={clientsList} contractsList={contractsList} vendorsList={vendorsList} />}
            {showManual && <ManualBillModal onSave={addBill} onClose={() => setShowManual(false)} clientsList={clientsList} contractsList={contractsList} vendorsList={vendorsList} />}
            {showQuote  && <ImportQuotationModal onSave={addBill} onClose={() => setShowQuote(false)} />}
            {detailBill && <BillDetailModal bill={detailBill} onAction={doAction} onXero={doAction} isApprover={['finance_approver','procurement_approver','superadmin'].includes(user?.role)} onClose={() => setDetailBill(null)} generateChallan={generateChallan} onCreateInvoice={createInvoiceFromBill} />}

            {/* Create Invoice success toast */}
            {invCreated && (
                <div style={{ position: 'fixed', bottom: '2rem', right: '2rem', background: '#22c55e', color: 'white', padding: '1rem 1.5rem', borderRadius: '12px', boxShadow: '0 8px 30px rgba(34,197,94,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '380px' }}>
                    <span style={{ fontSize: '1.4rem' }}>🧧</span>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: '2px' }}>Invoice Created!</div>
                        <div style={{ fontSize: '0.82rem', opacity: 0.9 }}>
                            <strong>{invCreated.invoice_number}</strong> created as Draft. Go to <strong>Invoices (AR)</strong> tab to review and raise it.
                        </div>
                    </div>
                    <button onClick={() => setInvCreated(null)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.3rem', marginLeft: 'auto' }}>×</button>
                </div>
            )}
        </div>
    );
}
