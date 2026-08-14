import React, { useState, useRef, useEffect, memo, useCallback } from 'react';
import { Calculator, Send, Download, Upload, ChevronDown, Filter, AlertCircle, CheckCircle, X, CheckSquare, Square, MessageSquare, FileText as FileTextIcon, CreditCard as CreditCardIcon, Lock, Unlock, Save, RefreshCw, Scale } from 'lucide-react';
import {
    PAYROLL_CONTRACT_CFG as CONTRACT_CFG,
    downloadCSV,
    buildPayrollCSV, buildHBLFile, buildWHTFile, buildEOBIFile, buildSESSIFile,
    COMPANY,
} from './payrollUtils';
import { api } from './api';
import { claimsBadgeStyle } from './utils/claimsRouting';
import './PayrollSheet.css';


// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = v => Math.round(parseFloat(v) || 0).toLocaleString('en-PK');
const Rs = v => `Rs. ${fmt(v)}`;

/** Calendar days in YYYY-MM (July → 31). Used as the Payroll Sheet Working Days default. */
function calendarDaysInMonthStr(ym) {
    const [y, m] = String(ym || '').split('-').map(Number);
    if (!y || !m) return 26;
    return new Date(y, m, 0).getDate();
}

/**
 * PD Days shown in the sheet — calendar present days, never back-solved from salary.
 * Prefer stored paid_days when it is a clean day count; if snapshot has absentDays,
 * show (calendar working days − absent).
 */
function resolveDisplayPaidDays(ov, calc, workDays) {
    const absent = parseFloat(calc?.absentDays);
    if (Number.isFinite(absent) && absent > 0 && workDays > 0) {
        return Math.round((workDays - absent) * 100) / 100;
    }
    const pd = parseFloat(ov?.paid_days ?? calc?.pd ?? workDays);
    return Number.isFinite(pd) ? pd : workDays;
}

/** Display calc from server snapshot (never browser-computed). */
function calcFromServer(row, ov = {}, empGross = 0) {
    const snap = row?.computed_json && typeof row.computed_json === 'object'
        ? row.computed_json
        : (typeof row?.computed_json === 'string'
            ? (() => { try { return JSON.parse(row.computed_json); } catch { return null; } })()
            : null);
    if (snap && (snap.serverComputed || snap.netPay != null || snap.grossMonthly != null)) {
        const salary = parseFloat(empGross) || 0;
        const basicPaid = parseFloat(snap.basicPaid) || 0;
        let absentDays = parseFloat(snap.absentDays) || 0;
        let absenceDeduction = parseFloat(snap.absenceDeduction) || 0;
        if (absenceDeduction <= 0 && salary > 0 && basicPaid > 0 && basicPaid < salary) {
            absenceDeduction = Math.round((salary - basicPaid) * 100) / 100;
        }
        if (absentDays <= 0 && salary > 0 && absenceDeduction > 0) {
            // Infer absent days from money gap vs calendar month (does not change net pay).
            const ym = row.year && row.month
                ? `${row.year}-${String(row.month).padStart(2, '0')}`
                : (ov._payrollMonth || null);
            const cal = calendarDaysInMonthStr(ym);
            if (cal >= 28) absentDays = Math.round((absenceDeduction / salary) * cal);
        }
        const ym = row.year && row.month
            ? `${row.year}-${String(row.month).padStart(2, '0')}`
            : (ov._payrollMonth || null);
        const cal = calendarDaysInMonthStr(ym);
        const pd = absentDays > 0 && cal >= 28
            ? Math.round((cal - absentDays) * 100) / 100
            : (snap.pd != null ? snap.pd : ov.paid_days);
        return {
            ...snap,
            pd,
            absentDays,
            absenceDeduction,
            serverComputed: true,
        };
    }
    const gross = parseFloat(row?.gross) || 0;
    const net = parseFloat(row?.net) || 0;
    const wht = parseFloat(row?.wht) || 0;
    return {
        pd: ov.paid_days, ot2hrs: ov.ot2_hrs || 0, ot3hrs: ov.ot3_hrs || 0,
        otAmount: 0, opdClaim: ov.opd_claim || 0, reimb: ov.reimbursement || 0,
        arrears: ov.arrears || 0, splAllow: ov.special_allowance || 0, fuelMob: ov.fuel_mobile || 0,
        basicPaid: 0, hraPaid: 0, convPaid: 0, medPaid: 0, otherPaid: 0,
        absentDays: 0, absenceDeduction: 0, ot2Amount: 0, ot3Amount: 0,
        grossMonthly: gross, taxableMonthly: Math.max(0, gross - (parseFloat(ov.bonus_amount) || 0)),
        incomeTax: wht, eobi_ee: parseFloat(row?.eobi_ee) || 0, pfEE: 0,
        advanceDed: ov.advance_deduction || 0, loanDed: ov.loan_deduction || 0,
        totalDeductions: wht + (parseFloat(row?.eobi_ee) || 0),
        netPay: net, eobi_er: 0, sessi: 0, gratuity: 0, lifeIns: 0,
        medEE: ov.medical_ee || 0, medSP: ov.medical_sp || 0, medCh1: ov.medical_ch1 || 0, medCh2: ov.medical_ch2 || 0,
        pfER: 0, bonusAccrual: 0, bonusAmount: ov.bonus_amount || 0, bonusDisbursed: ov.bonus_amount || 0,
        overhead: 0, totalPayrollCost: 0,
        serviceCharges: parseFloat(row?.service_charges) || 0,
        salesTax: parseFloat(row?.sales_tax) || 0,
        totalInvoice: parseFloat(row?.total_invoice) || 0,
        serverComputed: !!(gross || net || wht),
    };
}

