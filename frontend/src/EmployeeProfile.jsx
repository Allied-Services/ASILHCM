import React, { useState, useEffect } from 'react';
import { ChevronLeft, Plus, X, Edit2, Save, TrendingUp, Calendar, Heart, Landmark, FileText,
         Calculator, AlertTriangle, CheckCircle, Shield, Trash2 } from 'lucide-react';
import { api } from './api';

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = n => (parseFloat(n) || 0).toLocaleString('en-PK');
const fmtRs = n => `Rs. ${fmt(n)}`;

const dateDiff = (d1, d2) => {
    const ms = new Date(d2 || Date.now()) - new Date(d1);
    const days = Math.floor(ms / 86400000);
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    return { years, months, days, totalDays: days };
};

// FBR 2025-26 Income Tax (WHT) — monthly
const calcWHT = (monthlyGross) => {
    const annual = monthlyGross * 12;
    let tax = 0;
    if (annual <= 600000) tax = 0;
    else if (annual <= 1200000) tax = (annual - 600000) * 0.05;
    else if (annual <= 2200000) tax = 30000 + (annual - 1200000) * 0.15;
    else if (annual <= 3200000) tax = 180000 + (annual - 2200000) * 0.25;
    else if (annual <= 4100000) tax = 430000 + (annual - 3200000) * 0.30;
    else tax = 700000 + (annual - 4100000) * 0.35;
    return Math.round(tax / 12);
};

const calcEOBI = (gross) => {
    const cap = 37000;
    const wage = Math.min(gross, cap);
    return { employee: Math.round(wage * 0.01), employer: Math.round(wage * 0.05) };
};

const calcGratuity = (gross, doj, calcDate) => {
    const { years, months } = dateDiff(doj, calcDate);
    if (years < 1) return 0;
    const service = years + months / 12;
    return Math.round((gross / 26) * 30 * service);
};

const LEAVE_TYPES = { cl: { label: 'Casual Leave', total: 10, color: '#38bdf8' }, ml: { label: 'Medical Leave', total: 8, color: '#a78bfa' }, el: { label: 'Annual Leave', total: 14, color: '#22c55e' } };

const PUBLIC_HOLIDAYS = ['2026-03-23', '2026-05-01', '2026-05-12', '2026-06-28', '2026-06-29', '2026-07-06', '2026-08-14', '2026-09-06', '2026-11-09', '2026-12-25'];

// ── Mini helpers ─────────────────────────────────────────────────────────────
const Card = ({ children, style = {} }) => <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem', ...style }}>{children}</div>;
const STitle = ({ children }) => <h3 style={{ margin: '0 0 1.25rem', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>{children}</h3>;
const Row = ({ label, value, highlight }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.88rem' }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontWeight: highlight ? 700 : 500, color: highlight ? 'var(--primary)' : 'var(--text)', maxWidth: '55%', textAlign: 'right' }}>{value}</span>
    </div>
);
const FInput = ({ value, onChange, ph = '', type = 'text', style = {} }) => (
    <input type={type} value={value} placeholder={ph} onChange={onChange} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '7px 10px', color: 'var(--text)', fontSize: '0.88rem', outline: 'none', width: '100%', boxSizing: 'border-box', ...style }} />
);
const FLabel = ({ children }) => <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px', display: 'block' }}>{children}</label>;
const FField = ({ label, children }) => <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}><FLabel>{label}</FLabel>{children}</div>;

