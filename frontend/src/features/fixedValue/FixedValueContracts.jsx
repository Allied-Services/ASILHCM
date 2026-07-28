import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    MapPin, Upload, CloudDownload, Calculator, FileText, List, Shield,
    Mail, Database, RefreshCw, ChevronDown, AlertCircle, CheckCircle,
} from 'lucide-react';
import { api } from '../../api';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString();
const inputStyle = { background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text)' };
const PRINT_FORMATS = [
    { key: 'invoice', label: 'Proforma' },
    { key: 'invoice_letterhead', label: 'Proforma (Letterhead)' },
    { key: 'sales_tax', label: 'Sales Tax' },
    { key: 'sales_tax_letterhead', label: 'Sales Tax (Letterhead)' },
];

const TABS = [
    { key: 'orders', label: 'Orders', icon: List },
    { key: 'attendance', label: 'Attendance', icon: Upload },
    { key: 'payroll', label: 'Payroll', icon: Calculator },
    { key: 'invoice', label: 'Invoice', icon: FileText },
    { key: 'registry', label: 'Registry', icon: Database },
    { key: 'compliance', label: 'Compliance', icon: Shield },
    { key: 'focals', label: 'Focals / Email', icon: Mail },
];

export default function FixedValueContracts({ user }) {
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [contracts, setContracts] = useState([]);
    const [contractId, setContractId] = useState('');
    const [orders, setOrders] = useState([]);
    const [siteCode, setSiteCode] = useState('');
    const [activeTab, setActiveTab] = useState('orders');
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const [parsedRows, setParsedRows] = useState([]);
    const [deductions, setDeductions] = useState([]);
    const [invoicePreview, setInvoicePreview] = useState(null);
    const [persistedInvoice, setPersistedInvoice] = useState(null);
    const [registry, setRegistry] = useState([]);
    const [payrollRun, setPayrollRun] = useState(null);
    const [complianceRows, setComplianceRows] = useState([]);
    const [driveStatus, setDriveStatus] = useState(null);

    const selectedOrder = useMemo(
        () => orders.find(o => o.site_code === siteCode) || orders[0] || null,
        [orders, siteCode]
    );

    const loadContracts = useCallback(async () => {
        const rows = await api.getFixedValueContracts();
        setContracts(Array.isArray(rows) ? rows : []);
        if (!contractId && rows?.length) setContractId(rows[0].id);
    }, [contractId]);

    const loadOrders = useCallback(async () => {
        if (!contractId) return;
        const rows = await api.getFixedValueServiceOrders(contractId);
        const list = Array.isArray(rows) ? rows : [];
        setOrders(list);
        if (!siteCode && list.length) setSiteCode(list[0].site_code);
    }, [contractId, siteCode]);

    const loadDeductions = useCallback(async () => {
        if (!selectedOrder?.id) return;
        const rows = await api.getFixedValueDeductions(selectedOrder.id, month, year);
        setDeductions(Array.isArray(rows) ? rows : []);
    }, [selectedOrder?.id, month, year]);

    const loadRegistry = useCallback(async () => {
        if (!contractId) return;
        const rows = await api.getFixedValueRegistry(contractId, month, year, siteCode || undefined);
        setRegistry(Array.isArray(rows) ? rows : []);
    }, [contractId, month, year, siteCode]);

    useEffect(() => { loadContracts().catch(e => setError(e.message)); }, [loadContracts]);
    useEffect(() => { loadOrders().catch(() => {}); }, [loadOrders]);
    useEffect(() => { loadDeductions().catch(() => {}); }, [loadDeductions]);

    const runAction = async (fn, okMsg) => {
        setError('');
        setMsg('');
        setLoading(true);
        try {
            await fn();
            if (okMsg) setMsg(okMsg);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !selectedOrder) return;
        await runAction(async () => {
            const parsed = await api.uploadFixedValueAttendance(selectedOrder.id, month, year, file);
            if (!parsed.ok) throw new Error(parsed.error || 'Parse failed');
            setParsedRows(parsed.rows || []);
            setMsg(`Parsed ${parsed.rows?.length || 0} rows from ${parsed.sheetName}`);
        });
        e.target.value = '';
    };

    const handleDrivePull = () => runAction(async () => {
        const pulled = await api.pullFixedValueDriveAttendance(selectedOrder.id, month, year);
        if (!pulled.ok) throw new Error(pulled.code || 'Drive pull failed');
        setParsedRows(pulled.parse?.rows || []);
        setMsg(`Pulled ${pulled.fileName}`);
    });

    const handleApplyAttendance = () => runAction(async () => {
        const summary = await api.applyFixedValueAttendance(selectedOrder.id, month, year, parsedRows);
        setMsg(`Applied ${summary.overrides} overrides, ${summary.deductions} absence deductions`);
        await loadDeductions();
    });

    const handleComputeInvoice = () => runAction(async () => {
        const preview = await api.computeFixedValueInvoice(selectedOrder.id, month, year);
        setInvoicePreview(preview);
        setMsg('Invoice preview computed');
    });

    const handlePersistInvoice = () => runAction(async () => {
        const result = await api.persistFixedValueInvoice(selectedOrder.id, month, year);
        setPersistedInvoice(result.invoice);
        setInvoicePreview(result.computed);
        setMsg(`Invoice ${result.invoice.invoice_number} persisted`);
        await loadRegistry();
    });

    const handleComputePayroll = () => runAction(async () => {
        const result = await api.computePayrollRun(contractId, month, year);
        setPayrollRun(result);
        setMsg(result.ok === false ? (result.message || result.code) : 'Payroll run computed');
    });

    const handleLoadCompliance = () => runAction(async () => {
        const rows = await api.getComplianceLedger(month, year);
        setComplianceRows(Array.isArray(rows) ? rows : []);
        setMsg('Compliance ledger loaded');
    });

    const handleSeed = () => runAction(async () => {
        const result = await api.seedPsoNorthZone();
        setMsg(`Seeded ${result.sites} sites, ${result.workers} workers (Tarujabba check: ${result.tarujabbaCheck?.pass ? 'PASS' : 'FAIL'})`);
        await loadContracts();
        await loadOrders();
    });

    const handleDriveStatus = () => runAction(async () => {
        const status = await api.getFixedValueDriveStatus(selectedOrder.id);
        setDriveStatus(status);
    });

    const handleFocalEmail = () => runAction(async () => {
        const result = await api.sendFixedValueFocalEmail(selectedOrder.id, month, year);
        setMsg(result.send?.skipped ? `Email skipped (${result.send.reason})` : 'Focal email sent');
    });

    return (
        <div className="module-page">
            <div className="module-header" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <MapPin size={24} color="var(--accent)" />
                <div>
                    <h2 style={{ margin: 0 }}>Fixed Value / Conservancy</h2>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>PSO service orders — attendance deductions & invoicing</p>
                </div>
                {user?.role === 'superadmin' && (
                    <button type="button" className="btn-secondary" style={{ marginLeft: 'auto' }} onClick={handleSeed} disabled={loading}>
                        <Database size={16} /> Seed PSO North Zone
                    </button>
                )}
            </div>

            <div className="fv-chrome" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, padding: 12, background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
                    Month
                    <input type="number" min={1} max={12} value={month} onChange={e => setMonth(parseInt(e.target.value, 10))} style={{ ...inputStyle, width: 72 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem' }}>
                    Year
                    <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value, 10))} style={{ ...inputStyle, width: 88 }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', minWidth: 220 }}>
                    Contract
                    <select value={contractId} onChange={e => setContractId(e.target.value)} style={inputStyle}>
                        <option value="">Select contract</option>
                        {contracts.map(c => <option key={c.id} value={c.id}>{c.contract_name || c.id}</option>)}
                    </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', minWidth: 200 }}>
                    Site
                    <select value={siteCode} onChange={e => setSiteCode(e.target.value)} style={inputStyle}>
                        {orders.map(o => <option key={o.id} value={o.site_code}>{o.name || o.site_code}</option>)}
                    </select>
                </label>
                <button type="button" className="btn-secondary" onClick={() => { loadOrders(); loadDeductions(); loadRegistry(); }} disabled={loading}>
                    <RefreshCw size={16} /> Refresh
                </button>
            </div>

            {(msg || error) && (
                <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: error ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', color: error ? '#fca5a5' : '#86efac', display: 'flex', gap: 8, alignItems: 'center' }}>
                    {error ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
                    {error || msg}
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {TABS.map(t => {
                    const Icon = t.icon;
                    return (
                        <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: activeTab === t.key ? 'var(--accent)' : 'var(--bg-card)', color: activeTab === t.key ? '#fff' : 'var(--text)', cursor: 'pointer' }}>
                            <Icon size={16} /> {t.label}
                        </button>
                    );
                })}
            </div>

            {activeTab === 'orders' && selectedOrder && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                    <h3>{selectedOrder.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({selectedOrder.site_code})</span></h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>SO ID: {selectedOrder.id} · Total value: {fmt(selectedOrder.total_value)}/mo</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                <th style={{ textAlign: 'left', padding: 8 }}>Line</th>
                                <th style={{ textAlign: 'right', padding: 8 }}>Rate</th>
                                <th style={{ textAlign: 'right', padding: 8 }}>Qty</th>
                                <th style={{ textAlign: 'center', padding: 8 }}>Manpower</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(selectedOrder.lines || []).map(l => (
                                <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: 8 }}>{l.name}</td>
                                    <td style={{ padding: 8, textAlign: 'right' }}>{fmt(l.rate)}</td>
                                    <td style={{ padding: 8, textAlign: 'right' }}>{l.quantity ?? 1}</td>
                                    <td style={{ padding: 8, textAlign: 'center' }}>{l.is_manpower_dependent ? 'Yes' : 'No'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {activeTab === 'attendance' && selectedOrder && (
                <div style={{ display: 'grid', gap: 16 }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                        <h3 style={{ marginTop: 0 }}>Upload or pull attendance</h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            <label className="btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <Upload size={16} /> Upload Excel
                                <input type="file" accept=".xlsx,.xls" hidden onChange={handleUpload} />
                            </label>
                            <button type="button" className="btn-secondary" onClick={handleDrivePull} disabled={loading}><CloudDownload size={16} /> Pull from Drive</button>
                            <button type="button" className="btn-secondary" onClick={handleDriveStatus} disabled={loading}>Drive status</button>
                            <button type="button" className="btn-primary" onClick={handleApplyAttendance} disabled={loading || !parsedRows.length}>Apply to ledger</button>
                        </div>
                        {driveStatus && (
                            <pre style={{ marginTop: 12, fontSize: '0.75rem', overflow: 'auto', maxHeight: 120 }}>{JSON.stringify(driveStatus, null, 2)}</pre>
                        )}
                    </div>
                    {parsedRows.length > 0 && (
                        <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16, overflow: 'auto' }}>
                            <h4>Parsed rows ({parsedRows.length})</h4>
                            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                                <thead><tr><th>Code</th><th>Name</th><th>Designation</th><th>Present</th><th>Absent</th></tr></thead>
                                <tbody>
                                    {parsedRows.slice(0, 50).map((r, i) => (
                                        <tr key={i}><td>{r.empCode}</td><td>{r.name}</td><td>{r.designation}</td><td>{r.presentDays}</td><td>{r.absentDays}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                        <h4>Deductions ({deductions.length})</h4>
                        {deductions.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No deductions for this period.</p> : (
                            <table style={{ width: '100%', fontSize: '0.8rem' }}>
                                <thead><tr><th>Employee</th><th>Type</th><th>Days</th><th>Amount</th></tr></thead>
                                <tbody>
                                    {deductions.map(d => (
                                        <tr key={d.id}><td>{d.employee_name || d.employee_id}</td><td>{d.type}</td><td>{d.days_absent}</td><td>{fmt(d.amount)}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'payroll' && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>World B payroll run for contract headcount (invoice uses service-order path).</p>
                    <button type="button" className="btn-primary" onClick={handleComputePayroll} disabled={loading || !contractId}><Calculator size={16} /> Compute payroll run</button>
                    {payrollRun && (
                        <pre style={{ marginTop: 12, fontSize: '0.75rem', overflow: 'auto', maxHeight: 240 }}>{JSON.stringify({ status: payrollRun.run?.status, rows: payrollRun.rows?.length, code: payrollRun.code }, null, 2)}</pre>
                    )}
                </div>
            )}

            {activeTab === 'invoice' && selectedOrder && (
                <div style={{ display: 'grid', gap: 16 }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                            <button type="button" className="btn-secondary" onClick={handleComputeInvoice} disabled={loading}>Preview</button>
                            <button type="button" className="btn-primary" onClick={handlePersistInvoice} disabled={loading}>Persist to AR</button>
                        </div>
                        {invoicePreview && (
                            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Net taxable</div><strong>{fmt(invoicePreview.netTaxable)}</strong></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Provincial ST</div><strong>{fmt(invoicePreview.provincialSt)}</strong></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Stamped grand</div><strong>{fmt(invoicePreview.grandTotal)}</strong></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Income WHT (receivable)</div><strong>{fmt(invoicePreview.incomeWht)}</strong></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Net receivable</div><strong>{fmt(invoicePreview.netReceivable)}</strong></div>
                            </div>
                        )}
                        {persistedInvoice && (
                            <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {PRINT_FORMATS.map(f => (
                                    <button key={f.key} type="button" className="btn-secondary" onClick={() => api.openFixedValueInvoicePrint(persistedInvoice.id, f.key)}>
                                        <FileText size={14} /> {f.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'registry' && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                    <button type="button" className="btn-secondary" onClick={loadRegistry} disabled={loading}><RefreshCw size={16} /> Load registry</button>
                    <table style={{ width: '100%', marginTop: 12, fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ borderBottom: '1px solid var(--border)' }}><th>Invoice #</th><th>Period</th><th>Subtotal</th><th>ST</th><th>Grand</th><th>Status</th></tr></thead>
                        <tbody>
                            {registry.map(r => (
                                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: 8 }}>{r.invoice_number}</td>
                                    <td style={{ padding: 8 }}>{r.period_month}/{r.period_year}</td>
                                    <td style={{ padding: 8, textAlign: 'right' }}>{fmt(r.subtotal)}</td>
                                    <td style={{ padding: 8, textAlign: 'right' }}>{fmt(r.sales_tax)}</td>
                                    <td style={{ padding: 8, textAlign: 'right' }}>{fmt(r.grand_total)}</td>
                                    <td style={{ padding: 8 }}>{r.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {activeTab === 'compliance' && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                    <button type="button" className="btn-secondary" onClick={handleLoadCompliance} disabled={loading}><Shield size={16} /> Load compliance ledger</button>
                    {complianceRows.length > 0 && (
                        <pre style={{ marginTop: 12, fontSize: '0.75rem', overflow: 'auto', maxHeight: 300 }}>{JSON.stringify(complianceRows.slice(0, 20), null, 2)}</pre>
                    )}
                </div>
            )}

            {activeTab === 'focals' && selectedOrder && (
                <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Focal email enabled for Morgah, Chakpirana, Sihala sites after seed.</p>
                    <button type="button" className="btn-primary" onClick={handleFocalEmail} disabled={loading}><Mail size={16} /> Send focal email</button>
                </div>
            )}
        </div>
    );
}
