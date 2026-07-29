import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    MapPin, Upload, CloudDownload, Calculator, FileText, List, Shield,
    Mail, Database, RefreshCw, AlertCircle, CheckCircle, Download, ExternalLink,
} from 'lucide-react';
import { api } from '../../api';

const ALL_SITES = '__ALL__';
const fmt = (n) => (n == null || Number.isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString();
const inputStyle = { background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text)' };
const thStyle = { textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--text-muted)' };
const tdStyle = { padding: '7px 6px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const tdNum = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function rowSiteCode(r) {
    return String(r.site || '').trim().toUpperCase();
}

/** Prefer explicit sheet/override absent; only derive WD − present when absent is unknown. */
function absentDays(r) {
    const explicit = r.inputs?.absent_days ?? r.inputs?.absentDays;
    if (explicit != null && explicit !== '') {
        return Math.max(0, Number(explicit) || 0);
    }
    if (r.computed?.modelA?.absentSource === 'explicit' && r.computed?.modelA?.absentDays != null) {
        return Math.max(0, Number(r.computed.modelA.absentDays) || 0);
    }
    const present = Number(r.paid_days);
    const working = Number(r.working_days);
    if (Number.isNaN(present) || Number.isNaN(working)) return null;
    return Math.max(0, working - present);
}
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
    const [payrollRows, setPayrollRows] = useState([]);
    const [payrollWarnings, setPayrollWarnings] = useState([]);
    const [complianceRows, setComplianceRows] = useState([]);
    const [driveStatus, setDriveStatus] = useState(null);

    const selectedOrder = useMemo(
        () => orders.find(o => o.site_code === siteCode) || (siteCode === ALL_SITES ? null : orders[0]) || orders[0] || null,
        [orders, siteCode]
    );

    const filteredPayrollRows = useMemo(() => {
        if (!siteCode || siteCode === ALL_SITES) return payrollRows;
        const want = String(siteCode).trim().toUpperCase();
        const order = orders.find(o => o.site_code === siteCode);
        const nameNeedle = String(order?.name || '').toLowerCase();
        const bySite = payrollRows.filter(r => rowSiteCode(r) === want);
        if (bySite.length) return bySite;
        // Fallback: match employee.location to service-order name when site code absent
        if (nameNeedle) {
            const byLoc = payrollRows.filter(r => {
                const loc = String(r.location || '').toLowerCase();
                return loc.includes(nameNeedle) || loc.includes(want.toLowerCase());
            });
            if (byLoc.length) return byLoc;
        }
        return bySite;
    }, [payrollRows, siteCode, orders]);

    const payrollTotals = useMemo(() => filteredPayrollRows.reduce((acc, r) => {
        const c = r.computed || {};
        acc.net += Number(c.netPay || 0);
        acc.gross += Number(c.gross || 0);
        acc.wages += Number(c.salaryForDays || 0);
        acc.eobi += Number(c.eobiEmployee || 0);
        acc.tax += Number(c.wht || 0);
        acc.life += Number(c.lifeInsurance || 0);
        return acc;
    }, { net: 0, gross: 0, wages: 0, eobi: 0, tax: 0, life: 0 }), [filteredPayrollRows]);

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
        if ((!siteCode || (siteCode !== ALL_SITES && !list.some(o => o.site_code === siteCode))) && list.length) {
            setSiteCode(list[0].site_code);
        }
    }, [contractId, siteCode]);

    const loadDeductions = useCallback(async () => {
        if (!selectedOrder?.id) return;
        const rows = await api.getFixedValueDeductions(selectedOrder.id, month, year);
        setDeductions(Array.isArray(rows) ? rows : []);
    }, [selectedOrder?.id, month, year]);

    const loadRegistry = useCallback(async () => {
        if (!contractId) return;
        const siteArg = siteCode && siteCode !== ALL_SITES ? siteCode : undefined;
        const rows = await api.getFixedValueRegistry(contractId, month, year, siteArg);
        setRegistry(Array.isArray(rows) ? rows : []);
    }, [contractId, month, year, siteCode]);

    const loadPayrollRun = useCallback(async () => {
        if (!contractId) {
            setPayrollRun(null);
            setPayrollRows([]);
            return;
        }
        const data = await api.getPayrollRuns(contractId, month, year);
        setPayrollRun(data.run || null);
        setPayrollRows(Array.isArray(data.rows) ? data.rows : []);
    }, [contractId, month, year]);

    useEffect(() => { loadContracts().catch(e => setError(e.message)); }, [loadContracts]);
    useEffect(() => { loadOrders().catch(() => {}); }, [loadOrders]);
    useEffect(() => { loadDeductions().catch(() => {}); }, [loadDeductions]);
    useEffect(() => {
        if (activeTab !== 'payroll') return;
        loadPayrollRun().catch(() => {});
    }, [activeTab, loadPayrollRun]);

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
        if (result.ok === false) {
            setMsg(result.message || result.code || 'Compute failed');
            return;
        }
        setPayrollRun(result.run || null);
        setPayrollRows(Array.isArray(result.rows) ? result.rows : []);
        setPayrollWarnings(Array.isArray(result.warnings) ? result.warnings : []);
        // Refetch so rows include site/designation from GET join
        await loadPayrollRun();
        const siteLabel = siteCode && siteCode !== ALL_SITES ? siteCode : 'all sites';
        setMsg(`Payroll run computed (${result.headcount ?? result.rows?.length ?? 0} employees) — showing ${siteLabel}. Attendance apply writes monthly overrides used by this compute.`);
    });

    const exportPayrollCsv = () => {
        const headers = [
            'Staff code', 'Name', 'Site', 'Location', 'Designation',
            'Present', 'Absent', 'Working days', 'Basic', 'Wages earned',
            'EOBI', 'Tax', 'Life insurance', 'Gross', 'Net', 'Source',
        ];
        const lines = [headers.join(',')];
        const esc = (v) => {
            const s = v == null ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        for (const r of filteredPayrollRows) {
            const c = r.computed || {};
            lines.push([
                r.employee_id, r.employee_name, r.site, r.location, r.designation,
                r.paid_days, absentDays(r), r.working_days,
                r.basic_salary ?? c.newSalary, c.salaryForDays,
                c.eobiEmployee, c.wht, c.lifeInsurance, c.gross, c.netPay,
                r.source,
            ].map(esc).join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const sitePart = siteCode && siteCode !== ALL_SITES ? siteCode : 'ALL';
        a.download = `fv-payroll-${contractId}-${year}-${String(month).padStart(2, '0')}-${sitePart}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

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
                        <option value={ALL_SITES}>All sites</option>
                        {orders.map(o => <option key={o.id} value={o.site_code}>{o.name || o.site_code}</option>)}
                    </select>
                </label>
                <button type="button" className="btn-secondary" onClick={() => { loadOrders(); loadDeductions(); loadRegistry(); if (activeTab === 'payroll') loadPayrollRun(); }} disabled={loading}>
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
                <div style={{ display: 'grid', gap: 16 }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
                            World B payroll for this contract. Site attendance (Apply to ledger) writes <code>monthly_attendance_overrides</code>;
                            Compute uses those present days for wages. Invoice remains on the service-order path.
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                            <button type="button" className="btn-primary" onClick={handleComputePayroll} disabled={loading || !contractId}>
                                <Calculator size={16} /> Compute payroll run
                            </button>
                            <button type="button" className="btn-secondary" onClick={() => runAction(loadPayrollRun, 'Payroll run loaded')} disabled={loading || !contractId}>
                                <RefreshCw size={16} /> Reload run
                            </button>
                            {filteredPayrollRows.length > 0 && (
                                <button type="button" className="btn-secondary" onClick={exportPayrollCsv} disabled={loading}>
                                    <Download size={16} /> Export CSV
                                </button>
                            )}
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <ExternalLink size={14} /> Lock / invoice / disburse: sidebar → Payroll Run
                            </span>
                        </div>
                    </div>

                    {payrollRun && (
                        <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12, marginBottom: 12 }}>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Run ID</div><strong>{payrollRun.id}</strong></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Status</div><strong>{payrollRun.status}</strong></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Period</div><strong>{payrollRun.period_month}/{payrollRun.period_year}</strong></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Rows (filtered)</div><strong>{filteredPayrollRows.length}</strong><span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}> / {payrollRows.length} contract</span></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Sum net</div><strong>PKR {fmt(payrollTotals.net)}</strong></div>
                                <div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Sum wages</div><strong>PKR {fmt(payrollTotals.wages)}</strong></div>
                            </div>
                            {siteCode && siteCode !== ALL_SITES && (
                                <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    Filtered to site <strong style={{ color: 'var(--text)' }}>{selectedOrder?.name || siteCode}</strong> ({siteCode}).
                                    Choose “All sites” in the Site filter to see the full contract run.
                                </p>
                            )}
                            {filteredPayrollRows.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                                    {payrollRows.length === 0
                                        ? 'No payroll rows yet — compute a run for this contract/period.'
                                        : `No employees match site ${siteCode}. Try All sites or confirm employees.site is set (PSO seed uses site codes like SIHALA).`}
                                </p>
                            ) : (
                                <div style={{ overflow: 'auto', maxHeight: '60vh' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                        <thead>
                                            <tr>
                                                <th style={thStyle}>Staff code</th>
                                                <th style={thStyle}>Name</th>
                                                {(siteCode === ALL_SITES || !siteCode) && <th style={thStyle}>Site</th>}
                                                <th style={thStyle}>Designation</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Present</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Absent</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Basic</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Wages</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>EOBI</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Tax</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Life ins.</th>
                                                <th style={{ ...thStyle, textAlign: 'right' }}>Net</th>
                                                <th style={thStyle}>Source</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredPayrollRows.map(r => {
                                                const c = r.computed || {};
                                                return (
                                                    <tr key={r.id || r.employee_id}>
                                                        <td style={tdStyle}>{r.employee_id}</td>
                                                        <td style={tdStyle}>{r.employee_name || '—'}</td>
                                                        {(siteCode === ALL_SITES || !siteCode) && (
                                                            <td style={tdStyle}>{r.site || r.location || '—'}</td>
                                                        )}
                                                        <td style={tdStyle}>{r.designation || '—'}</td>
                                                        <td style={tdNum}>{r.paid_days ?? '—'}</td>
                                                        <td style={tdNum}>{absentDays(r) ?? '—'}</td>
                                                        <td style={tdNum}>{fmt(r.basic_salary)}</td>
                                                        <td style={tdNum}>{fmt(c.salaryForDays)}</td>
                                                        <td style={tdNum}>{fmt(c.eobiEmployee)}</td>
                                                        <td style={tdNum}>{fmt(c.wht)}</td>
                                                        <td style={tdNum}>{fmt(c.lifeInsurance)}</td>
                                                        <td style={tdNum}>{fmt(c.netPay)}</td>
                                                        <td style={tdStyle}>{r.source || '—'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ fontWeight: 600 }}>
                                                <td style={tdStyle} colSpan={(siteCode === ALL_SITES || !siteCode) ? 7 : 6}>Totals ({filteredPayrollRows.length})</td>
                                                <td style={tdNum}>{fmt(payrollTotals.wages)}</td>
                                                <td style={tdNum}>{fmt(payrollTotals.eobi)}</td>
                                                <td style={tdNum}>{fmt(payrollTotals.tax)}</td>
                                                <td style={tdNum}>{fmt(payrollTotals.life)}</td>
                                                <td style={tdNum}>{fmt(payrollTotals.net)}</td>
                                                <td style={tdStyle} />
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {!payrollRun && (
                        <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16, color: 'var(--text-muted)' }}>
                            No World B run for this contract/period yet. Upload &amp; apply site attendance, then Compute payroll run.
                        </div>
                    )}

                    {payrollWarnings.length > 0 && (
                        <div style={{ background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', padding: 16, color: 'var(--warning, #fbbf24)' }}>
                            <strong>Compute warnings</strong> ({payrollWarnings.length})
                            <ul style={{ margin: '8px 0 0', paddingLeft: 18, maxHeight: 160, overflow: 'auto', fontSize: '0.8rem' }}>
                                {payrollWarnings.slice(0, 40).map((w, i) => (
                                    <li key={i}>{w.message || w.code}</li>
                                ))}
                            </ul>
                        </div>
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
