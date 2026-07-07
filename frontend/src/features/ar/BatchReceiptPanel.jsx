import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const fmt = n => Math.round(parseFloat(n) || 0).toLocaleString('en-PK');

export default function BatchReceiptPanel() {
    const [client, setClient] = useState('Wafi Energy');
    const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
    const [bankRef, setBankRef] = useState('');
    const [invoices, setInvoices] = useState([]);
    const [selected, setSelected] = useState({});
    const [lines, setLines] = useState([]);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');
    const [posting, setPosting] = useState(false);

    useEffect(() => {
        api.getClientInvoices({ status: 'Raised' }).then(d => {
            const list = (d.invoices || []).filter(i => !i.payment_received_at && ['Raised', 'Sent'].includes(i.status));
            setInvoices(list);
        }).catch(() => setInvoices([]));
    }, []);

    const selectedIds = Object.keys(selected).filter(id => selected[id]);

    const preview = async () => {
        setError('');
        try {
            const r = await api.previewReceiptSplit({ invoice_ids: selectedIds.map(id => parseInt(id, 10)) });
            setLines(r.lines || []);
        } catch (e) {
            setError(e.message);
        }
    };

    const updateLine = (invoiceId, field, value) => {
        setLines(prev => prev.map(l => l.invoice_id === invoiceId ? { ...l, [field]: parseFloat(value) || 0 } : l));
    };

    const post = async () => {
        setPosting(true);
        setError('');
        try {
            await api.postReceipt({
                client,
                receipt_date: receiptDate,
                bank_ref: bankRef,
                lines: lines.map(l => ({
                    invoice_id: l.invoice_id,
                    cash_received: l.cash_received,
                    income_tax_wht: l.income_tax_wht,
                    sales_tax_withheld_by_client: l.sales_tax_withheld_by_client,
                    sales_tax_self_paid: l.sales_tax_self_paid,
                })),
            });
            setMsg('Batch payment recorded');
            setLines([]);
            setSelected({});
        } catch (e) {
            setError(e.message);
        }
        setPosting(false);
    };

    const totals = lines.reduce((acc, l) => {
        acc.cash += l.cash_received || 0;
        acc.wht += l.income_tax_wht || 0;
        acc.stw += l.sales_tax_withheld_by_client || 0;
        return acc;
    }, { cash: 0, wht: 0, stw: 0 });

    return (
        <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem' }}>Record Batch Payment</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
                Select invoices paid in a client batch. Auto-compute the 3-way tax split; edit before posting.
            </p>

            {msg && <div style={{ color: 'var(--success)', marginBottom: '0.75rem' }}>{msg}</div>}
            {error && <div style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>{error}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                <input value={client} onChange={e => setClient(e.target.value)} placeholder="Client"
                    style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} />
                <input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)}
                    style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} />
                <input value={bankRef} onChange={e => setBankRef(e.target.value)} placeholder="Bank reference"
                    style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' }} />
            </div>

            <table className="data-table" style={{ marginBottom: '1rem' }}>
                <thead>
                    <tr><th></th><th>Invoice</th><th>Client</th><th>Grand Total</th></tr>
                </thead>
                <tbody>
                    {invoices.map(inv => (
                        <tr key={inv.id}>
                            <td>
                                <input type="checkbox" checked={!!selected[inv.id]}
                                    onChange={e => setSelected(p => ({ ...p, [inv.id]: e.target.checked }))} />
                            </td>
                            <td>{inv.invoice_number}</td>
                            <td>{inv.client}</td>
                            <td>{fmt(inv.grand_total)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <button type="button" className="btn-secondary" onClick={preview} disabled={!selectedIds.length}>
                    Compute split
                </button>
            </div>

            {lines.length > 0 && (
                <>
                    <table className="data-table" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
                        <thead>
                            <tr>
                                <th>Invoice</th>
                                <th>Cash received</th>
                                <th>Income tax WHT</th>
                                <th>Sales tax withheld</th>
                                <th>Sales tax self-paid</th>
                            </tr>
                        </thead>
                        <tbody>
                            {lines.map(l => (
                                <tr key={l.invoice_id}>
                                    <td>{l.invoice_number}</td>
                                    {['cash_received', 'income_tax_wht', 'sales_tax_withheld_by_client', 'sales_tax_self_paid'].map(field => (
                                        <td key={field}>
                                            <input type="number" value={l[field]}
                                                onChange={e => updateLine(l.invoice_id, field, e.target.value)}
                                                style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 4, padding: 4, color: 'var(--text)' }} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td><strong>Totals</strong></td>
                                <td>{fmt(totals.cash)}</td>
                                <td>{fmt(totals.wht)}</td>
                                <td>{fmt(totals.stw)}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                    <button type="button" className="btn-primary" onClick={post} disabled={posting}>
                        {posting ? 'Posting…' : 'Post receipt'}
                    </button>
                </>
            )}
        </div>
    );
}
