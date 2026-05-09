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
function BreakdownPanel({ emp, calc, cfg, workDays, onClose }) {
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
    // cfg: contract config for this employee — provides bonus_months, overhead_per_employee, service_charges_pct etc.
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1100, padding: '2rem', overflowY: 'auto' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '720px', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <h3 style={{ margin: 0 }}>Payroll Verification — {emp.name}</h3>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{emp.id} · {emp.contract} · OT Rate: Gross÷208hrs</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
                </div>
                <div style={{ padding: '1.75rem 2rem' }}>
                    <S title="Earnings" color="#22c55e">
                        <R label="Basic" value={calc.basicPaid} />
                        {calc.hraPaid > 0 && <R label="HRA" value={calc.hraPaid} />}
                        {calc.convPaid > 0 && <R label="Conveyance" value={calc.convPaid} />}
                        {calc.medPaid > 0 && <R label="Medical Allowance" value={calc.medPaid} />}
                        {calc.otherPaid > 0 && <R label="Other Allowances" value={calc.otherPaid} />}
                        {calc.absentDays > 0 && <R label={`Absence Deduction (${calc.absentDays} days)`} formula={`Gross ${fmt(calc.hrlyGross ? calc.hrlyGross*208 : 0)} ÷ 26 × ${calc.absentDays}`} value={-calc.absenceDeduction} color="#f43f5e" />}
                        {calc.ot2hrs > 0 && <R label={`OT @2× (${calc.ot2hrs} hrs)`} formula={`Gross÷208 × 2 × ${calc.ot2hrs}`} value={calc.ot2Amount} />}
                        {calc.ot3hrs > 0 && <R label={`OT @3× (${calc.ot3hrs} hrs)`} formula={`Gross÷208 × 3 × ${calc.ot3hrs}`} value={calc.ot3Amount} />}
                        {calc.opdClaim > 0 && <R label="OPD Claim" value={calc.opdClaim} />}
                        {calc.reimb > 0 && <R label="Reimbursements" value={calc.reimb} />}
                        {calc.arrears > 0 && <R label="Arrears" value={calc.arrears} />}
                        {calc.splAllow > 0 && <R label="Special Allowance" value={calc.splAllow} />}
                        {calc.fuelMob > 0 && <R label="Fuel/Mobile" value={calc.fuelMob} />}
                        <D label="Gross Monthly" value={calc.grossMonthly} color="#22c55e" />
                    </S>
                    <S title="Employee Deductions" color="#f43f5e">
                        <R label="Income Tax (WHT)" formula={`Taxable Annual Rs.${fmt(calc.taxableMonthly*12)} → FBR 2025-26 ÷ 12`} value={calc.incomeTax} color="#f43f5e" />
                        <R label="EOBI Employee — Fixed" formula="1% × Rs. 40,000 (statutory minimum wage)" value={calc.eobi_ee} />
                        {emp.pf_enrolled && <R label="PF Employee (Gross ÷ 24)" formula={`${fmt(emp.gross || 0)} ÷ 24`} value={calc.pfEE} />}
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
                        <R label="Gratuity (monthly accrual — Employer only)" formula={`Base Salary ÷ 12  (8.33% of contractual base — per EOB Ord 1968)`} value={calc.gratuity} />
                        <R label="Life Insurance" value={calc.lifeIns} />
                        <R label="Medical — Employee" value={calc.medEE} />
                        {calc.medSP > 0 && <R label="Medical — Spouse" value={calc.medSP} />}
                        {calc.medCh1 > 0 && <R label="Medical — Child 1" value={calc.medCh1} />}
                        {calc.medCh2 > 0 && <R label="Medical — Child 2" value={calc.medCh2} />}
                        {(emp.pf_enrolled || calc.pfER > 0) && <R label="PF Employer Match (Gross ÷ 24)" formula={`Gross ÷ 24 ≈ 4.17%`} value={calc.pfER} />}
                        <R label={`Bonus Accrual (${cfg.bonus_months ?? 0} month${cfg.bonus_months !== 1 ? 's' : ''}/yr)`} formula={`${cfg.bonus_months ?? 0} × Gross ÷ 12`} value={calc.bonusAccrual} muted={!calc.bonusAccrual} />
                        {calc.bonusAmount > 0 && <R label="Bonus (Cash — this month)" value={calc.bonusAmount} />}
                        <R label={`Overhead (Fixed — Rs.${cfg.overhead_per_employee || 0}/head)`} formula="Fixed per-head charge from contract" value={calc.overhead} muted={!calc.overhead} />
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
                    // Strip commas from formatted numbers e.g. "10,000" → 10000
                    const n = (v) => parseFloat(String(v || '').replace(/,/g, '')) || 0;
                    const presentDays = obj['Present Days'] !== undefined && obj['Present Days'] !== ''
                        ? Math.min(n(obj['Present Days']) || workDays, workDays)
                        : workDays;
                    const leaveDays = workDays - presentDays;
                    rows.push({
                        empId:             match.id,
                        paid_days:         presentDays,
                        ot2_hrs:           n(obj['OT Hrs @ 2X']),
                        ot3_hrs:           n(obj['OT Hrs @ 3X']),
                        opd_claim:         n(obj['OPD']),
                        reimbursement:     n(obj['Expense Reimbursement']),
                        arrears:           n(obj['Arrears']),
                        bonus_amount:      n(obj['Bonus']),
                        special_allowance: n(obj['Special Allowance']),
                        fuel_mobile:       n(obj['Other Allowance Fuel | Mobile']),
                        other_deduction:   n(obj['Other Deduction']),
                        contract_name:     obj['Contract Name'] || '',
                    });
                    prev.push({
                        name: match.name, id: match.id,
                        presentDays, leaveDays,
                        ot2: obj['OT Hrs @ 2X'] || 0, ot3: obj['OT Hrs @ 3X'] || 0,
                        opd: n(obj['OPD']), reimb: n(obj['Expense Reimbursement']),
                        arrears: n(obj['Arrears']), bonus: n(obj['Bonus']),
                        splAllow: n(obj['Special Allowance']),
                        fuelMob: n(obj['Other Allowance Fuel | Mobile']),
                        otherDed: n(obj['Other Deduction']),
                        contractName: obj['Contract Name'] || '',
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
            'ASIL Employee Code': 'EMP-2026-201', 'Contract Name': 'Security Services LMT',
            'Present Days': '26',
            'OT Hrs @ 2X': '8', 'OT Hrs @ 3X': '0',
            'OPD': '0', 'Expense Reimbursement': '0', 'Arrears': '0',
            'Special Allowance': '0', 'Other Allowance Fuel | Mobile': '0', 'Other Deduction': '0',
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
                                        <tr>{['Employee', 'ID', 'Contract', 'Pres.Days', 'OT@2X','OT@3X','OPD','Reimb.','Arrears','Spl.Allow','Fuel/Mob','OtherDed'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {preview.map((r, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: r.leaveDays > 0 ? 'rgba(239,68,68,0.05)' : undefined }}>
                                                <td style={{ padding: '7px 8px', fontWeight: 600 }}>{r.name}</td>
                                                <td style={{ padding: '7px 8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.id}</td>
                                                <td style={{ padding: '7px 8px', fontSize: '0.72rem', color: r.contractName ? 'var(--primary)' : 'var(--text-muted)' }}>{r.contractName || '—'}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.presentDays}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.ot2}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.ot3}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(r.opd)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(r.reimb)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(r.arrears)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right', color: r.splAllow > 0 ? '#22c55e' : 'var(--text-muted)' }}>{fmt(r.splAllow)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right', color: r.fuelMob > 0 ? '#22c55e' : 'var(--text-muted)' }}>{fmt(r.fuelMob)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right', color: r.otherDed > 0 ? '#ef4444' : 'var(--text-muted)' }}>{fmt(r.otherDed)}</td>
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
function ExportMenu({ month, isLocked, filterClient, filterContract, filterLoc, onClose }) {
    const [yr, mo] = month.split('-');
    const dlExport = async (type) => {
        if (!isLocked && !['payroll'].includes(type)) {
            alert('Payroll must be locked before exporting bank files.');
            return;
        }
        const API_URL = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
        const token = localStorage.getItem('asil_hcm_token');
        // Build query string with active filters so server respects them
        const params = new URLSearchParams({ type });
        if (filterClient && filterClient !== 'All') params.set('client', filterClient);
        if (filterContract && filterContract !== 'All') params.set('contract', filterContract);
        if (filterLoc && filterLoc !== 'All') params.set('location', filterLoc);
        try {
            const res = await fetch(`${API_URL}/api/payroll/${yr}/${mo}/export?${params.toString()}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) { alert('Export failed: ' + res.status); return; }
            // Handle JSON message (e.g. no locked rows)
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                const d = await res.json();
                alert(d.msg || d.message || 'No data to export.');
                return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const cd = res.headers.get('content-disposition') || '';
            const fname = cd.match(/filename="([^"]+)"/)?.[1] || `export_${type}_${yr}-${mo}.csv`;
            a.href = url; a.download = fname;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
        } catch(e) { alert('Export error: ' + e.message); }
    };
    const opts = [
        { label: '📊 Full Payroll CSV', sub: `All columns — ${filterClient !== 'All' ? filterClient : 'all clients'}${filterContract !== 'All' ? ` · ${filterContract}` : ''}`, fn: () => dlExport('payroll') },
        { label: '🏦 HBL → HBL Transfers', sub: 'Net Pay for HBL account holders (🔒 locked rows only)', fn: () => dlExport('hbl_same'), needsLock: true },
        { label: '🏦 HBL → Other Banks (IBFT)', sub: 'Net Pay for non-HBL accounts (🔒 locked rows only)', fn: () => dlExport('hbl_other'), needsLock: true },
        { label: '📋 WHT Returns (FBR)', sub: 'Taxable amount + tax per employee for FBR', fn: () => dlExport('wht') },
        { label: '📋 EOBI Contributions', sub: 'Employee & employer EOBI per head', fn: () => dlExport('eobi') },
        { label: '📋 SESSI Contributions', sub: 'Employer SESSI contribution per head', fn: () => dlExport('sessi') },
        { label: '🧾 Xero Invoice CSV', sub: 'Xero-importable Sales Invoice CSV grouped by Client + Province (🔒 locked only)', fn: () => dlExport('xero'), needsLock: true },
        { label: '📈 Invoice Summary (AT:AW)', sub: 'Grouped totals: Net Pay, Total Payroll Cost, Service Charges, Sales Tax, Total Invoice (🔒 locked only)', fn: () => dlExport('invoice_summary'), needsLock: true },
    ];
    // Show active filter badge if any filter is set
    const hasFilter = (filterClient && filterClient !== 'All') || (filterContract && filterContract !== 'All') || (filterLoc && filterLoc !== 'All');
    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1050 }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: '140px', right: '2rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', minWidth: '360px', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
                <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em' }}>Export Options — {month}</div>
                {hasFilter && (
                    <div style={{ padding: '0.6rem 1.25rem', background: 'rgba(56,189,248,0.08)', borderBottom: '1px solid rgba(56,189,248,0.2)', fontSize: '0.78rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        🔍 Filtered: {[filterClient !== 'All' && filterClient, filterContract !== 'All' && filterContract, filterLoc !== 'All' && filterLoc].filter(Boolean).join(' · ')}
                    </div>
                )}
                {!isLocked && (
                    <div style={{ padding: '0.65rem 1.25rem', background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.3)', fontSize: '0.78rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        ⚠️ Bank files are only available after payroll is <strong>locked</strong>.
                    </div>
                )}
                {opts.map(o => (
                    <button key={o.label} onClick={() => { o.fn(); onClose(); }}
                        disabled={o.needsLock && !isLocked}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.9rem 1.25rem', background: 'transparent', border: 'none', color: (o.needsLock && !isLocked) ? 'var(--text-muted)' : 'var(--text)', cursor: (o.needsLock && !isLocked) ? 'not-allowed' : 'pointer', borderBottom: '1px solid var(--border)', opacity: (o.needsLock && !isLocked) ? 0.5 : 1 }}
                        onMouseEnter={e => { if (!(o.needsLock && !isLocked)) e.currentTarget.style.background = 'var(--bg-dark)'; }}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
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
export default function PayrollSheet({ user }) {
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    const [month, setMonth] = useState(defaultMonth);
    const [workDays, setWorkDays] = useState(26);
    const [filterClient, setFilterClient] = useState('All');
    const [filterContract, setFilterContract] = useState('All');
    const [filterLoc, setFilterLoc] = useState('All');
    const [filterLockStatus, setFilterLockStatus] = useState('All'); // 'All' | 'Locked' | 'Unlocked'
    const [overrides, setOverrides] = useState({});
    const [breakdown, setBreakdown] = useState(null);
    const [approvalSent, setApprovalSent] = useState({});
    const [showExport, setShowExport] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [EMPLOYEES, setEMPLOYEES] = useState([]);
    const [CONTRACT_MAP, setCONTRACT_MAP] = useState({});
    // ── Lock / DB state ─────────────────────────────────────────────────────────
    const [lockedIds, setLockedIds] = useState(new Set()); // per-employee lock status
    const [lockedBy, setLockedBy] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const saveTimerRef = useRef(null);
    // ── Bulk selection state ────────────────────────────────────────────────────
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [showBulkSMS, setShowBulkSMS] = useState(false);
    const [bulkSMSMsg, setBulkSMSMsg] = useState('');
    const [bulkSMSSending, setBulkSMSSending] = useState(false);
    const [bulkSMSResult, setBulkSMSResult] = useState(null);

    const isSuperAdmin = user?.role === 'superadmin';
    const [PROVINCE_RATES, setPROVINCE_RATES] = useState([]); // from System Config Tax by Region
    const [invoiceStatus, setInvoiceStatus] = useState({ invoicedClients: [], invoicedContracts: [] });

    // ── Load contracts + employees + province tax rates in parallel ──
    useEffect(() => {
        Promise.all([
            api.getContracts(),
            api.getEmployees(),
            api.getConfig('region_tax').catch(() => null),
        ]).then(([ctData, empData, regRes]) => {
            // Load province tax rates from System Config
            if (regRes?.config?.value) setPROVINCE_RATES(regRes.config.value);

            // 1. Build CONTRACT_MAP first
            const map = {};
            (ctData.contracts || []).forEach(ct => {
                const cfg = {
                    id:                  ct.id,
                    service_charges_pct: parseFloat(ct.financials?.service_charges_pct) || 0,
                    sales_tax_pct:       parseFloat(ct.financials?.sales_tax_pct) || 0,
                    life_insurance:      parseFloat(ct.costs?.life_insurance) || 0,
                    medical_ee:          parseFloat(ct.costs?.medical_ee) || 0,
                    medical_sp:          parseFloat(ct.costs?.medical_sp) || 0,
                    medical_child:       parseFloat(ct.costs?.medical_child) || 0,
                    bonus_months:        parseFloat(ct.costs?.bonus_months) || 0,
                    bonus_min_months:    parseFloat(ct.costs?.bonus_min_months) || 12,
                    eosb_type:           ct.costs?.eosb_type || 'None',
                    overhead_per_employee: parseFloat(ct.costs?.overhead_per_employee) || 0,
                    _isActive:           ct.status === 'Active',
                };
                if (ct.id) map[ct.id] = cfg;
                const nameKey = ct.contractName?.toLowerCase()?.trim();
                if (nameKey && (!map[nameKey] || cfg._isActive)) map[nameKey] = cfg;
                const clientKey = ct.clientName?.toLowerCase()?.trim();
                if (clientKey && (!map[clientKey] || cfg._isActive)) map[clientKey] = cfg;
            });
            setCONTRACT_MAP(map);

            // 2. Map employees — CONTRACT_MAP is already built above
            const mapped = (empData.employees || []).map(e => {
                const gross = parseFloat(e.salary) || 0;
                const hasSpouse = !!(e.spouseName && String(e.spouseName).trim());
                const numChildren = [e.child1Name, e.child2Name].filter(n => n && String(n).trim()).length;
                return {
                    id: e.id, cnic: e.cnic, name: e.name,
                    designation: e.designation || '',
                    contractId:   e.contractId   || '',
                    contractName: e.contractName || '',
                    contract: e.contractName || e.clientBU || 'Standard',
                    location: e.location || '', client: e.client || '',
                    province: e.province || '',
                    gross,
                    basic:             parseFloat(e.basic) > 0 ? parseFloat(e.basic) : Math.round(gross * 0.60),
                    hra:               Math.round(gross * 0.20),
                    conveyance:        Math.round(gross * 0.10),
                    medical_allowance: Math.round(gross * 0.07),
                    other_allowances:  Math.round(gross * 0.03),
                    pf_enrolled: e.pf_enrolled || false,
                    bankAccount: e.bankAccount || '', bankName: e.bankName || '',
                    eobiNo: e.eobiNo || '', email: e.email || '',
                    contact: e.primaryContact || '',
                    doj: e.doj || '',
                    lwd: e.lastWorkingDay || '',
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
        setLockedIds(new Set());
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
            const lockedRowIds = data.rows.filter(r => r.locked).map(r => r.employee_id);
            setLockedIds(new Set(lockedRowIds));
            // Derive lockedBy from first locked row
            const firstLocked = data.rows.find(r => r.locked);
            if (firstLocked?.locked_by) setLockedBy(firstLocked.locked_by);
        }).catch(() => {}); // silently ignore if table not yet created
        // Also load invoice status for current month — drives INV ✓ badge
        api.getPayrollInvoiceStatus(yr, mo)
            .then(d => setInvoiceStatus(d || { invoicedClients: [], invoicedContracts: [] }))
            .catch(() => {});
    }, [month]);

    // ── Save rows to DB (debounced) ─────────────────────────────────────────────
    const saveToDb = useCallback((ovState, rowsData) => {
        if (rowsData.some(r => lockedIds.has(r.emp?.id))) return;
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
    }, [month, lockedIds]);

    const rowsRef = useRef([]);

    const setOv = (id, field, val) => {
        if (lockedIds.has(id)) return;
        setOverrides(p => ({ ...p, [id]: { ...(p[id] || {}), [field]: val } }));
        // Trigger debounced save after user edits
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
            const currentRows = rowsRef.current;
            if (!currentRows.length) return;
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

    // Generate payslips for selected - authenticated fetch → blob download (no popup blocker)
    const generatePayslips = async () => {
        if (!selectedRows.length) return alert('Select at least one employee.');
        const API_URL = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
        const token = localStorage.getItem('asil_hcm_token');
        for (const r of selectedRows) {
            const [yr2, mo2] = month.split('-');
            try {
                const res = await fetch(`${API_URL}/api/payslip/${encodeURIComponent(r.emp.id)}/${mo2}/${yr2}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) { alert(`Payslip error for ${r.emp.name}: HTTP ${res.status}`); continue; }
                const html = await res.text();
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Payslip_${r.emp.id}_${mo2}-${yr2}.html`;
                document.body.appendChild(a); a.click();
                document.body.removeChild(a); URL.revokeObjectURL(url);
            } catch(e) { alert(`Payslip error for ${r.emp.name}: ${e.message}`); }
        }
    };

    // Send payslips by email
    const [sendingEmails, setSendingEmails] = React.useState(false);
    const [emailResult, setEmailResult] = React.useState(null);
    const sendPayslipEmails = async () => {
        const targets = selectedIds.size > 0 ? [...selectedIds] : [];
        if (!window.confirm(`Send salary slip emails to ${targets.length ? targets.length + ' selected' : 'ALL'} employees for ${month}?`)) return;
        setSendingEmails(true); setEmailResult(null);
        try {
            const [yr2, mo2] = month.split('-');
            const res = await fetch(`/api/payroll/${yr2}/${mo2}/send-payslips`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeIds: targets }),
            });
            const d = await res.json();
            if (d.error) throw new Error(d.error);
            setEmailResult({ ok: true, msg: `✅ Sent to ${d.sent} employee(s)${d.failed?.length ? ` (⚠️ ${d.failed.length} failed)` : ''}.` });
        } catch(e) { setEmailResult({ ok: false, msg: '❌ ' + e.message }); }
        setSendingEmails(false);
    };

    // Cascading filter lists
    const allClients = ['All', ...new Set(EMPLOYEES.map(e => e.client))];
    const contractPool = filterClient === 'All' ? EMPLOYEES : EMPLOYEES.filter(e => e.client === filterClient);
    const allContracts = ['All', ...new Set(contractPool.map(e => e.contract))];
    const locPool = filterContract === 'All' ? contractPool : contractPool.filter(e => e.contract === filterContract);
    const allLocs = ['All', ...new Set(locPool.map(e => e.location))];

    const [yr, mo] = month.split('-').map(Number);
    const monthStart = new Date(yr, mo - 1, 1);          // 1st of payroll month
    const monthEnd   = new Date(yr, mo, 0);               // last day of payroll month

    // Filter employees for payroll:
    //   - Exclude if LWD is BEFORE the start of the payroll month (already left)
    //   - Exclude if DOJ is AFTER the end of the payroll month (not yet joined)
    const filtered = EMPLOYEES.filter(e => {
        if (e.lwd) {
            const lwdDate = new Date(e.lwd);
            if (lwdDate < monthStart) return false; // Left before this month
        }
        if (e.doj) {
            const dojDate = new Date(e.doj);
            if (dojDate > monthEnd) return false;   // Joins after this month
        }
        return (
            (filterClient === 'All' || e.client === filterClient) &&
            (filterContract === 'All' || e.contract === filterContract) &&
            (filterLoc === 'All' || e.location === filterLoc) &&
            (filterLockStatus === 'All' ||
             (filterLockStatus === 'Locked'   &&  lockedIds.has(e.id)) ||
             (filterLockStatus === 'Unlocked' && !lockedIds.has(e.id)))
        );
    });

    // isLocked = true only when ALL currently visible filtered rows are locked (and there are some)
    const isLocked = filtered.length > 0 && filtered.every(e => lockedIds.has(e.id));
    // Partial lock = some but not all locked in current view
    const isPartiallyLocked = !isLocked && filtered.some(e => lockedIds.has(e.id));

    // Contract cfg lookup: ID first (exact), then name, then client fuzzy fallback
    const rows = filtered.map(emp => {
        // 1. Primary: exact contract ID match (most precise)
        let cfg = emp.contractId && CONTRACT_MAP[emp.contractId];
        // 2. Contract name string match
        const contractKey = emp.contractName?.toLowerCase()?.trim();
        if (!cfg && contractKey) cfg = CONTRACT_MAP[contractKey];
        // 3. clientBU / contract label fuzzy fallback
        const buKey = emp.contract?.toLowerCase()?.trim();
        if (!cfg && buKey) cfg = CONTRACT_MAP[buKey];
        if (!cfg && buKey) {
            const _fk = Object.keys(CONTRACT_MAP).find(k => k.startsWith(buKey) || k.includes(buKey));
            if (_fk) cfg = CONTRACT_MAP[_fk];
        }
        // 4. Client name fallback (group-level)
        cfg = cfg || CONTRACT_MAP[emp.client?.toLowerCase()?.trim()];
        // Flag no-contract employees — they must be excluded from invoice calculation
        const noContract = !cfg;
        cfg = cfg || {};
        cfg._noContract = noContract;
        // Medical defaults from contract + employee family
        const defMedEE    = cfg.medical_ee    || 0;
        const defMedSP    = emp.hasSpouse ? (cfg.medical_sp || 0) : 0;
        const defMedCh1   = emp.numChildren >= 1 ? (cfg.medical_child || 0) : 0;
        const defMedCh2   = emp.numChildren >= 2 ? (cfg.medical_child || 0) : 0;

        // ── Pro-rata paid days for new joiners ───────────────────────────────
        // If the employee's DOJ falls within the current payroll month, default
        // paid_days to the number of calendar days worked that month.
        // Formula: days_worked = (lastDayOfMonth - doj + 1); paid_days = days_worked
        // This maps to the business rule: salary = (days_worked / total_days) × gross
        // The calcEmployeeRow engine uses paid_days vs workDays to compute absence deduction.
        let defPaidDays = workDays;
        let calDaysWorked = null;
        let totalCalDays = null;
        if (emp.doj) {
            const [yr, mo] = month.split('-').map(Number);
            const dojDate  = new Date(emp.doj);
            const dojYear  = dojDate.getFullYear();
            const dojMonth = dojDate.getMonth() + 1;
            if (dojYear === yr && dojMonth === mo) {
                // Calendar days in this month
                totalCalDays = new Date(yr, mo, 0).getDate();
                // Days from joining to end of month (inclusive of joining day)
                calDaysWorked = totalCalDays - dojDate.getDate() + 1;
                // Convert to working-day equivalent (pro-rated against workDays)
                defPaidDays = Math.round((calDaysWorked / totalCalDays) * workDays);
            }
        }
        const ov = {
            paid_days:        getOv(emp.id, 'paid_days', defPaidDays),
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
            // Runtime only — used by calcEmployeeRow for joining-month pro-rata (not saved to DB)
            ...(calDaysWorked !== null ? { calDaysWorked, totalCalDays } : {}),
        };
        // Expose current payroll month to calcEmployeeRow for bonus disbursement logic
        if (typeof window !== 'undefined') window.__payrollMonth = month;
        return { emp, cfg, calc: calcEmployeeRow(emp, ov, cfg, workDays, PROVINCE_RATES), ov };


    });
    // Keep ref in sync so the debounced setOv save always uses current calculations
    rowsRef.current = rows;

    // Bulk helpers — placed HERE so filtered + rows are already defined
    const allSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));
    const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(filtered.map(e => e.id)));
    const selectedRows = rows.filter(r => selectedIds.has(r.emp.id));

    const T = rows.reduce((acc, { calc, ov }) => {
        // Calculated fields
        ['grossMonthly','incomeTax','eobi_ee','pfEE','totalDeductions','netPay',
            'eobi_er','sessi','gratuity','lifeIns','totalMedical','totalPayrollCost',
            'serviceCharges','salesTax','totalInvoice','otAmount','otherPaid','pfER',
            'bonusAccrual','overhead'].forEach(k => {
            acc[k] = (acc[k] || 0) + (calc[k] || 0);
        });
        // Override / editable fields
        ['paid_days','ot2_hrs','ot3_hrs','opd_claim','reimbursement','arrears',
            'special_allowance','fuel_mobile','advance_deduction','loan_deduction',
            'other_deduction','medical_ee','medical_sp','medical_ch1','medical_ch2',
            'bonus_amount'].forEach(k => {
            acc[k] = (acc[k] || 0) + (parseFloat(ov[k]) || 0);
        });
        return acc;
    }, {});

    const applyImport = async (parsed) => {
        const newOv = { ...overrides };
        const importedIds = new Set();
        parsed.forEach(({ empId, ...fields }) => {
            newOv[empId] = { ...(newOv[empId] || {}), ...fields };
            importedIds.add(empId);
        });
        setOverrides(newOv);
        // Save ONLY the employees that were in the import CSV — never overwrite others
        try {
            const [yr, mo] = month.split('-');
            const payload = filtered
                .filter(emp => importedIds.has(emp.id))
                .map(emp => {
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
            if (payload.length > 0) {
                await api.savePayroll(yr, mo, payload);
                console.log(`Import saved ${payload.length} employees to DB`);
            }
        } catch (e) { console.warn('Import save failed:', e.message); }
    };


    const canManageLock = isSuperAdmin || user?.role === 'finance_approver';

    const handleLock = async () => {
        // Only lock the IDs that are currently VISIBLE (filtered) and NOT yet locked
        const toLock = rows.filter(r => !lockedIds.has(r.emp.id)).map(r => r.emp.id);
        const scopeLabel = filterClient !== 'All'
            ? `${filterClient}${filterContract !== 'All' ? ' / ' + filterContract : ''}`
            : 'all visible';
        if (!toLock.length) { alert('All visible employees are already locked.'); return; }
        if (!window.confirm(
            `Lock payroll for ${toLock.length} employee(s) under "${scopeLabel}"?\n\n` +
            `Only these ${toLock.length} records will be locked.\n` +
            `Other clients/contracts remain editable.\n\n` +
            `Exports will only include locked records.`
        )) return;
        try {
            const [yr, mo] = month.split('-');
            await api.lockPayroll(yr, mo, toLock);
            setLockedIds(prev => new Set([...prev, ...toLock]));
            setLockedBy('You');
        } catch (e) { alert('Lock failed: ' + e.message); }
    };

    const handleUnlock = async () => {
        // Only unlock the IDs that are currently VISIBLE (filtered) and are locked
        const toUnlock = rows.filter(r => lockedIds.has(r.emp.id)).map(r => r.emp.id);
        const scopeLabel = filterClient !== 'All'
            ? `${filterClient}${filterContract !== 'All' ? ' / ' + filterContract : ''}`
            : 'all visible';
        if (!toUnlock.length) { alert('No locked employees in current view.'); return; }
        if (!window.confirm(`Unlock payroll for ${toUnlock.length} employee(s) under "${scopeLabel}"?\n\nThis means the bank has NOT yet processed this batch.`)) return;
        try {
            const [yr, mo] = month.split('-');
            await api.unlockPayroll(yr, mo, toUnlock);
            setLockedIds(prev => { const next = new Set(prev); toUnlock.forEach(id => next.delete(id)); return next; });
        } catch (e) { alert('Unlock failed: ' + e.message); }
    };

    const needsApproval = rows.some(r => r.cfg.client_approval);

    // Editable cell — disabled when this employee is locked
    const EC = ({ empId, field, def = 0, w = '68px' }) => {
        const cellLocked = lockedIds.has(empId);
        return (
            <input type="number" min={0} step="any" value={getOv(empId, field, def)}
                disabled={cellLocked}
                onChange={e => {
                    if (cellLocked) return;
                    setOv(empId, field, e.target.value);
                }}
                style={{ width: w, background: cellLocked ? 'transparent' : 'rgba(56,189,248,0.07)', border: cellLocked ? 'none' : '1px solid rgba(56,189,248,0.2)', borderRadius: '4px', padding: '3px 5px', color: 'var(--text)', fontSize: '0.78rem', textAlign: 'right', outline: 'none', cursor: cellLocked ? 'not-allowed' : 'text', opacity: cellLocked ? 0.7 : 1 }} />
        );
    };
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
                    {/* Lock status filter */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Lock:</span>
                        {['All','Locked','Unlocked'].map(opt => (
                            <button key={opt} onClick={() => setFilterLockStatus(opt)}
                                style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: '6px', cursor: 'pointer', fontWeight: filterLockStatus === opt ? 700 : 400,
                                    background: filterLockStatus === opt ? (opt==='Locked' ? 'rgba(239,68,68,0.15)' : opt==='Unlocked' ? 'rgba(34,197,94,0.12)' : 'var(--primary)') : 'transparent',
                                    border: filterLockStatus === opt ? (opt==='Locked' ? '1px solid rgba(239,68,68,0.4)' : opt==='Unlocked' ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--primary)') : '1px solid var(--border)',
                                    color: filterLockStatus === opt ? (opt==='Locked' ? '#f87171' : opt==='Unlocked' ? '#22c55e' : 'white') : 'var(--text-muted)' }}>
                                {opt === 'Locked' ? '🔒' : opt === 'Unlocked' ? '🔓' : ''} {opt}
                            </button>
                        ))}
                    </div>
                    {(filterClient !== 'All' || filterContract !== 'All' || filterLoc !== 'All' || filterLockStatus !== 'All') &&
                        <button onClick={() => { setFilterClient('All'); setFilterContract('All'); setFilterLoc('All'); setFilterLockStatus('All'); }}
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
                    <button onClick={() => setShowExport(v => !v)}
                        title={isLocked ? 'Export options' : 'Export payroll CSV (lock first for bank files)'}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: isLocked ? '#22c55e' : 'var(--primary)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                        <Download size={15} /> Export <ChevronDown size={14} />
                    </button>
                    {canManageLock && !isLocked && (
                        <>
                            {emailResult && <span style={{ fontSize: '0.8rem', color: emailResult.ok ? '#22c55e' : '#ef4444', marginRight: '0.5rem' }}>{emailResult.msg}</span>}
                            <button onClick={sendPayslipEmails} disabled={sendingEmails} style={{ background: '#7c3aed', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px', opacity: sendingEmails ? 0.6 : 1 }}>
                                {sendingEmails ? '📧 Sending...' : '📧 Send Payslips'}
                            </button>
                            <button onClick={handleLock} title={`Lock ${rows.length} visible employee(s)`} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f59e0b', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                                <Lock size={15} /> Lock Payroll ({rows.length})
                            </button>
                        </>
                    )}
                    {canManageLock && isLocked && (
                        <button onClick={handleUnlock} title="Unlock payroll to allow edits" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Unlock size={15} /> Unlock
                        </button>
                    )}
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

            {/* Lock Banner — scoped to current filter view */}
            {isLocked && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '10px', padding: '0.85rem 1.25rem', marginBottom: '1.25rem' }}>
                    <Lock size={16} color="#f87171" />
                    <span style={{ fontSize: '0.9rem', color: '#f87171' }}>
                        <strong>Payroll Locked</strong> — All {filtered.length} employees in this view have been sent to the bank.
                        {lockedBy && <span style={{ opacity: 0.8 }}> Locked by {lockedBy}.</span>}
                        {' '}No edits allowed. Click <strong>Unlock</strong> to re-open this batch.
                    </span>
                </div>
            )}
            {isPartiallyLocked && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: '10px', padding: '0.75rem 1.25rem', marginBottom: '1.25rem' }}>
                    <Lock size={16} color="#f59e0b" />
                    <span style={{ fontSize: '0.88rem', color: '#f59e0b' }}>
                        <strong>Partial Lock</strong> — {filtered.filter(e => lockedIds.has(e.id)).length} of {filtered.length} employees in this view are locked. Use <strong>Lock:</strong> filter to see only locked or unlocked rows.
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
                                <TH label="Bonus" sub="Edit" /><TH label="Bns Accr" sub="Auto" color="#f59e0b" /><TH label="Overhead" sub="Fixed" color="#f59e0b" /><TH label="PF ER" sub="8.33%" />
                                <TH label="Tot Cost" color="#a78bfa" />
                                <TH label="Svc Chg" color="#f59e0b" /><TH label="Sales Tax" /><TH label="INVOICE" color="#f59e0b" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(({ emp, cfg, calc }, i) => {
                                const isEmpLocked = lockedIds.has(emp.id);
                                const rowBg = selectedIds.has(emp.id) ? 'rgba(56,189,248,0.07)' : isEmpLocked ? 'rgba(239,68,68,0.04)' : (i % 2 === 0 ? 'var(--bg-card)' : '#171c28');
                                // ── NO CONTRACT WARNING ROW ──────────────────────────────────────────
                                if (cfg._noContract) {
                                    return (
                                        <tr key={emp.id} style={{ borderBottom: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' }}>
                                            <td colSpan={2} style={{ padding: '8px 12px', position: 'sticky', left: 0, zIndex: 2, background: 'rgba(239,68,68,0.05)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <AlertCircle size={14} color="#ef4444" />
                                                    <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#f87171' }}>{emp.name}</span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{emp.designation}</span>
                                                </div>
                                            </td>
                                            <td colSpan={30} style={{ padding: '8px 12px' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', padding: '4px 12px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700 }}>
                                                    ⚠ NO CONTRACT ASSIGNED — Payroll calculation skipped. Go to Employee Profile → Employment tab to assign a contract.
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                }
                                return (
                                    <tr key={emp.id} style={{ borderBottom: '1px solid var(--border)', background: rowBg }}>
                                        <td style={{ position: 'sticky', left: 0, zIndex: 3, background: rowBg, padding: '6px 8px', width: '36px' }}>
                                            <input type="checkbox" checked={selectedIds.has(emp.id)} onChange={() => toggleSelect(emp.id)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                                        </td>
                                        <td style={{ position: 'sticky', left: 36, zIndex: 2, background: rowBg, padding: '6px 10px', minWidth: '180px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {isEmpLocked && (
                                                    <span title="This employee's payroll is locked" style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '4px', padding: '1px 5px', fontSize: '0.67rem', color: '#f87171', fontWeight: 700, whiteSpace: 'nowrap', gap: '3px' }}>
                                                        <Lock size={9} /> LOCKED
                                                    </span>
                                                )}
                                                <button onClick={() => setBreakdown({ emp, calc, cfg })} title="Verify calculation"
                                                    style={{ background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: '4px', padding: '2px 6px', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                    Verify
                                                </button>
                                                {isSuperAdmin && (
                                                    <button
                                                        title="Delete this row (SuperAdmin only)"
                                                        onClick={async () => {
                                                            if (!window.confirm(`⚠️ Delete payroll row for ${emp.name} (${month})?\n\nThis removes their saved overrides for this month only.`)) return;
                                                            try {
                                                                const [yr, mo] = month.split('-');
                                                                const token = localStorage.getItem('asil_hcm_token');
                                                                const API_URL = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
                                                                const r = await fetch(`${API_URL}/api/payroll/${yr}/${mo}/${encodeURIComponent(emp.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
                                                                if (!r.ok) throw new Error((await r.json()).error || 'Delete failed');
                                                                setOverrides(prev => { const next = { ...prev }; delete next[emp.id]; return next; });
                                                            } catch (e) { alert('Delete failed: ' + e.message); }
                                                        }}
                                                        style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '4px', padding: '2px 5px', color: '#ef4444', cursor: 'pointer', fontSize: '0.7rem', lineHeight: 1 }}>
                                                        🗑
                                                    </button>
                                                )}
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                                                        <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{emp.name}</span>
                                                        {(() => {
                                                            const isInvoiced =
                                                                invoiceStatus.invoicedClients.includes((emp.client || '').toLowerCase()) ||
                                                                invoiceStatus.invoicedContracts.includes((emp.contract || '').toLowerCase());
                                                            return isInvoiced ? (
                                                                <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '4px', padding: '1px 5px', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>INV ✓</span>
                                                            ) : null;
                                                        })()}
                                                    </div>
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{emp.designation}</div>
                                                </div>
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
                                        <RC val={calc.bonusAccrual} muted={!calc.bonusAccrual} style={{ color: '#f59e0b' }} />
                                        <RC val={calc.overhead} muted={!calc.overhead} style={{ color: '#f59e0b' }} />
                                        <RC val={calc.pfER} muted={!calc.pfER} />
                                        <RC val={calc.totalPayrollCost} bold style={{ color: '#a78bfa' }} />
                                        <RC val={calc.serviceCharges} /><RC val={calc.salesTax} />
                                        <RC val={calc.totalInvoice} bold />
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr style={{ background: 'var(--bg-dark)', borderTop: '2px solid var(--border)', fontWeight: 700, fontSize: '0.78rem' }}>
                                <td style={{ position: 'sticky', left: 0, zIndex: 4, background: 'var(--bg-dark)', padding: '9px 8px', width: '36px' }} />
                                <td colSpan={3} style={{ position: 'sticky', left: 36, zIndex: 2, background: 'var(--bg-dark)', padding: '9px 10px', borderRight: '2px solid var(--border)', whiteSpace: 'nowrap' }}>TOTALS — {rows.length} employees</td>
                                {/* Pd Days */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.paid_days > 0 ? fmt(T.paid_days) : '—'}</td>
                                {/* OT 2x hrs */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.ot2_hrs > 0 ? parseFloat(T.ot2_hrs).toFixed(1) : '—'}</td>
                                {/* OT 3x hrs */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.ot3_hrs > 0 ? parseFloat(T.ot3_hrs).toFixed(1) : '—'}</td>
                                {/* OT Amt */}<td style={{ padding: '6px 5px', textAlign: 'right', color: '#22c55e' }}>{fmt(T.otAmount)}</td>
                                {/* OPD */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.opd_claim > 0 ? fmt(T.opd_claim) : '—'}</td>
                                {/* Reimb */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.reimbursement > 0 ? fmt(T.reimbursement) : '—'}</td>
                                {/* Arrears */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.arrears > 0 ? fmt(T.arrears) : '—'}</td>
                                {/* Spl Allow */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.special_allowance > 0 ? fmt(T.special_allowance) : '—'}</td>
                                {/* Fuel/Mob */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.fuel_mobile > 0 ? fmt(T.fuel_mobile) : '—'}</td>
                                {/* Oth Allow */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.otherPaid > 0 ? fmt(T.otherPaid) : '—'}</td>
                                {/* GROSS */}<td style={{ padding: '6px 5px', textAlign: 'right', color: '#22c55e', fontWeight: 900 }}>{fmt(T.grossMonthly)}</td>
                                {/* Inc Tax */}<td style={{ padding: '6px 5px', textAlign: 'right', color: '#f43f5e' }}>{fmt(T.incomeTax)}</td>
                                {/* EOBI EE */}<td style={{ padding: '6px 5px', textAlign: 'right' }}>{fmt(T.eobi_ee)}</td>
                                {/* PF EE */}<td style={{ padding: '6px 5px', textAlign: 'right' }}>{T.pfEE > 0 ? fmt(T.pfEE) : '—'}</td>
                                {/* Adv */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.advance_deduction > 0 ? fmt(T.advance_deduction) : '—'}</td>
                                {/* Loan */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.loan_deduction > 0 ? fmt(T.loan_deduction) : '—'}</td>
                                {/* Oth Ded */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.other_deduction > 0 ? fmt(T.other_deduction) : '—'}</td>
                                {/* NET PAY */}<td style={{ padding: '6px 5px', textAlign: 'right', color: '#22c55e', fontWeight: 900 }}>{fmt(T.netPay)}</td>
                                {/* EOBI ER */}<td style={{ padding: '6px 5px', textAlign: 'right' }}>{fmt(T.eobi_er)}</td>
                                {/* SESSI */}<td style={{ padding: '6px 5px', textAlign: 'right' }}>{T.sessi > 0 ? fmt(T.sessi) : '—'}</td>
                                {/* Gratuity */}<td style={{ padding: '6px 5px', textAlign: 'right' }}>{fmt(T.gratuity)}</td>
                                {/* Life Ins */}<td style={{ padding: '6px 5px', textAlign: 'right' }}>{T.lifeIns > 0 ? fmt(T.lifeIns) : '—'}</td>
                                {/* Med EE */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.medical_ee > 0 ? fmt(T.medical_ee) : '—'}</td>
                                {/* Med SP */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.medical_sp > 0 ? fmt(T.medical_sp) : '—'}</td>
                                {/* Med Ch1 */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.medical_ch1 > 0 ? fmt(T.medical_ch1) : '—'}</td>
                                {/* Med Ch2 */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.medical_ch2 > 0 ? fmt(T.medical_ch2) : '—'}</td>
                                {/* Bonus */}<td style={{ padding: '6px 5px', textAlign: 'right', color: 'var(--text-muted)' }}>{T.bonus_amount > 0 ? fmt(T.bonus_amount) : '—'}</td>
                                {/* Bns Accr */}<td style={{ padding: '6px 5px', textAlign: 'right', color: '#f59e0b' }}>{T.bonusAccrual > 0 ? fmt(T.bonusAccrual) : '—'}</td>
                                {/* Overhead */}<td style={{ padding: '6px 5px', textAlign: 'right', color: '#f59e0b' }}>{T.overhead > 0 ? fmt(T.overhead) : '—'}</td>
                                {/* PF ER */}<td style={{ padding: '6px 5px', textAlign: 'right' }}>{T.pfER > 0 ? fmt(T.pfER) : '—'}</td>
                                {/* Tot Cost */}<td style={{ padding: '6px 5px', textAlign: 'right', color: '#a78bfa', fontWeight: 900 }}>{fmt(T.totalPayrollCost)}</td>
                                {/* Svc Chg */}<td style={{ padding: '6px 5px', textAlign: 'right' }}>{fmt(T.serviceCharges)}</td>
                                {/* Sales Tax */}<td style={{ padding: '6px 5px', textAlign: 'right' }}>{fmt(T.salesTax)}</td>
                                {/* INVOICE */}<td style={{ padding: '6px 5px', textAlign: 'right', color: '#f59e0b', fontWeight: 900 }}>{fmt(T.totalInvoice)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem 1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <strong>Formulas:</strong> Gross = Basic(paid) + Allowances(pro-rata) + OT | WHT = FBR 2025-26 slabs ÷ 12 |
                EOBI = Flat <strong>Rs. 400 (EE) / Rs. 2,000 (ER)</strong> for all employees |
                SESSI = <strong>6% of gross</strong>, only where gross &lt; Rs. 45,000 (exempt above) |
                PF = Gross ÷ 24 (EE &amp; ER, when PF scheme) | <strong>Gratuity = Base Salary ÷ 12</strong> (8.33% of contractual base, EOB Ord 1968 — NOT inflated by OT) |
                Total Payroll Cost = Gross + employer obligations | Service Charges on Total Payroll Cost | Sales Tax on (Total Payroll Cost + Service Charges). Click <strong>Verify</strong> on any row for full step-by-step breakdown.
            </div>

            {breakdown && <BreakdownPanel emp={breakdown.emp} calc={breakdown.calc} cfg={breakdown.cfg || {}} workDays={workDays} onClose={() => setBreakdown(null)} />}
            {showExport && <ExportMenu month={month} isLocked={isLocked} filterClient={filterClient} filterContract={filterContract} filterLoc={filterLoc} onClose={() => setShowExport(false)} />}
            {showImport && <ImportModal onApply={applyImport} onClose={() => setShowImport(false)} employees={EMPLOYEES} workDays={workDays} />}
        </div>
    );
}
