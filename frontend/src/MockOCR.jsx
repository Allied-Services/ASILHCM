import React, { useState } from 'react';
import { Scan, AlertOctagon, RefreshCw, CheckCircle, Search } from 'lucide-react';

const MockOCR = () => {
    const [scanning, setScanning] = useState(false);
    const [result, setResult] = useState(null);

    const simulateScan = () => {
        setScanning(true);
        setResult(null);

        // Simulate 2 seconds to scan "katcha bill"
        setTimeout(() => {
            setScanning(false);

            // Deliberately introduce a mathematical discrepancy to force Human in Loop
            setResult({
                vendorName: 'M. Ali Hardware Traders',
                date: '02-07-2026',
                items: [
                    { item: 'Broom Stick x50', ocrValue: 7500 },
                    { item: 'Window Cleaner x20', ocrValue: 4000 },
                ],
                ocrTotal: 12500, // OCR read 12500
                calculatedTotal: 11500, // But math says 11500
                taxExempt: false
            });
        }, 2000);
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">OCR Invoice Parser Simulation</h1>
                <p className="page-subtitle">Processing handwritten "Katcha Bills" and raw receipts</p>
            </div>

            <div className="ocr-split">
                <div className="glass-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: '600' }}>Virtual Scanner</h2>
                        <button className="btn-primary" onClick={simulateScan} disabled={scanning} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {scanning ? <RefreshCw className="animate-spin" size={16} /> : <Scan size={16} />}
                            {scanning ? 'Processing...' : 'Upload & Parse Image'}
                        </button>
                    </div>

                    <div className={`receipt-image ${scanning ? 'scanning' : ''}`}>
                        {/* The scanning line */}
                        <div className="scan-line"></div>

                        <div style={{ border: '2px dashed #cbd5e1', padding: '100px 40px', textAlign: 'center' }}>
                            <Search size={48} color="#94a3b8" style={{ marginBottom: '16px' }} />
                            <div style={{ color: '#64748b' }}>
                                {scanning ? 'Running Vision-LLM Analysis...' : 'Handwritten Hardware Receipt Image'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="glass-card">
                    <h2 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '16px' }}>Extraction Engine Output</h2>

                    {!result && !scanning && (
                        <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                            Awaiting payload execution...
                        </div>
                    )}

                    {scanning && (
                        <div style={{ height: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                            <RefreshCw className="animate-spin" size={40} style={{ marginBottom: '16px' }} />
                            <p>Extracting Line Items...</p>
                        </div>
                    )}

                    {result && (
                        <div className="animate-fade-in">
                            <div className="grid-3" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: '24px' }}>
                                <div>
                                    <div className="stat-label">Identified Vendor</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: '600', marginTop: '4px' }}>{result.vendorName}</div>
                                </div>
                                <div>
                                    <div className="stat-label">Document Date</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: '600', marginTop: '4px' }}>{result.date}</div>
                                </div>
                            </div>

                            <div className="data-table-container " style={{ marginBottom: '16px' }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Line Item</th>
                                            <th style={{ textAlign: 'right' }}>Extracted Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.items.map((it, i) => (
                                            <tr key={i}>
                                                <td>{it.item}</td>
                                                <td style={{ textAlign: 'right' }}>Rs. {it.ocrValue}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0', borderTop: '1px solid var(--surface-border)' }}>
                                <span className="stat-label">OCR Scanned Total:</span>
                                <span style={{ fontWeight: '700', fontSize: '1.2rem', color: 'var(--danger)' }}>Rs. {result.ocrTotal}</span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '16px' }}>
                                <span className="stat-label">Internal Mathematical Total:</span>
                                <span style={{ fontWeight: '600', fontSize: '1.1rem', color: 'var(--text-main)' }}>Rs. {result.calculatedTotal}</span>
                            </div>

                            {result.ocrTotal !== result.calculatedTotal && (
                                <div className="audit-alert">
                                    <AlertOctagon size={24} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                                    <div>
                                        <h4 style={{ fontWeight: '700', color: '#ffb3b3', marginBottom: '4px' }}>SYSTEM HALT: HUMAN IN LOOP TRIGGERED</h4>
                                        <p style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                                            The OCR engine read a bottom-line total of <strong>12,500</strong>, but the summation of individual line items equals <strong>11,500</strong>. This discrepancy must be rectified manually before pushing to the `raw_bills` ledger.
                                        </p>
                                        <button className="btn-primary" style={{ marginTop: '12px', background: 'var(--danger)' }}>
                                            Launch Manual Corrective View
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MockOCR;