// ── PAYSLIP MODAL ────────────────────────────────────────────────────────────
function PayslipModal({ payslip, employee, onClose }) {
    const eobi = calcEOBI(payslip.gross || employee.salary);
    const wht = calcWHT(payslip.gross || employee.salary);
    const totalEarnings = (payslip.gross || 0) + (payslip.ot_amount || 0) + (payslip.reimbursements || 0);
    const totalDed = eobi.employee + wht + (payslip.advance_deduction || 0) + (payslip.other_deductions || 0);
    const netPay = totalEarnings - totalDed;

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '2rem' }}>
            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                    <div><h3 style={{ margin: 0 }}>Payslip — {payslip.month}</h3><p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{employee.name} · {employee.id}</p></div>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                </div>
                <div style={{ padding: '1.5rem 2rem' }}>
                    {/* Earnings */}
                    <div style={{ background: 'var(--bg-dark)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#22c55e', marginBottom: '0.75rem' }}>▲ Earnings</div>
                        {[['Basic Salary', payslip.basic], ['HRA (House Rent)', payslip.hra], ['Conveyance Allowance', payslip.conveyance], ['Medical Allowance', payslip.medical_allowance], ['Other Allowances', payslip.other_allowances], ['Overtime', payslip.ot_amount || 0], ['Reimbursements', payslip.reimbursements || 0]].map(([l, v]) => v > 0 && (
                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}><span style={{ color: 'var(--text-muted)' }}>{l}</span><span>{fmtRs(v)}</span></div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}><span>Total Earnings</span><span style={{ color: '#22c55e' }}>{fmtRs(totalEarnings)}</span></div>
                    </div>

                    {/* Deductions */}
                    <div style={{ background: 'var(--bg-dark)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#f43f5e', marginBottom: '0.75rem' }}>▼ Deductions</div>
                        {[
                            ['EOBI (Employee 1%)', eobi.employee],
                            ['Income Tax / WHT (FBR 2025-26)', wht],
                            ['Advance Recovery', payslip.advance_deduction || 0],
                            ['Other Deductions', payslip.other_deductions || 0],
                        ].map(([l, v]) => (
                            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', padding: '3px 0' }}>
                                <span style={{ color: 'var(--text-muted)' }}>{l}</span>
                                <span style={{ color: v > 0 ? '#f43f5e' : 'var(--text-muted)' }}>{fmtRs(v)}</span>
                            </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}><span>Total Deductions</span><span style={{ color: '#f43f5e' }}>{fmtRs(totalDed)}</span></div>
                    </div>

                    {/* Net */}
                    <div style={{ background: 'linear-gradient(135deg,rgba(56,189,248,0.15),rgba(99,102,241,0.15))', border: '1px solid var(--primary)', borderRadius: '10px', padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Net Pay</span>
                        <span style={{ fontWeight: 800, fontSize: '1.4rem', color: 'var(--primary)' }}>{fmtRs(netPay)}</span>
                    </div>

                    {/* Tax note */}
                    {wht > 0 && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>ℹ Income Tax calculated per FBR 2025-26 slab. Annual equivalent: Rs. {fmt(payslip.gross * 12)} → Monthly WHT: {fmtRs(wht)}</p>}
                </div>
            </div>
        </div>
    );
}

// ── MAIN PROFILE ─────────────────────────────────────────────────────────────
export default function EmployeeProfile({ employee, user, onBack, onUpdate }) {
    const isSuperAdmin = user?.role === 'admin' || user?.role === 'superadmin';
    const [tab, setTab] = useState('personal');
    const [emp, setEmp] = useState(employee);
    const [viewPayslip, setViewPayslip] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState({});
    const [editSaving, setEditSaving] = useState(false);

    // ── Inline edit helpers ──────────────────────────────────────────────────
    const ef = (field) => editForm[field] ?? '';
    const setEf = (field, val) => setEditForm(p => ({ ...p, [field]: val }));
    const EI = ({ field, disabled = false, type = 'text', opts }) => (
        opts ? (
            <select value={ef(field)} onChange={e => setEf(field, e.target.value)} disabled={disabled}
                style={{ background: 'var(--bg-dark)', border: `1px solid ${disabled ? '#555' : 'var(--primary)'}`, borderRadius: '6px', padding: '4px 8px', color: disabled ? 'var(--text-muted)' : 'var(--text)', fontSize: '0.85rem', width: '100%', opacity: disabled ? 0.55 : 1 }}>
                {opts.map(o => <option key={o}>{o}</option>)}
            </select>
        ) : (
            <input type={type} value={ef(field)} onChange={e => setEf(field, e.target.value)} disabled={disabled}
                style={{ background: 'var(--bg-dark)', border: `1px solid ${disabled ? '#555' : 'var(--primary)'}`, borderRadius: '6px', padding: '4px 8px', color: disabled ? 'var(--text-muted)' : 'var(--text)', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box', opacity: disabled ? 0.55 : 1 }} />
        )
    );
    const ERow = ({ label, field, disabled = false, type = 'text', opts }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: '1px solid var(--border)', gap: '8px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', minWidth: '44%', flexShrink: 0 }}>{label}{disabled && !isSuperAdmin ? ' 🔒' : ''}</span>
            <div style={{ flex: 1 }}><EI field={field} disabled={disabled && !isSuperAdmin} type={type} opts={opts} /></div>
        </div>
    );
    const startEdit = () => { setEditForm({ ...emp }); setIsEditing(true); };
    const cancelEdit = () => { setEditForm({}); setIsEditing(false); };
    const saveEdit = async () => {
        setEditSaving(true);
        try {
            const res = await api.updateEmployee(editForm.id, editForm);
            const updated = res.employee || editForm;
            setEmp(updated); onUpdate(updated);
            setIsEditing(false); setEditForm({});
        } catch (err) { alert('Save failed: ' + err.message); }
        setEditSaving(false);
    };

    // Salary History state
    const [showAddSalary, setShowAddSalary] = useState(false);
    const [newSalary, setNewSalary] = useState({ date: '', basic: '', hra: '', conveyance: '', medical_allowance: '', other_allowances: '', note: '' });

    // Leave state
    const [showAddLeave, setShowAddLeave] = useState(false);
    const [newLeave, setNewLeave] = useState({ type: 'cl', startDate: '', endDate: '', reason: '' });

    // Payroll state
    const [showAddPayroll, setShowAddPayroll] = useState(false);
    const latestSal = emp.salaryHistory?.[emp.salaryHistory.length - 1] || {};
    const [newPayroll, setNewPayroll] = useState({
        month: '', basic: latestSal.basic || 0, hra: latestSal.hra || 0, conveyance: latestSal.conveyance || 0,
        medical_allowance: latestSal.medical || 0, other_allowances: latestSal.other || 0,
        ot_hours: 0, ot_rate: '2x', ot_amount: 0, reimbursements: 0,
        advance_deduction: 0, other_deductions: 0, notes: ''
    });

    // Settlement state
    const [showSettlement, setShowSettlement] = useState(false);
    const [settlementReason, setSettlementReason] = useState('Resignation');
    const [settlementDate, setSettlementDate] = useState(new Date().toISOString().split('T')[0]);

    const save = (updated) => { setEmp(updated); onUpdate(updated); };

    // ── Handlers ─────────────────────────────────────────────────────────────
    const addSalaryRecord = () => {
        const gross = ['basic', 'hra', 'conveyance', 'medical_allowance', 'other_allowances'].reduce((s, k) => s + parseFloat(newSalary[k] || 0), 0);
        const record = { date: newSalary.date, basic: parseFloat(newSalary.basic) || 0, hra: parseFloat(newSalary.hra) || 0, conveyance: parseFloat(newSalary.conveyance) || 0, medical: parseFloat(newSalary.medical_allowance) || 0, other: parseFloat(newSalary.other_allowances) || 0, gross, note: newSalary.note || 'Increment' };
        const updated = { ...emp, salary: gross, lastSalary: gross, salaryHistory: [...(emp.salaryHistory || []), record] };
        save(updated); setShowAddSalary(false); setNewSalary({ date: '', basic: '', hra: '', conveyance: '', medical_allowance: '', other_allowances: '', note: '' });
    };

    const addLeave = () => {
        if (!newLeave.startDate || !newLeave.endDate) return alert('Start and End date required.');
        const days = Math.max(1, Math.round((new Date(newLeave.endDate) - new Date(newLeave.startDate)) / 86400000) + 1);
        const lv = emp.leaves || { cl: { total: 10, used: 0 }, ml: { total: 8, used: 0 }, el: { total: 14, used: 0 } };
        const typeLv = lv[newLeave.type];
        const updated = {
            ...emp,
            leaves: { ...lv, [newLeave.type]: { ...typeLv, used: (typeLv.used || 0) + days } },
            leaveHistory: [...(emp.leaveHistory || []), { ...newLeave, days, status: 'Approved' }]
        };
        save(updated); setShowAddLeave(false); setNewLeave({ type: 'cl', startDate: '', endDate: '', reason: '' });
    };

    const addPayroll = () => {
        if (!newPayroll.month) return alert('Month is required.');
        const eobi = calcEOBI(parseFloat(newPayroll.gross) || emp.salary);
        const record = {
            ...newPayroll,
            gross: ['basic', 'hra', 'conveyance', 'medical_allowance', 'other_allowances'].reduce((s, k) => s + parseFloat(newPayroll[k] || 0), 0),
            eobi_employee: eobi.employee, eobi_employer: eobi.employer,
            income_tax: calcWHT(parseFloat(newPayroll.basic) || emp.salary),
        };
        const updated = { ...emp, payrollHistory: [...(emp.payrollHistory || []), record] };
        save(updated); setShowAddPayroll(false);
    };

    // ── Settlement Calculation ────────────────────────────────────────────────
    const calcSettlement = () => {
        const gross = emp.salary || 0;
        const dailyRate = gross / 26;
        const now = new Date(settlementDate);
        const lastPayday = new Date(now.getFullYear(), now.getMonth(), 1);
        const daysWorked = Math.round((now - lastPayday) / 86400000) + 1;
        const remainingSalary = Math.round(daysWorked * dailyRate);
        const elBalance = (emp.leaves?.el?.total || 14) - (emp.leaves?.el?.used || 0);
        const leaveEncashment = Math.round(elBalance * dailyRate);
        const gratuity = calcGratuity(gross, emp.doj, settlementDate);
        const outstanding = 0; // TODO: advances
        return { daysWorked, dailyRate: Math.round(dailyRate), remainingSalary, elBalance, leaveEncashment, gratuity, outstanding, netSettlement: remainingSalary + leaveEncashment + gratuity - outstanding };
    };

    const svc = dateDiff(emp.doj, new Date());
    const currentSal = (emp.salaryHistory || []).slice(-1)[0] || { basic: emp.salary, hra: 0, conveyance: 0, medical: 0, other: 0, gross: emp.salary };
    const eobi = calcEOBI(currentSal.gross || emp.salary);
    const wht = calcWHT(currentSal.gross || emp.salary);

    const TABS = [
        { key: 'personal', label: 'Personal Info', icon: <FileText size={15} /> },
        { key: 'documents', label: 'Documents & Compliance', icon: <Shield size={15} /> },
        { key: 'salary', label: 'Salary & Increments', icon: <TrendingUp size={15} /> },
        { key: 'payroll', label: 'Payroll & Payslips', icon: <Calculator size={15} /> },
        { key: 'leaves', label: 'Leave Management', icon: <Calendar size={15} /> },
        { key: 'medical', label: 'Medical & Insurance', icon: <Heart size={15} /> },
        { key: 'settlement', label: 'Final Settlement', icon: <AlertTriangle size={15} /> },
    ];

    // ── Documents tab state ──────────────────────────────────────────────────
    const [docs, setDocs] = useState([]);
    const [docsLoaded, setDocsLoaded] = useState(false);
    const [showAddDoc, setShowAddDoc] = useState(false);
    const [editDoc, setEditDoc] = useState(null);
    const [docForm, setDocForm] = useState({ doc_type: 'cnic', doc_name: '', issue_date: '', expiry_date: '', issuing_authority: '', doc_no: '', notes: '' });

    useEffect(() => {
        if (tab === 'documents' && !docsLoaded) {
            api.getEmployeeDocs(emp.id)
                .then(d => { setDocs(d.documents || []); setDocsLoaded(true); })
                .catch(() => setDocsLoaded(true));
        }
    }, [tab, emp.id, docsLoaded]);

    // Also add CNIC from employee record as a synthetic doc if no docs loaded yet
    const allDocs = docsLoaded
        ? docs
        : [];

    const DOC_TYPES = [
        { value: 'cnic', label: 'CNIC / National ID' },
        { value: 'fitness_to_work', label: 'Fitness to Work Certificate' },
        { value: 'police_clearance', label: 'Police Clearance Certificate' },
        { value: 'passport', label: 'Passport' },
        { value: 'driving_license', label: 'Driving License' },
        { value: 'medical_certificate', label: 'Medical Certificate' },
        { value: 'other', label: 'Other' },
    ];

    const daysUntilExpiry = d => d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null;
    const docStatus = d => {
        if (!d.expiry_date) return { label: 'No Expiry', color: 'var(--text-muted)', bg: 'var(--bg-dark)' };
        const days = daysUntilExpiry(d.expiry_date);
        if (days < 0) return { label: 'Expired', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' };
        if (days <= 30) return { label: `Expires in ${days}d`, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' };
        if (days <= 90) return { label: `Expires in ${days}d`, color: '#eab308', bg: 'rgba(234,179,8,0.08)' };
        return { label: 'Valid', color: '#22c55e', bg: 'rgba(34,197,94,0.08)' };
    };

    const saveDoc = async () => {
        try {
            if (editDoc?.id) {
                const d = await api.updateEmployeeDoc(emp.id, editDoc.id, docForm);
                setDocs(p => p.map(x => x.id === editDoc.id ? d.document : x));
            } else {
                const d = await api.createEmployeeDoc(emp.id, docForm);
                setDocs(p => [...p, d.document]);
            }
            setShowAddDoc(false); setEditDoc(null);
            setDocForm({ doc_type: 'cnic', doc_name: '', issue_date: '', expiry_date: '', issuing_authority: '', doc_no: '', notes: '' });
        } catch (err) { alert('Save failed: ' + err.message); }
    };

    const deleteDoc = async (id) => {
        if (!confirm('Delete this document?')) return;
        try {
            await api.deleteEmployeeDoc(emp.id, id);
            setDocs(p => p.filter(x => x.id !== id));
        } catch (err) { alert('Delete failed: ' + err.message); }
    };

    const openAddDoc = () => {
        setEditDoc(null);
        setDocForm({ doc_type: 'cnic', doc_name: '', issue_date: '', expiry_date: '', issuing_authority: '', doc_no: '', notes: '' });
        setShowAddDoc(true);
    };
    const openEditDoc = (doc) => {
        setEditDoc(doc);
        setDocForm({ doc_type: doc.doc_type, doc_name: doc.doc_name || '', issue_date: doc.issue_date ? String(doc.issue_date).slice(0,10) : '', expiry_date: doc.expiry_date ? String(doc.expiry_date).slice(0,10) : '', issuing_authority: doc.issuing_authority || '', doc_no: doc.doc_no || '', notes: doc.notes || '' });
        setShowAddDoc(true);
    };

    return (
        <div className="dashboard">
            {/* Back */}
            <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginBottom: '1.5rem', fontSize: '0.9rem', padding: 0 }}>
                <ChevronLeft size={18} /> All Employees
            </button>

            {/* Header Card */}
            <Card style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                    <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'linear-gradient(135deg,var(--primary),#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: '1.3rem', flexShrink: 0 }}>
                        {emp.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{emp.name}</h1>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>{emp.id} · {emp.designation} · {emp.client}</p>
                        <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>{emp.location}, {emp.province} · Service: {svc.years}y {svc.months}m</p>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                        {[['Gross Salary', fmtRs(currentSal.gross || emp.salary)], ['EOBI (EE)', fmtRs(eobi.employee)], ['Income Tax', fmtRs(wht)], ['Net Est.', fmtRs((currentSal.gross || emp.salary) - eobi.employee - wht)]].map(([l, v]) => (
                            <div key={l} style={{ textAlign: 'center' }}><div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>{v}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{l}</div></div>
                        ))}
                    </div>
                    {!isEditing
                        ? <button onClick={startEdit} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1', color: '#6366f1', padding: '0.6rem 1.1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                            <Edit2 size={15} /> Edit Profile
                          </button>
                        : <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={cancelEdit} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.6rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Cancel</button>
                            <button onClick={saveEdit} disabled={editSaving} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#22c55e', border: 'none', color: 'white', padding: '0.6rem 1.1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                                <Save size={15} /> {editSaving ? 'Saving…' : 'Save Changes'}
                            </button>
                          </div>
                    }
                </div>
            </Card>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '2rem', overflowX: 'auto' }}>
                {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0.85rem 1.25rem', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t.key ? 'var(--primary)' : 'transparent'}`, color: tab === t.key ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', fontWeight: tab === t.key ? 700 : 400, fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                        {t.icon} {t.label}
                    </button>
                ))}
            </div>

            {/* ── TAB: Personal Info ── */}
            {tab === 'personal' && (<>
                {!isSuperAdmin && isEditing && <div style={{ background:'rgba(234,179,8,0.1)', border:'1px solid rgba(234,179,8,0.3)', borderRadius:'8px', padding:'0.6rem 1rem', fontSize:'0.84rem', color:'#eab308', marginBottom:'0.75rem' }}>🔒 Fields with lock icon can only be changed by an Administrator.</div>}
                {!isEditing && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                    <Card><STitle>Employment</STitle>
                        {[['Employee Code', emp.id], ['ASIL BU', emp.bu], ['Client', emp.client], ['Client BU', emp.clientBU], ['Department', emp.dept], ['Designation', emp.designation], ['Location', emp.location + ', ' + (emp.province || '')], ['Date of Joining', emp.doj], ['Status', emp.active === 'Yes' ? 'Active' : 'Inactive']].map(([l, v]) => <Row key={l} label={l} value={v || '—'} />)}
                    </Card>
                    <Card><STitle>Personal</STitle>
                        {[["Father's Name", emp.fatherName], ["Mother's Name", emp.motherName], ['CNIC', emp.cnic], ['CNIC Issue', emp.cnicIssue], ['CNIC Expiry', emp.cnicExpiry], ['Date of Birth', emp.dob], ['Place of Birth', emp.placeOfBirth], ['Religion', emp.religion], ['Marital Status', emp.maritalStatus]].map(([l, v]) => <Row key={l} label={l} value={v || '—'} />)}
                    </Card>
                    <Card><STitle>Contact</STitle>
                        {[['Primary Contact', emp.primaryContact], ['Emergency Contact', emp.emergencyContact], ['Email', emp.email], ['Present Address', emp.presentAddress], ['Permanent Address', emp.permanentAddress]].map(([l, v]) => <Row key={l} label={l} value={v || '—'} />)}
                    </Card>
                    <Card><STitle>Compliance & Banking</STitle>
                        {[['EOBI No.', emp.eobiNo], ['Bank', emp.bankName], ['Account No.', emp.bankAccount], ['Account Title', emp.accountTitle], ['NOK Name', emp.nokName], ['NOK Relation', emp.nokRelation], ['NOK Contact', emp.nokContact]].map(([l, v]) => <Row key={l} label={l} value={v || '—'} />)}
                    </Card>
                    {(emp.maritalStatus === 'Married') && (
                        <Card style={{ gridColumn: '1/-1' }}><STitle>Family Details</STitle>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', fontSize: '0.88rem' }}>
                                <div style={{ background: 'var(--bg-dark)', borderRadius: '8px', padding: '1rem' }}><div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '6px' }}>SPOUSE</div>{[['Name', emp.spouseName || '—'], ['Age', emp.spouseAge || '—'], ['CNIC', emp.spouseCnic || '—']].map(([l, v]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '2px 0' }}><span style={{ color: 'var(--text-muted)' }}>{l}</span><span>{v}</span></div>)}</div>
                                <div style={{ background: 'var(--bg-dark)', borderRadius: '8px', padding: '1rem' }}><div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '6px' }}>CHILD 1</div>{[['Name', emp.child1Name || '—'], ['Age', emp.child1Age || '—'], ['ID', emp.child1Id || '—']].map(([l, v]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '2px 0' }}><span style={{ color: 'var(--text-muted)' }}>{l}</span><span>{v}</span></div>)}</div>
                                <div style={{ background: 'var(--bg-dark)', borderRadius: '8px', padding: '1rem' }}><div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '6px' }}>CHILD 2</div>{[['Name', emp.child2Name || '—'], ['Age', emp.child2Age || '—'], ['ID', emp.child2Id || '—']].map(([l, v]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '2px 0' }}><span style={{ color: 'var(--text-muted)' }}>{l}</span><span>{v}</span></div>)}</div>
                            </div>
                        </Card>
                        )}
                </div>}
                {isEditing && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                    <Card><STitle>Employment</STitle>
                        <ERow label="Employee Code" field="id" disabled />
                        <ERow label="ASIL BU" field="bu" />
                        <ERow label="Client Name" field="client" />
                        <ERow label="Client BU" field="clientBU" />
                        <ERow label="Department" field="dept" />
                        <ERow label="Designation" field="designation" />
                        <ERow label="Location" field="location" />
                        <ERow label="Province" field="province" opts={['Sindh','Punjab','KPK','Balochistan','Gilgit-Baltistan','Islamabad']} />
                        <ERow label="Date of Joining" field="doj" type="date" />
                        <ERow label="Status (Admin Only)" field="active" disabled opts={['Yes','No']} />
                    </Card>
                    <Card><STitle>Personal</STitle>
                        <ERow label="Full Name (Admin Only)" field="name" disabled />
                        <ERow label="Father's Name" field="fatherName" />
                        <ERow label="Mother's Name" field="motherName" />
                        <ERow label="CNIC" field="cnic" />
                        <ERow label="CNIC Issue" field="cnicIssue" type="date" />
                        <ERow label="CNIC Expiry" field="cnicExpiry" type="date" />
                        <ERow label="Date of Birth" field="dob" type="date" />
                        <ERow label="Place of Birth" field="placeOfBirth" />
                        <ERow label="Religion" field="religion" />
                        <ERow label="Marital Status" field="maritalStatus" opts={['Single','Married','Divorced','Widowed']} />
                    </Card>
                    <Card><STitle>Contact</STitle>
                        <ERow label="Primary Contact" field="primaryContact" />
                        <ERow label="Emergency Contact" field="emergencyContact" />
                        <ERow label="Email" field="email" type="email" />
                        <ERow label="Present Address" field="presentAddress" />
                        <ERow label="Permanent Address" field="permanentAddress" />
                    </Card>
                    <Card><STitle>Compliance &amp; Banking</STitle>
                        <ERow label="EOBI No." field="eobiNo" />
                        <ERow label="Bank Name" field="bankName" />
                        <ERow label="Bank Account" field="bankAccount" />
                        <ERow label="Account Title" field="accountTitle" />
                        <ERow label="NOK Name" field="nokName" />
                        <ERow label="NOK Relation" field="nokRelation" />
                        <ERow label="NOK Contact" field="nokContact" />
                    </Card>
                    <Card style={{ gridColumn: '1/-1' }}><STitle>Family Details</STitle>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
                            <div><div style={{ fontWeight:600, fontSize:'0.75rem', color:'var(--text-muted)', marginBottom:'8px', textTransform:'uppercase' }}>Spouse</div>
                                <ERow label="Name" field="spouseName" /><ERow label="Age" field="spouseAge" /><ERow label="CNIC" field="spouseCnic" /></div>
                            <div><div style={{ fontWeight:600, fontSize:'0.75rem', color:'var(--text-muted)', marginBottom:'8px', textTransform:'uppercase' }}>Child 1</div>
                                <ERow label="Name" field="child1Name" /><ERow label="Age" field="child1Age" /><ERow label="ID" field="child1Id" /></div>
                            <div><div style={{ fontWeight:600, fontSize:'0.75rem', color:'var(--text-muted)', marginBottom:'8px', textTransform:'uppercase' }}>Child 2</div>
                                <ERow label="Name" field="child2Name" /><ERow label="Age" field="child2Age" /><ERow label="ID" field="child2Id" /></div>
                        </div>
                    </Card>
                </div>}
            </>)}


            {/* ── TAB: Salary & Increments ── */}
            {tab === 'salary' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.25rem' }}>
                        <button onClick={() => setShowAddSalary(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Plus size={16} /> Record Increment / Salary Change
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {(emp.salaryHistory || []).slice().reverse().map((s, i) => (
                            <Card key={i} style={{ borderLeft: `3px solid ${i === 0 ? '#22c55e' : 'var(--border)'}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '1rem' }}>{s.note || 'Salary Record'}</div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Effective: {s.date} {i === 0 && <span style={{ color: '#22c55e', fontWeight: 600 }}> ← Current</span>}</div>
                                    </div>
                                    <div style={{ fontWeight: 800, fontSize: '1.3rem', color: i === 0 ? '#22c55e' : 'var(--text)' }}>{fmtRs(s.gross)}</div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '0.75rem', background: 'var(--bg-dark)', borderRadius: '8px', padding: '1rem', fontSize: '0.85rem' }}>
                                    {[['Basic', s.basic], ['HRA', s.hra], ['Conveyance', s.conveyance], ['Medical', s.medical || s.medical_allowance || 0], ['Other', s.other || s.other_allowances || 0]].map(([l, v]) => (
                                        <div key={l} style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{fmtRs(v)}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{l}</div></div>
                                    ))}
                                </div>
                            </Card>
                        ))}
                        {!(emp.salaryHistory || []).length && <p style={{ color: 'var(--text-muted)' }}>No salary records yet.</p>}
                    </div>

                    {showAddSalary && (
                        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
                            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '600px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                                    <h3 style={{ margin: 0 }}>Record Salary Change / Increment</h3>
                                    <button onClick={() => setShowAddSalary(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                                </div>
                                <div style={{ padding: '1.5rem 2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div style={{ gridColumn: '1/-1' }}><FField label="Effective Date"><FInput type="date" value={newSalary.date} onChange={e => setNewSalary(p => ({ ...p, date: e.target.value }))} /></FField></div>
                                    <FField label="Basic Salary (Rs.)"><FInput type="number" value={newSalary.basic} onChange={e => setNewSalary(p => ({ ...p, basic: e.target.value }))} ph="e.g. 35000" /></FField>
                                    <FField label="HRA (Rs.)"><FInput type="number" value={newSalary.hra} onChange={e => setNewSalary(p => ({ ...p, hra: e.target.value }))} ph="0" /></FField>
                                    <FField label="Conveyance (Rs.)"><FInput type="number" value={newSalary.conveyance} onChange={e => setNewSalary(p => ({ ...p, conveyance: e.target.value }))} ph="0" /></FField>
                                    <FField label="Medical Allowance (Rs.)"><FInput type="number" value={newSalary.medical_allowance} onChange={e => setNewSalary(p => ({ ...p, medical_allowance: e.target.value }))} ph="0" /></FField>
                                    <FField label="Other Allowances (Rs.)"><FInput type="number" value={newSalary.other_allowances} onChange={e => setNewSalary(p => ({ ...p, other_allowances: e.target.value }))} ph="0" /></FField>
                                    <div style={{ background: 'rgba(56,189,248,0.1)', borderRadius: '8px', padding: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>New Gross</span>
                                        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmtRs(['basic', 'hra', 'conveyance', 'medical_allowance', 'other_allowances'].reduce((s, k) => s + parseFloat(newSalary[k] || 0), 0))}</span>
                                    </div>
                                    <div style={{ gridColumn: '1/-1' }}><FField label="Note / Reason"><FInput value={newSalary.note} onChange={e => setNewSalary(p => ({ ...p, note: e.target.value }))} ph="e.g. Annual Increment FY2026" /></FField></div>
                                </div>
                                <div style={{ padding: '0 2rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                    <button onClick={() => setShowAddSalary(false)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                    <button onClick={addSalaryRecord} style={{ background: '#22c55e', border: 'none', color: 'white', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}><CheckCircle size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />Save Increment</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── TAB: Payroll & Payslips ── */}
            {tab === 'payroll' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.25rem' }}>
                        <button onClick={() => setShowAddPayroll(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Plus size={16} /> Add Monthly Payroll Entry
                        </button>
                    </div>

                    {(emp.payrollHistory || []).length === 0 && <p style={{ color: 'var(--text-muted)' }}>No payroll entries yet. Add the first payslip above.</p>}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {(emp.payrollHistory || []).slice().reverse().map((p, i) => {
                            const gross = (p.basic || 0) + (p.hra || 0) + (p.conveyance || 0) + (p.medical_allowance || 0) + (p.other_allowances || 0);
                            const eobi2 = calcEOBI(gross); const wht2 = calcWHT(gross);
                            const netPay = gross + (p.ot_amount || 0) + (p.reimbursements || 0) - eobi2.employee - wht2 - (p.advance_deduction || 0) - (p.other_deductions || 0);
                            return (
                                <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                                    <div>
                                        <div style={{ fontWeight: 700 }}>{p.month}</div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Gross {fmtRs(gross)} · Deductions {fmtRs(eobi2.employee + wht2 + (p.advance_deduction || 0) + (p.other_deductions || 0))}</div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#22c55e' }}>{fmtRs(netPay)}</div><div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Net Pay</div></div>
                                        <button onClick={() => setViewPayslip({ ...p, gross, eobi_employee: eobi2.employee, income_tax: wht2 })} style={{ background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '5px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>View Payslip</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {showAddPayroll && (
                        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '2rem', overflowY: 'auto' }}>
                            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '700px', marginBottom: '2rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                                    <h3 style={{ margin: 0 }}>Add Monthly Payroll Entry</h3>
                                    <button onClick={() => setShowAddPayroll(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                                </div>
                                <div style={{ padding: '1.5rem 2rem' }}>
                                    <div style={{ marginBottom: '1rem' }}><FField label="Payroll Month (e.g. 2026-07)"><FInput type="month" value={newPayroll.month} onChange={e => setNewPayroll(p => ({ ...p, month: e.target.value }))} /></FField></div>
                                    <div style={{ background: 'var(--bg-dark)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem' }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: '#22c55e', marginBottom: '0.75rem' }}>Earnings</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                            {[['basic', 'Basic Salary'], ['hra', 'HRA'], ['conveyance', 'Conveyance'], ['medical_allowance', 'Medical Allowance'], ['other_allowances', 'Other Allowances']].map(([k, lbl]) => (
                                                <FField key={k} label={lbl}><FInput type="number" value={newPayroll[k]} onChange={e => setNewPayroll(p => ({ ...p, [k]: parseFloat(e.target.value) || 0 }))} /></FField>
                                            ))}
                                        </div>
                                        <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.75rem', paddingTop: '0.75rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                                            <FField label="OT Hours"><FInput type="number" value={newPayroll.ot_hours} onChange={e => {
                                                const h = parseFloat(e.target.value) || 0;
                                                const gross = (newPayroll.basic || 0) + (newPayroll.hra || 0) + (newPayroll.conveyance || 0) + (newPayroll.medical_allowance || 0) + (newPayroll.other_allowances || 0);
                                                const hrRate = gross / (26 * 8);
                                                setNewPayroll(p => ({ ...p, ot_hours: h, ot_amount: Math.round(h * hrRate * 2) }));
                                            }} /></FField>
                                            <FField label="OT Rate"><div style={{ padding: '8px 10px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.88rem', color: 'var(--text-muted)' }}>2× (Double Rate)</div></FField>
                                            <FField label="OT Amount (Rs.)"><div style={{ padding: '8px 10px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', fontWeight: 700, color: '#22c55e' }}>{fmtRs(newPayroll.ot_amount)}</div></FField>
                                            <FField label="Reimbursements (Rs.)"><FInput type="number" value={newPayroll.reimbursements} onChange={e => setNewPayroll(p => ({ ...p, reimbursements: parseFloat(e.target.value) || 0 }))} /></FField>
                                        </div>
                                    </div>
                                    <div style={{ background: 'var(--bg-dark)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem' }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.8rem', textTransform: 'uppercase', color: '#f43f5e', marginBottom: '0.75rem' }}>Deductions</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                            <div>
                                                <FLabel>EOBI (Auto-calculated)</FLabel>
                                                <div style={{ padding: '8px 10px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>Rs. {calcEOBI((newPayroll.basic || 0) + (newPayroll.hra || 0) + (newPayroll.conveyance || 0) + (newPayroll.medical_allowance || 0) + (newPayroll.other_allowances || 0)).employee.toLocaleString()}</div>
                                            </div>
                                            <div>
                                                <FLabel>Income Tax / WHT (Auto)</FLabel>
                                                <div style={{ padding: '8px 10px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>Rs. {calcWHT((newPayroll.basic || 0) + (newPayroll.hra || 0) + (newPayroll.conveyance || 0) + (newPayroll.medical_allowance || 0) + (newPayroll.other_allowances || 0)).toLocaleString()}</div>
                                            </div>
                                            <FField label="Advance Recovery (Rs.)"><FInput type="number" value={newPayroll.advance_deduction} onChange={e => setNewPayroll(p => ({ ...p, advance_deduction: parseFloat(e.target.value) || 0 }))} /></FField>
                                            <FField label="Other Deductions (Rs.)"><FInput type="number" value={newPayroll.other_deductions} onChange={e => setNewPayroll(p => ({ ...p, other_deductions: parseFloat(e.target.value) || 0 }))} /></FField>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                        <button onClick={() => setShowAddPayroll(false)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                        <button onClick={addPayroll} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Save Payroll Entry</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── TAB: Leaves ── */}
            {tab === 'leaves' && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.25rem' }}>
                        <button onClick={() => setShowAddLeave(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)', color: 'white', border: 'none', padding: '0.7rem 1.25rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                            <Plus size={16} /> Log Leave
                        </button>
                    </div>

                    {/* Leave Balance Summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.25rem', marginBottom: '2rem' }}>
                        {Object.entries(LEAVE_TYPES).map(([key, info]) => {
                            const lv = emp.leaves?.[key] || { total: info.total, used: 0 };
                            const bal = (lv.total || info.total) - (lv.used || 0);
                            const renewalDate = emp.doj ? `${new Date(emp.doj).getFullYear() + Math.ceil(svc.years) + 1}-${String(new Date(emp.doj).getMonth() + 1).padStart(2, '0')}-${String(new Date(emp.doj).getDate()).padStart(2, '0')}` : '—';
                            return (
                                <Card key={key}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{info.label}</div>
                                        <span style={{ background: info.color + '22', color: info.color, padding: '2px 8px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700 }}>{key.toUpperCase()}</span>
                                    </div>
                                    <div style={{ marginBottom: '0.75rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.85rem' }}>
                                            <span style={{ color: 'var(--text-muted)' }}>Used</span><span style={{ fontWeight: 600 }}>{lv.used || 0} / {lv.total || info.total} days</span>
                                        </div>
                                        <div style={{ background: 'var(--bg-dark)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', width: `${Math.min(100, ((lv.used || 0) / (lv.total || info.total)) * 100)}%`, background: info.color, borderRadius: '4px', transition: 'width 0.5s' }} />
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                                        <span style={{ color: 'var(--text-muted)' }}>Balance</span>
                                        <span style={{ fontWeight: 700, color: bal <= 2 ? '#ef4444' : info.color }}>{bal} days</span>
                                    </div>
                                    <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Renews: {renewalDate}</div>
                                </Card>
                            );
                        })}
                    </div>

                    {/* Leave History */}
                    <Card><STitle>Leave History</STitle>
                        {!(emp.leaveHistory || []).length && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No leave records yet.</p>}
                        {(emp.leaveHistory || []).slice().reverse().map((l, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.88rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                <div>
                                    <span style={{ background: LEAVE_TYPES[l.type]?.color + '22', color: LEAVE_TYPES[l.type]?.color, padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, marginRight: '8px' }}>{l.type?.toUpperCase()}</span>
                                    <span style={{ fontWeight: 600 }}>{l.startDate} → {l.endDate}</span>
                                    <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>({l.days} days)</span>
                                </div>
                                <div style={{ color: 'var(--text-muted)' }}>{l.reason}</div>
                                <span style={{ color: '#22c55e', fontSize: '0.8rem' }}>{l.status}</span>
                            </div>
                        ))}
                    </Card>

                    {showAddLeave && (
                        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
                            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '500px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                                    <h3 style={{ margin: 0 }}>Log Leave</h3>
                                    <button onClick={() => setShowAddLeave(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                                </div>
                                <div style={{ padding: '1.5rem 2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div style={{ gridColumn: '1/-1' }}>
                                        <FLabel>Leave Type</FLabel>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            {Object.entries(LEAVE_TYPES).map(([k, info]) => (
                                                <button key={k} onClick={() => setNewLeave(p => ({ ...p, type: k }))} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid', borderColor: newLeave.type === k ? info.color : 'var(--border)', background: newLeave.type === k ? info.color + '22' : 'transparent', color: newLeave.type === k ? info.color : 'var(--text-muted)', cursor: 'pointer', fontWeight: newLeave.type === k ? 700 : 400, fontSize: '0.85rem' }}>
                                                    {k.toUpperCase()}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <FField label="Start Date"><FInput type="date" value={newLeave.startDate} onChange={e => setNewLeave(p => ({ ...p, startDate: e.target.value }))} /></FField>
                                    <FField label="End Date"><FInput type="date" value={newLeave.endDate} onChange={e => setNewLeave(p => ({ ...p, endDate: e.target.value }))} /></FField>
                                    <div style={{ gridColumn: '1/-1' }}><FField label="Reason / Notes"><FInput value={newLeave.reason} onChange={e => setNewLeave(p => ({ ...p, reason: e.target.value }))} ph="Optional reason or notes" /></FField></div>
                                </div>
                                <div style={{ padding: '0 2rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                    <button onClick={() => setShowAddLeave(false)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                    <button onClick={addLeave} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>Log Leave</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── TAB: Medical & Insurance ── */}
            {tab === 'medical' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                    <Card>
                        <STitle><Heart size={14} /> Insurance Coverage</STitle>
                        {[['Coverage Type', emp.medicalType || 'Not Assigned'], ['Maternity Cover', emp.medicalMaternity || '—'], ['Total Coverage (Rs.)', emp.totalMedicalCoverage ? fmtRs(emp.totalMedicalCoverage) : '—']].map(([l, v]) => <Row key={l} label={l} value={v} />)}
                    </Card>
                    <Card>
                        <STitle>Dependants Covered</STitle>
                        {emp.maritalStatus === 'Married' ? (
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.88rem' }}><CheckCircle size={14} color="#22c55e" /><span style={{ fontWeight: 600 }}>Spouse:</span> {emp.spouseName || '—'}</div>
                                {emp.child1Name && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.88rem' }}><CheckCircle size={14} color="#22c55e" /> Child 1: {emp.child1Name} (Age {emp.child1Age})</div>}
                                {emp.child2Name && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.5rem 0', fontSize: '0.88rem' }}><CheckCircle size={14} color="#22c55e" /> Child 2: {emp.child2Name} (Age {emp.child2Age})</div>}
                                {!emp.child1Name && !emp.child2Name && <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No children on record.</p>}
                            </div>
                        ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>Employee is unmarried — Self coverage only.</p>}
                    </Card>
                    <Card style={{ gridColumn: '1/-1', background: 'rgba(56,189,248,0.04)', border: '1px dashed rgba(56,189,248,0.3)' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            💡 <strong>Insurance Plans Master</strong> is configured at the contract level under Client → Contract. Once a plan is assigned to this employee's contract, their premium and coverage details will auto-populate here.
                        </div>
                    </Card>
                </div>
            )}

            {/* ── TAB: Final Settlement ── */}
            {tab === 'settlement' && (
                <div>
                    <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.04)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}><AlertTriangle size={20} color="#eab308" /><h3 style={{ margin: 0, color: '#eab308' }}>Final Settlement Calculator</h3></div>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 1.5rem' }}>Calculate the full and final payment upon separation. This is calculated per Pakistani labour law.</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                            <FField label="Separation Reason">
                                <select value={settlementReason} onChange={e => setSettlementReason(e.target.value)} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.9rem' }}>
                                    {['Resignation', 'Termination', 'End of Contract', 'Retirement', 'Redundancy', 'Death in Service'].map(o => <option key={o}>{o}</option>)}
                                </select>
                            </FField>
                            <FField label="Last Working Date"><FInput type="date" value={settlementDate} onChange={e => setSettlementDate(e.target.value)} /></FField>
                            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                <button onClick={() => setShowSettlement(true)} style={{ width: '100%', background: '#eab308', border: 'none', color: '#000', padding: '0.75rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                                    <Calculator size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />Calculate Settlement
                                </button>
                            </div>
                        </div>
                    </Card>

                    {showSettlement && (() => {
                        const s = calcSettlement();
                        return (
                            <Card>
                                <h3 style={{ margin: '0 0 1.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle size={20} color="#22c55e" /> Settlement Breakdown — {settlementReason}</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                    {[
                                        { label: 'Days Worked (This Month)', value: s.daysWorked + ' days', color: 'var(--text)' },
                                        { label: 'Daily Rate (Gross÷26)', value: fmtRs(s.dailyRate), color: 'var(--text)' },
                                        { label: 'Remaining Salary', value: fmtRs(s.remainingSalary), color: '#22c55e' },
                                        { label: 'Annual Leave Balance', value: s.elBalance + ' days', color: 'var(--text)' },
                                        { label: 'Leave Encashment', value: fmtRs(s.leaveEncashment), color: '#22c55e' },
                                        { label: 'Gratuity (' + (svc.years < 1 ? '< 1 yr, not eligible' : svc.years + 'y ' + svc.months + 'm') + ')', value: svc.years >= 1 ? fmtRs(s.gratuity) : 'Not Eligible', color: svc.years >= 1 ? '#22c55e' : '#eab308' },
                                        { label: 'Outstanding Advances', value: fmtRs(s.outstanding), color: s.outstanding > 0 ? '#ef4444' : 'var(--text-muted)' },
                                    ].map(item => (
                                        <div key={item.label} style={{ background: 'var(--bg-dark)', borderRadius: '8px', padding: '1rem' }}>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>{item.label}</div>
                                            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: item.color }}>{item.value}</div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ background: 'linear-gradient(135deg,rgba(34,197,94,0.15),rgba(56,189,248,0.1))', border: '1px solid #22c55e', borderRadius: '12px', padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div><div style={{ fontWeight: 700, fontSize: '1rem' }}>NET FINAL SETTLEMENT</div><div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Remaining Salary + Leave Encashment + Gratuity − Advances</div></div>
                                    <div style={{ fontWeight: 900, fontSize: '1.8rem', color: '#22c55e' }}>{fmtRs(s.netSettlement)}</div>
                                </div>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '1rem' }}>ℹ EOBI withdrawal process to be initiated separately. Tax on gratuity applies if &gt; Rs. 600,000 per year of service.</p>
                            </Card>
                        );
                    })()}
                </div>
            )}

            {/* ── TAB: Documents & Compliance ── */}
            {tab === 'documents' && (
                <div>
                    {/* CNIC from employee record - always shown */}
                    <Card style={{ marginBottom: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                        <div style={{ gridColumn: '1/-1' }}><STitle><Shield size={14} /> CNIC on Record (from Employee Profile)</STitle></div>
                        {[['CNIC Number', emp.cnic || '—'], ['Issue Date', emp.cnicIssue ? String(emp.cnicIssue).slice(0,10) : '—'], ['Expiry Date', emp.cnicExpiry ? String(emp.cnicExpiry).slice(0,10) : '—']].map(([l, v]) => (
                            <div key={l}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>{l}</div>
                                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{v}</div>
                                {l === 'Expiry Date' && emp.cnicExpiry && (() => {
                                    const days = daysUntilExpiry(emp.cnicExpiry);
                                    const clr = days < 0 ? '#ef4444' : days <= 90 ? '#f59e0b' : '#22c55e';
                                    const msg = days < 0 ? '⚠️ Expired' : days <= 90 ? `⚠️ Expires in ${days} days` : `✅ Valid (${days} days)`;
                                    return <div style={{ fontSize: '0.78rem', color: clr, marginTop: '4px', fontWeight: 600 }}>{msg}</div>;
                                })()}
                            </div>
                        ))}
                        <div style={{ gridColumn: '1/-1', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            To update CNIC dates, use the <strong>Edit Profile</strong> button above (Personal Info → CNIC fields).
                        </div>
                    </Card>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                        <h3 style={{ margin: 0, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Additional Compliance Documents</h3>
                        <button onClick={openAddDoc}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--primary)', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                            <Plus size={15} /> Add Document
                        </button>
                    </div>

                    {!docsLoaded && <div style={{ color: 'var(--text-muted)', padding: '1rem' }}>Loading documents...</div>}

                    {docsLoaded && allDocs.length === 0 && (
                        <div style={{ border: '2px dashed var(--border)', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <Shield size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
                            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>No compliance documents added yet</div>
                            <div style={{ fontSize: '0.85rem' }}>Add Fitness to Work, Police Clearance, or any other required documents.</div>
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {allDocs.map(doc => {
                            const st = docStatus(doc);
                            const typeLabel = DOC_TYPES.find(t => t.value === doc.doc_type)?.label || doc.doc_type;
                            return (
                                <div key={doc.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                                            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{doc.doc_name || typeLabel}</span>
                                            <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, background: st.bg, color: st.color }}>{st.label}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.82rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                            <span>Type: <strong style={{ color: 'var(--text)' }}>{typeLabel}</strong></span>
                                            {doc.doc_no && <span>No: <strong style={{ color: 'var(--text)' }}>{doc.doc_no}</strong></span>}
                                            {doc.issue_date && <span>Issued: <strong style={{ color: 'var(--text)' }}>{String(doc.issue_date).slice(0,10)}</strong></span>}
                                            {doc.expiry_date && <span>Expires: <strong style={{ color: st.color }}>{String(doc.expiry_date).slice(0,10)}</strong></span>}
                                            {doc.issuing_authority && <span>Authority: <strong style={{ color: 'var(--text)' }}>{doc.issuing_authority}</strong></span>}
                                        </div>
                                        {doc.notes && <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{doc.notes}</div>}
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <button onClick={() => openEditDoc(doc)}
                                            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                            <Edit2 size={13} />
                                        </button>
                                        <button onClick={() => deleteDoc(doc.id)}
                                            style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Add / Edit Doc Modal */}
                    {showAddDoc && (
                        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '2rem' }}>
                            <div style={{ background: 'var(--bg-card)', borderRadius: '16px', border: '1px solid var(--border)', width: '100%', maxWidth: '580px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
                                    <h3 style={{ margin: 0 }}>{editDoc ? 'Edit' : 'Add'} Compliance Document</h3>
                                    <button onClick={() => { setShowAddDoc(false); setEditDoc(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
                                </div>
                                <div style={{ padding: '1.5rem 2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div style={{ gridColumn: '1/-1' }}>
                                        <FLabel>Document Type</FLabel>
                                        <select value={docForm.doc_type} onChange={e => setDocForm(p => ({ ...p, doc_type: e.target.value }))}
                                            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--text)', fontSize: '0.88rem', width: '100%' }}>
                                            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                    <FField label="Document Name / Reference">
                                        <FInput value={docForm.doc_name} onChange={e => setDocForm(p => ({ ...p, doc_name: e.target.value }))} ph="e.g. CNIC Renewal 2026" />
                                    </FField>
                                    <FField label="Document Number">
                                        <FInput value={docForm.doc_no} onChange={e => setDocForm(p => ({ ...p, doc_no: e.target.value }))} ph="ID / Certificate number" />
                                    </FField>
                                    <FField label="Issue Date">
                                        <FInput type="date" value={docForm.issue_date} onChange={e => setDocForm(p => ({ ...p, issue_date: e.target.value }))} />
                                    </FField>
                                    <FField label="Expiry Date">
                                        <FInput type="date" value={docForm.expiry_date} onChange={e => setDocForm(p => ({ ...p, expiry_date: e.target.value }))} />
                                    </FField>
                                    <div style={{ gridColumn: '1/-1' }}>
                                        <FField label="Issuing Authority">
                                            <FInput value={docForm.issuing_authority} onChange={e => setDocForm(p => ({ ...p, issuing_authority: e.target.value }))} ph="e.g. NADRA / Police / Hospital" />
                                        </FField>
                                    </div>
                                    <div style={{ gridColumn: '1/-1' }}>
                                        <FField label="Notes">
                                            <FInput value={docForm.notes} onChange={e => setDocForm(p => ({ ...p, notes: e.target.value }))} ph="Optional notes" />
                                        </FField>
                                    </div>
                                </div>
                                <div style={{ padding: '0 2rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                                    <button onClick={() => { setShowAddDoc(false); setEditDoc(null); }} style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--text)', padding: '0.7rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
                                    <button onClick={saveDoc} style={{ background: 'var(--primary)', border: 'none', color: 'white', padding: '0.7rem 1.75rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Save size={15} /> {editDoc ? 'Save Changes' : 'Add Document'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Payslip viewer */}
            {viewPayslip && <PayslipModal payslip={viewPayslip} employee={emp} onClose={() => setViewPayslip(null)} />}
        </div>
    );
}
