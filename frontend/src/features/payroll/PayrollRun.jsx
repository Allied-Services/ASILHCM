import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const fmt = (n) => (n == null || Number.isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString();
const inputStyle = { width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' };

const PayrollRun = () => {
    const now = new Date();
    const [contracts, setContracts] = useState([]);
    const [contractId, setContractId] = useState('');
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [run, setRun] = useState(null);
    const [rows, setRows] = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [holidays, setHolidays] = useState([]);
    const [holidayForm, setHolidayForm] = useState({ holiday_date: '', name: '', multiplier: 3 });
    const [expanded, setExpanded] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');

    const totals = rows.reduce((acc, r) => {
        const c = r.computed || {};
        acc.netPay += Number(c.netPay || 0);
        acc.payrollCost += Number(c.totalPayrollCost || 0);
        acc.serviceCharges += Number(c.serviceCharges || 0);
        acc.salesTax += Number(c.salesTax || 0);
        acc.invoice += Number(c.totalCost || 0);
        return acc;
    }, { netPay: 0, payrollCost: 0, serviceCharges: 0, salesTax: 0, invoice: 0 });

    const marginPct = totals.invoice ? ((totals.serviceCharges / totals.invoice) * 100).toFixed(1) : '0';

    useEffect(() => {
        api.getContracts().then(setContracts).catch(() => {});
        api.getHolidays().then(setHolidays).catch(() => setHolidays([]));
    }, []);

    const loadRun = async () => {
        if (!contractId) return;
        const data = await api.getPayrollRuns(contractId, month, year);
        setRun(data.run || null);
        setRows(data.rows || []);
    };

    useEffect(() => { loadRun().catch(() => {}); }, [contractId, month, year]);

    const compute = async () => {
        setError('');
        setLoading(true);
        try {
            const result = await api.computePayrollRun(contractId, month, year);
            if (!result.ok) {
                setError(result.message || result.code);
                return;
            }
            setRun(result.run);
            setRows((result.rows || []).map(r => ({ ...r, id: r.id })));
            setWarnings(result.warnings || []);
            setMsg('Payroll computed from attendance');
            await loadRun();
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const lockRun = async () => {
        if (!run?.id || !window.confirm('Lock this payroll run?')) return;
        try {
            const locked = await api.lockPayrollRun(run.id);
            setRun(locked);
            setMsg('Run locked');
        } catch (e) { setError(e.message); }
    };

    const invoiceRun = async () => {
        if (!run?.id || !window.confirm('Generate client invoice from this run?')) return;
        try {
            const result = await api.invoicePayrollRun(run.id);
            setMsg(`Invoice created #${result.invoice?.invoice_number || result.invoice?.id}. Feeds P&L and AR.`);
            await loadRun();
        } catch (e) { setError(e.message); }
    };

    const overrideRow = async (row) => {
        const paidDays = window.prompt('Paid days', row.paid_days);
        if (paidDays == null) return;
        const ot2 = window.prompt('OT 2X hours', row.ot2_hours);
        if (ot2 == null) return;
        const ot3 = window.prompt('OT 3X hours', row.ot3_hours);
        if (ot3 == null) return;
        try {
            await api.patchPayrollRunRow(run.id, row.id, { paidDays: Number(paidDays), ot2: Number(ot2), ot3: Number(ot3) });
            await loadRun();
        } catch (e) { setError(e.message); }
    };

    const exportCsv = () => {
        const headers = ['Employee', 'Paid Days', 'OT 2X', 'OT 3X', 'Gross', 'WHT', 'EOBI', 'Net Pay', 'TPC', 'SC', 'ST', 'Total'];
        const lines = [headers.join(',')];
        for (const r of rows) {
            const c = r.computed || {};
            lines.push([
                r.employee_name || r.employee_id,
                r.paid_days, r.ot2_hours, r.ot3_hours,
                c.gross, c.wht, c.eobiEmployee, c.netPay,
                c.totalPayrollCost, c.serviceCharges, c.salesTax, c.totalCost,
            ].join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `payroll-run-${contractId}-${month}-${year}.csv`;
        a.click();
    };

    const addHoliday = async () => {
        if (!holidayForm.holiday_date || !holidayForm.name) return;
        await api.saveHoliday(holidayForm);
        setHolidays(await api.getHolidays());
        setHolidayForm({ holiday_date: '', name: '', multiplier: 3 });
    };

    return (
        <div className="animate-fade-in">
            <div className="page-header">
                <h1 className="page-title">Payroll Run</h1>
                <p className="page-subtitle">Compute payroll from attendance — PR sheet parity with lock & invoice</p>
            </div>

            {msg && <div className="glass-card" style={{ color: 'var(--success)', marginBottom: '1rem' }}>{msg}</div>}
            {error && <div className="glass-card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

            <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                    <label>Contract
                        <select value={contractId} onChange={e => setContractId(e.target.value)} style={inputStyle}>
                            <option value="">— Select —</option>
                            {contracts.map(c => <option key={c.id} value={c.id}>{c.contract_name || c.id}</option>)}
                        </select>
                    </label>
                    <label>Month<input type="number" min={1} max={12} value={month} onChange={e => setMonth(Number(e.target.value))} style={inputStyle} /></label>
                    <label>Year<input type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={inputStyle} /></label>
                    <button type="button" className="btn-primary" disabled={!contractId || loading} onClick={compute}>
                        {loading ? 'Computing…' : 'Compute from Attendance'}
                    </button>
                </div>
                {error === 'No contract policy configured.' && (
                    <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Configure this contract in Contract Policies first (OT rules, service charge %, month days).</p>
                )}
            </div>

            {rows.length > 0 && (
                <>
                    <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
                        <div className="glass-card"><div className="stat-label">Pay to Employees</div><div className="stat-value">PKR {fmt(totals.netPay)}</div></div>
                        <div className="glass-card"><div className="stat-label">Total Payroll Cost</div><div className="stat-value">PKR {fmt(totals.payrollCost)}</div></div>
                        <div className="glass-card"><div className="stat-label">Invoice to Client</div><div className="stat-value">PKR {fmt(totals.invoice)}</div></div>
                        <div className="glass-card"><div className="stat-label">Margin (Service Charge)</div><div className="stat-value">PKR {fmt(totals.serviceCharges)} ({marginPct}%)</div></div>
                    </div>

                    {warnings.length > 0 && (
                        <div className="glass-card" style={{ marginBottom: '1rem', color: 'var(--warning)' }}>
                            <strong>Warnings</strong>
                            <ul>{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
                        </div>
                    )}

                    <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <h3 style={{ margin: 0 }}>Run status: {run?.status || '—'}</h3>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {run?.status === 'draft' && <button type="button" className="btn-primary" onClick={lockRun}>Lock Run</button>}
                                {run?.status === 'locked' && <button type="button" className="btn-primary" onClick={invoiceRun}>Generate Invoice</button>}
                                <button type="button" className="btn-secondary" onClick={exportCsv}>Export CSV</button>
                            </div>
                        </div>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Employee</th><th>Paid Days</th><th>OT 2X</th><th>OT 3X</th>
                                    <th>Gross</th><th>WHT</th><th>EOBI</th><th>Net Pay</th>
                                    <th>TPC</th><th>SC</th><th>ST</th><th>Total</th><th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => {
                                    const c = r.computed || {};
                                    const isOverride = r.inputs?.overridden_by;
                                    return (
                                        <React.Fragment key={r.id || r.employee_id}>
                                            <tr onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                                                <td>{r.employee_name || r.employee_id}{isOverride && <span style={{ fontSize: '0.7rem', color: 'var(--warning)', marginLeft: 4 }}>override</span>}</td>
                                                <td>{r.paid_days}</td>
                                                <td>{r.ot2_hours}</td>
                                                <td>{r.ot3_hours}</td>
                                                <td>{fmt(c.gross)}</td>
                                                <td>{fmt(c.wht)}</td>
                                                <td>{fmt(c.eobiEmployee)}</td>
                                                <td>{fmt(c.netPay)}</td>
                                                <td>{fmt(c.totalPayrollCost)}</td>
                                                <td>{fmt(c.serviceCharges)}</td>
                                                <td>{fmt(c.salesTax)}</td>
                                                <td>{fmt(c.totalCost)}</td>
                                                <td>{run?.status === 'draft' && <button type="button" className="btn-secondary" style={{ fontSize: '0.75rem' }} onClick={e => { e.stopPropagation(); overrideRow(r); }}>Edit</button>}</td>
                                            </tr>
                                            {expanded === r.id && (
                                                <tr><td colSpan={13} style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                    Salary for days: {fmt(c.salaryForDays)} · OT amt: {fmt(c.overtimeAmount)} · EOBI ER: {fmt(c.eobiEmployer)} · SESSI ER: {fmt(c.sessiEmployer)} · Bonus accrual: {fmt(c.bonusAccrual)} · Gratuity: {fmt(c.gratuityAccrual)} · Edu cess: {fmt(c.eduCess)}
                                                </td></tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr style={{ fontWeight: 600 }}>
                                    <td>Totals</td><td colSpan={6}></td>
                                    <td>{fmt(totals.netPay)}</td>
                                    <td>{fmt(totals.payrollCost)}</td>
                                    <td>{fmt(totals.serviceCharges)}</td>
                                    <td>{fmt(totals.salesTax)}</td>
                                    <td>{fmt(totals.invoice)}</td><td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </>
            )}

            <div className="glass-card">
                <h3 style={{ marginBottom: '1rem' }}>Public Holidays (3X OT)</h3>
                <table className="data-table" style={{ marginBottom: '1rem' }}>
                    <thead><tr><th>Date</th><th>Name</th><th>Multiplier</th><th></th></tr></thead>
                    <tbody>
                        {holidays.map(h => (
                            <tr key={h.id}>
                                <td>{h.holiday_date?.slice?.(0, 10) || h.holiday_date}</td>
                                <td>{h.name}</td>
                                <td>{h.multiplier}x</td>
                                <td><button type="button" className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => api.deleteHoliday(h.id).then(() => api.getHolidays().then(setHolidays))}>Remove</button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                    <input type="date" value={holidayForm.holiday_date} onChange={e => setHolidayForm(f => ({ ...f, holiday_date: e.target.value }))} style={inputStyle} />
                    <input placeholder="Holiday name" value={holidayForm.name} onChange={e => setHolidayForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
                    <input type="number" step="0.1" value={holidayForm.multiplier} onChange={e => setHolidayForm(f => ({ ...f, multiplier: e.target.value }))} style={inputStyle} />
                    <button type="button" className="btn-secondary" onClick={addHoliday}>Add holiday</button>
                </div>
            </div>
        </div>
    );
};

export default PayrollRun;
