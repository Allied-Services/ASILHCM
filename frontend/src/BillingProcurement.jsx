import React, { useState, useRef, useEffect } from 'react';
import { FileText, Upload, Edit3, CheckCircle, Loader, Eye, AlertTriangle } from 'lucide-react';
import { api } from './api';

// ─── Constants ────────────────────────────────────────────────────────────────
const CLIENTS = ['Wafi Energy Pakistan Limited', 'Bank Al Habib', 'Pakistan State Oil Company', 'Gul Ahmed Textile'];
const CONTRACTS = {
    'Wafi Energy Pakistan Limited': ['CTR-2024-WFI-001 — Terminal Ops Bhakkar'],
    'Bank Al Habib': ['CTR-2026-BAHL-A1 — Security Services', 'CTR-2026-BAHL-A2 — Janitorial'],
    'Pakistan State Oil Company': ['CTR-2025-PSO-X9 — General Workers'],
    'Gul Ahmed Textile': ['CTR-2025-GT-01 — Facilities Management'],
};
const SITES = ['Bhakkar Terminal', 'KHI-Clifton Branch', 'KHI-IIG Campus', 'ISB-F7 Branch', 'LHR-Gulberg'];
const BILL_TYPES = ['Company Expense', 'Client Debit Note', 'Imprest'];
const PURPOSES = ['Office Supplies', 'Maintenance & Repair', 'Fuel & Transport', 'Safety Equipment', 'Procurement — Fixed Supply', 'Catering', 'Utilities', 'Other'];

