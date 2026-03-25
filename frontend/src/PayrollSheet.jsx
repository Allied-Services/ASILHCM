import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Calculator, Send, Download, Upload, ChevronDown, Filter, AlertCircle, CheckCircle, X, CheckSquare, Square, MessageSquare, FileText as FileTextIcon, CreditCard as CreditCardIcon, Lock, Unlock, Save } from 'lucide-react';
import {
    PAYROLL_CONTRACT_CFG as CONTRACT_CFG,
    calcEmployeeRow, downloadCSV,
    buildPayrollCSV, buildHBLFile, buildWHTFile, buildEOBIFile, buildSESSIFile,
    calcWHT, calcEOBI_fn, calcGratuityMonthly, calcPF_fn, COMPANY,
} from './payrollUtils';
import { api } from './api';


// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = v => Math.round(parseFloat(v) || 0).toLocaleString('en-PK');
const Rs = v => `Rs. ${fmt(v)}`;

// ─── Breakdown panel ─────────────────────────────────────────────────────────
function BreakdownPanel({ emp, calc, workDays, onClose }) {
    const S = ({ title, color, children }) => (
        <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', color, marginBottom: '0.6rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${color}44` }}>{title}</div>
            {children}
        </div>
    );
    const R = ({ label, formula, value, bold, color }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--text-muted)', flex: 1 }}>{label}</span>
            {formula && <span style={{ color: '#64748b', fontSize: '0.75rem', marginRight: '1rem', flex: 2 }}>{formula}</span>}
            <span style={{ fontWeight: bold ? 700 : 500, color: color || 'var(--text)', minWidth: '110px', textAlign: 'right' }}>{Rs(value)}</span>
        </div>
    );
    const D = ({ label, value, color }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-dark)', borderRadius: '6px', marginTop: '6px', fontWeight: 700 }}>
            <span>{label}</span><span style={{ color: color || 'var(--text)' }}>{Rs(value)}</span>
        </div>
    );
    const cfg = CONTRACT_CFG[emp.contract] || {};
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1100, padding: '2rem', overflowY: 'auto' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '720px', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <h3 style={{ margin: 0 }}>Payroll Verification — {emp.name}</h3>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{emp.id} · {emp.contract} · Working Days: {workDays}</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
                </div>
                <div style={{ padding: '1.75rem 2rem' }}>
                    <S title="Earnings" color="#22c55e">
                        <R label="Basic (paid days)" formula={`${fmt(emp.basic)} ÷ ${workDays} × ${calc.pd} days`} value={calc.basicPaid} />
                        <R label="HRA" formula={`${fmt(emp.hra || 0)} × ${calc.pd}/${workDays}`} value={calc.hraPaid} />
                        <R label="Conveyance" formula={`${fmt(emp.conveyance || 0)} × ${calc.pd}/${workDays}`} value={calc.convPaid} />
                        <R label="Medical Allowance" value={calc.medPaid} />
                        {calc.ot2hrs > 0 && <R label={`OT @2× (${calc.ot2hrs} hrs)`} formula={`${fmt(emp.basic)}÷${workDays}÷8 × 2 × ${calc.ot2hrs}`} value={calc.otAmount} />}
                        {calc.ot3hrs > 0 && <R label={`OT @3× (${calc.ot3hrs} hrs)`} value={Math.round((emp.basic / workDays / 8) * 3 * calc.ot3hrs)} />}
                        {calc.opdClaim > 0 && <R label="OPD Claim" value={calc.opdClaim} />}
                        {calc.reimb > 0 && <R label="Reimbursements" value={calc.reimb} />}
                        {calc.arrears > 0 && <R label="Arrears" value={calc.arrears} />}
                        {calc.splAllow > 0 && <R label="Special Allowance" value={calc.splAllow} />}
                        {calc.fuelMob > 0 && <R label="Fuel/Mobile" value={calc.fuelMob} />}
                        <D label="Gross Monthly" value={calc.grossMonthly} color="#22c55e" />
                    </S>
                    <S title="Employee Deductions" color="#f43f5e">
                        <R label="Income Tax (WHT)" formula={`Annual Rs.${fmt(calc.annualIncome)} → FBR 2025-26 ÷ 12`} value={calc.incomeTax} color="#f43f5e" />
                        <R label="EOBI Employee — Fixed" formula="1% × Rs. 40,000 (statutory minimum wage)" value={calc.eobi_ee} />
                        {emp.pf_enrolled && <R label="PF Employee 8.33%" formula={`${fmt(emp.basic)} × 8.33%`} value={calc.pfEE} />}
                        {calc.advanceDed > 0 && <R label="Advance Recovery" value={calc.advanceDed} />}
                        {calc.loanDed > 0 && <R label="Loan Installment" value={calc.loanDed} />}
                        <D label="Total Deductions" value={calc.totalDeductions} color="#f43f5e" />
                        <D label="NET PAY (Employee Take-home)" value={calc.netPay} color="#22c55e" />
                    </S>
                    <S title="Employer Add-ons (Billed to Client)" color="#a78bfa">
                        <R label="Gross Monthly (pass-through)" value={calc.grossMonthly} />
                        <R label="EOBI Employer — Fixed" formula="5% × Rs. 40,000 (statutory minimum wage)" value={calc.eobi_er} />
                        {calc.sessi > 0
                            ? <R label={`SESSI (6% — gross Rs.${fmt(calc.grossMonthly)} < 45,000)`} formula={`6% × ${fmt(calc.grossMonthly)}`} value={calc.sessi} />
                            : <R label="SESSI — Exempt (gross ≥ Rs. 45,000)" formula="Not applicable" value={0} muted />}
                        <R label="Gratuity (monthly accrual)" formula={`(${fmt(emp.gross)} ÷ 26) × 30 ÷ 12`} value={calc.gratuity} />
                        <R label="Life Insurance" value={calc.lifeIns} />
                        <R label="Medical — Employee" value={calc.medEE} />
                        {calc.medSP > 0 && <R label="Medical — Spouse" value={calc.medSP} />}
                        {calc.medCh1 > 0 && <R label="Medical — Child 1" value={calc.medCh1} />}
                        {calc.medCh2 > 0 && <R label="Medical — Child 2" value={calc.medCh2} />}
                        {emp.pf_enrolled && <R label="PF Employer Match 8.33%" value={calc.pfER} />}
                        <D label="Total Payroll Cost" value={calc.totalPayrollCost} color="#a78bfa" />
                    </S>
                    <S title="Invoice" color="#f59e0b">
                        <R label="Total Payroll Cost" value={calc.totalPayrollCost} />
                        <R label="Service Charges / Margin" formula={`${cfg.service_charges_pct || 0}% of Payroll Cost`} value={calc.serviceCharges} />
                        <R label="Sales Tax" formula={`${cfg.sales_tax_pct || 0}% on Service Charges only`} value={calc.salesTax} />
                        <div style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.15),rgba(56,189,248,0.1))', border: '1px solid #f59e0b', borderRadius: '8px', padding: '1rem', marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700 }}>TOTAL INVOICE TO CLIENT</span>
                            <span style={{ fontWeight: 900, fontSize: '1.4rem', color: '#f59e0b' }}>{Rs(calc.totalInvoice)}</span>
                        </div>
                    </S>
                </div>
            </div>
        </div>
    );
}

// ─── Import Modal ─────────────────────────────────────────────────────────────
function ImportModal({ onApply, onClose, employees = [], workDays = 26 }) {
    const fileRef = useRef();
    const [preview, setPreview] = useState([]);
    const [errors, setErrors] = useState([]);
    const [parsed, setParsed] = useState([]);

    // Only CNIC or ASIL Employee Code is required, rest are optional
    const REQUIRED = ['CNIC', 'ASIL Employee Code'];

    const handleFile = (e) => {
        const f = e.target.files[0]; if (!f) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const lines = ev.target.result.replace(/\r/g, '').split('\n').filter(Boolean);
            const hdrs = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
            const missing = REQUIRED.filter(r => !hdrs.includes(r));
            if (missing.length) { setErrors([`Missing required columns: ${missing.join(', ')}`]); return; }

            const errs = []; const rows = []; const prev = [];
            lines.slice(1).forEach((line, i) => {
                const vals = []; let cur = '', inQ = false;
                for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; } else cur += ch; }
                vals.push(cur.trim());
                const obj = {}; hdrs.forEach((h, j) => { obj[h] = vals[j] || ''; });
                const cnic = obj['CNIC']; const empCode = obj['ASIL Employee Code'];
                // Match by CNIC first, then by employee code (either is sufficient)
                const match = employees.find(e => e.cnic === cnic) ||
                              employees.find(e => e.id === empCode);
                if (!match) {
                    errs.push(`Row ${i + 2}: No employee found for CNIC ${cnic} / Code ${empCode}`);
                } else {
                    // Present Days: if provided, use as paid_days (unauthorized absence = deduction)
                    const presentDays = obj['Present Days'] !== undefined && obj['Present Days'] !== ''
                        ? Math.min(parseFloat(obj['Present Days']) || workDays, workDays)
                        : workDays;
                    const leaveDays = workDays - presentDays;
                    rows.push({
                        empId:         match.id,
                        paid_days:     presentDays,
                        ot2_hrs:       parseFloat(obj['OT Hrs @ 2X']) || 0,
                        ot3_hrs:       parseFloat(obj['OT Hrs @ 3X']) || 0,
                        opd_claim:     parseFloat(obj['OPD']) || 0,
                        reimbursement: parseFloat(obj['Expense Reimbursement']) || 0,
                        arrears:       parseFloat(obj['Arrears']) || 0,
                        bonus_amount:  parseFloat(obj['Bonus']) || 0,
                    });
                    prev.push({
                        name: match.name, id: match.id,
                        presentDays, leaveDays,
                        ot2: obj['OT Hrs @ 2X'] || 0, ot3: obj['OT Hrs @ 3X'] || 0,
                        opd: obj['OPD'] || 0, reimb: obj['Expense Reimbursement'] || 0,
                        arrears: obj['Arrears'] || 0, bonus: obj['Bonus'] || 0,
                    });
                }
            });
            setErrors(errs); setParsed(rows); setPreview(prev);
        };
        reader.readAsText(f);
    };

    const downloadTemplate = () => {
        downloadCSV('payroll_import_template.csv', [{
            'CNIC': '42101-1234567-1', 'Staff Code': 'SEC-001', 'Month': 'March', 'Year': '2026',
            'ASIL Employee Code': 'EMP-2026-201',
            'Present Days': '26',       // attendance (< working days = deduction)
            'OT Hrs @ 2X': '8', 'OT Hrs @ 3X': '0',
            'OPD': '0', 'Expense Reimbursement': '0', 'Arrears': '0', 'Bonus': '0',
        }]);
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1100, padding: '2rem', overflowY: 'auto' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '860px', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <h3 style={{ margin: 0 }}>Import Payroll Sheet</h3>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Upload attendance + overtime + adjustments CSV collected from site focals.</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
                </div>
                <div style={{ padding: '2rem' }}>
                    <div style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                        <strong>Required:</strong> CNIC, ASIL Employee Code (either one is enough to match).<br />
                        <strong>Optional:</strong> Present Days, OT Hrs @ 2X, OT Hrs @ 3X, OPD, Expense Reimbursement, Arrears, Bonus.<br />
                        <strong style={{ color: '#f59e0b' }}>Present Days:</strong> If less than Working Days ({workDays}), the difference is treated as unauthorized leave and salary is deducted. Notified leave = show full {workDays} days.
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                        <button onClick={downloadTemplate} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Download size={16} /> Download Template
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Upload size={16} /> Upload CSV
                            <input type="file" accept=".csv" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
                        </label>
                    </div>

                    {errors.length > 0 && (
                        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '10px', padding: '1rem', marginBottom: '1.25rem' }}>
                            <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '6px' }}><AlertCircle size={16} /> {errors.length} Validation Error(s)</div>
                            {errors.map((e, i) => <div key={i} style={{ fontSize: '0.85rem', color: '#f87171', marginTop: '3px' }}>• {e}</div>)}
                        </div>
                    )}

                    {preview.length > 0 && (
                        <div>
                            <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}><CheckCircle size={16} /> {preview.length} rows validated — ready to import</div>
                            <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border)', maxHeight: '280px', overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                    <thead style={{ background: 'var(--bg-dark)', position: 'sticky', top: 0 }}>
                                        <tr>{['Employee', 'ID', 'Pres.Days', 'Leave', 'OT @2X', 'OT @3X', 'OPD', 'Reimb.', 'Arrears', 'Bonus'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {preview.map((r, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: r.leaveDays > 0 ? 'rgba(239,68,68,0.05)' : undefined }}>
                                                <td style={{ padding: '7px 8px', fontWeight: 600 }}>{r.name}</td>
                                                <td style={{ padding: '7px 8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.id}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.presentDays}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right', color: r.leaveDays > 0 ? '#ef4444' : 'var(--text-muted)', fontWeight: r.leaveDays > 0 ? 700 : 400 }}>{r.leaveDays > 0 ? `-${r.leaveDays}d` : '—'}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.ot2}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.ot3}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(r.opd)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(r.reimb)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(r.arrears)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right', color: parseFloat(r.bonus) > 0 ? '#22c55e' : 'var(--text-muted)' }}>{fmt(r.bonus)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ background: '#0f1823', fontWeight: 700, fontSize: '0.78rem', borderTop: '2px solid var(--border)' }}>
                                            <td colSpan={2} style={{ padding: '7px 8px', color: 'var(--text-muted)' }}>TOTALS ({preview.length} rows)</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right' }}>{preview.reduce((s,r)=>s+(parseFloat(r.presentDays)||0),0)}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right', color: '#ef4444' }}>{preview.reduce((s,r)=>s+(parseFloat(r.leaveDays)||0),0)}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right' }}>{preview.reduce((s,r)=>s+(parseFloat(r.ot2)||0),0).toFixed(1)}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right' }}>{preview.reduce((s,r)=>s+(parseFloat(r.ot3)||0),0).toFixed(1)}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(preview.reduce((s,r)=>s+(parseFloat(r.opd)||0),0))}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(preview.reduce((s,r)=>s+(parseFloat(r.reimb)||0),0))}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right', color: '#22c55e' }}>{fmt(preview.reduce((s,r)=>s+(parseFloat(r.arrears)||0),0))}</td>
                                            <td style={{ padding: '7px 8px', textAlign: 'right', color: '#22c55e' }}>{fmt(preview.reduce((s,r)=>s+(parseFloat(r.bonus)||0),0))}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.25rem' }}>
                                <button onClick={onClose} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={() => { onApply(parsed); onClose(); }} style={{ background: '#22c55e', border: 'none', color: 'white', padding: '8px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Apply to Payroll Sheet</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Export Dropdown ──────────────────────────────────────────────────────────
function ExportMenu({ rows, month, onClose }) {
    const opts = [
        { label: 'Full Payroll CSV', sub: 'All columns — earnings, deductions, invoice', fn: () => downloadCSV(`Payroll_${month}.csv`, buildPayrollCSV(rows, month)) },
        { label: 'HBL Bank File', sub: 'Net Pay per employee in HBL transfer format', fn: () => downloadCSV(`HBL_Bank_${month}.csv`, buildHBLFile(rows, month)) },
        { label: 'WHT Returns (FBR)', sub: 'Taxable amount + tax per employee for FBR', fn: () => { const d = buildWHTFile(rows); d.length ? downloadCSV(`WHT_Returns_${month}.csv`, d) : alert('No employees with WHT this month.'); } },
        { label: 'EOBI Contributions', sub: 'Employee & employer EOBI per head', fn: () => downloadCSV(`EOBI_${month}.csv`, buildEOBIFile(rows, month)) },
        { label: 'SESSI Contributions', sub: 'Employer SESSI contribution per head', fn: () => downloadCSV(`SESSI_${month}.csv`, buildSESSIFile(rows, month)) },
    ];
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050 }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '140px', right: '2rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', minWidth: '320px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
                <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em' }}>Export Options — {month}</div>
                {opts.map(o => (
                    <button key={o.label} onClick={() => { o.fn(); onClose(); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.9rem 1.25rem', background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-dark)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{o.label}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>{o.sub}</div>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function PayrollSheet() {
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    const [month, setMonth] = useState(defaultMonth);
    const [workDays, setWorkDays] = useState(26);
    const [filterClient, setFilterClient] = useState('All');
    const [filterContract, setFilterContract] = useState('All');
    const [filterLoc, setFilterLoc] = useState('All');
    const [overrides, setOverrides] = useState({});
    const [breakdown, setBreakdown] = useState(null);
    const [approvalSent, setApprovalSent] = useState({});
    const [showExport, setShowExport] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [EMPLOYEES, setEMPLOYEES] = useState([]);
    const [CONTRACT_MAP, setCONTRACT_MAP] = useState({});
    // ── Lock / DB state ─────────────────────────────────────────────────────────
    const [isLocked, setIsLocked] = useState(false);
    const [lockedBy, setLockedBy] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const saveTimerRef = useRef(null);
    // ── Bulk selection state ────────────────────────────────────────────────────
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [showBulkSMS, setShowBulkSMS] = useState(false);
    const [bulkSMSMsg, setBulkSMSMsg] = useState('');
    const [bulkSMSSending, setBulkSMSSending] = useState(false);
    const [bulkSMSResult, setBulkSMSResult] = useState(null);

    // Load contracts from DB → build lookup map by client name AND contract name
    useEffect(() => {
        api.getContracts().then(data => {
            const map = {};
            const addToMap = (key, cfg) => {
                const k = key?.toLowerCase()?.trim();
                if (!k) return;
                if (!map[k] || cfg._isActive) map[k] = cfg;
            };
            (data.contracts || []).forEach(ct => {
                const cfg = {
                    service_charges_pct: parseFloat(ct.financials?.service_charges_pct) || 0,
                    sales_tax_pct:       parseFloat(ct.financials?.sales_tax_pct) || 0,
                    life_insurance:      parseFloat(ct.costs?.life_insurance) || 0,
                    medical_ee:          parseFloat(ct.costs?.medical_ee) || 0,
                    medical_sp:          parseFloat(ct.costs?.medical_sp) || 0,
                    medical_child:       parseFloat(ct.costs?.medical_child) || 0,
                    bonus_months:        parseFloat(ct.costs?.bonus_months) || 0,
                    bonus_min_months:    parseFloat(ct.costs?.bonus_min_months) || 12,
                    _isActive:           ct.status === 'Active',
                };
                // Index by client name (for lookup by emp.client)
                addToMap(ct.clientName, cfg);
                // Also index by contract name (for lookup by emp.contract = clientBU)
                addToMap(ct.contractName, cfg);
                // Also index by contract id
                addToMap(ct.id, cfg);
            });
            setCONTRACT_MAP(map);
        }).catch(() => {});
    }, []);

    // Load employees from DB and map to payroll format (family composition → medical)
    useEffect(() => {
        api.getEmployees().then(data => {
            const mapped = (data.employees || []).map(e => {
                const gross = parseFloat(e.salary) || 0;
                // Family composition for medical
                const hasSpouse = !!(e.spouseName && String(e.spouseName).trim());
                const numChildren = [e.child1Name, e.child2Name].filter(n => n && String(n).trim()).length;
                return {
                    id: e.id, cnic: e.cnic, name: e.name,
                    designation: e.designation || '', contract: e.clientBU || 'Standard',
                    location: e.location || '', client: e.client || '',
                    gross,
                    basic:             Math.round(gross * 0.60),
                    hra:               Math.round(gross * 0.20),
                    conveyance:        Math.round(gross * 0.10),
                    medical_allowance: Math.round(gross * 0.07),
                    other_allowances:  Math.round(gross * 0.03),
                    pf_enrolled: false,
                    bankAccount: e.bankAccount || '', bankName: e.bankName || '',
                    eobiNo: e.eobiNo || '', email: e.email || '',
                    contact: e.primaryContact || '',
                    doj: e.doj || '',
                    // family (used for medical)
                    hasSpouse, numChildren: Math.min(numChildren, 2),
                };
            });
            setEMPLOYEES(mapped);
        }).catch(() => {});
    }, []);

    // ── Load saved payroll from DB whenever month changes ──────────────────────
    useEffect(() => {
        const [yr, mo] = month.split('-');
        setOverrides({});
        setIsLocked(false);
        setLockedBy(null);
        api.getPayroll(yr, mo).then(data => {
            if (!data.rows || !data.rows.length) return;
            const ov = {};
            data.rows.forEach(r => {
                ov[r.employee_id] = {
                    ...(r.paid_days != null ? { paid_days: r.paid_days } : {}),
                    ot2_hrs:           r.ot2_hrs,
                    ot3_hrs:           r.ot3_hrs,
                    opd_claim:         r.opd_claim,
                    reimbursement:     r.reimbursement,
                    arrears:           r.arrears,
                    bonus_amount:      r.bonus_amount,
                    special_allowance: r.special_allowance,
                    fuel_mobile:       r.fuel_mobile,
                    other_deduction:   r.other_deduction,
                    advance_deduction: r.advance_deduction,
                    loan_deduction:    r.loan_deduction,
                    ...(r.medical_ee  != null ? { medical_ee:  r.medical_ee  } : {}),
                    ...(r.medical_sp  != null ? { medical_sp:  r.medical_sp  } : {}),
                    ...(r.medical_ch1 != null ? { medical_ch1: r.medical_ch1 } : {}),
                    ...(r.medical_ch2 != null ? { medical_ch2: r.medical_ch2 } : {}),
                };
            });
            setOverrides(ov);
            setIsLocked(data.locked || false);
            setLockedBy(data.lockedBy || null);
        }).catch(() => {}); // silently ignore if table not yet created
    }, [month]);

    // ── Save rows to DB (debounced) ─────────────────────────────────────────────
    const saveToDb = useCallback((ovState, rowsData) => {
        if (isLocked) return;
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            try {
                setIsSaving(true);
                const [yr, mo] = month.split('-');
                const payload = rowsData.map(({ emp, ov: rowOv, calc }) => ({
                    employee_id: emp.id,
                    ov: rowOv,
                    calc,
                }));
                await api.savePayroll(yr, mo, payload);
            } catch (e) { console.warn('Payroll save failed:', e.message); }
            finally { setIsSaving(false); }
        }, 800);
    }, [month, isLocked]);

    const rowsRef = useRef([]);

    const setOv = (id, field, val) => {
        if (isLocked) return;
        setOverrides(p => ({ ...p, [id]: { ...(p[id] || {}), [field]: val } }));
        // Trigger debounced save after user edits
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            const currentRows = rowsRef.current;
            if (!currentRows.length || isLocked) return;
            try {
                setIsSaving(true);
                const [yr, mo] = month.split('-');
                const payload = currentRows.map(({ emp, ov: rowOv, calc }) => ({
                    employee_id: emp.id, ov: rowOv, calc,
                }));
                await api.savePayroll(yr, mo, payload);
            } catch (e) { console.warn('Payroll save failed:', e.message); }
            finally { setIsSaving(false); }
        }, 1200);
    };
    const getOv = (id, field, def) => { const o = overrides[id]; return (o && o[field] !== undefined) ? o[field] : def; };

    // Bulk selection helpers — defined AFTER filtered/rows (declared below)
    const toggleSelect = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

    // Bulk SMS send (uses Jazz bulk endpoint)
    const sendBulkSMS = async () => {
        if (!bulkSMSMsg.trim()) return;
        setBulkSMSSending(true); setBulkSMSResult(null);
        try {
            const recipients = selectedRows.map(r => ({ phone: r.emp.contact, name: r.emp.name, netPay: Math.round(r.calc.netPay) })).filter(x => x.phone);
            if (!recipients.length) throw new Error('No phone numbers found for selected employees.');
            const res = await api.bulkSms(recipients, bulkSMSMsg);
            setBulkSMSResult({ ok: true, msg: `✅ Sent to ${recipients.length} employee(s). Jazz response: ${JSON.stringify(res)}` });
        } catch (err) { setBulkSMSResult({ ok: false, msg: '❌ ' + err.message }); }
        setBulkSMSSending(false);
    };

    // Export bank file for selected only
    const exportBankSelected = () => {
        if (!selectedRows.length) return alert('Select at least one employee.');
        downloadCSV(`HBL_Selected_${month}.csv`, buildHBLFile(selectedRows, month));
    };

    // Generate payslips for selected (open each in new tab)
    const generatePayslips = () => {
        if (!selectedRows.length) return alert('Select at least one employee.');
        selectedRows.forEach(r => api.openPayslip(r.emp.id, parseInt(month.split('-')[1]), parseInt(month.split('-')[0])));
    };

    // Cascading filter lists
    const allClients = ['All', ...new Set(EMPLOYEES.map(e => e.client))];
    const contractPool = filterClient === 'All' ? EMPLOYEES : EMPLOYEES.filter(e => e.client === filterClient);
    const allContracts = ['All', ...new Set(contractPool.map(e => e.contract))];
    const locPool = filterContract === 'All' ? contractPool : contractPool.filter(e => e.contract === filterContract);
    const allLocs = ['All', ...new Set(locPool.map(e => e.location))];

    const filtered = EMPLOYEES.filter(e =>
        (filterClient === 'All' || e.client === filterClient) &&
        (filterContract === 'All' || e.contract === filterContract) &&
        (filterLoc === 'All' || e.location === filterLoc)
    );

    // Contract cfg lookup: try client name first, then contract name (clientBU)
    const rows = filtered.map(emp => {
        const cfg = CONTRACT_MAP[emp.contract?.toLowerCase()?.trim()] ||
                    CONTRACT_MAP[emp.client?.toLowerCase()?.trim()] || {};
        // Medical defaults from contract + employee family
        const defMedEE    = cfg.medical_ee    || 0;
        const defMedSP    = emp.hasSpouse ? (cfg.medical_sp || 0) : 0;
        const defMedCh1   = emp.numChildren >= 1 ? (cfg.medical_child || 0) : 0;
        const defMedCh2   = emp.numChildren >= 2 ? (cfg.medical_child || 0) : 0;
        const ov = {
            paid_days:        getOv(emp.id, 'paid_days', workDays),
            ot2_hrs:          getOv(emp.id, 'ot2_hrs', 0),
            ot3_hrs:          getOv(emp.id, 'ot3_hrs', 0),
            opd_claim:        getOv(emp.id, 'opd_claim', 0),
            reimbursement:    getOv(emp.id, 'reimbursement', 0),
            arrears:          getOv(emp.id, 'arrears', 0),
            special_allowance:getOv(emp.id, 'special_allowance', 0),
            fuel_mobile:      getOv(emp.id, 'fuel_mobile', 0),
            other_deduction:  getOv(emp.id, 'other_deduction', 0),
            advance_deduction:getOv(emp.id, 'advance_deduction', 0),
            loan_deduction:   getOv(emp.id, 'loan_deduction', 0),
            bonus_amount:     getOv(emp.id, 'bonus_amount', 0),
            medical_ee:       getOv(emp.id, 'medical_ee',  defMedEE),
            medical_sp:       getOv(emp.id, 'medical_sp',  defMedSP),
            medical_ch1:      getOv(emp.id, 'medical_ch1', defMedCh1),
            medical_ch2:      getOv(emp.id, 'medical_ch2', defMedCh2),
        };
        return { emp, cfg, calc: calcEmployeeRow(emp, ov, cfg, workDays), ov };
    });
    // Keep ref in sync so the debounced setOv save always uses current calculations
    rowsRef.current = rows;

    // Bulk helpers — placed HERE so filtered + rows are already defined
    const allSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));
    const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(filtered.map(e => e.id)));
    const selectedRows = rows.filter(r => selectedIds.has(r.emp.id));

    const T = rows.reduce((acc, { calc }) => {
        ['grossMonthly', 'incomeTax', 'eobi_ee', 'pfEE', 'totalDeductions', 'netPay',
            'eobi_er', 'sessi', 'gratuity', 'lifeIns', 'totalMedical', 'totalPayrollCost',
            'serviceCharges', 'salesTax', 'totalInvoice', 'otAmount'].forEach(k => {
                acc[k] = (acc[k] || 0) + (calc[k] || 0);
            });
        return acc;
    }, {});

    const applyImport = async (parsed) => {
        const newOv = { ...overrides };
        parsed.forEach(({ empId, ...fields }) => {
            newOv[empId] = { ...(newOv[empId] || {}), ...fields };
        });
        setOverrides(newOv);
        // Save immediately to DB after import
        try {
            const [yr, mo] = month.split('-');
            const payload = filtered.map(emp => {
                const cfg = CONTRACT_MAP[emp.client?.toLowerCase()?.trim()] ||
                            CONTRACT_MAP[emp.contract?.toLowerCase()?.trim()] || {};
                const empOv = newOv[emp.id] || {};
                const ov = {
                    paid_days:         empOv.paid_days         ?? workDays,
                    ot2_hrs:           empOv.ot2_hrs           ?? 0,
                    ot3_hrs:           empOv.ot3_hrs           ?? 0,
                    opd_claim:         empOv.opd_claim         ?? 0,
                    reimbursement:     empOv.reimbursement     ?? 0,
                    arrears:           empOv.arrears           ?? 0,
                    bonus_amount:      empOv.bonus_amount      ?? 0,
                    special_allowance: empOv.special_allowance ?? 0,
                    fuel_mobile:       empOv.fuel_mobile       ?? 0,
                    other_deduction:   empOv.other_deduction   ?? 0,
                    advance_deduction: empOv.advance_deduction ?? 0,
                    loan_deduction:    empOv.loan_deduction    ?? 0,
                };
                const calc = calcEmployeeRow(emp, ov, cfg, workDays);
                return { employee_id: emp.id, ov, calc };
            });
            await api.savePayroll(yr, mo, payload);
        } catch (e) { console.warn('Import save failed:', e.message); }
    };

    const handleLock = async () => {
        if (!window.confirm('Lock this payroll month? No further edits will be allowed after locking.')) return;
        try {
            const [yr, mo] = month.split('-');
            await api.lockPayroll(yr, mo);
            setIsLocked(true);
            setLockedBy('You');
        } catch (e) { alert('Lock failed: ' + e.message); }
    };

    const handleUnlock = async () => {
        if (!window.confirm('Unlock this payroll? This means the bank has NOT processed it yet.')) return;
        try {
            const [yr, mo] = month.split('-');
            await api.unlockPayroll(yr, mo);
            setIsLocked(false);
            setLockedBy(null);
        } catch (e) { alert('Unlock failed: ' + e.message); }
    };

    const needsApproval = rows.some(r => r.cfg.client_approval);

    // Editable cell — disabled when payroll is locked
    const EC = ({ empId, field, def = 0, w = '68px' }) => (
        <input type="number" min={0} value={getOv(empId, field, def)}
            disabled={isLocked}
            onChange={e => {
                if (isLocked) return;
                setOv(empId, field, e.target.value);
            }}
            style={{ width: w, background: isLocked ? 'transparent' : 'rgba(56,189,248,0.07)', border: isLocked ? 'none' : '1px solid rgba(56,189,248,0.2)', borderRadius: '4px', padding: '3px 5px', color: 'var(--text)', fontSize: '0.78rem', textAlign: 'right', outline: 'none', cursor: isLocked ? 'not-allowed' : 'text', opacity: isLocked ? 0.7 : 1 }} />
    );
    const RC = ({ val, pos, neg, bold, muted }) => (
        <td style={{ padding: '6px 7px', textAlign: 'right', fontWeight: bold ? 700 : 400, fontSize: '0.8rem', whiteSpace: 'nowrap', color: neg ? '#f43f5e' : pos ? '#22c55e' : muted ? '#64748b' : 'var(--text)' }}>
            {fmt(val)}
        </td>
    );
    const TH = ({ label, sub, color }) => (
        <th style={{ padding: '7px 7px', textAlign: 'right', whiteSpace: 'nowrap', fontSize: '0.67rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: color || 'var(--text-muted)', lineHeight: 1.3 }}>
            {label}{sub && <><br /><span style={{ fontWeight: 400, fontSize: '0.63rem', opacity: 0.7 }}>{sub}</span></>}
        </th>
    );

    const FD = ({ label, val, set, opts }) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}:</span>
            <select value={val} onChange={e => { set(e.target.value); if (label === 'Client') { setFilterContract('All'); setFilterLoc('All'); } if (label === 'Contract') setFilterLoc('All'); }}
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '6px', padding: '5px 8px', color: 'var(--text)', fontSize: '0.82rem', outline: 'none', maxWidth: '180px' }}>
                {opts.map(o => <option key={o}>{o}</option>)}
            </select>
        </div>
    );

    return (
        <div className="dashboard">
            <header className="header">
                <h1>Payroll Sheet</h1>
                <p>Monthly payroll — net pay for employees + total cost invoice for clients.</p>
            </header>

            {/* Controls */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Payroll Month</div>
                    <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '7px 12px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none' }} />
                </div>
                <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Working Days</div>
                    <input type="number" value={workDays} min={20} max={31} onChange={e => setWorkDays(parseInt(e.target.value) || 26)}
                        style={{ width: '72px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '7px 10px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <Filter size={14} color="var(--text-muted)" />
                    <FD label="Client" val={filterClient} set={setFilterClient} opts={allClients} />
                    <FD label="Contract" val={filterContract} set={setFilterContract} opts={allContracts} />
                    <FD label="Location" val={filterLoc} set={setFilterLoc} opts={allLocs} />
                    {(filterClient !== 'All' || filterContract !== 'All' || filterLoc !== 'All') &&
                        <button onClick={() => { setFilterClient('All'); setFilterContract('All'); setFilterLoc('All'); }}
                            style={{ fontSize: '0.75rem', color: '#ef4444', background: 'transparent', border: '1px solid #ef444440', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}>Clear</button>}
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    {isSaving && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Save size={13} />Saving…</span>}
                    <button onClick={() => setShowImport(true)} disabled={isLocked}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: isLocked ? '#333' : 'var(--bg-card)', border: '1px solid var(--border)', color: isLocked ? '#555' : 'var(--text)', padding: '8px 16px', borderRadius: '8px', cursor: isLocked ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                        <Upload size={15} /> Import
                    </button>
                    {needsApproval && (
                        <button onClick={() => setApprovalSent(p => ({ ...p, [month]: 'Submitted' }))}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#6366f1', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Send size={15} /> Submit for Approval
                        </button>
                    )}
                    <button onClick={() => setShowExport(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#22c55e', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        <Download size={15} /> Export <ChevronDown size={14} />
                    </button>
                    {!isLocked
                        ? <button onClick={handleLock} title="Lock payroll — mark as bank-processed" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f59e0b', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Lock size={15} /> Lock Payroll
                          </button>
                        : <button onClick={handleUnlock} title="Unlock payroll to allow edits" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Unlock size={15} /> Unlock
                          </button>}
                </div>
            </div>

            {/* Bulk action bar — shown when any rows are selected */}
            {selectedIds.size > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: '10px', padding: '0.75rem 1.25rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: 'var(--primary)', fontSize: '0.9rem' }}>
                        <CheckSquare size={18} /> {selectedIds.size} selected
                    </div>
                    <div style={{ height: '20px', width: '1px', background: 'var(--border)' }} />
                    <button onClick={() => { setShowBulkSMS(true); setBulkSMSMsg(''); setBulkSMSResult(null); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', padding: '5px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                        <MessageSquare size={15} /> Send SMS
                    </button>
                    <button onClick={generatePayslips}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', padding: '5px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                        <FileTextIcon size={15} /> Generate Payslips
                    </button>
                    <button onClick={exportBankSelected}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa', padding: '5px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                        <CreditCardIcon size={15} /> Export Bank File
                    </button>
                    <button onClick={() => setSelectedIds(new Set())}
                        style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}>
                        Clear Selection
                    </button>
                </div>
            )}

            {/* Bulk SMS Modal */}
            {showBulkSMS && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '2rem' }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '520px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                            <div>
                                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><MessageSquare size={18} color="#22c55e" /> Bulk Payroll SMS</h3>
                                <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.83rem' }}>Sending to {selectedIds.size} employee(s) for {month}</p>
                            </div>
                            <button onClick={() => setShowBulkSMS(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                        </div>
                        <div style={{ padding: '1.5rem 2rem' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '1rem' }}>
                                {[
                                    { label: 'Salary Processed', text: `Dear {name}, your salary for the month of ${month} has been processed. Net amount: Rs. {netPay}. Please verify your bank account. - ASIL` },
                                    { label: 'Visa Status Update', text: `Dear {name}, your employment & visa status has been reviewed. Please contact HR for further details. - Allied Services International` },
                                    { label: 'Report to Office', text: `Dear {name}, please report to the ASIL Head Office at your earliest convenience. Bring your original CNIC. - HR Department` },
                                ].map(t => (
                                    <button key={t.label} onClick={() => setBulkSMSMsg(t.text)}
                                        style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-dark)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem' }}>{t.label}</button>
                                ))}
                            </div>
                            <div style={{ marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Message (use {name} and {netPay} as placeholders)</div>
                            <textarea value={bulkSMSMsg} onChange={e => setBulkSMSMsg(e.target.value.slice(0, 160))}
                                rows={5} style={{ width: '100%', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px', color: 'var(--text)', fontSize: '0.88rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>{bulkSMSMsg.length}/160 characters</div>
                            {bulkSMSResult && (
                                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: '8px', background: bulkSMSResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${bulkSMSResult.ok ? '#22c55e' : '#ef4444'}`, fontSize: '0.82rem', color: bulkSMSResult.ok ? '#22c55e' : '#f87171' }}>
                                    {bulkSMSResult.msg}
                                </div>
                            )}
                        </div>
                        <div style={{ padding: '0 2rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button onClick={() => setShowBulkSMS(false)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Close</button>
                            <button onClick={sendBulkSMS} disabled={bulkSMSSending || !bulkSMSMsg.trim()}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: bulkSMSSending ? '#555' : '#22c55e', border: 'none', color: 'white', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: bulkSMSSending ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
                                <MessageSquare size={15} /> {bulkSMSSending ? 'Sending…' : `Send to ${selectedIds.size} Employee(s)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Lock Banner */}
            {isLocked && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '10px', padding: '0.85rem 1.25rem', marginBottom: '1.25rem' }}>
                    <Lock size={16} color="#f87171" />
                    <span style={{ fontSize: '0.9rem', color: '#f87171' }}>
                        <strong>Payroll Locked</strong> — This payroll has been sent to the bank for processing.
                        {lockedBy && <span style={{ opacity: 0.8 }}> Locked by {lockedBy}.</span>}
                        {' '}No edits allowed. Click <strong>Unlock</strong> to re-open.
                    </span>
                </div>
            )}

            {approvalSent[month] && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(99,102,241,0.1)', border: '1px solid #6366f1', borderRadius: '10px', padding: '0.85rem 1.25rem', marginBottom: '1.25rem' }}>
                    <Send size={16} color="#6366f1" />
                    <span style={{ fontSize: '0.9rem' }}>Payroll <strong>{month}</strong> submitted. Status: <strong style={{ color: '#6366f1' }}>{approvalSent[month]}</strong></span>
                    {approvalSent[month] !== 'Approved' && <button onClick={() => setApprovalSent(p => ({ ...p, [month]: 'Approved' }))} style={{ marginLeft: 'auto', background: '#22c55e', border: 'none', color: 'white', padding: '4px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Mark Approved</button>}
                </div>
            )}

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    { l: 'Employees', v: rows.length, c: 'var(--primary)', s: 'In this run' },
                    { l: 'Total Gross Pay', v: Rs(T.grossMonthly), c: '#22c55e', s: 'Before deductions' },
                    { l: 'Total Net Pay', v: Rs(T.netPay), c: '#22c55e', s: 'Take-home' },
                    { l: 'Total Payroll Cost', v: Rs(T.totalPayrollCost), c: '#a78bfa', s: 'Gross + employer costs' },
                    { l: 'Total Invoice', v: Rs(T.totalInvoice), c: '#f59e0b', s: 'Incl. svc charges + ST' },
                ].map(c => (
                    <div key={c.l} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '5px' }}>{c.l}</div>
                        <div style={{ fontWeight: 800, fontSize: '1rem', color: c.c }}>{c.v}</div>
                        <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '3px' }}>{c.s}</div>
                    </div>
                ))}
            </div>

            {/* Table */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', marginBottom: '1.25rem' }}>
                <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', position: 'relative' }}>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: '2500px' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                            <tr style={{ background: '#0f1823' }}>
                                {/* Select-all checkbox header */}
                                <th style={{ position: 'sticky', left: 0, zIndex: 4, background: '#0f1823', padding: '6px 8px', width: '36px' }}>
                                    <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                                </th>
                                {/* Sticky group: EMPLOYEE col */}
                                <th style={{ position: 'sticky', left: 36, zIndex: 3, background: '#0f1823', padding: '6px', minWidth: '180px' }} />
                                {/* Sticky group: CONTRACT col */}
                                <th style={{ position: 'sticky', left: 216, zIndex: 3, background: '#0f1823', padding: '6px', minWidth: '140px' }} />
                                {/* Sticky group: SALARY col */}
                                <th style={{ position: 'sticky', left: 356, zIndex: 3, background: '#0f1823', padding: '6px', minWidth: '80px', borderRight: '2px solid var(--border)' }} />
                                <th colSpan={9} style={{ padding: '6px', textAlign: 'center', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase' }}>EARNINGS (blue = editable)</th>
                                <th style={{ padding: '6px', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontSize: '0.68rem', fontWeight: 800, borderLeft: '2px solid var(--border)', borderRight: '2px solid var(--border)', whiteSpace: 'nowrap' }}>GROSS</th>
                                <th colSpan={6} style={{ padding: '6px', textAlign: 'center', background: 'rgba(244,63,94,0.08)', color: '#f43f5e', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase' }}>DEDUCTIONS</th>
                                <th style={{ padding: '6px', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontSize: '0.68rem', fontWeight: 800, borderLeft: '2px solid var(--border)', borderRight: '2px solid var(--border)', whiteSpace: 'nowrap' }}>NET PAY</th>
                                <th colSpan={9} style={{ padding: '6px', textAlign: 'center', background: 'rgba(167,139,250,0.08)', color: '#a78bfa', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase' }}>EMPLOYER ADD-ONS</th>
                                <th colSpan={3} style={{ padding: '6px', textAlign: 'center', background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase' }}>INVOICE</th>
                            </tr>
                            <tr style={{ background: 'var(--bg-dark)', borderBottom: '2px solid var(--border)' }}>
                                <th style={{ position: 'sticky', left: 0, zIndex: 4, background: 'var(--bg-dark)', padding: '7px 8px', width: '36px' }} />
                                <th style={{ position: 'sticky', left: 36, zIndex: 3, background: 'var(--bg-dark)', padding: '7px 10px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: '180px' }}>EMPLOYEE</th>
                                <th style={{ position: 'sticky', left: 216, zIndex: 3, background: 'var(--bg-dark)', padding: '7px 6px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: '140px' }}>CONTRACT</th>
                                <th style={{ position: 'sticky', left: 356, zIndex: 3, background: 'var(--bg-dark)', padding: '7px 6px', textAlign: 'right', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap', borderRight: '2px solid var(--border)', minWidth: '80px' }}>SALARY</th>
                                <TH label="Pd Days" sub="Edit" /><TH label="OT @2×" sub="Hrs" /><TH label="OT @3×" sub="Hrs" />
                                <TH label="OT Amt" sub="Auto" /><TH label="OPD" sub="Edit" /><TH label="Reimb" sub="Edit" />
                                <TH label="Arrears" sub="Edit" /><TH label="Spl Allow" sub="Edit" /><TH label="Fuel/Mob" sub="Edit" />
                                <TH label="Oth Allow" sub="Auto" />
                                <TH label="GROSS" color="#22c55e" sub="Auto" />
                                <TH label="Inc Tax" color="#f43f5e" sub="FBR" /><TH label="EOBI EE" sub="1%" /><TH label="PF EE" sub="8.33%" />
                                <TH label="Adv" sub="Edit" /><TH label="Loan" sub="Edit" /><TH label="Oth Ded" sub="Edit" />
                                <TH label="NET PAY" color="#22c55e" />
                                <TH label="EOBI ER" sub="5%" /><TH label="SESSI" /><TH label="Gratuity" sub="Auto" />
                                <TH label="Life Ins" /><TH label="Med EE" sub="Edit" /><TH label="Med SP" sub="Edit" />
                                <TH label="Med Ch1" sub="Edit" /><TH label="Med Ch2" sub="Edit" />
                                <TH label="Bonus" sub="Edit" /><TH label="PF ER" sub="8.33%" />
                                <TH label="Tot Cost" color="#a78bfa" />
                                <TH label="Svc Chg" color="#f59e0b" /><TH label="Sales Tax" /><TH label="INVOICE" color="#f59e0b" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(({ emp, calc }, i) => {
                                const rowBg = selectedIds.has(emp.id) ? 'rgba(56,189,248,0.07)' : (i % 2 === 0 ? 'var(--bg-card)' : '#171c28');
                                return (
                                    <tr key={emp.id} style={{ borderBottom: '1px solid var(--border)', background: rowBg }}>
                                        <td style={{ position: 'sticky', left: 0, zIndex: 3, background: rowBg, padding: '6px 8px', width: '36px' }}>
                                            <input type="checkbox" checked={selectedIds.has(emp.id)} onChange={() => toggleSelect(emp.id)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                                        </td>
                                        <td style={{ position: 'sticky', left: 36, zIndex: 2, background: rowBg, padding: '6px 10px', minWidth: '180px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <button onClick={() => setBreakdown({ emp, calc })} title="Verify calculation"
                                                    style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '4px', padding: '2px 6px', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                    Verify
                                                </button>
                                                <div><div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{emp.name}</div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{emp.designation}</div></div>
                                            </div>
                                        </td>
                                        <td style={{ position: 'sticky', left: 216, zIndex: 2, background: rowBg, padding: '6px 7px', fontSize: '0.74rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: '140px' }}>{emp.contract}<br /><span style={{ fontSize: '0.68rem' }}>{emp.location}</span></td>
                                        <td style={{ position: 'sticky', left: 356, zIndex: 2, background: rowBg, padding: '6px 7px', textAlign: 'right', fontWeight: 600, borderRight: '2px solid var(--border)', whiteSpace: 'nowrap', fontSize: '0.82rem', minWidth: '80px' }}>{fmt(emp.gross)}</td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="paid_days" def={workDays} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="ot2_hrs" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="ot3_hrs" def={0} /></td>
                                        <RC val={calc.otAmount} muted={!calc.otAmount} />
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="opd_claim" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="reimbursement" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="arrears" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="special_allowance" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="fuel_mobile" def={0} /></td>
                                        <RC val={calc.otherPaid} muted />
                                        <RC val={calc.grossMonthly} pos bold />
                                        <RC val={calc.incomeTax} neg={calc.incomeTax > 0} />
                                        <RC val={calc.eobi_ee} neg />
                                        <RC val={calc.pfEE} neg={calc.pfEE > 0} muted={!calc.pfEE} />
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="advance_deduction" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="loan_deduction" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="other_deduction" def={0} /></td>
                                        <RC val={calc.netPay} pos bold />
                                        <RC val={calc.eobi_er} /><RC val={calc.sessi} /><RC val={calc.gratuity} /><RC val={calc.lifeIns} />
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="medical_ee" def={calc.medEE} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="medical_sp" def={calc.medSP} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="medical_ch1" def={calc.medCh1} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="medical_ch2" def={calc.medCh2} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="bonus_amount" def={0} /></td>
                                        <RC val={calc.pfER} muted={!calc.pfER} />
                                        <RC val={calc.totalPayrollCost} bold style={{ color: '#a78bfa' }} />
                                        <RC val={calc.serviceCharges} /><RC val={calc.salesTax} />
                                        <RC val={calc.totalInvoice} bold />
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr style={{ background: 'var(--bg-dark)', borderTop: '2px solid var(--border)', fontWeight: 700, fontSize: '0.82rem' }}>
                                <td style={{ position: 'sticky', left: 0, zIndex: 4, background: 'var(--bg-dark)', padding: '9px 8px', width: '36px' }} />
                                <td colSpan={3} style={{ position: 'sticky', left: 36, zIndex: 2, background: 'var(--bg-dark)', padding: '9px 10px', borderRight: '2px solid var(--border)' }}>TOTALS — {rows.length} employees</td>
                                <td colSpan={3} /><td style={{ padding: '9px 7px', textAlign: 'right', color: '#22c55e' }}>{fmt(T.otAmount)}</td>
                                <td colSpan={5} />
                                <td style={{ padding: '9px 7px', textAlign: 'right', color: '#22c55e' }}>{fmt(T.grossMonthly)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right', color: '#f43f5e' }}>{fmt(T.incomeTax)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right' }}>{fmt(T.eobi_ee)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right' }}>{fmt(T.pfEE)}</td>
                                <td colSpan={3} />
                                <td style={{ padding: '9px 7px', textAlign: 'right', color: '#22c55e' }}>{fmt(T.netPay)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right' }}>{fmt(T.eobi_er)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right' }}>{fmt(T.sessi)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right' }}>{fmt(T.gratuity)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right' }}>{fmt(T.lifeIns)}</td>
                                <td colSpan={5} />
                                <td style={{ padding: '9px 7px', textAlign: 'right', color: '#a78bfa' }}>{fmt(T.totalPayrollCost)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right' }}>{fmt(T.serviceCharges)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right' }}>{fmt(T.salesTax)}</td>
                                <td style={{ padding: '9px 7px', textAlign: 'right', color: '#f59e0b' }}>{fmt(T.totalInvoice)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem 1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <strong>Formulas:</strong> Gross = Basic(paid) + Allowances(pro-rata) + OT | WHT = FBR 2025-26 slabs ÷ 12 |
                EOBI = Flat <strong>Rs. 400 (EE) / Rs. 2,000 (ER)</strong> for all employees |
                SESSI = <strong>6% of gross</strong>, only where gross &lt; Rs. 45,000 (exempt above) |
                PF = 8.33% of Basic (if enrolled) | Gratuity = (Gross÷26)×30÷12 | Total Payroll Cost = Gross + employer obligations |
                Service Charges on Total Payroll Cost | Sales Tax on Service Charges only. Click <strong>Verify</strong> on any row for full step-by-step breakdown.
            </div>

            {breakdown && <BreakdownPanel emp={breakdown.emp} calc={breakdown.calc} workDays={workDays} onClose={() => setBreakdown(null)} />}
            {showExport && <ExportMenu rows={rows} month={month} onClose={() => setShowExport(false)} />}
            {showImport && <ImportModal onApply={applyImport} onClose={() => setShowImport(false)} employees={EMPLOYEES} workDays={workDays} />}
        </div>
    );
}
