import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import ConfirmModal from '../../components/ConfirmModal';

const API_URL = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
const fmt = (n) => (n == null || Number.isNaN(n)) ? '—' : Math.round(Number(n)).toLocaleString();
const inputStyle = { width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, color: 'var(--text)' };

const DISBURSE_ROLES = ['ap_team', 'finance_manager', 'superadmin'];
const DISBURSE_ERROR_LABELS = {
    BATCH_EXISTS: 'A payment batch already exists for this contract and period.',
    LEGACY_PAYROLL_LOCKED: 'Legacy World A payroll is locked for this contract and period — resolve before disbursing.',
    RUN_NOT_DISBURSABLE: 'This run cannot be disbursed (status must be locked or invoiced).',
    MISSING_BANK_DETAILS: 'Some employees are missing bank account details.',
    NO_DISBURSABLE_ROWS: 'No employees with valid bank details to disburse.',
};

const PayrollRun = ({ user }) => {
    const now = new Date();
    const [contracts, setContracts] = useState([]);
    const [contractId, setContractId] = useState('');
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [run, setRun] = useState(null);
    const [rows, setRows] = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [runMeta, setRunMeta] = useState({});
    const [invoice, setInvoice] = useState(null);
    const [holidays, setHolidays] = useState([]);
    const [holidayForm, setHolidayForm] = useState({ holiday_date: '', name: '', multiplier: 3 });
    const [expanded, setExpanded] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    const [modal, setModal] = useState(null);
    const [overrideRow, setOverrideRow] = useState(null);
    const [banks, setBanks] = useState([]);
    const [disburseOpen, setDisburseOpen] = useState(false);
    const [disburseForm, setDisburseForm] = useState({ bank_id: '', bank_name: '', payment_date: '', reference_no: '', notes: '' });
    const [disburseLoading, setDisburseLoading] = useState(false);
    const [disburseError, setDisburseError] = useState('');
    const [missingBankEmployees, setMissingBankEmployees] = useState([]);
    const [allowMissingBank, setAllowMissingBank] = useState(false);

    const canDisburse = DISBURSE_ROLES.includes(user?.role);
    const canDisburseRun = canDisburse && (run?.status === 'locked' || run?.status === 'invoiced');

    const totals = rows.reduce((acc, r) => {
        const c = r.computed || {};
        acc.netPay += Number(c.netPay || 0);
        acc.payrollCost += Number(c.totalPayrollCost || 0);
        acc.serviceCharges += Number(c.serviceCharges || 0);
        acc.salesTax += Number(c.salesTax || 0);
        acc.invoice += Number(c.totalCost || 0);
        acc.billable += Number(c.billAmount || c.totalCost || 0);
        return acc;
    }, { netPay: 0, payrollCost: 0, serviceCharges: 0, salesTax: 0, invoice: 0, billable: 0 });

    const displayBillable = runMeta.totalBillable ?? totals.billable;
    const displayMargin = runMeta.margin ?? (displayBillable - totals.payrollCost);
    const hasRateCardBilling = runMeta.hasRateCardBilling || rows.some(r => r.computed?.billSource === 'rate_card');
    const marginPct = displayBillable ? ((displayMargin / displayBillable) * 100).toFixed(1) : '0';

    useEffect(() => {
        api.getContracts().then(d => setContracts(d.contracts || d || [])).catch(() => {});
        api.getHolidays().then(setHolidays).catch(() => setHolidays([]));
    }, []);

    useEffect(() => {
        if (!disburseOpen || !canDisburse) return;
        api.getBanks()
            .then(d => setBanks(d.banks || d || []))
            .catch(() => setBanks([]));
    }, [disburseOpen, canDisburse]);

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
            setRunMeta({
                totalBillable: result.totalBillable,
                margin: result.margin,
                hasRateCardBilling: result.hasRateCardBilling,
            });
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

    const doLockRun = async () => {
        try {
            const locked = await api.lockPayrollRun(run.id);
            setRun(locked);
            setMsg('Run locked — AP close pack created. Settle salaries and contributions in Accounts Payable → FV Close Packs.');
        } catch (e) { setError(e.message); }
    };

    const doInvoiceRun = async () => {
        try {
            const result = await api.invoicePayrollRun(run.id);
            setInvoice(result.invoice);
            setMsg(`Invoice created #${result.invoice?.invoice_number || result.invoice?.id}. Feeds P&L and AR.`);
            await loadRun();
        } catch (e) { setError(e.message); }
    };

    const openDisburseModal = () => {
        const today = new Date().toISOString().slice(0, 10);
        setDisburseForm({ bank_id: '', bank_name: '', payment_date: today, reference_no: '', notes: '' });
        setDisburseError('');
        setMissingBankEmployees([]);
        setAllowMissingBank(false);
        setDisburseOpen(true);
    };

    const selectDisburseBank = (bankId) => {
        const bank = banks.find(b => String(b.id) === String(bankId));
        setDisburseForm(f => ({
            ...f,
            bank_id: bankId,
            bank_name: bank?.name || '',
        }));
    };

    const doDisburseRun = async () => {
        setDisburseError('');
        setDisburseLoading(true);
        try {
            const result = await api.disbursePayrollRun(run.id, {
                bank_id: disburseForm.bank_id || null,
                bank_name: disburseForm.bank_name,
                payment_date: disburseForm.payment_date || null,
                reference_no: disburseForm.reference_no || null,
                notes: disburseForm.notes || null,
                allow_missing_bank: allowMissingBank,
            });
            setDisburseOpen(false);
            setMsg(`Disbursement confirmed — batch ${result.batch_id} (${result.employee_count} employees, PKR ${fmt(result.total_amount)})`);
            await loadRun();
        } catch (e) {
            if (e.status === 422 && e.code === 'MISSING_BANK_DETAILS') {
                setMissingBankEmployees(e.employees || []);
                setDisburseError(DISBURSE_ERROR_LABELS.MISSING_BANK_DETAILS);
            } else if (e.status === 409 && e.code) {
                setDisburseError(DISBURSE_ERROR_LABELS[e.code] || e.message);
            } else {
                setDisburseError(e.message || 'Disbursement failed');
            }
        } finally {
            setDisburseLoading(false);
        }
    };

    const doOverrideRow = async (values) => {
        try {
            await api.patchPayrollRunRow(run.id, overrideRow.id, {
                paidDays: Number(values.paidDays),
                ot2: Number(values.ot2),
                ot3: Number(values.ot3),
            });
            setOverrideRow(null);
            await loadRun();
        } catch (e) { setError(e.message); }
    };

    const downloadPayslip = async (row) => {
        const token = localStorage.getItem('asil_hcm_token');
        try {
            const res = await fetch(`${API_URL}/api/payroll-runs/${run.id}/payslip/${encodeURIComponent(row.employee_id)}?download=1`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `Payslip_${row.employee_id}_${month}-${year}.html`;
            a.click();
        } catch (e) { setError(e.message); }
    };

    const emailAllPayslips = async () => {
        try {
            const result = await api.sendPayrollRunPayslips(run.id);
            setMsg(`Payslips emailed: ${result.sent} sent, ${result.skipped} skipped`);
        } catch (e) { setError(e.message); }
    };

    const viewInvoice = async () => {
        const token = localStorage.getItem('asil_hcm_token');
        try {
            const res = await fetch(`${API_URL}/api/payroll-runs/${run.id}/invoice-html`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            window.open(URL.createObjectURL(blob), '_blank');
        } catch (e) { setError(e.message); }
    };

    const pushToXero = async () => {
        if (!invoice && !run?.invoice_id) {
            setError('No invoice found for this run');
            return;
        }
        try {
            const inv = invoice || { invoice_number: run.invoice_id, client: '', contract: '', grand_total: displayBillable };
            const result = await api.pushRunInvoiceToXero({ ...run, headcount: rows.length }, inv);
            await api.logXeroSync({
                entityType: 'client_invoice',
                entityId: String(inv.id || run.invoice_id),
                direction: 'push',
                status: 'success',
                xeroId: result?.Invoices?.[0]?.InvoiceID || null,
            }).catch(() => {});
            setMsg('Invoice pushed to Xero');
        } catch (e) {
            const msg = e.message || '';
            if (msg.toLowerCase().includes('not connected') || msg.toLowerCase().includes('xero')) {
                setError('Xero is not connected. Connect via System Configs first.');
            } else {
                setError(msg);
            }
        }
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

    const canPayslip = run?.status === 'locked' || run?.status === 'invoiced';

    return (
        <div className="animate-fade-in">
            <ConfirmModal
                open={modal === 'lock'}
                title="Lock payroll run?"
                body="Locked runs feed P&L and compliance. This cannot be undone without admin help."
                confirmLabel="Lock run"
                onConfirm={() => { setModal(null); doLockRun(); }}
                onCancel={() => setModal(null)}
            />
            <ConfirmModal
                open={modal === 'invoice'}
                title="Generate client invoice?"
                body="Creates a draft invoice in AR from this locked run."
                confirmLabel="Generate invoice"
                onConfirm={() => { setModal(null); doInvoiceRun(); }}
                onCancel={() => setModal(null)}
            />
            <ConfirmModal
                open={modal === 'email-payslips'}
                title="Email all payslips?"
                body={`Send salary slips to all employees with email addresses for ${month}/${year}.`}
                confirmLabel="Send emails"
                onConfirm={() => { setModal(null); emailAllPayslips(); }}
                onCancel={() => setModal(null)}
            />
            <ConfirmModal
                open={!!overrideRow}
                title="Override row"
                body={`Adjust values for ${overrideRow?.employee_name || overrideRow?.employee_id}`}
                fields={[
                    { name: 'paidDays', label: 'Paid days', type: 'number', default: overrideRow?.paid_days },
                    { name: 'ot2', label: 'OT 2X hours', type: 'number', default: overrideRow?.ot2_hours },
                    { name: 'ot3', label: 'OT 3X hours', type: 'number', default: overrideRow?.ot3_hours },
                ]}
                confirmLabel="Save override"
                onConfirm={doOverrideRow}
                onCancel={() => setOverrideRow(null)}
            />

            {disburseOpen && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
                }}>
                    <div className="glass-card" style={{ maxWidth: 480, width: '100%' }}>
                        <h3 style={{ marginTop: 0 }}>Disburse payroll run</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                            Creates a confirmed AP payment batch for {rows.length} employees — total net pay PKR {fmt(totals.netPay)}.
                        </p>
                        {disburseError && (
                            <div style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.9rem' }}>{disburseError}</div>
                        )}
                        {missingBankEmployees.length > 0 && (
                            <div style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 8 }}>
                                <strong style={{ color: 'var(--warning)' }}>Missing bank details</strong>
                                <ul style={{ margin: '0.5rem 0', paddingLeft: '1.25rem', color: 'var(--text-muted)' }}>
                                    {missingBankEmployees.map(emp => (
                                        <li key={emp.id}>{emp.name || emp.id} ({emp.id})</li>
                                    ))}
                                </ul>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={allowMissingBank}
                                        onChange={e => setAllowMissingBank(e.target.checked)}
                                    />
                                    Exclude employees without bank details and proceed
                                </label>
                            </div>
                        )}
                        <label style={{ display: 'block', marginBottom: '0.75rem' }}>
                            Bank
                            <select
                                value={disburseForm.bank_id}
                                onChange={e => selectDisburseBank(e.target.value)}
                                style={inputStyle}
                            >
                                <option value="">— Select bank —</option>
                                {banks.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </label>
                        <label style={{ display: 'block', marginBottom: '0.75rem' }}>
                            Payment date
                            <input
                                type="date"
                                value={disburseForm.payment_date}
                                onChange={e => setDisburseForm(f => ({ ...f, payment_date: e.target.value }))}
                                style={inputStyle}
                            />
                        </label>
                        <label style={{ display: 'block', marginBottom: '0.75rem' }}>
                            Reference no
                            <input
                                value={disburseForm.reference_no}
                                onChange={e => setDisburseForm(f => ({ ...f, reference_no: e.target.value }))}
                                placeholder="Optional bank reference"
                                style={inputStyle}
                            />
                        </label>
                        <label style={{ display: 'block', marginBottom: '1rem' }}>
                            Notes
                            <input
                                value={disburseForm.notes}
                                onChange={e => setDisburseForm(f => ({ ...f, notes: e.target.value }))}
                                placeholder="Optional notes"
                                style={inputStyle}
                            />
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button type="button" className="btn-secondary" onClick={() => setDisburseOpen(false)} disabled={disburseLoading}>Cancel</button>
                            <button
                                type="button"
                                className="btn-primary"
                                onClick={doDisburseRun}
                                disabled={disburseLoading || !disburseForm.bank_name}
                            >
                                {disburseLoading ? 'Processing…' : 'Confirm disbursement'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                            {contracts.map(c => <option key={c.id} value={c.id}>{c.contractName || c.contract_name || c.id}</option>)}
                        </select>
                    </label>
                    <label>Month<input type="number" min={1} max={12} value={month} onChange={e => setMonth(Number(e.target.value))} style={inputStyle} /></label>
                    <label>Year<input type="number" value={year} onChange={e => setYear(Number(e.target.value))} style={inputStyle} /></label>
                    <button type="button" className="btn-primary" disabled={!contractId || loading} onClick={compute}>
                        {loading ? 'Computing…' : 'Compute from Attendance'}
                    </button>
                </div>
                {!contractId && (
                    <div style={{ marginTop: '1.25rem', padding: '1rem', border: '1px dashed var(--border)', borderRadius: 8 }}>
                        <strong>Getting started</strong>
                        <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', color: 'var(--text-muted)' }}>
                            <li>Configure Contract Policies (OT rules, service charge %)</li>
                            <li>Import attendance for the period</li>
                            <li>Select contract and click Compute from Attendance</li>
                        </ol>
                    </div>
                )}
                {error === 'No contract policy configured.' && (
                    <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>Configure this contract in Contract Policies first (OT rules, service charge %, month days).</p>
                )}
            </div>

            {rows.length > 0 && (
                <>
                    <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
                        <div className="glass-card"><div className="stat-label">Pay to Employees</div><div className="stat-value">PKR {fmt(totals.netPay)}</div></div>
                        <div className="glass-card"><div className="stat-label">Total Payroll Cost</div><div className="stat-value">PKR {fmt(totals.payrollCost)}</div></div>
                        <div className="glass-card"><div className="stat-label">Invoice to Client</div><div className="stat-value">PKR {fmt(hasRateCardBilling ? displayBillable : totals.invoice)}</div></div>
                        <div className="glass-card">
                            <div className="stat-label">{hasRateCardBilling ? 'Margin (Bill − Cost)' : 'Margin (Service Charge)'}</div>
                            <div className="stat-value">PKR {fmt(hasRateCardBilling ? displayMargin : totals.serviceCharges)} ({marginPct}%)</div>
                        </div>
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
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                {run?.status === 'draft' && <button type="button" className="btn-primary" onClick={() => setModal('lock')}>Lock Run</button>}
                                {run?.status === 'locked' && <button type="button" className="btn-primary" onClick={() => setModal('invoice')}>Generate Invoice</button>}
                                {canDisburseRun && <button type="button" className="btn-primary" onClick={openDisburseModal}>Disburse</button>}
                                {canPayslip && <button type="button" className="btn-secondary" onClick={() => setModal('email-payslips')}>Email All Payslips</button>}
                                {run?.status === 'invoiced' && (
                                    <>
                                        <button type="button" className="btn-secondary" onClick={viewInvoice}>View Invoice</button>
                                        <button type="button" className="btn-secondary" onClick={pushToXero}>Push to Xero</button>
                                    </>
                                )}
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
                                    const claimsCount = r.claimsApplied || 0;
                                    return (
                                        <React.Fragment key={r.id || r.employee_id}>
                                            <tr onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                                                <td>
                                                    {r.employee_name || r.employee_id}
                                                    {isOverride && <span style={{ fontSize: '0.7rem', color: 'var(--warning)', marginLeft: 4 }}>override</span>}
                                                    {claimsCount > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--success)', marginLeft: 4 }}>+{claimsCount} claims</span>}
                                                </td>
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
                                                <td>
                                                    {run?.status === 'draft' && <button type="button" className="btn-secondary" style={{ fontSize: '0.75rem' }} onClick={e => { e.stopPropagation(); setOverrideRow(r); }}>Edit</button>}
                                                    {canPayslip && <button type="button" className="btn-secondary" style={{ fontSize: '0.75rem', marginLeft: 4 }} onClick={e => { e.stopPropagation(); downloadPayslip(r); }}>Payslip</button>}
                                                </td>
                                            </tr>
                                            {expanded === r.id && (
                                                <tr><td colSpan={13} style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                    Salary for days: {fmt(c.salaryForDays)} · OT amt: {fmt(c.overtimeAmount)} · EOBI ER: {fmt(c.eobiEmployer)} · SESSI ER: {fmt(c.sessiEmployer)} · Bonus: {c.bonusDisbursed > 0 ? fmt(c.bonusDisbursed) : '—'} · Bonus accrual: {fmt(c.bonusAccrual)} · Gratuity: {fmt(c.gratuityAccrual)} · Edu cess: {fmt(c.eduCess)}
                                                    {c.billSource === 'rate_card' && <> · Bill rate: {fmt(c.billAmount)}</>}
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