const STATUS_COLORS = {
    'Draft': { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' },
    'Pending': { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' },
    'Approved': { bg: 'rgba(34,197,94,0.12)', color: '#22c55e' },
    'Rejected': { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' },
    'Posted': { bg: 'rgba(99,102,241,0.12)', color: '#818cf8' },
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
function OCRModal({ onSave, onClose }) {
    const fileRef = useRef();
    const [phase, setPhase] = useState('upload'); // upload | scanning | review
    const [scanStatus, setScanStatus] = useState('');
    const [pages, setPages] = useState([]); // [{ img, extracted }]
    const [pageIdx, setPageIdx] = useState(0);
    const [client, setClient] = useState('');
    const [contract, setContract] = useState('');
    const [site, setSite] = useState('');
    const [billType, setBillType] = useState('Client Debit Note');
    const [purpose, setPurpose] = useState('');
    const [note, setNote] = useState('');

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
        onSave({ id: `BILL-${Date.now()}-${pageIdx}`, type: 'OCR / Katcha', client, contract, site, vendor: ex.vendor, date: ex.date, items: ex.items, amount: ex.subtotal, gst: ex.gst, total: ex.grandTotal, purpose, billType, status: 'Draft', note });
    };

    const saveAllAndClose = () => {
        pages.forEach((pg, i) => {
            const ex = pg.extracted;
            onSave({ id: `BILL-${Date.now()}-${i}`, type: 'OCR / Katcha', client, contract, site, vendor: ex.vendor, date: ex.date, items: ex.items, amount: ex.subtotal, gst: ex.gst, total: ex.grandTotal, purpose, billType, status: 'Draft', note });
        });
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
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
                </div>
                <div style={{ padding: '1.75rem 2rem', display: 'grid', gridTemplateColumns: phase === 'upload' || phase === 'scanning' ? '1fr' : '1fr 1fr', gap: '1.5rem' }}>

                    {phase === 'upload' && (
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
                            {cur.img && <img src={cur.img} alt="Bill" style={{ width: '100%', maxHeight: '220px', objectFit: 'contain', borderRadius: '8px', border: '1px solid var(--border)' }} />}
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
                            <FL label="Vendor"><SI value={cur.extracted.vendor} onChange={e => setExt({ vendor: e.target.value })} /></FL>
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
                                <FL label="Client"><SS value={client} onChange={e => { setClient(e.target.value); setContract(''); }} opts={CLIENTS} /></FL>
                                <FL label="Contract"><SS value={contract} onChange={e => setContract(e.target.value)} opts={CONTRACTS[client] || []} /></FL>
                                <FL label="Site"><SS value={site} onChange={e => setSite(e.target.value)} opts={SITES} /></FL>
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
function ManualBillModal({ onSave, onClose }) {
    const emptyItem = () => ({ desc: '', qty: 1, unit: '', total: 0 });
    const [form, setForm] = useState({ vendor: '', date: new Date().toISOString().split('T')[0], gstPct: '17', client: '', contract: '', site: '', billType: 'Client Debit Note', purpose: '', note: '' });
    const [items, setItems] = useState([emptyItem()]);
    const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

    const setItem = (i, k, v) => setItems(p => {
        const next = [...p]; next[i] = { ...next[i], [k]: v };
        if (k === 'qty' || k === 'unit') next[i].total = Math.round((parseFloat(k === 'qty' ? v : next[i].qty) || 0) * (parseFloat(k === 'unit' ? v : next[i].unit) || 0));
        return next;
    });

    const subtotal = items.reduce((a, it) => a + (parseFloat(it.total) || 0), 0);
    const gstAmount = Math.round(subtotal * (parseFloat(form.gstPct) || 0) / 100);
    const grandTotal = subtotal + gstAmount;

    const save = () => {
        onSave({ id: `BILL-${Date.now()}`, type: 'Manual', ...form, items, amount: subtotal, gst: gstAmount, total: grandTotal, status: 'Draft' });
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
                        <FL label="Vendor / Supplier" span="span 2"><SI value={form.vendor} onChange={e => set('vendor', e.target.value)} placeholder="Vendor or supplier name" /></FL>
                        <FL label="Bill Date"><SI type="date" value={form.date} onChange={e => set('date', e.target.value)} /></FL>
                        <FL label="Client">
                            <SS value={form.client} onChange={e => { set('client', e.target.value); set('contract', ''); }} opts={CLIENTS} />
                        </FL>
                        <FL label="Contract">
                            <SS value={form.contract} onChange={e => set('contract', e.target.value)} opts={CONTRACTS[form.client] || []} />
                        </FL>
                        <FL label="Site"><SS value={form.site} onChange={e => set('site', e.target.value)} opts={SITES} /></FL>
                        <FL label="Purpose" span="span 2"><SS value={form.purpose} onChange={e => set('purpose', e.target.value)} opts={PURPOSES} /></FL>
                        <FL label="GST %"><SI type="number" value={form.gstPct} onChange={e => set('gstPct', e.target.value)} placeholder="17" /></FL>
                    </div>

                    {/* Bill Type */}
                    <div style={{ marginBottom: '1rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '6px' }}>Bill Type — who bears this cost?</div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {BILL_TYPES.map(t => (
                                <button key={t} onClick={() => set('billType', t)}
                                    style={{ flex: 1, padding: '8px', borderRadius: '8px', border: `2px solid ${form.billType === t ? 'var(--primary)' : 'var(--border)'}`, background: form.billType === t ? 'rgba(56,189,248,0.1)' : 'transparent', color: form.billType === t ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                    {t}
                                </button>
                            ))}
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
                        {[['Subtotal', Rs(subtotal)], [`GST (${form.gstPct || 0}%)`, Rs(gstAmount)], ['GRAND TOTAL', Rs(grandTotal)]].map(([l, v], i) => (
                            <React.Fragment key={l}>
                                <span style={{ fontSize: '0.85rem', fontWeight: i === 2 ? 700 : 400, color: i === 2 ? 'var(--text)' : 'var(--text-muted)' }}>{l}</span>
                                <span style={{ textAlign: 'right', fontWeight: i === 2 ? 900 : 600, color: i === 2 ? 'var(--primary)' : 'var(--text)', fontSize: i === 2 ? '1.05rem' : '0.88rem' }}>{v}</span>
                            </React.Fragment>
                        ))}
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

// ─── Bill Detail Modal ────────────────────────────────────────────────────────
function BillDetailModal({ bill, onAction, onClose }) {
    const flow = { 'Draft': ['Submit for Approval'], 'Pending': ['Approve', 'Reject'], 'Approved': ['Post to Ledger'], 'Posted': [], 'Rejected': ['Archive'] };
    const actions = flow[bill.status] || [];

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
                        {[['Vendor', bill.vendor], ['Client', bill.client], ['Contract', bill.contract], ['Site', bill.site], ['Purpose', bill.purpose], ['Bill Type', bill.billType], ['Amount (excl. GST)', Rs(bill.amount)], ['GST', Rs(bill.gst)], ['Note', bill.note || '—']].map(([l, v]) => (
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

                    {bill.billType === 'Client Debit Note' && (
                        <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.84rem' }}>
                            <strong style={{ color: '#818cf8' }}>→ Debit Note:</strong> When approved & posted, this will be available in a Client Invoice to {bill.client}.
                        </div>
                    )}
                    {bill.billType === 'Imprest' && (
                        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.84rem' }}>
                            <strong style={{ color: '#f59e0b' }}>→ Imprest:</strong> This will be deducted from the Imprest pool for {bill.client}.
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <button onClick={onClose} style={{ flex: 1, background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '10px', borderRadius: '8px', cursor: 'pointer' }}>Close</button>
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

    // Load bills from DB on mount — shared across all users
    useEffect(() => {
        api.getBills()
            .then(data => setBills(Array.isArray(data) ? data : []))
            .catch(err => console.error('Bills load error:', err.message))
            .finally(() => setLoading(false));
    }, []);

    const filtered = bills.filter(b =>
        (filterType === 'All' || b.type === filterType) &&
        (filterClient === 'All' || b.client === filterClient) &&
        (filterStatus === 'All' || b.status === filterStatus)
    );
    const totals = filtered.reduce((a, b) => ({ total: a.total + b.total, gst: a.gst + b.gst }), { total: 0, gst: 0 });

    const addBill = async b => {
        try {
            const { bill } = await api.saveBill(b);
            setBills(p => [bill, ...p]);
        } catch (err) { alert('Failed to save bill: ' + err.message); }
    };

    const doAction = async (id, action) => {
        const map = { 'Submit for Approval': 'Pending', 'Approve': 'Approved', 'Post to Ledger': 'Posted', 'Reject': 'Rejected', 'Archive': 'Archived' };
        const newStatus = map[action];
        if (!newStatus) return;
        try {
            await api.updateBillStatus(id, newStatus);
            setBills(p => p.map(b => b.id === id ? { ...b, status: newStatus } : b));
        } catch (err) { alert('Status update failed: ' + err.message); }
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

    const isSuperAdmin = user?.role === 'superadmin';

    const TYPES = ['All', 'OCR / Katcha', 'Manual', 'Quotation'];
    const STATUSES = ['All', 'Draft', 'Pending', 'Approved', 'Posted', 'Rejected'];

    return (
        <div className="dashboard">
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
                    { l: 'Pending Approval', v: bills.filter(b => b.status === 'Pending').length, c: '#f59e0b' },
                    { l: 'Approved', v: bills.filter(b => b.status === 'Approved').length, c: '#22c55e' },
                    { l: 'Total Value', v: Rs(bills.reduce((a, b) => a + b.total, 0)), c: 'var(--text)' },
                    { l: 'As Debit Notes', v: Rs(bills.filter(b => b.billType === 'Client Debit Note').reduce((a, b) => a + b.total, 0)), c: '#818cf8' },
                ].map(card => (
                    <div key={card.l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '5px' }}>{card.l}</div>
                        <div style={{ fontWeight: 800, fontSize: '1rem', color: card.c }}>{card.v}</div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {[['Type', filterType, setFilterType, TYPES], ['Client', filterClient, setFilterClient, ['All', ...CLIENTS]], ['Status', filterStatus, setFilterStatus, STATUSES]].map(([label, val, setter, opts]) => (
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

            {/* Bill Table — or empty state */}
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
                                {['Bill ID', 'Type', 'Vendor', 'Client / Contract', 'Site', 'Purpose', 'Bill Type', 'Amount', 'Status', 'Actions'].map(h => (
                                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                ))}
                            </tr></thead>
                            <tbody>
                                {filtered.map((b, i) => (
                                    <tr key={b.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                                        <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--primary)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{b.id.slice(0, 16)}</td>
                                        <td style={{ padding: '9px 12px', fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{b.type}</td>
                                        <td style={{ padding: '9px 12px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{b.vendor}</td>
                                        <td style={{ padding: '9px 12px', fontSize: '0.8rem' }}>
                                            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.83rem' }}>{b.client || '—'}</div>
                                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{b.contract}</div>
                                        </td>
                                        <td style={{ padding: '9px 12px', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{b.site || '—'}</td>
                                        <td style={{ padding: '9px 12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{b.purpose || '—'}</td>
                                        <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                                            <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 700, background: b.billType === 'Client Debit Note' ? 'rgba(99,102,241,0.12)' : b.billType === 'Imprest' ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)', color: b.billType === 'Client Debit Note' ? '#818cf8' : b.billType === 'Imprest' ? '#f59e0b' : '#22c55e' }}>
                                                {b.billType}
                                            </span>
                                        </td>
                                        <td style={{ padding: '9px 12px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right', fontSize: '0.88rem' }}>{Rs(b.total)}</td>
                                        <td style={{ padding: '9px 12px' }}><Badge status={b.status} /></td>
                                        <td style={{ padding: '9px 12px' }}>
                                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                <button onClick={() => setDetailBill(b)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.2)', color: 'var(--primary)', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                                    <Eye size={13} /> View
                                                </button>
                                                {isSuperAdmin && (
                                                    <button onClick={() => deleteBill(b)}
                                                        title="Delete (SuperAdmin only)"
                                                        style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}>
                                                        🗑
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && bills.length > 0 && (
                                    <tr><td colSpan={10} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No bills match the current filters.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {showOCR && <OCRModal onSave={addBill} onClose={() => setShowOCR(false)} />}
            {showManual && <ManualBillModal onSave={addBill} onClose={() => setShowManual(false)} />}
            {showQuote && <ImportQuotationModal onSave={addBill} onClose={() => setShowQuote(false)} />}
            {detailBill && <BillDetailModal bill={detailBill} onAction={doAction} onClose={() => setDetailBill(null)} />}
        </div>
    );
}
