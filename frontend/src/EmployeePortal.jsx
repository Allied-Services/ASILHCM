import React, { useState } from 'react';
import { ChevronLeft, LogOut, FileText, Phone, MessageSquare, Eye, EyeOff, ChevronDown, ChevronUp, CheckCircle } from 'lucide-react';

// ─── Sample payslip data ─────────────────────────────────────────────────────
// NOTE: This is intentionally empty for production. Payslips will be loaded
// from the database through the /api/employee/payslips endpoint.
const PAYSLIP_DB = {};

const Rs = n => `Rs. ${Math.round(n).toLocaleString('en-PK')}`;
const fmt = n => Math.round(n).toLocaleString('en-PK');

// ─── OTP Step ─────────────────────────────────────────────────────────────────
function OTPStep({ cnic, phone, onVerify, onBack }) {
    const [otp, setOtp] = useState('');
    const [sent, setSent] = useState(false);
    const [err, setErr] = useState('');

    const sendOTP = () => {
        setSent(true);
        setErr('');
    };

    const verify = () => {
        // Simulation: accept 123456
        if (otp === '123456') { onVerify(); }
        else { setErr('Incorrect OTP. Please try again. (Demo: use 123456)'); }
    };

    return (
        <div style={{ padding: '2rem 1.5rem' }}>
            <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: 'var(--ess-muted)', cursor: 'pointer', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                <ChevronLeft size={18} /> Back
            </button>

            <div style={{ marginBottom: '2rem' }}>
                <div style={{ fontWeight: 700, fontSize: '1.4rem', marginBottom: '6px' }}>Verify Your Phone</div>
                <div style={{ color: 'var(--ess-muted)', fontSize: '0.9rem' }}>We'll send a 6-digit code to <strong>{phone}</strong></div>
            </div>

            {!sent ? (
                <button onClick={sendOTP}
                    style={{ width: '100%', background: 'var(--ess-primary)', color: '#fff', border: 'none', padding: '1rem', borderRadius: '12px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <Phone size={18} /> Send OTP to {phone}
                </button>
            ) : (
                <div>
                    <div style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.88rem', color: 'var(--ess-success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CheckCircle size={16} /> OTP sent to {phone}
                    </div>
                    <input
                        type="number" inputMode="numeric" placeholder="Enter 6-digit OTP"
                        value={otp} onChange={e => setOtp(e.target.value)}
                        style={{ width: '100%', padding: '1rem', fontSize: '1.5rem', textAlign: 'center', letterSpacing: '0.5rem', border: `2px solid ${err ? '#dc2626' : '#e2e8f0'}`, borderRadius: '12px', outline: 'none', fontFamily: 'monospace', color: 'var(--ess-text)', background: 'var(--ess-card)', marginBottom: '0.75rem' }}
                    />
                    {err && <div style={{ color: 'var(--ess-danger)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{err}</div>}
                    <button onClick={verify}
                        style={{ width: '100%', background: 'var(--ess-primary)', color: '#fff', border: 'none', padding: '1rem', borderRadius: '12px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', marginBottom: '0.75rem' }}>
                        Verify & Login
                    </button>
                    <button onClick={sendOTP} style={{ width: '100%', background: 'none', border: '1px solid var(--ess-border)', color: 'var(--ess-muted)', padding: '0.75rem', borderRadius: '12px', cursor: 'pointer', fontSize: '0.9rem' }}>
                        Resend OTP
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
    const [cnic, setCnic] = useState('');
    const [phone, setPhone] = useState('');
    const [step, setStep] = useState('form'); // 'form' | 'otp'
    const [err, setErr] = useState('');

    const formatCNIC = (v) => {
        const digits = v.replace(/\D/g, '').slice(0, 13);
        if (digits.length <= 5) return digits;
        if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
        return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
    };

    const handleNext = () => {
        setErr('');
        const cnicClean = cnic.replace(/-/g, '');
        if (cnicClean.length !== 13) { setErr('Please enter a valid 13-digit CNIC.'); return; }
        if (!phone.match(/^0[0-9]{10}$/)) { setErr('Please enter a valid 11-digit mobile number (e.g. 0301-1234567).'); return; }
        if (!PAYSLIP_DB[cnic]) { setErr('CNIC not found. Please contact HR if you believe this is an error.'); return; }
        const emp = PAYSLIP_DB[cnic];
        if (emp.phone.replace(/\D/g, '') !== phone.replace(/\D/g, '')) { setErr('Phone number does not match our records.'); return; }
        setStep('otp');
    };

    if (step === 'otp') {
        return <OTPStep cnic={cnic} phone={phone} onVerify={() => onLogin(cnic)} onBack={() => setStep('form')} />;
    }

    return (
        <div style={{ padding: '2rem 1.5rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                <div style={{ width: '64px', height: '64px', background: 'var(--ess-primary)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                    <FileText size={32} color="#fff" />
                </div>
                <div style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--ess-primary)' }}>ASIL HCM</div>
                <div style={{ color: 'var(--ess-muted)', fontSize: '0.9rem', marginTop: '4px' }}>Employee Self-Service Portal</div>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: 'var(--ess-text)' }}>CNIC Number</label>
                <input
                    type="text" inputMode="numeric" placeholder="XXXXX-XXXXXXX-X"
                    value={cnic} onChange={e => setCnic(formatCNIC(e.target.value))}
                    style={{ width: '100%', padding: '0.9rem 1rem', fontSize: '1rem', border: '2px solid var(--ess-border)', borderRadius: '12px', outline: 'none', fontFamily: 'monospace', letterSpacing: '0.1rem', color: 'var(--ess-text)', background: 'var(--ess-card)', transition: 'border-color 0.2s' }}
                    onFocus={e => e.target.style.borderColor = 'var(--ess-primary)'}
                    onBlur={e => e.target.style.borderColor = 'var(--ess-border)'}
                />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: 'var(--ess-text)' }}>Registered Mobile Number</label>
                <input
                    type="tel" inputMode="numeric" placeholder="03XX-XXXXXXX"
                    value={phone} onChange={e => setPhone(e.target.value)}
                    style={{ width: '100%', padding: '0.9rem 1rem', fontSize: '1rem', border: '2px solid var(--ess-border)', borderRadius: '12px', outline: 'none', color: 'var(--ess-text)', background: 'var(--ess-card)', transition: 'border-color 0.2s' }}
                    onFocus={e => e.target.style.borderColor = 'var(--ess-primary)'}
                    onBlur={e => e.target.style.borderColor = 'var(--ess-border)'}
                />
            </div>

            {err && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.88rem', color: 'var(--ess-danger)' }}>
                    {err}
                </div>
            )}

            <button onClick={handleNext}
                style={{ width: '100%', background: 'var(--ess-primary)', color: '#fff', border: 'none', padding: '1rem', borderRadius: '12px', fontSize: '1rem', fontWeight: 700, cursor: 'pointer' }}>
                Continue →
            </button>

            <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.82rem', color: 'var(--ess-muted)' }}>
                Having trouble? Contact HR at <strong>hr@asil.com.pk</strong>
            </div>
        </div>
    );
}

// ─── Payslip Card ─────────────────────────────────────────────────────────────
function PayslipCard({ p, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);

    const Row = ({ label, value, green, red, bold }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--ess-border)', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--ess-muted)' }}>{label}</span>
            <span style={{ fontWeight: bold ? 700 : 500, color: green ? 'var(--ess-success)' : red ? 'var(--ess-danger)' : 'var(--ess-text)' }}>{value}</span>
        </div>
    );

    return (
        <div style={{ background: 'var(--ess-card)', border: '1px solid var(--ess-border)', borderRadius: '14px', marginBottom: '0.75rem', overflow: 'hidden' }}>
            <button onClick={() => setOpen(v => !v)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--ess-text)' }}>{p.month}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--ess-muted)', marginTop: '2px' }}>Net Pay: <strong style={{ color: 'var(--ess-success)' }}>{Rs(p.net)}</strong></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 700, background: p.status === 'Paid' ? 'rgba(22,163,74,0.12)' : 'rgba(245,158,11,0.12)', color: p.status === 'Paid' ? 'var(--ess-success)' : '#b45309' }}>
                        {p.status}
                    </span>
                    {open ? <ChevronUp size={18} color="var(--ess-muted)" /> : <ChevronDown size={18} color="var(--ess-muted)" />}
                </div>
            </button>

            {open && (
                <div style={{ padding: '0 1.25rem 1.25rem' }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--ess-muted)', marginBottom: '0.75rem' }}>Paid on: <strong>{p.paidOn}</strong></div>

                    <div style={{ fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ess-muted)', marginBottom: '6px' }}>Earnings</div>
                    <Row label="Basic Salary" value={Rs(p.basic)} />
                    <Row label="House Rent Allow." value={Rs(p.hra)} />
                    <Row label="Conveyance" value={Rs(p.conv)} />
                    <Row label="Medical Allowance" value={Rs(p.med)} />
                    {p.ot > 0 && <Row label="Overtime" value={Rs(p.ot)} />}
                    {p.opd > 0 && <Row label="OPD Reimbursement" value={Rs(p.opd)} />}
                    {p.reimb > 0 && <Row label="Expense Reimburse." value={Rs(p.reimb)} />}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: '0.92rem', fontWeight: 700, marginBottom: '8px' }}>
                        <span>Gross Salary</span><span style={{ color: 'var(--ess-text)' }}>{Rs(p.gross)}</span>
                    </div>

                    <div style={{ fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ess-muted)', marginBottom: '6px' }}>Deductions</div>
                    <Row label="Income Tax (FBR)" value={`- ${Rs(p.wht)}`} red={p.wht > 0} />
                    <Row label="EOBI (Employee 1%)" value={`- ${Rs(p.eobi_ee)}`} red />
                    {p.pf_ee > 0 && <Row label="Provident Fund EE" value={`- ${Rs(p.pf_ee)}`} red />}
                    {p.adv > 0 && <Row label="Advance Recovery" value={`- ${Rs(p.adv)}`} red />}

                    <div style={{ background: 'var(--ess-primary)', borderRadius: '10px', padding: '0.9rem 1rem', marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#fff', fontWeight: 700, fontSize: '1rem' }}>NET PAY</span>
                        <span style={{ color: '#fff', fontWeight: 900, fontSize: '1.25rem' }}>{Rs(p.net)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Support Form ─────────────────────────────────────────────────────────────
function SupportForm({ emp, onBack }) {
    const [queue, setQueue] = useState('Payroll');
    const [msg, setMsg] = useState('');
    const [sent, setSent] = useState(false);

    const queues = [
        { id: 'Payroll', label: 'Payroll Query', sub: 'Salary, deductions, payslip errors', color: '#6366f1' },
        { id: 'Safety', label: 'Safety & HSEQ', sub: 'Incidents, PPE, site safety issues', color: '#f59e0b' },
        { id: 'Operations', label: 'Operations / HR', sub: 'Leave, schedule, site issues', color: '#22c55e' },
    ];

    const submit = () => {
        if (!msg.trim()) return;
        // In production: POST to /api/support with queue, message, emp details
        setSent(true);
    };

    if (sent) return (
        <div style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
            <div style={{ width: '64px', height: '64px', background: 'rgba(22,163,74,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <CheckCircle size={32} color="var(--ess-success)" />
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '8px' }}>Request Submitted</div>
            <div style={{ color: 'var(--ess-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>Your {queue} team will respond within 1 working day.</div>
            <button onClick={() => { setSent(false); setMsg(''); }}
                style={{ background: 'var(--ess-primary)', color: '#fff', border: 'none', padding: '0.9rem 2rem', borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}>
                Submit Another
            </button>
        </div>
    );

    return (
        <div style={{ padding: '1.5rem' }}>
            <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: 'var(--ess-muted)', cursor: 'pointer', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                <ChevronLeft size={18} /> Back
            </button>
            <div style={{ fontWeight: 700, fontSize: '1.2rem', marginBottom: '1.25rem' }}>Contact Support</div>

            <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '8px', color: 'var(--ess-text)' }}>Select Team</div>
                {queues.map(q => (
                    <button key={q.id} onClick={() => setQueue(q.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '0.9rem 1rem', borderRadius: '12px', border: `2px solid ${queue === q.id ? q.color : 'var(--ess-border)'}`, background: queue === q.id ? `${q.color}12` : 'var(--ess-card)', cursor: 'pointer', marginBottom: '0.5rem', textAlign: 'left', transition: 'all 0.15s' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: q.color, flexShrink: 0 }} />
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--ess-text)' }}>{q.label}</div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--ess-muted)' }}>{q.sub}</div>
                        </div>
                    </button>
                ))}
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: 'var(--ess-text)' }}>Your Message</label>
                <textarea
                    rows={5} value={msg} onChange={e => setMsg(e.target.value)}
                    placeholder={`Describe your ${queue.toLowerCase()} query...`}
                    style={{ width: '100%', padding: '0.9rem 1rem', fontSize: '0.9rem', border: '2px solid var(--ess-border)', borderRadius: '12px', outline: 'none', resize: 'vertical', color: 'var(--ess-text)', background: 'var(--ess-card)', fontFamily: 'inherit', lineHeight: 1.6 }}
                    onFocus={e => e.target.style.borderColor = 'var(--ess-primary)'}
                    onBlur={e => e.target.style.borderColor = 'var(--ess-border)'}
                />
            </div>

            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.82rem', color: 'var(--ess-muted)' }}>
                Submitting as: <strong style={{ color: 'var(--ess-text)' }}>{emp.name}</strong> · {emp.employeeCode}
            </div>

            <button onClick={submit} disabled={!msg.trim()}
                style={{ width: '100%', background: msg.trim() ? 'var(--ess-primary)' : '#cbd5e1', color: '#fff', border: 'none', padding: '1rem', borderRadius: '12px', fontSize: '1rem', fontWeight: 700, cursor: msg.trim() ? 'pointer' : 'not-allowed' }}>
                Submit to {queue} Team
            </button>
        </div>
    );
}

// ─── Dashboard (post-login) ───────────────────────────────────────────────────
function EmployeeDashboard({ emp, onLogout }) {
    const [screen, setScreen] = useState('home'); // 'home' | 'payslips' | 'support'
    const latest = emp.payslips[0];

    return (
        <div style={{ maxWidth: '430px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ background: 'var(--ess-primary)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', fontWeight: 600 }}>ALLIED SERVICES (PVT.) LTD. · ASIL HCM</div>
                    <div style={{ color: '#fff', fontWeight: 700, fontSize: '1.05rem', marginTop: '2px' }}>{emp.name}</div>
                    <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem' }}>{emp.designation}</div>
                </div>
                <button onClick={onLogout} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                    <LogOut size={18} color="#fff" />
                </button>
            </div>

            {/* Nav Tabs */}
            {screen !== 'support' && (
                <div style={{ display: 'flex', borderBottom: '1px solid var(--ess-border)', background: 'var(--ess-card)' }}>
                    {[{ id: 'home', label: 'Overview' }, { id: 'payslips', label: 'Payslips' }].map(t => (
                        <button key={t.id} onClick={() => setScreen(t.id)}
                            style={{ flex: 1, padding: '0.9rem', border: 'none', borderBottom: screen === t.id ? '3px solid var(--ess-primary)' : '3px solid transparent', background: 'none', fontWeight: screen === t.id ? 700 : 500, color: screen === t.id ? 'var(--ess-primary)' : 'var(--ess-muted)', cursor: 'pointer', fontSize: '0.9rem', transition: 'all 0.15s' }}>
                            {t.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Screens */}
            <div style={{ flex: 1, overflowY: 'auto', background: 'var(--ess-bg)' }}>

                {screen === 'home' && (
                    <div style={{ padding: '1.25rem' }}>
                        {/* Profile quick info */}
                        <div style={{ background: 'var(--ess-card)', borderRadius: '14px', padding: '1.25rem', marginBottom: '1rem', border: '1px solid var(--ess-border)' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ess-muted)', marginBottom: '0.75rem' }}>My Details</div>
                            {[
                                ['Employee Code', emp.employeeCode],
                                ['Department', emp.department.length > 30 ? emp.department.slice(0, 30) + '…' : emp.department],
                                ['Client', emp.client],
                                ['Site', emp.site],
                                ['Joining Date', emp.joiningDate],
                            ].map(([l, v]) => (
                                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.85rem', borderBottom: '1px solid var(--ess-border)' }}>
                                    <span style={{ color: 'var(--ess-muted)' }}>{l}</span>
                                    <span style={{ fontWeight: 600, color: 'var(--ess-text)', textAlign: 'right', maxWidth: '55%' }}>{v}</span>
                                </div>
                            ))}
                        </div>

                        {/* Latest payslip */}
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--ess-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>Latest Payslip — {latest.month}</div>
                        <PayslipCard p={latest} defaultOpen={true} />

                        <button onClick={() => setScreen('payslips')}
                            style={{ width: '100%', background: 'var(--ess-card)', border: '1px solid var(--ess-border)', color: 'var(--ess-primary)', padding: '0.85rem', borderRadius: '12px', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem', marginBottom: '1rem' }}>
                            View All Payslips →
                        </button>

                        {/* Support tile */}
                        <button onClick={() => setScreen('support')}
                            style={{ width: '100%', background: 'var(--ess-primary)', border: 'none', color: '#fff', padding: '1rem', borderRadius: '14px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', textAlign: 'left' }}>
                            <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: '10px', padding: '8px' }}><MessageSquare size={20} color="#fff" /></div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Contact Support</div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>Payroll · Safety · Operations</div>
                            </div>
                        </button>
                    </div>
                )}

                {screen === 'payslips' && (
                    <div style={{ padding: '1.25rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem' }}>Payslip History</div>
                        {emp.payslips.map((p, i) => <PayslipCard key={i} p={p} defaultOpen={i === 0} />)}
                    </div>
                )}

                {screen === 'support' && <SupportForm emp={emp} onBack={() => setScreen('home')} />}
            </div>

            {/* Footer */}
            <div style={{ background: 'var(--ess-card)', borderTop: '1px solid var(--ess-border)', padding: '0.75rem 1.5rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--ess-muted)' }}>
                Allied Services (Pvt.) Ltd. · ASIL HCM System · hr@asil.com.pk
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT — wraps in ess-root for light theme isolation
// ═══════════════════════════════════════════════════════════════════════════════
export default function EmployeePortal() {
    const [loggedInCnic, setLoggedInCnic] = useState(null);
    const emp = loggedInCnic ? PAYSLIP_DB[loggedInCnic] : null;

    return (
        <div className="ess-root" style={{ position: 'fixed', inset: 0, zIndex: 9000, overflowY: 'auto' }}>
            {!emp ? (
                <div style={{ maxWidth: '430px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <LoginScreen onLogin={cnic => setLoggedInCnic(cnic)} />
                </div>
            ) : (
                <EmployeeDashboard emp={emp} onLogout={() => setLoggedInCnic(null)} />
            )}
        </div>
    );
}