function emptyServerCalc(ov = {}) {
    return calcFromServer({}, ov);
}

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
                        {(cfg.bonus_months ?? 0) === 0
                            ? <R label="Bonus Accrual" formula="No bonus applicable for this contract" value={0} muted />
                            : <R label={`Bonus Accrual (${cfg.bonus_months ?? 0} month${cfg.bonus_months !== 1 ? 's' : ''}/yr)`} formula={`${cfg.bonus_months ?? 0} × Gross ÷ 12`} value={calc.bonusAccrual} muted={!calc.bonusAccrual} />}
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

    const REQUIRED = ['ASIL Employee Code'];

    const normCode = (id) => String(id || '').trim().toUpperCase().replace(/\s+/g, '');
    const nameSimilar = (a, b) => {
        const x = String(a || '').toLowerCase().replace(/[^a-z]/g, '');
        const y = String(b || '').toLowerCase().replace(/[^a-z]/g, '');
        if (!x || !y) return true;
        return x.includes(y.slice(0, 8)) || y.includes(x.slice(0, 8));
    };

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
                const empCode = obj['ASIL Employee Code'];
                const match = employees.find(e => e.id === empCode)
                    || employees.find(e => normCode(e.id) === normCode(empCode));
                if (!match) {
                    errs.push(`Row ${i + 2}: No employee found for code ${empCode}`);
                } else {
                    const csvName = obj['Emp Name'] || obj['Employee Name'] || '';
                    if (csvName && !nameSimilar(csvName, match.name)) {
                        errs.push(`Row ${i + 2}: Name warning for ${empCode} — CSV "${csvName}" vs HCM "${match.name}" (code match used)`);
                    }
                    const n = (v) => parseFloat(String(v || '').replace(/,/g, '')) || 0;
                    const rawPresent = obj['Present Days'] !== undefined && obj['Present Days'] !== ''
                        ? n(obj['Present Days'])
                        : workDays;
                    if (rawPresent > workDays) {
                        errs.push(`Row ${i + 2}: Present Days ${rawPresent} exceeds Working Days ${workDays} — not truncated`);
                    }
                    const presentDays = rawPresent;
                    const leaveDays = Math.max(0, workDays - presentDays);
                    // Special Allowance column is bonus verification in Excel — never import as special_allowance.
                    // Bonus disbursement comes from contract auto-calc only.
                    rows.push({
                        empId:             match.id,
                        paid_days:         presentDays,
                        ot2_hrs:           n(obj['OT Hrs @ 2X']),
                        ot3_hrs:           n(obj['OT Hrs @ 3X']),
                        opd_claim:         n(obj['OPD']),
                        reimbursement:     n(obj['Expense Reimbursement']),
                        arrears:           n(obj['Arrears']),
                        bonus_amount:      0,
                        special_allowance: 0,
                        fuel_mobile:       n(obj['Other Allowance Fuel | Mobile']),
                        other_deduction:   n(obj['Other Deduction']),
                        remarks:           String(obj['Remarks'] || '').trim(),
                    });
                    prev.push({
                        name: match.name, id: match.id,
                        presentDays, leaveDays,
                        ot2: obj['OT Hrs @ 2X'] || 0, ot3: obj['OT Hrs @ 3X'] || 0,
                        opd: n(obj['OPD']), reimb: n(obj['Expense Reimbursement']),
                        arrears: n(obj['Arrears']),
                        splAllow: 0,
                        fuelMob: n(obj['Other Allowance Fuel | Mobile']),
                        otherDed: n(obj['Other Deduction']),
                        remarks: obj['Remarks'] || '',
                    });
                }
            });
            setErrors(errs); setParsed(rows); setPreview(prev);
        };
        reader.readAsText(f);
    };

    const downloadTemplate = () => {
        downloadCSV('payroll_import_template.csv', [{
            'Month': 'July', 'Year': '2026',
            'ASIL Employee Code': 'ASIL/SPL-91/21', 'Emp Name': 'Muhammad Anees',
            'Present Days': '26',
            'OT Hrs @ 2X': '8', 'OT Hrs @ 3X': '0',
            'OPD': '0', 'Expense Reimbursement': '0', 'Arrears': '0',
            'Special Allowance': '0', 'Other Allowance Fuel | Mobile': '0', 'Other Deduction': '0',
            'Remarks': '',
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
                        <strong>Required:</strong> ASIL Employee Code (primary match key).<br />
                        <strong>Optional:</strong> Month, Year, Emp Name (fuzzy warn), Present Days, OT Hrs @ 2X/3X, OPD, Expense Reimbursement, Arrears, Fuel/Mobile, Other Deduction, Remarks.<br />
                        <strong style={{ color: '#f59e0b' }}>Special Allowance:</strong> Not imported — bonus comes from contract settings only.<br />
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
                                        <tr>{['Employee', 'ID', 'Pres.Days', 'OT@2X','OT@3X','OPD','Reimb.','Arrears','Fuel/Mob','OtherDed','Remarks'].map(h => <th key={h} style={{ padding: '8px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {preview.map((r, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: r.leaveDays > 0 ? 'rgba(239,68,68,0.05)' : undefined }}>
                                                <td style={{ padding: '7px 8px', fontWeight: 600 }}>{r.name}</td>
                                                <td style={{ padding: '7px 8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.id}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.presentDays}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.ot2}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.ot3}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(r.opd)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(r.reimb)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(r.arrears)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right', color: r.fuelMob > 0 ? '#22c55e' : 'var(--text-muted)' }}>{fmt(r.fuelMob)}</td>
                                                <td style={{ padding: '7px 8px', textAlign: 'right', color: r.otherDed > 0 ? '#ef4444' : 'var(--text-muted)' }}>{fmt(r.otherDed)}</td>
                                                <td style={{ padding: '7px 8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.remarks || '—'}</td>
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

// ─── Refresh Payroll Modal ───────────────────────────────────────────────────
function RefreshPayrollModal({ month, onClose, onSuccess }) {
    const [step, setStep] = useState(1); // 1 = confirm, 2 = password, 3 = done
    const [password, setPassword] = useState('');
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState('');
    const [deletedCount, setDeletedCount] = useState(0);

    const monthLabel = (() => {
        const [y, m] = month.split('-');
        return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString('en-PK', { month: 'long', year: 'numeric' });
    })();

    const doReset = async () => {
        setError(''); setLoading(true);
        try {
            const [yr, mo] = month.split('-');
            const result = await api.resetPayroll(yr, mo, password);
            setDeletedCount(result.deleted || 0);
            setStep(3);
            onSuccess && onSuccess();
        } catch (e) {
            setError(e.message);
        } finally { setLoading(false); }
    };

    const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '2rem' };
    const card    = { background: 'linear-gradient(135deg,#1a1f2e,#0f1520)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '20px', width: '100%', maxWidth: '500px', boxShadow: '0 30px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(239,68,68,0.1) inset' };

    // Step indicator
    const StepDot = ({ n }) => (
        <div style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.78rem',
            background: step >= n ? (n === 3 ? '#22c55e' : '#ef4444') : 'rgba(255,255,255,0.08)',
            color: step >= n ? 'white' : '#64748b', border: step === n ? '2px solid currentColor' : '2px solid transparent', transition: 'all 0.3s' }}>{n}</div>
    );

    return (
        <div style={overlay}>
            <div style={card}>
                {/* Header */}
                <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid rgba(239,68,68,0.2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                                <div style={{ width: 36, height: 36, borderRadius: '10px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <RefreshCw size={18} color="#f87171" />
                                </div>
                                <h3 style={{ margin: 0, color: '#f87171', fontSize: '1.1rem' }}>Refresh Payroll</h3>
                            </div>
                            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.82rem' }}>Erase entered data for {monthLabel}</p>
                        </div>
                        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1 }}>×</button>
                    </div>
                    {/* Step pills */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '1.25rem' }}>
                        <StepDot n={1} />
                        <div style={{ flex: 1, height: 2, background: step > 1 ? '#ef4444' : 'rgba(255,255,255,0.08)', borderRadius: 2, transition: 'background 0.3s' }} />
                        <StepDot n={2} />
                        <div style={{ flex: 1, height: 2, background: step > 2 ? '#22c55e' : 'rgba(255,255,255,0.08)', borderRadius: 2, transition: 'background 0.3s' }} />
                        <StepDot n={3} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                        <span>Confirm</span><span style={{ marginRight: '-8px' }}>Password</span><span>Done</span>
                    </div>
                </div>

                {/* Body */}
                <div style={{ padding: '1.75rem 2rem' }}>
                    {step === 1 && (
                        <div>
                            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' }}>
                                <div style={{ fontWeight: 700, color: '#f87171', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '7px' }}>
                                    <AlertCircle size={16} /> Warning — Destructive Action
                                </div>
                                <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8 }}>
                                    <li>All <strong style={{ color: 'var(--text)' }}>entered attendance, OT, adjustments and bonuses</strong> for <strong style={{ color: '#f87171' }}>{monthLabel}</strong> will be permanently erased.</li>
                                    <li>Locked rows <strong>cannot</strong> be erased — unlock them first.</li>
                                    <li>This action is logged on the server.</li>
                                </ul>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                                <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                <button onClick={() => setStep(2)} style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)', border: 'none', color: 'white', padding: '8px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <RefreshCw size={15} /> Proceed with Erase
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                                Enter the <strong>Payroll Reset Password</strong> to confirm this action. This password is set by your system administrator in the server environment.
                            </p>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Reset Password</label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={e => { setPassword(e.target.value); setError(''); }}
                                    onKeyDown={e => { if (e.key === 'Enter' && password.trim()) doReset(); }}
                                    placeholder="Enter reset password…"
                                    autoFocus
                                    style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '10px 14px', color: 'var(--text)', fontSize: '0.95rem', outline: 'none' }}
                                />
                            </div>
                            {error && (
                                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#f87171', display: 'flex', alignItems: 'flex-start', gap: '7px' }}>
                                    <AlertCircle size={15} style={{ marginTop: 2, flexShrink: 0 }} /> {error}
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                                <button onClick={() => { setStep(1); setError(''); setPassword(''); }} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer' }}>Back</button>
                                <button onClick={doReset} disabled={!password.trim() || loading}
                                    style={{ background: loading ? '#374151' : 'linear-gradient(135deg,#ef4444,#dc2626)', border: 'none', color: 'white', padding: '8px 24px', borderRadius: '8px', cursor: (!password.trim() || loading) ? 'not-allowed' : 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px', opacity: (!password.trim() || loading) ? 0.7 : 1 }}>
                                    {loading ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> Erasing…</> : <><RefreshCw size={15} /> Confirm Erase</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', border: '2px solid #22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                                <CheckCircle size={32} color="#22c55e" />
                            </div>
                            <h4 style={{ margin: '0 0 0.5rem', color: '#22c55e' }}>Payroll Reset Complete</h4>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1.5rem' }}>
                                {deletedCount} employee row(s) erased for <strong style={{ color: 'var(--text)' }}>{monthLabel}</strong>. The sheet will reload with fresh defaults.
                            </p>
                            <button onClick={onClose} style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', border: 'none', color: 'white', padding: '9px 28px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Close</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EditableCell — module-level so React.memo works (no re-creation each render)
// ─────────────────────────────────────────────────────────────────────────────
// Key performance insight: defining this INSIDE PayrollSheet causes it to be
// recreated on every render, defeating React.memo and causing ALL 500 cells
// to re-render when ANY override changes.
// Moving it here means:
//   • onChange updates only this cell's local state — zero parent re-renders
//   • onBlur calls setOv (parent re-render + save) — once per field exit
// ─────────────────────────────────────────────────────────────────────────────
const EditableCell = memo(function EditableCell({ empId, field, value, locked, w = '68px', setOv }) {
    const [localVal, setLocalVal] = useState(value);
    // Sync with parent when DB loads or month changes
    useEffect(() => { setLocalVal(value); }, [value]);
    return (
        <input
            type="number" min={0} step="any"
            value={localVal}
            disabled={locked}
            onChange={e => { if (!locked) setLocalVal(e.target.value); }}
            onBlur={e => { if (!locked) setOv(empId, field, e.target.value); }}
            style={{
                width: w,
                background: locked ? 'transparent' : 'rgba(56,189,248,0.07)',
                border: locked ? 'none' : '1px solid rgba(56,189,248,0.2)',
                borderRadius: '4px', padding: '3px 5px',
                color: 'var(--text)', fontSize: '0.78rem',
                textAlign: 'right', outline: 'none',
                cursor: locked ? 'not-allowed' : 'text',
                opacity: locked ? 0.7 : 1,
            }}
        />
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function PayrollSheet({ user }) {
    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    const [month, setMonth] = useState(defaultMonth);
    const [workDays, setWorkDays] = useState(() => calendarDaysInMonthStr(defaultMonth));
    const [filterClient, setFilterClient] = useState('All');
    const [filterContract, setFilterContract] = useState('All');
    const [filterLoc, setFilterLoc] = useState('All');
    const [filterLockStatus, setFilterLockStatus] = useState('All'); // 'All' | 'Locked' | 'Unlocked'
    const [overrides, setOverrides] = useState({});
    const [breakdown, setBreakdown] = useState(null);
    const [approvalSent, setApprovalSent] = useState({});
    const [showExport, setShowExport] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [showRefresh, setShowRefresh] = useState(false);
    const [EMPLOYEES, setEMPLOYEES] = useState([]);
    const [CONTRACT_MAP, setCONTRACT_MAP] = useState({});
    // ── Lock / DB state ─────────────────────────────────────────────────────────
    const [lockedIds, setLockedIds] = useState(new Set()); // per-employee lock status
    const [lockedBy, setLockedBy] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isCalculating, setIsCalculating] = useState(false);
    const [calcMsg, setCalcMsg] = useState(null);
    // Default OFF: Calculate must recompute from current sheet hours (idempotent).
    // Turn on only when you want approved claims merged into the sheet.
    const [pullClaimsOnCalc, setPullClaimsOnCalc] = useState(false);
    const [serverRows, setServerRows] = useState({}); // employee_id -> GET/calculate row
    const saveTimerRef = useRef(null);
    const serverRowsRef = useRef({});
    // ── Bulk selection state ────────────────────────────────────────────────────
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [showBulkSMS, setShowBulkSMS] = useState(false);
    const [bulkSMSMsg, setBulkSMSMsg] = useState('');
    const [bulkSMSSending, setBulkSMSSending] = useState(false);
    const [bulkSMSResult, setBulkSMSResult] = useState(null);
    const [payslipReadiness, setPayslipReadiness] = useState(null);
    const [showSendPayslips, setShowSendPayslips] = useState(false);
    const [sendPayslipConfirm, setSendPayslipConfirm] = useState(false);
    const [showPayslipTestRun, setShowPayslipTestRun] = useState(false);
    const [payslipTestEmail, setPayslipTestEmail] = useState('shezad.mumtaz@asil.com.pk');
    const [payslipTestPhone, setPayslipTestPhone] = useState('03008275688');
    const [payslipTestBusy, setPayslipTestBusy] = useState(false);
    const [payslipTestResult, setPayslipTestResult] = useState(null);
    const [showAddClaims, setShowAddClaims] = useState(false);
    const [addClaimsForm, setAddClaimsForm] = useState({
        employeeId: '', ot1Hours: 0, ot2Hours: 0, ot3Hours: 0,
        expenseAmount: 0, medicalAmount: 0, mode: 'add', reason: '',
    });
    const [addClaimsMsg, setAddClaimsMsg] = useState('');

    const isSuperAdmin = user?.role === 'superadmin';
    const canManageLock = isSuperAdmin || user?.role === 'finance_approver';
    const canSendPayslips = isSuperAdmin
        || user?.role === 'finance_manager'
        || user?.role === 'finance_approver'
        || user?.role === 'payroll_initiator';
    const canReconcile = isSuperAdmin
        || user?.role === 'finance_manager'
        || user?.role === 'finance_approver'
        || user?.role === 'payroll_initiator'
        || user?.role === 'ap_team';
    const [forceResendPayslips, setForceResendPayslips] = useState(false);
    const [sendAllPayslips, setSendAllPayslips] = useState(false);
    const [payrollRecon, setPayrollRecon] = useState(null);
    const [showReconPanel, setShowReconPanel] = useState(false);
    const [reconLoading, setReconLoading] = useState(false);
    const [reconError, setReconError] = useState(null);
    // #region agent log
    {
        const reconBindings = {};
        try { reconBindings.payrollRecon = typeof payrollRecon; } catch (e) { reconBindings.payrollReconErr = e.name + ': ' + e.message; }
        try { reconBindings.setPayrollRecon = typeof setPayrollRecon; } catch (e) { reconBindings.setPayrollReconErr = e.name + ': ' + e.message; }
        try { reconBindings.showReconPanel = typeof showReconPanel; } catch (e) { reconBindings.showReconPanelErr = e.name + ': ' + e.message; }
        try { reconBindings.setShowReconPanel = typeof setShowReconPanel; } catch (e) { reconBindings.setShowReconPanelErr = e.name + ': ' + e.message; }
        reconBindings.hasReconError = reconError != null;
        fetch('http://127.0.0.1:7862/ingest/e9557106-2f42-4248-bcaf-ee841cde492e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea0c85'},body:JSON.stringify({sessionId:'ea0c85',hypothesisId:'A',runId:'post-fix',location:'PayrollSheet.jsx:recon-bindings',message:'PayrollSheet recon identifier bindings',data:reconBindings,timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    const selectedIdsRef = useRef(selectedIds);
    useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
    const [PROVINCE_RATES, setPROVINCE_RATES] = useState([]); // from System Config Tax by Region
    const [invoiceStatus, setInvoiceStatus] = useState({ invoicedClients: [], invoicedContracts: [] });

    // ── REFS — ALL declared here at the TOP, before any useEffect ─────────────────────
    // overridesRef: mirror of overrides state, kept in sync synchronously so
    // debounced save callbacks always read the latest value (not stale React state).
    const overridesRef  = useRef({});
    // empMapRef: map of employee_id -> { emp, cfg } for quick lookup in save callbacks
    const empMapRef     = useRef({});
    // workDaysRef: mirror of workDays to avoid stale closures in async callbacks
    const workDaysRef   = useRef(calendarDaysInMonthStr(defaultMonth));
    const prevWorkDays = useRef(calendarDaysInMonthStr(defaultMonth));
    // rowsRef: latest rendered rows list (used by lock handler to build save payload)
    const rowsRef       = useRef([]);
    // perEmpTimers: per-employee debounce timers so editing emp A doesn’t cancel emp B’s pending save
    const perEmpTimers  = useRef({});
    // monthRef: mirror of month to avoid stale closures in debounced callbacks
    const monthRef      = useRef(defaultMonth);
    // medCleanedRef: flag to prevent the medical cleanup effect from looping
    // (the effect adds overrides as a dep so it re-fires when DB data loads,
    //  but we only want it to run ONCE per month after both employees + overrides load)
    const medCleanedRef = useRef(false);

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
            const contractList = Array.isArray(ctData) ? ctData : (ctData?.contracts || []);
            contractList.forEach(ct => {
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
                    bonus_disbursement_month: parseInt(ct.costs?.bonus_disbursement_month) || 0,
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
                // Treat null, empty string, AND the literal '0' as no family data
                // ('0' was incorrectly imported from old CSV uploads)
                const isFamilyName = n => n && String(n).trim() && String(n).trim() !== '0';
                const hasSpouse = isFamilyName(e.spouseName);
                const numChildren = [e.child1Name, e.child2Name].filter(isFamilyName).length;

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


    const applyPayrollPayload = (data) => {
        if (!data?.rows?.length) {
            serverRowsRef.current = {};
            setServerRows({});
            return;
        }
        const ov = {};
        const srv = {};
        data.rows.forEach(r => {
            srv[r.employee_id] = r;
            const snap = r.computed_json && typeof r.computed_json === 'object'
                ? r.computed_json
                : (typeof r.computed_json === 'string'
                    ? (() => { try { return JSON.parse(r.computed_json); } catch { return null; } })()
                    : null);
            const cal = calendarDaysInMonthStr(month);
            let paidDays = r.paid_days;
            const empMeta = empMapRef.current[r.employee_id]?.emp;
            const salary = parseFloat(empMeta?.gross) || 0;
            if (snap) {
                if (Number(snap.absentDays) > 0) {
                    paidDays = Math.round((cal - Number(snap.absentDays)) * 100) / 100;
                } else if (salary > 0 && Number(snap.basicPaid) > 0 && Number(snap.basicPaid) < salary) {
                    // Recover calendar PD from contractual salary vs paid basic (fixes 27.1-style back-solves).
                    const absent = Math.round(((salary - Number(snap.basicPaid)) / salary) * cal);
                    if (absent > 0) paidDays = cal - absent;
                }
            }
            ov[r.employee_id] = {
                ...(paidDays != null ? { paid_days: paidDays } : {}),
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
                ...(r.medical_ee  != null && parseFloat(r.medical_ee)  > 0 ? { medical_ee:  parseFloat(r.medical_ee)  } : {}),
                ...(r.medical_sp  != null && parseFloat(r.medical_sp)  > 0 ? { medical_sp:  parseFloat(r.medical_sp)  } : {}),
                ...(r.medical_ch1 != null && parseFloat(r.medical_ch1) > 0 ? { medical_ch1: parseFloat(r.medical_ch1) } : {}),
                ...(r.medical_ch2 != null && parseFloat(r.medical_ch2) > 0 ? { medical_ch2: parseFloat(r.medical_ch2) } : {}),
                remarks:           r.remarks || '',
            };
        });
        overridesRef.current = ov;
        setOverrides(ov);
        serverRowsRef.current = srv;
        setServerRows(srv);
        const lockedRowIds = data.rows.filter(r => r.locked).map(r => r.employee_id);
        setLockedIds(new Set(lockedRowIds));
        const firstLocked = data.rows.find(r => r.locked);
        if (firstLocked?.locked_by) setLockedBy(firstLocked.locked_by);
    };

    // ── Load saved payroll from DB whenever month changes ──────────────────────
    useEffect(() => {
        const [yr, mo] = month.split('-');
        monthRef.current = month;
        overridesRef.current = {};
        setOverrides({});
        serverRowsRef.current = {};
        setServerRows({});
        setLockedIds(new Set());
        setLockedBy(null);
        setCalcMsg(null);
        setShowReconPanel(false);
        setPayrollRecon(null);
        setReconError(null);
        api.getPayroll(yr, mo).then(applyPayrollPayload).catch(() => {});
        api.getPayrollInvoiceStatus(yr, mo)
            .then(d => setInvoiceStatus(d || { invoicedClients: [], invoicedContracts: [] }))
            .catch(() => {});
    }, [month]);

    // Keep workDaysRef in sync whenever workDays changes
    useEffect(() => { workDaysRef.current = workDays; }, [workDays]);

    // When the payroll month changes, align Working Days to the calendar length
    // (July=31, Feb=28/29). Do NOT trigger persistAllUnlocked — that would rewrite pay.
    useEffect(() => {
        const cal = calendarDaysInMonthStr(month);
        setWorkDays(cal);
        workDaysRef.current = cal;
        prevWorkDays.current = cal;
    }, [month]);
    // Keep monthRef in sync whenever month changes
    useEffect(() => { monthRef.current = month; }, [month]);

    // ── Clean stale medical overrides for employees with no family data ────────
    // Root cause: overrides load async from DB AFTER EMPLOYEES loads. Adding
    // [EMPLOYEES, month] as deps meant the cleanup ran when overrides was still
    // empty {}. Adding 'overrides' to deps causes it to re-run when DB data arrives.
    // medCleanedRef prevents the loop that would result from setOverrides() re-firing it.
    useEffect(() => { medCleanedRef.current = false; }, [month]); // reset flag on month change
    useEffect(() => {
        if (!EMPLOYEES.length) return;               // employees not loaded yet
        if (!Object.keys(overrides).length) return;  // DB overrides not loaded yet
        if (medCleanedRef.current) return;           // already cleaned for this month
        medCleanedRef.current = true;                // mark done before setOverrides to prevent loop
        setOverrides(prev => {
            let changed = false;
            const cleaned = { ...prev };
            EMPLOYEES.forEach(emp => {
                const ov = cleaned[emp.id];
                if (!ov) return;
                const newOv = { ...ov };
                let empChanged = false;
                if (!emp.hasSpouse    && parseFloat(ov.medical_sp)  > 0) { delete newOv.medical_sp;  empChanged = true; }
                if (emp.numChildren < 1 && parseFloat(ov.medical_ch1) > 0) { delete newOv.medical_ch1; empChanged = true; }
                if (emp.numChildren < 2 && parseFloat(ov.medical_ch2) > 0) { delete newOv.medical_ch2; empChanged = true; }
                if (empChanged) { cleaned[emp.id] = newOv; changed = true; }
            });
            if (changed) { overridesRef.current = cleaned; return cleaned; }
            return prev;
        });
    }, [EMPLOYEES, month, overrides]); // overrides in deps so effect re-fires when DB data loads


    const getOv = (id, field, def) => { const o = overrides[id]; return (o && o[field] !== undefined) ? o[field] : def; };

    // \u2500\u2500 Build the calc overrides object for one employee from refs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const buildOvForEmp = (empId) => {
        const ov  = overridesRef.current[empId] || {};
        const wd  = workDaysRef.current;
        const old = rowsRef.current.find(r => r.emp.id === empId)?.calc || {};
        return {
            paid_days:         ov.paid_days         ?? old.pd ?? wd,
            ot2_hrs:           ov.ot2_hrs           ?? 0,
            ot3_hrs:           ov.ot3_hrs           ?? 0,
            opd_claim:         ov.opd_claim         ?? 0,
            reimbursement:     ov.reimbursement     ?? 0,
            arrears:           ov.arrears           ?? 0,
            special_allowance: ov.special_allowance ?? 0,
            fuel_mobile:       ov.fuel_mobile       ?? 0,
            other_deduction:   ov.other_deduction   ?? 0,
            advance_deduction: ov.advance_deduction ?? 0,
            loan_deduction:    ov.loan_deduction    ?? 0,
            bonus_amount:      ov.bonus_amount      ?? 0,
            remarks:           ov.remarks           ?? '',
            medical_ee:        ov.medical_ee        ?? old.medEE  ?? 0,
            medical_sp:        ov.medical_sp        ?? old.medSP  ?? 0,
            medical_ch1:       ov.medical_ch1       ?? old.medCh1 ?? 0,
            medical_ch2:       ov.medical_ch2       ?? old.medCh2 ?? 0,
            ...(ov.calDaysWorked != null ? { calDaysWorked: ov.calDaysWorked, totalCalDays: ov.totalCalDays } : {}),
        };
    };

    // ── Save INPUTS only (money columns update after Calculate) ───────────────
    const persistEmployee = async (empId) => {
        const { emp, cfg } = empMapRef.current[empId] || {};
        if (!emp || !cfg) return;
        const ov = buildOvForEmp(empId);
        const [yr, mo] = monthRef.current.split('-');
        try {
            setIsSaving(true);
            await api.savePayroll(yr, mo, [{ employee_id: empId, ov, calc: {} }], { inputsOnly: true });
        } catch (e) {
            console.warn(`Payroll save failed for ${empId}:`, e.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleCalculatePayroll = async () => {
        const [yr, mo] = month.split('-');
        setIsCalculating(true);
        setCalcMsg(null);
        try {
            // sheet_inputs = recompute from current grid; canonical = attendance + approved claims
            const body = { sourceMode: pullClaimsOnCalc ? 'canonical' : 'sheet_inputs' };
            if (filterClient && filterClient !== 'All') body.client = filterClient;
            if (filterContract && filterContract !== 'All') {
                const match = Object.values(CONTRACT_MAP).find(c => c.id === filterContract)
                    || Object.entries(CONTRACT_MAP).find(([k]) => k === filterContract.toLowerCase()?.trim());
                const cid = match?.id || match?.[1]?.id;
                if (cid) body.contractId = cid;
            }
            const result = await api.calculatePayroll(yr, mo, body);
            applyPayrollPayload(result);
            const a208 = result.anchors && Object.entries(result.anchors).find(([id]) => /SPL-208/i.test(id));
            const a91 = result.anchors && Object.entries(result.anchors).find(([id]) => /SPL-91/i.test(id));
            setCalcMsg(`Calculated ${result.updated || 0} employees on server.`
                + (a208 ? ` SPL-208 net ${Math.round(a208[1].net).toLocaleString()}` : '')
                + (a91 ? ` · SPL-91 net ${Math.round(a91[1].net).toLocaleString()} tax ${Math.round(a91[1].wht).toLocaleString()}` : ''));
            // Reload authoritative GET (includes locked flags)
            const fresh = await api.getPayroll(yr, mo);
            applyPayrollPayload(fresh);
        } catch (e) {
            setCalcMsg(e.message || 'Calculate failed');
        } finally {
            setIsCalculating(false);
        }
    };

    // ── setOv: update one field, trigger per-employee debounced save ──────────
    // useCallback([lockedIds]): reference is stable so React.memo works on
    // EditableCell — prevents all 500 cells re-rendering on every state change.
    const setOv = useCallback((id, field, val) => {
        if (lockedIds.has(id)) return;
        overridesRef.current = {
            ...overridesRef.current,
            [id]: { ...(overridesRef.current[id] || {}), [field]: val },
        };
        setOverrides(p => ({ ...p, [id]: { ...(p[id] || {}), [field]: val } }));
        clearTimeout(perEmpTimers.current[id]);
        perEmpTimers.current[id] = setTimeout(() => persistEmployee(id), 900);
    }, [lockedIds]); // eslint-disable-line react-hooks/exhaustive-deps

    // Bulk save INPUTS only when working days changes (press Calculate to refresh money)
    const persistAllUnlocked = async (wd) => {
        const empsList = rowsRef.current;
        if (!empsList.length) return;
        const [yr, mo] = monthRef.current.split('-');
        const payload = empsList
            .filter(({ emp }) => !lockedIds.has(emp.id))
            .map(({ emp }) => {
                const ov = buildOvForEmp(emp.id);
                const ovWithWd = { ...ov, paid_days: overridesRef.current[emp.id]?.paid_days ?? wd };
                return { employee_id: emp.id, ov: ovWithWd, calc: {} };
            });
        if (!payload.length) return;
        try {
            setIsSaving(true);
            await api.savePayroll(yr, mo, payload, { inputsOnly: true });
        } catch (e) { console.warn('Bulk save failed:', e.message); }
        finally { setIsSaving(false); }
    };

    // ── When Working Days changes manually, bulk-save unlocked rows.
    // Calendar sync from month change updates prevWorkDays first so this is a no-op.
    useEffect(() => {
        if (workDays === prevWorkDays.current) return; // skip mount / calendar month sync
        prevWorkDays.current = workDays;
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => persistAllUnlocked(workDays), 1200);
    }, [workDays]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Generate payslips — World A sheet layout; preview first + download all
    const generatePayslips = async () => {
        if (!selectedRows.length) return alert('Select at least one employee.');
        const [yr2, mo2] = month.split('-');
        let previewOpened = false;
        for (const r of selectedRows) {
            try {
                const html = await api.fetchPayslipHtml(r.emp.id, mo2, yr2, { source: 'world_a' });
                if (!previewOpened) {
                    const w = window.open('', '_blank');
                    if (w) {
                        w.document.write(html);
                        w.document.close();
                        previewOpened = true;
                    }
                }
                const blob = new Blob([html], { type: 'text/html' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `Payslip_${r.emp.id}_${mo2}-${yr2}.html`;
                document.body.appendChild(a); a.click();
                document.body.removeChild(a); URL.revokeObjectURL(url);
            } catch (e) { alert(`Payslip error for ${r.emp.name}: ${e.message}`); }
        }
    };

    const openSendPayslipsModal = () => {
        setShowSendPayslips(true);
        setSendPayslipConfirm(false);
        setForceResendPayslips(false);
        setSendAllPayslips(false);
        const [yr2, mo2] = month.split('-');
        const ids = [...selectedIdsRef.current];
        api.getPayslipReadiness(yr2, mo2, ids)
            .then(setPayslipReadiness)
            .catch(() => setPayslipReadiness(null));
    };

    // Send payslips (PDF email + SMS) — selection-scoped; month must be bank-paid
    const [sendingEmails, setSendingEmails] = React.useState(false);
    const [emailResult, setEmailResult] = React.useState(null);
    const sendPayslipEmails = async () => {
        const targets = [...selectedIdsRef.current];
        const sendingAll = targets.length === 0;
        if (sendingAll && !sendAllPayslips) {
            alert('Select one or more employees, or tick “Send to ALL locked employees”.');
            return;
        }
        if (payslipReadiness && (!payslipReadiness.paid || (payslipReadiness.notPaid || []).length > 0)) {
            const names = (payslipReadiness.notPaid || []).map((e) => e.name).filter(Boolean);
            alert(
                `${payslipReadiness.notPaid?.length || 0} selected employee(s) are not yet marked paid in Accounts Payable`
                + (names.length ? `: ${names.join(', ')}` : '.')
            );
            return;
        }
        setSendingEmails(true); setEmailResult(null);
        try {
            const [yr2, mo2] = month.split('-');
            const d = await api.sendPayslipEmails(yr2, mo2, {
                employeeIds: targets,
                confirm: true,
                forceResend: !!forceResendPayslips,
                sendAll: sendingAll,
            });
            if (d.error) throw new Error(d.error);
            const scope = targets.length
                ? `selected ${targets.length}`
                : 'all locked';
            const msg = `Delivered ${d.sent}/${d.total} (${scope}) — email: ${d.emailCount}, SMS: ${d.smsCount}${d.failed?.length ? `, failed: ${d.failed.length}` : ''}.`;
            setEmailResult({
                ok: d.status !== 'failed',
                msg,
                emailCount: d.emailCount || 0,
                smsCount: d.smsCount || 0,
                status: d.status,
                deliveries: d.deliveries || [],
                failed: d.failed || [],
            });
            setSendPayslipConfirm(false);
            setForceResendPayslips(false);
            setSendAllPayslips(false);
            api.getPayslipReadiness(yr2, mo2, targets).then(setPayslipReadiness).catch(() => {});
        } catch (e) {
            setEmailResult({ ok: false, msg: e.message || 'Send failed', deliveries: [] });
        }
        setSendingEmails(false);
    };

    const runPayslipTestDelivery = async () => {
        if (!payslipTestEmail?.includes('@')) return alert('Enter a valid email');
        if (!payslipTestPhone?.trim()) return alert('Enter a phone number');
        if (!window.confirm(`Send 5 sample July payslips to\n${payslipTestEmail}\nand SMS to ${payslipTestPhone}?`)) return;
        setPayslipTestBusy(true);
        setPayslipTestResult(null);
        try {
            const d = await api.sendPayslipTestRun({
                email: payslipTestEmail.trim(),
                phone: payslipTestPhone.trim(),
            });
            if (d.error) throw new Error(d.error);
            setPayslipTestResult({
                ok: true,
                msg: `Test run done — emailed ${d.emailed || 0}/5, SMS ${d.smsed || 0}/5. Check inbox & phone.`,
                detail: d,
            });
        } catch (e) {
            setPayslipTestResult({ ok: false, msg: e.message || 'Test run failed' });
        }
        setPayslipTestBusy(false);
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

    useEffect(() => {
        if (!canSendPayslips || !month) return;
        const [yr2, mo2] = month.split('-');
        const ids = [...selectedIds];
        api.getPayslipReadiness(yr2, mo2, ids)
            .then(setPayslipReadiness)
            .catch(() => setPayslipReadiness(null));
    }, [month, canSendPayslips, lockedIds.size, selectedIds.size, payslipReadiness?.paid]);

    useEffect(() => {
        if (!month) return;
        const [yr2, mo2] = month.split('-');
        api.getPayrollReconciliation(yr2, mo2)
            .then(setPayrollRecon)
            .catch(() => setPayrollRecon(null));
    }, [month, lockedIds.size]);

    const loadPayrollRecon = async () => {
        const [yr2, mo2] = month.split('-');
        setReconLoading(true);
        try {
            const d = await api.getPayrollReconciliation(yr2, mo2);
            setPayrollRecon(d);
            setShowReconPanel(true);
        } catch {
            setPayrollRecon(null);
        }
        setReconLoading(false);
    };

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
        // Medical defaults: use OVERRIDE spouse/children count first (from CSV import),
        // then fall back to the employee record's family data.
        const ovSpouseCount    = getOv(emp.id, 'spouse_count', emp.hasSpouse ? 1 : 0);
        const ovChildrenCount  = getOv(emp.id, 'children_count', emp.numChildren);
        const defMedEE    = cfg.medical_ee    || 0;
        const defMedSP    = ovSpouseCount   >= 1 ? (cfg.medical_sp    || 0) : 0;
        const defMedCh1   = ovChildrenCount >= 1 ? (cfg.medical_child || 0) : 0;
        const defMedCh2   = ovChildrenCount >= 2 ? (cfg.medical_child || 0) : 0;
        // Safety net: if contract has no medical rates, use the CSV total directly
        // so TPC is always accurate even when contract is not fully configured.
        const csvMedTotal = getOv(emp.id, 'total_medical_csv', 0);
        const contractMedTotal = defMedEE + defMedSP + defMedCh1 + defMedCh2;
        // If contract gives 0 but CSV has a value, absorb CSV total into medical_ee
        const useCsvFallback = csvMedTotal > 0 && contractMedTotal === 0;

        // paid_days: use DB/override value if set, else default to full working days.
        // New joiners and mid-month exits are handled by entering the actual days worked
        // in the PD DAYS field — the calculation engine does: gross = salary × pd / workDays.
        const ov = {
            paid_days:         getOv(emp.id, 'paid_days', workDays),
            ot2_hrs:           getOv(emp.id, 'ot2_hrs', 0),
            ot3_hrs:           getOv(emp.id, 'ot3_hrs', 0),
            opd_claim:         getOv(emp.id, 'opd_claim', 0),
            reimbursement:     getOv(emp.id, 'reimbursement', 0),
            arrears:           getOv(emp.id, 'arrears', 0),
            special_allowance: getOv(emp.id, 'special_allowance', 0),
            fuel_mobile:       getOv(emp.id, 'fuel_mobile', 0),
            other_deduction:   getOv(emp.id, 'other_deduction', 0),
            advance_deduction: getOv(emp.id, 'advance_deduction', 0),
            loan_deduction:    getOv(emp.id, 'loan_deduction', 0),
            bonus_amount:      getOv(emp.id, 'bonus_amount', 0),
            medical_ee:   getOv(emp.id, 'medical_ee',  useCsvFallback ? csvMedTotal : defMedEE),
            medical_sp:   getOv(emp.id, 'medical_sp',  useCsvFallback ? 0           : defMedSP),
            medical_ch1:  getOv(emp.id, 'medical_ch1', useCsvFallback ? 0           : defMedCh1),
            medical_ch2:  getOv(emp.id, 'medical_ch2', useCsvFallback ? 0           : defMedCh2),
        };
        const srv = serverRows[emp.id] || serverRowsRef.current[emp.id];
        const calc = srv ? calcFromServer(srv, { ...ov, _payrollMonth: month }, emp.gross) : emptyServerCalc(ov);
        return { emp, cfg, calc, ov };
    });
    // Keep ref in sync so workDays save and lock handler always use current data
    rowsRef.current = rows;
    // Rebuild empMapRef on every render so persistEmployee always has the latest emp+cfg
    rows.forEach(({ emp, cfg }) => { empMapRef.current[emp.id] = { emp, cfg }; });

    const paidIdSet = new Set(payslipReadiness?.paidIds || []);
    const unpaidSelectedList = selectedIds.size > 0
        ? rows.filter(r => selectedIds.has(r.emp.id) && !paidIdSet.has(r.emp.id))
            .map(r => ({ id: r.emp.id, name: r.emp.name }))
        : (payslipReadiness?.notPaid || []);


    // Bulk helpers — placed HERE so filtered + rows are already defined
    const allSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));
    const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(filtered.map(e => e.id)));
    const selectedRows = rows.filter(r => selectedIds.has(r.emp.id));

    const T = rows.reduce((acc, { calc, ov }) => {
        // Calculated fields
        ['grossMonthly','incomeTax','eobi_ee','pfEE','totalDeductions','netPay',
            'eobi_er','sessi','gratuity','lifeIns','totalMedical','totalPayrollCost',
            'serviceCharges','salesTax','totalInvoice','otAmount','otherPaid','pfER',
            'bonusAccrual','bonusDisbursed','overhead'].forEach(k => {
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
        overridesRef.current = newOv; // keep sync ref in step with imported state
        setOverrides(newOv);
        // Save ONLY the employees that were in the import CSV — never overwrite others
        try {
            const [yr, mo] = month.split('-');
            const payload = filtered
                .filter(emp => importedIds.has(emp.id))
                .map(emp => {
                    // Contract lookup mirrors the main rows() logic: ID → name → BU → client
                    let cfg = emp.contractId && CONTRACT_MAP[emp.contractId];
                    const contractKey = emp.contractName?.toLowerCase()?.trim();
                    if (!cfg && contractKey) cfg = CONTRACT_MAP[contractKey];
                    const buKey = emp.contract?.toLowerCase()?.trim();
                    if (!cfg && buKey) cfg = CONTRACT_MAP[buKey];
                    cfg = cfg || CONTRACT_MAP[emp.client?.toLowerCase()?.trim()] || {};

                    const empOv = newOv[emp.id] || {};

                    // BUG FIX: Use employee record's family data as fallback when CSV
                    // did not contain Spouse/Children Count columns (they'd both be 0).
                    // This ensures spouse/children medical is ALWAYS included when the
                    // employee master has spouse_name / child1_name / child2_name filled.
                    const csvSpouseCount   = empOv.spouse_count   ?? null;
                    const csvChildrenCount = empOv.children_count ?? null;
                    const resolvedSpouseCount   = csvSpouseCount   != null ? csvSpouseCount   : (emp.hasSpouse   ? 1 : 0);
                    const resolvedChildrenCount = csvChildrenCount != null ? csvChildrenCount : (emp.numChildren ?? 0);

                    const empMedEE   = cfg.medical_ee    || 0;
                    const empMedSP   = resolvedSpouseCount   >= 1 ? (cfg.medical_sp    || 0) : 0;
                    const empMedCh1  = resolvedChildrenCount >= 1 ? (cfg.medical_child || 0) : 0;
                    const empMedCh2  = resolvedChildrenCount >= 2 ? (cfg.medical_child || 0) : 0;
                    const _csvMed    = empOv.total_medical_csv ?? 0;
                    const _useFallback = _csvMed > 0 && (empMedEE + empMedSP + empMedCh1 + empMedCh2) === 0;
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
                        remarks:           empOv.remarks           ?? '',
                        spouse_count:      resolvedSpouseCount,
                        children_count:    resolvedChildrenCount,
                        // Save family medical with actual resolved amounts (never 0 when family exists)
                        medical_ee:        _useFallback ? _csvMed  : (empOv.medical_ee  ?? empMedEE),
                        medical_sp:        _useFallback ? 0         : (empOv.medical_sp  ?? empMedSP),
                        medical_ch1:       _useFallback ? 0         : (empOv.medical_ch1 ?? empMedCh1),
                        medical_ch2:       _useFallback ? 0         : (empOv.medical_ch2 ?? empMedCh2),
                    };
                    return { employee_id: emp.id, ov, calc: {} };
                });
            if (payload.length > 0) {
                await api.savePayroll(yr, mo, payload, { inputsOnly: true });
                setCalcMsg(`Imported ${payload.length} input rows. Press Calculate / Update Payroll to recompute pay.`);
                console.log(`Import saved ${payload.length} employees to DB (inputs only)`);
            }
        } catch (e) { console.warn('Import save failed:', e.message); }
    };


    const handleLock = async () => {
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
            // Step 1: flush all pending per-emp timers then save every unlocked row
            Object.values(perEmpTimers.current).forEach(clearTimeout);
            perEmpTimers.current = {};
            clearTimeout(saveTimerRef.current);
            await persistAllUnlocked(workDaysRef.current);
            // Step 2: lock them
            const [yr, mo] = monthRef.current.split('-');
            await api.lockPayroll(yr, mo, toLock);
            setLockedIds(prev => new Set([...prev, ...toLock]));
            setLockedBy('You');
        } catch (e) { setIsSaving(false); alert('Lock failed: ' + e.message); }
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

    // EC — thin wrapper that wires EditableCell to this component's setOv / overrides
    // Defined here (not at module level) because it captures setOv, getOv, lockedIds
    const EC = ({ empId, field, def = 0, w = '68px' }) => (
        <EditableCell
            empId={empId}
            field={field}
            value={getOv(empId, field, def)}
            locked={lockedIds.has(empId)}
            w={w}
            setOv={setOv}
        />
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

    // #region agent log
    fetch('http://127.0.0.1:7862/ingest/e9557106-2f42-4248-bcaf-ee841cde492e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ea0c85'},body:JSON.stringify({sessionId:'ea0c85',hypothesisId:'C',runId:'pre-fix',location:'PayrollSheet.jsx:pre-return',message:'PayrollSheet reached JSX return',data:{month,employeeCount:EMPLOYEES.length,filteredCount:filtered.length,rowCount:rows.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return (
        <div className="dashboard">
            <header className="header">
                <h1>Payroll Sheet</h1>
                <p>Edit inputs, then press Calculate / Update Payroll — the server computes Net Pay and tax. Browser does not invent pay amounts.</p>
            </header>

            <div style={{ marginBottom: '1rem' }}>
                <button type="button" onClick={() => setShowAddClaims(v => !v)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(37,99,235,0.12)', border: '1px solid rgba(37,99,235,0.35)', color: '#60a5fa', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                    ADD OT / CLAIMS
                </button>
                {showAddClaims && (
                    <div style={{ marginTop: 10, padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                        <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-muted)' }}>
                            Unusual / other-source claims. Finance can Add; Superadmin can Replace/Remove. Dry-run first.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
                            <input placeholder="Employee code" value={addClaimsForm.employeeId} onChange={e => setAddClaimsForm(f => ({ ...f, employeeId: e.target.value }))} />
                            <input type="number" placeholder="OT1" value={addClaimsForm.ot1Hours} onChange={e => setAddClaimsForm(f => ({ ...f, ot1Hours: e.target.value }))} />
                            <input type="number" placeholder="OT2" value={addClaimsForm.ot2Hours} onChange={e => setAddClaimsForm(f => ({ ...f, ot2Hours: e.target.value }))} />
                            <input type="number" placeholder="OT3" value={addClaimsForm.ot3Hours} onChange={e => setAddClaimsForm(f => ({ ...f, ot3Hours: e.target.value }))} />
                            <input type="number" placeholder="Expense" value={addClaimsForm.expenseAmount} onChange={e => setAddClaimsForm(f => ({ ...f, expenseAmount: e.target.value }))} />
                            <input type="number" placeholder="Medical" value={addClaimsForm.medicalAmount} onChange={e => setAddClaimsForm(f => ({ ...f, medicalAmount: e.target.value }))} />
                            <select value={addClaimsForm.mode} onChange={e => setAddClaimsForm(f => ({ ...f, mode: e.target.value }))}>
                                <option value="add">Add</option>
                                {isSuperAdmin && <option value="replace">Replace</option>}
                                {isSuperAdmin && <option value="remove">Remove</option>}
                            </select>
                            <input placeholder="Reason (required)" value={addClaimsForm.reason} onChange={e => setAddClaimsForm(f => ({ ...f, reason: e.target.value }))} style={{ gridColumn: 'span 2' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button type="button" className="btn-secondary" onClick={async () => {
                                try {
                                    const [y, m] = month.split('-').map(Number);
                                    const d = await api.portalClaimsManualOverride({ ...addClaimsForm, month: m, year: y, dryRun: true });
                                    setAddClaimsMsg(`Dry-run OK${d.warning ? ' — ' + d.warning : ''}. After: OT2=${d.after?.ot2_hrs} OT3=${d.after?.ot3_hrs} Exp=${d.after?.reimbursement} Med=${d.after?.opd_claim}`);
                                } catch (e) { setAddClaimsMsg(e.message); }
                            }}>Dry-run</button>
                            <button type="button" className="btn-primary" onClick={async () => {
                                try {
                                    const [y, m] = month.split('-').map(Number);
                                    const d = await api.portalClaimsManualOverride({ ...addClaimsForm, month: m, year: y, dryRun: false });
                                    setAddClaimsMsg(`Committed.${d.warning ? ' ' + d.warning : ''}`);
                                } catch (e) { setAddClaimsMsg(e.message); }
                            }}>Commit</button>
                        </div>
                        {addClaimsMsg && <p style={{ marginTop: 8, fontSize: 13 }}>{addClaimsMsg}</p>}
                    </div>
                )}
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Payroll Month</div>
                    <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '7px 12px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none' }} />
                </div>
                <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>Working Days (calendar)</div>
                    <input type="number" value={workDays} min={28} max={31} onChange={e => setWorkDays(parseInt(e.target.value) || calendarDaysInMonthStr(month))}
                        title="Full-month days for this payroll month (e.g. July = 31). PD Days = calendar days − absences."
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
                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: 200 }}
                        title="Off (default): recalculate from hours already on this sheet. On: also merge approved claims OT/OPD/expense."
                    >
                        <input type="checkbox" checked={pullClaimsOnCalc} onChange={e => setPullClaimsOnCalc(e.target.checked)} disabled={isCalculating || isLocked} />
                        Also pull approved claims
                    </label>
                    <button
                        type="button"
                        onClick={handleCalculatePayroll}
                        disabled={isCalculating || isLocked}
                        title={isLocked ? 'Unlock payroll before calculating' : 'Server recalculates Net Pay / Tax (browser does not compute pay)'}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            background: isLocked ? '#333' : '#0ea5e9',
                            border: 'none', color: 'white',
                            padding: '8px 16px', borderRadius: '8px',
                            cursor: (isCalculating || isLocked) ? 'not-allowed' : 'pointer',
                            fontWeight: 700, opacity: isCalculating ? 0.7 : 1,
                        }}
                    >
                        <Calculator size={15} />
                        {isCalculating ? 'Calculating…' : 'Calculate / Update Payroll'}
                    </button>
                    {canManageLock && (
                        <button onClick={() => setShowRefresh(true)} disabled={isLocked || isCalculating}
                            title={isLocked ? 'Unlock payroll before refreshing' : 'Erase entered payroll data for this month'}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: isLocked ? 'transparent' : 'rgba(239,68,68,0.1)', border: isLocked ? '1px solid #333' : '1px solid rgba(239,68,68,0.35)', color: isLocked ? '#555' : '#f87171', padding: '8px 16px', borderRadius: '8px', cursor: isLocked ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                            <RefreshCw size={15} /> Refresh
                        </button>
                    )}
                    <button onClick={() => setShowImport(true)} disabled={isLocked || isCalculating}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: isLocked ? '#333' : 'var(--bg-card)', border: '1px solid var(--border)', color: isLocked ? '#555' : 'var(--text)', padding: '8px 16px', borderRadius: '8px', cursor: (isLocked || isCalculating) ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
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
                    {canSendPayslips && (
                        <>
                            {emailResult && <span style={{ fontSize: '0.8rem', color: emailResult.ok ? '#22c55e' : '#ef4444', marginRight: '0.5rem' }}>{emailResult.msg}</span>}
                            <button
                                type="button"
                                onClick={openSendPayslipsModal}
                                disabled={sendingEmails}
                                title={
                                    !payslipReadiness
                                        ? 'Loading payslip readiness…'
                                        : payslipReadiness.canSend
                                            ? (selectedIds.size > 0
                                                ? `Send to ${selectedIds.size} selected employee(s)`
                                                : (payslipReadiness.needsForceResend
                                                    ? 'Payslips already sent — open to force resend all locked'
                                                    : 'Select employees, or open and send to all locked'))
                                            : `Not ready: ${!payslipReadiness.allLocked
                                                ? (selectedIds.size > 0 ? 'selected employees must be locked' : 'lock all payroll rows')
                                                : `${payslipReadiness.notPaid?.length || unpaidSelectedList.length || 0} selected employee(s) not yet paid in Accounts Payable`}`
                                }
                                style={{
                                    background: payslipReadiness?.canSend ? '#7c3aed' : 'rgba(124,58,237,0.2)',
                                    border: payslipReadiness?.canSend ? 'none' : '1px solid rgba(124,58,237,0.45)',
                                    color: payslipReadiness?.canSend ? 'white' : '#c4b5fd',
                                    padding: '8px 16px', borderRadius: '8px', cursor: sendingEmails ? 'not-allowed' : 'pointer',
                                    fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px',
                                    opacity: sendingEmails ? 0.6 : 1,
                                }}>
                                {sendingEmails
                                    ? '📧 Sending...'
                                    : selectedIds.size > 0
                                        ? `📧 Send Payslips (${selectedIds.size})`
                                        : payslipReadiness?.needsForceResend
                                            ? '📧 Send Payslips (resend)'
                                            : '📧 Send Payslips'}
                            </button>
                        </>
                    )}
                    {isSuperAdmin && (
                        <button type="button" onClick={() => { setShowPayslipTestRun(true); setPayslipTestResult(null); }}
                            title="Send 5 sample July payslips to your email + SMS (QA before candidate rollout)"
                            style={{ background: 'transparent', border: '1px solid #38bdf8', color: '#38bdf8', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                            July Test Run
                        </button>
                    )}
                    {canManageLock && !isLocked && (
                        <>
                            <button onClick={handleLock} disabled={isCalculating} title={`Lock ${rows.length} visible employee(s)`} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f59e0b', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: isCalculating ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: isCalculating ? 0.6 : 1 }}>
                                <Lock size={15} /> Lock Payroll ({rows.length})
                            </button>
                        </>
                    )}
                    {canManageLock && isLocked && (
                        <button onClick={handleUnlock} disabled={isCalculating} title="Unlock payroll to allow edits" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)', padding: '8px 16px', borderRadius: '8px', cursor: isCalculating ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                            <Unlock size={15} /> Unlock
                        </button>
                    )}
                </div>
            </div>
            {calcMsg && (
                <div style={{
                    marginBottom: '0.75rem', padding: '10px 14px', borderRadius: 8,
                    background: /fail|error|locked/i.test(calcMsg) ? 'rgba(239,68,68,0.12)' : 'rgba(14,165,233,0.12)',
                    border: `1px solid ${/fail|error|locked/i.test(calcMsg) ? 'rgba(239,68,68,0.35)' : 'rgba(14,165,233,0.35)'}`,
                    color: /fail|error|locked/i.test(calcMsg) ? '#f87171' : '#7dd3fc',
                    fontSize: '0.85rem', fontWeight: 600,
                }}>
                    {calcMsg}
                </div>
            )}

            {/* Refresh Payroll Modal */}
            {showRefresh && (
                <RefreshPayrollModal
                    month={month}
                    onClose={() => setShowRefresh(false)}
                    onSuccess={() => {
                        // Reload DB data for this month (same effect as changing month)
                        const [yr, mo] = month.split('-');
                        overridesRef.current = {};
                        setOverrides({});
                        setLockedIds(new Set());
                        setLockedBy(null);
                        api.getPayroll(yr, mo).then(data => {
                            if (!data.rows || !data.rows.length) return;
                            const ov = {};
                            data.rows.forEach(r => { ov[r.employee_id] = { ...r }; });
                            overridesRef.current = ov;
                            setOverrides(ov);
                        }).catch(() => {});
                        setTimeout(() => setShowRefresh(false), 1800);
                    }}
                />
            )}

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
                        title="Preview first slip in a new tab and download HTML for all selected"
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8', padding: '5px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                        <FileTextIcon size={15} /> Generate Payslips
                    </button>
                    {canSendPayslips && (
                        <button type="button" onClick={openSendPayslipsModal}
                            title={`Email + SMS password-protected PDF payslips for ${selectedIds.size} selected employee(s)`}
                            style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd', padding: '5px 14px', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' }}>
                            📧 Email / SMS Payslips ({selectedIds.size})
                        </button>
                    )}
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

            {/* Send Payslips Modal */}
            {showSendPayslips && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '2rem' }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '560px' }}>
                        <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                            <h3 style={{ margin: 0 }}>Send Payslips — {month}</h3>
                            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                Password-protected PDF (CNIC 13 digits, no dashes) via email + SMS PDF link (7 days). No salary/OT amounts in SMS.
                            </p>
                        </div>
                        <div style={{ padding: '1.5rem 2rem', fontSize: '0.88rem' }}>
                            <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 12px', borderRadius: 8, marginBottom: '1rem', fontSize: '0.82rem' }}>
                                <strong>TRIAL MODE</strong> until Nov 2026 — employees should report issues to ops-support@asil.com.pk
                            </div>
                            {emailResult ? (
                                <div>
                                    <div style={{
                                        background: emailResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                                        border: `1px solid ${emailResult.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                                        color: emailResult.ok ? '#86efac' : '#fca5a5',
                                        padding: '12px 14px', borderRadius: 8, marginBottom: '1rem',
                                    }}>
                                        <strong>{emailResult.ok ? 'Send finished.' : 'Send did not complete.'}</strong>
                                        <div style={{ marginTop: 6 }}>{emailResult.msg}</div>
                                        {emailResult.emailCount != null && (
                                            <div style={{ marginTop: 8 }}>
                                                <div>Email confirmed: <strong>{emailResult.emailCount}</strong></div>
                                                <div>SMS confirmed: <strong>{emailResult.smsCount}</strong></div>
                                            </div>
                                        )}
                                    </div>
                                    {emailResult.deliveries?.length > 0 && (
                                        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                                            {emailResult.deliveries.map((d) => (
                                                <li key={d.id} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                                                    <div style={{ fontWeight: 700 }}>{d.name || d.id}</div>
                                                    <div style={{ marginTop: 4, color: String(d.emailStatus).startsWith('sent') ? '#86efac' : d.emailStatus === 'failed' ? '#fca5a5' : '#fbbf24' }}>
                                                        Email: {String(d.emailStatus).startsWith('sent') ? `sent to ${d.email}` : (d.emailDetail || d.emailStatus || 'not sent')}
                                                    </div>
                                                    <div style={{ marginTop: 2, color: String(d.smsStatus).startsWith('sent') ? '#86efac' : d.smsStatus === 'failed' ? '#fca5a5' : '#fbbf24' }}>
                                                        SMS: {String(d.smsStatus).startsWith('sent') ? `sent to ${d.phone}` : (d.smsDetail || d.smsStatus || 'not sent')}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            ) : !payslipReadiness ? (
                                <p style={{ color: 'var(--text-muted)' }}>Loading readiness…</p>
                            ) : (
                                <>
                                    <div style={{
                                        background: selectedIds.size > 0 ? 'rgba(124,58,237,0.12)' : 'rgba(56,189,248,0.1)',
                                        border: `1px solid ${selectedIds.size > 0 ? 'rgba(124,58,237,0.4)' : 'rgba(56,189,248,0.35)'}`,
                                        color: selectedIds.size > 0 ? '#c4b5fd' : '#7dd3fc',
                                        padding: '10px 12px', borderRadius: 8, marginBottom: '1rem', fontSize: '0.85rem',
                                    }}>
                                        {selectedIds.size > 0
                                            ? <>Recipients: <strong>{selectedIds.size} selected</strong> employee(s) only.</>
                                            : <>No row selection — tick “Send to ALL locked” below, or cancel and select specific employees.</>}
                                    </div>
                                    {!payslipReadiness.canSend && (
                                        <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', padding: '10px 12px', borderRadius: 8, marginBottom: '1rem', fontSize: '0.85rem' }}>
                                            <strong>Not ready to send yet.</strong>
                                            <ul style={{ margin: '8px 0 0', paddingLeft: '1.2rem' }}>
                                                {!payslipReadiness.allLocked && (
                                                    <li>
                                                        {selectedIds.size > 0
                                                            ? `Selected employees must be locked (${payslipReadiness.lockedCount}/${payslipReadiness.totalRows || selectedIds.size}).`
                                                            : `Lock all payroll rows for this month (${payslipReadiness.lockedCount}/${payslipReadiness.totalRows} locked).`}
                                                    </li>
                                                )}
                                                {(!payslipReadiness.paid || unpaidSelectedList.length > 0) && (
                                                    <li>
                                                        {unpaidSelectedList.length
                                                            ? `${unpaidSelectedList.length} selected employee(s) are not yet marked paid in Accounts Payable.`
                                                            : 'Confirm bank payment in Accounts Payable for every selected employee.'}
                                                    </li>
                                                )}
                                            </ul>
                                        </div>
                                    )}
                                    <ul style={{ margin: '0 0 1rem', paddingLeft: '1.2rem', lineHeight: 1.6 }}>
                                        <li>
                                            {selectedIds.size > 0
                                                ? `${payslipReadiness.employeeCount} selected locked employee(s) will receive payslips`
                                                : `${payslipReadiness.employeeCount} locked employees in month (send-all scope)`}
                                        </li>
                                        <li>{payslipReadiness.withEmail} with email</li>
                                        <li>{payslipReadiness.withPhone} with phone (SMS link)</li>
                                        <li style={{ color: payslipReadiness.paid ? '#86efac' : '#fca5a5' }}>
                                            Paid in AP: {payslipReadiness.paidCount ?? 0}/{payslipReadiness.employeeCount} in scope
                                            {payslipReadiness.paid ? ' (all paid)' : ''}
                                        </li>
                                        {unpaidSelectedList.length > 0 && (
                                            <li style={{ color: '#fca5a5' }}>
                                                Unpaid (cannot send until AP confirms):
                                                <ul style={{ margin: '6px 0 0', paddingLeft: '1.1rem' }}>
                                                    {unpaidSelectedList.map((e) => (
                                                        <li key={e.id}>{e.name} ({e.id})</li>
                                                    ))}
                                                </ul>
                                            </li>
                                        )}
                                        {payslipReadiness.alreadyDeliveredCount > 0 && (
                                            <li style={{ color: '#fbbf24' }}>
                                                {payslipReadiness.alreadyDeliveredCount} in this scope already delivered
                                                {payslipReadiness.needsForceResend ? ' — tick force resend to send again' : ' (new recipients can still be sent)'}.
                                            </li>
                                        )}
                                        {payslipReadiness.missingCnic?.length > 0 && (
                                            <li style={{ color: '#f87171' }}>{payslipReadiness.missingCnic.length} missing CNIC (will be skipped)</li>
                                        )}
                                    </ul>
                                    {selectedIds.size === 0 && (
                                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: '0.75rem' }}>
                                            <input type="checkbox" checked={sendAllPayslips} onChange={e => setSendAllPayslips(e.target.checked)} />
                                            <span>Send to <strong>ALL</strong> locked employees for this month</span>
                                        </label>
                                    )}
                                    {(payslipReadiness.needsForceResend || payslipReadiness.alreadyDeliveredCount > 0) && (
                                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: '0.75rem' }}>
                                            <input type="checkbox" checked={forceResendPayslips} onChange={e => setForceResendPayslips(e.target.checked)} />
                                            <span>Force resend to employees who already received this month</span>
                                        </label>
                                    )}
                                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={sendPayslipConfirm}
                                            onChange={e => setSendPayslipConfirm(e.target.checked)}
                                            disabled={!payslipReadiness.canSend || unpaidSelectedList.length > 0 || (selectedIds.size === 0 && !sendAllPayslips)}
                                        />
                                        <span>I confirm payroll is locked, bank-paid, and ready to send payslips.</span>
                                    </label>
                                </>
                            )}
                        </div>
                        <div style={{ padding: '0 2rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button type="button" onClick={() => { setShowSendPayslips(false); setEmailResult(null); }} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>{emailResult ? 'Close' : 'Cancel'}</button>
                            {!emailResult && (
                            <button
                                type="button"
                                onClick={sendPayslipEmails}
                                disabled={
                                    !payslipReadiness?.canSend
                                    || unpaidSelectedList.length > 0
                                    || !sendPayslipConfirm
                                    || sendingEmails
                                    || (selectedIds.size === 0 && !sendAllPayslips)
                                    || (payslipReadiness?.needsForceResend && !forceResendPayslips)
                                }
                                style={{
                                    background: (
                                        !payslipReadiness?.canSend
                                        || unpaidSelectedList.length > 0
                                        || !sendPayslipConfirm
                                        || (selectedIds.size === 0 && !sendAllPayslips)
                                        || (payslipReadiness?.needsForceResend && !forceResendPayslips)
                                    ) ? '#555' : '#7c3aed',
                                    border: 'none', color: 'white', padding: '0.7rem 1.5rem', borderRadius: '8px',
                                    cursor: (!payslipReadiness?.canSend || unpaidSelectedList.length > 0 || !sendPayslipConfirm) ? 'not-allowed' : 'pointer', fontWeight: 700,
                                }}>
                                {sendingEmails
                                    ? 'Sending…'
                                    : selectedIds.size > 0
                                        ? `Send to ${selectedIds.size} selected`
                                        : 'Send to all locked'}
                            </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* July payslip QA test-run (superadmin) */}
            {showPayslipTestRun && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '2rem' }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '520px' }}>
                        <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                            <h3 style={{ margin: 0 }}>July Payslip Test Run</h3>
                            <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                Sends 5 sample July payslips (OT 2X/3X, reimbursements, tax, net) to your email + SMS. Not live employee payroll.
                            </p>
                        </div>
                        <div style={{ padding: '1.5rem 2rem', display: 'grid', gap: '12px' }}>
                            <label style={{ display: 'grid', gap: 4, fontSize: '0.85rem' }}>
                                Email
                                <input value={payslipTestEmail} onChange={e => setPayslipTestEmail(e.target.value)}
                                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-dark)', color: 'var(--text)' }} />
                            </label>
                            <label style={{ display: 'grid', gap: 4, fontSize: '0.85rem' }}>
                                SMS phone
                                <input value={payslipTestPhone} onChange={e => setPayslipTestPhone(e.target.value)}
                                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-dark)', color: 'var(--text)' }} />
                            </label>
                            {payslipTestResult && (
                                <div style={{
                                    padding: '10px 12px', borderRadius: 8, fontSize: '0.85rem',
                                    background: payslipTestResult.ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                                    color: payslipTestResult.ok ? '#86efac' : '#fca5a5',
                                }}>
                                    {payslipTestResult.msg}
                                    {payslipTestResult.ok && payslipTestResult.detail?.emailed === 0 && (
                                        <div style={{ marginTop: 6, opacity: 0.9 }}>
                                            If emailed=0, check Render env: RESEND_API_KEY. If SMS=0, check JAZZ_SMS_USER / JAZZ_SMS_PASS / JAZZ_HTTPS_PROXY.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div style={{ padding: '0 2rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button type="button" onClick={() => setShowPayslipTestRun(false)}
                                style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>
                                Close
                            </button>
                            <button type="button" onClick={runPayslipTestDelivery} disabled={payslipTestBusy}
                                style={{ background: '#0ea5e9', border: 'none', color: 'white', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: payslipTestBusy ? 'not-allowed' : 'pointer', fontWeight: 700, opacity: payslipTestBusy ? 0.7 : 1 }}>
                                {payslipTestBusy ? 'Sending…' : 'Send 5 test payslips'}
                            </button>
                        </div>
                    </div>
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
                            <div style={{ marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Message (use {'{name}'} and {'{netPay}'} as placeholders)</div>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                {[
                    { l: 'Employees', v: rows.length, c: 'var(--primary)', s: 'In this run' },
                    { l: 'Total Gross Pay', v: Rs(T.grossMonthly), c: '#22c55e', s: 'Before deductions' },
                    { l: 'Total Net Pay', v: Rs(T.netPay), c: '#22c55e', s: 'Visible rows' },
                    { l: 'Locked (AP view)', v: Rs(payrollRecon?.lockedTotal ?? 0), c: '#38bdf8', s: 'Frozen locked net' },
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

            <div className="payroll-recon-bar">
                <div className="payroll-recon-bar__item">
                    <span className="payroll-recon-bar__label">AP batches</span>
                    <span className="payroll-recon-bar__value payroll-recon-bar__value--ap">{Rs(payrollRecon?.apTotal ?? 0)}</span>
                </div>
                <div className="payroll-recon-bar__item">
                    <span className="payroll-recon-bar__label">Ledger paid</span>
                    <span className="payroll-recon-bar__value">{Rs(payrollRecon?.paidTotal ?? 0)}</span>
                </div>
                <div className="payroll-recon-bar__item">
                    <span className="payroll-recon-bar__label">Exceptions</span>
                    <span className={`payroll-recon-bar__value${(
                        (payrollRecon?.unlocked?.length || 0)
                        + (payrollRecon?.orphans?.length || 0)
                        + (payrollRecon?.blankScope?.length || 0)
                        + (payrollRecon?.lockedNotPaid?.length || 0)
                    ) > 0 ? ' payroll-recon-bar__value--warn' : ''}`}>
                        {(payrollRecon?.unlocked?.length || 0)
                            + (payrollRecon?.orphans?.length || 0)
                            + (payrollRecon?.blankScope?.length || 0)
                            + (payrollRecon?.excludedByDates?.length || 0)
                            + (payrollRecon?.lockedNotPaid?.length || 0)
                            + (payrollRecon?.paidNotLocked?.length || 0)}
                    </span>
                </div>
                <div className="payroll-recon-bar__actions">
                    <button type="button" className="payroll-recon-btn" onClick={loadPayrollRecon} disabled={reconLoading}>
                        <Scale size={15} /> {reconLoading ? 'Loading…' : 'Reconcile'}
                    </button>
                </div>
            </div>

            {showReconPanel && payrollRecon && (
                <div className="payroll-recon-panel">
                    <div className="payroll-recon-panel__head">
                        <div>
                            <h3>Payroll vs AP — {month}</h3>
                            <p>Locked total must equal AP batch total after full confirm.</p>
                        </div>
                        <button type="button" className="payroll-recon-panel__close" onClick={() => setShowReconPanel(false)} aria-label="Close">
                            <X size={16} />
                        </button>
                    </div>
                    <div className="payroll-recon-kpis">
                        {[
                            ['Sheet total', payrollRecon.sheetTotal],
                            ['Locked (AP view)', payrollRecon.lockedTotal],
                            ['AP batches', payrollRecon.apTotal],
                            ['Ledger paid', payrollRecon.paidTotal],
                        ].map(([label, val]) => (
                            <div key={label} className="payroll-recon-kpi">
                                <div className="payroll-recon-bar__label">{label}</div>
                                <div className="payroll-recon-bar__value">{Rs(val)}</div>
                            </div>
                        ))}
                    </div>
                    {[
                        ['Unlocked', payrollRecon.unlocked],
                        ['Orphans (no employee)', payrollRecon.orphans],
                        ['Blank lock scope', payrollRecon.blankScope],
                        ['Excluded by DOJ/LWD', payrollRecon.excludedByDates],
                        ['Locked not paid', payrollRecon.lockedNotPaid],
                        ['Paid not locked', payrollRecon.paidNotLocked],
                    ].map(([title, list]) => (
                        <div key={title} className="payroll-recon-list">
                            <h4>{title} ({list?.length || 0})</h4>
                            {!list?.length ? (
                                <p className="payroll-recon-empty">None</p>
                            ) : (
                                <ul>
                                    {list.slice(0, 40).map((row, i) => (
                                        <li key={`${title}-${row.id || row.employee_id || i}`}>
                                            {row.name || row.employee_id || row.id}
                                            {row.net != null ? ` — ${Rs(row.net)}` : ''}
                                        </li>
                                    ))}
                                    {list.length > 40 && <li>…and {list.length - 40} more</li>}
                                </ul>
                            )}
                        </div>
                    ))}
                </div>
            )}

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
                                <th colSpan={10} style={{ padding: '6px', textAlign: 'center', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase' }}>EARNINGS (blue = editable)</th>
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
                                <TH label="Oth Allow" sub="Auto" /><TH label="Bns Disb" sub="Cash" color="#22c55e" />
                                <TH label="GROSS" color="#22c55e" sub="Auto" />
                                <TH label="Inc Tax" color="#f43f5e" sub="FBR" /><TH label="EOBI EE" sub="1%" /><TH label="PF EE" sub="8.33%" />
                                <TH label="Adv" sub="Edit" /><TH label="Loan" sub="Edit" /><TH label="Oth Ded" sub="Edit" />
                                <TH label="NET PAY" color="#22c55e" />
                                <TH label="EOBI ER" sub="5%" /><TH label="SESSI" /><TH label="Gratuity" sub="Auto" />
                                <TH label="Life Ins" /><TH label="Med EE" sub="Edit" /><TH label="Med SP" sub="Edit" />
                                <TH label="Med Ch1" sub="Edit" /><TH label="Med Ch2" sub="Edit" />
                                <TH label="Bonus" sub="Edit" /><TH label="Bns Accr" sub="Monthly" color="#f59e0b" /><TH label="Overhead" sub="Fixed" color="#f59e0b" /><TH label="PF ER" sub="8.33%" />
                                <TH label="Tot Cost" color="#a78bfa" />
                                <TH label="Svc Chg" color="#f59e0b" /><TH label="Sales Tax" /><TH label="INVOICE" color="#f59e0b" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(({ emp, cfg, calc }, i) => {
                                const isEmpLocked = lockedIds.has(emp.id);
                                const isEmpPaid = paidIdSet.has(emp.id);
                                const rowBg = selectedIds.has(emp.id) ? 'rgba(56,189,248,0.07)' : isEmpLocked ? 'rgba(239,68,68,0.04)' : (i % 2 === 0 ? 'var(--bg-card)' : '#171c28');
                                // ── NO CONTRACT WARNING ROW ──────────────────────────────────────────
                                if (cfg._noContract) {
                                    return (
                                        <tr key={emp.id} style={{ borderBottom: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' }}>
                                            <td colSpan={2} style={{ padding: '8px 12px', position: 'sticky', left: 0, zIndex: 2, background: 'rgba(239,68,68,0.05)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <AlertCircle size={14} color="#ef4444" />
                                                    <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#f87171' }}>{emp.name}</span>
                                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{emp.id}</span>
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
                                                <button
                                                    onClick={() => {
                                                        const [yr, mo] = month.split('-');
                                                        api.openPayslip(emp.id, mo, yr, { source: 'world_a' });
                                                    }}
                                                    title="Preview World A payslip"
                                                    style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '4px', padding: '2px 6px', color: '#22c55e', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                    Payslip
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
                                                        <span
                                                            title={`Payslip eligibility: ${isEmpLocked ? 'locked' : 'not locked'}, ${isEmpPaid ? 'paid in Accounts Payable' : 'not paid in Accounts Payable'}`}
                                                            style={{
                                                                fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.02em', whiteSpace: 'nowrap',
                                                                color: isEmpLocked && isEmpPaid ? '#86efac' : '#fbbf24',
                                                                background: isEmpLocked && isEmpPaid ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                                                                border: `1px solid ${isEmpLocked && isEmpPaid ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'}`,
                                                                borderRadius: '4px', padding: '1px 5px',
                                                            }}>
                                                            locked {isEmpLocked ? '✓' : '—'} / paid {isEmpPaid ? '✓' : '—'}
                                                        </span>
                                                        {(() => {
                                                            const isInvoiced =
                                                                invoiceStatus.invoicedClients.includes((emp.client || '').toLowerCase()) ||
                                                                invoiceStatus.invoicedContracts.includes((emp.contract || '').toLowerCase());
                                                            return isInvoiced ? (
                                                                <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '4px', padding: '1px 5px', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>INV ✓</span>
                                                            ) : null;
                                                        })()}
                                                    </div>
                                                    <div style={{ fontSize: '0.68rem', color: 'var(--primary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '-0.02em', marginTop: '2px' }}>{emp.id}</div>
                                                    {String(emp.client || '').toLowerCase().includes('wafi') && (() => {
                                                        const b = claimsBadgeStyle(emp);
                                                        return (
                                                            <span title={b.tooltip} style={{ fontSize: '0.6rem', fontWeight: 700, color: b.tone, background: `${b.tone}22`, border: `1px solid ${b.tone}55`, borderRadius: '4px', padding: '1px 5px', marginTop: '3px', display: 'inline-block' }}>
                                                                {b.category}
                                                            </span>
                                                        );
                                                    })()}
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{emp.designation}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ position: 'sticky', left: 216, zIndex: 2, background: rowBg, padding: '6px 7px', fontSize: '0.74rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: '140px' }}>{emp.contract}<br /><span style={{ fontSize: '0.68rem' }}>{emp.location}</span></td>
                                        <td style={{ position: 'sticky', left: 356, zIndex: 2, background: rowBg, padding: '6px 7px', textAlign: 'right', fontWeight: 600, borderRight: '2px solid var(--border)', whiteSpace: 'nowrap', fontSize: '0.82rem', minWidth: '80px' }}>{fmt(emp.gross)}</td>
                                        <td style={{ padding: '3px 3px' }}>
                                            <EC
                                                empId={emp.id}
                                                field="paid_days"
                                                def={resolveDisplayPaidDays(
                                                    { paid_days: getOv(emp.id, 'paid_days', workDays) },
                                                    calc,
                                                    workDays,
                                                )}
                                            />
                                        </td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="ot2_hrs" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="ot3_hrs" def={0} /></td>
                                        <RC val={calc.otAmount} muted={!calc.otAmount} />
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="opd_claim" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="reimbursement" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="arrears" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="special_allowance" def={0} /></td>
                                        <td style={{ padding: '3px 3px' }}><EC empId={emp.id} field="fuel_mobile" def={0} /></td>
                                        <RC val={calc.otherPaid} muted />
                                        <RC val={calc.bonusDisbursed} muted={!calc.bonusDisbursed} pos={calc.bonusDisbursed > 0} />
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
                                {/* Bns Disb */}<td style={{ padding: '6px 5px', textAlign: 'right', color: T.bonusDisbursed > 0 ? '#22c55e' : 'var(--text-muted)', fontWeight: T.bonusDisbursed > 0 ? 700 : 400 }}>{T.bonusDisbursed > 0 ? fmt(T.bonusDisbursed) : '—'}</td>
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
