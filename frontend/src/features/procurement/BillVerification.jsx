import React, { useEffect, useState, useRef } from 'react';
import { api, apiFetch } from '../../api';

const BillVerification = () => {
    const [queue, setQueue] = useState([]);
    const [selected, setSelected] = useState(null);
    const [budgetLines, setBudgetLines] = useState([]);
    const [ocrData, setOcrData] = useState({ vendor: '', grandTotal: '', items: [] });
    const [loading, setLoading] = useState(true);
    const [ocrLoading, setOcrLoading] = useState(false);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    const fileRef = useRef(null);

    const load = () => {
        setLoading(true);
        api.getProcurementQueue()
            .then(rows => setQueue(Array.isArray(rows) ? rows : []))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(load, []);

    useEffect(() => {
        if (selected?.contract_id) {
            api.getBudgetLines(selected.contract_id).then(setBudgetLines).catch(() => setBudgetLines([]));
        }
    }, [selected?.contract_id]);

    const runOcr = async (file) => {
        if (!file) return;
        setOcrLoading(true);
        setError('');
        try {
            const b64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const result = await apiFetch('/api/bills/ocr', {
                method: 'POST',
                body: JSON.stringify({ imageBase64: b64, mimeType: file.type }),
            });
            setOcrData({
                vendor: result.vendor || '',
                grandTotal: result.grandTotal || '',
                items: result.items || [],
                confidence: result.confidence,
            });
        } catch (e) {
            setError(e.message);
        } finally {
            setOcrLoading(false);
        }
    };

    const saveVerified = async () => {
        if (!selected) return;
        try {
            await api.verifyBillOcr(selected.id, {
                ocrJson: ocrData,
                confidence: ocrData.confidence || 0.5,
            });
            setMsg('Bill verified (Trace: P4-PROC-003)');
            load();
        } catch (e) {
            setError(e.message);
        }
    };

    const matchBudget = async (budgetLineId) => {
        if (!selected) return;
        try {
            await api.matchBillBudget(selected.id, budgetLineId);
            setMsg('Budget line matched (Trace: P4-PROC-004)');
            load();
        } catch (e) {
            setError(e.message);
        }
    };

    const checkApprove = async () => {
        if (!selected) return;
        try {
            const result = await api.canApproveBill(selected.id);
            if (result.ok) setMsg('Bill CAN be approved — budget matched');
            else setError(result.message || result.code);
        } catch (e) {
            setError(e.message);
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Katcha Bill Verification</h1>
                <p className="page-subtitle">OCR + side-by-side manual verification + budget line matching (Trace: P4-PROC-001)</p>
            </div>

            {msg && <div className="glass-card" style={{ color: 'var(--success)', marginBottom: '1rem' }}>{msg}</div>}
            {error && <div className="glass-card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="glass-card">
                    <h3 style={{ marginBottom: '1rem' }}>Verification Queue</h3>
                    {loading ? <p className="text-muted">Loading…</p> : (
                        <table className="data-table">
                            <thead><tr><th>Vendor</th><th>Amount</th><th>Match</th><th>OCR</th></tr></thead>
                            <tbody>
                                {queue.map(b => (
                                    <tr key={b.id} onClick={() => { setSelected(b); setOcrData(b.ocr_json || { vendor: b.vendor, grandTotal: b.total || b.amount }); setMsg(''); setError(''); }}
                                        style={{ cursor: 'pointer', background: selected?.id === b.id ? 'rgba(99,102,241,0.1)' : undefined }}>
                                        <td>{b.vendor || '—'}</td>
                                        <td>{Number(b.total || b.amount || 0).toLocaleString()}</td>
                                        <td>{b.match_status || 'unmatched'}</td>
                                        <td>{b.ocr_status || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="glass-card">
                    <h3 style={{ marginBottom: '1rem' }}>Manual Verification</h3>
                    {!selected ? <p style={{ color: 'var(--text-muted)' }}>Select a bill from the queue</p> : (
                        <>
                            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => runOcr(e.target.files[0])} />
                            <button onClick={() => fileRef.current?.click()} disabled={ocrLoading} className="btn-secondary" style={{ marginBottom: '1rem' }}>
                                {ocrLoading ? 'Running OCR…' : 'Upload & OCR Bill Photo'}
                            </button>
                            <div style={{ display: 'grid', gap: '0.5rem' }}>
                                <label>Vendor<input value={ocrData.vendor || ''} onChange={e => setOcrData(d => ({ ...d, vendor: e.target.value }))}
                                    style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} /></label>
                                <label>Grand Total<input type="number" value={ocrData.grandTotal || ''} onChange={e => setOcrData(d => ({ ...d, grandTotal: e.target.value }))}
                                    style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} /></label>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                                <button onClick={saveVerified} className="btn-primary">Save Verified</button>
                                <button onClick={checkApprove} className="btn-secondary">Check Can Approve</button>
                            </div>
                            {budgetLines.length > 0 && (
                                <div style={{ marginTop: '1rem' }}>
                                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Match Budget Line</label>
                                    <select onChange={e => e.target.value && matchBudget(Number(e.target.value))} defaultValue=""
                                        style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)', marginTop: 4 }}>
                                        <option value="">— Select budget line —</option>
                                        {budgetLines.map(bl => (
                                            <option key={bl.id} value={bl.id}>{bl.name} ({bl.category}) — Remaining: {Number(bl.remaining).toLocaleString()}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BillVerification;
