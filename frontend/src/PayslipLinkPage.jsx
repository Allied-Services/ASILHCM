import React, { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';
const OPS_SUPPORT = 'ops-support@asil.com.pk';

export default function PayslipLinkPage({ token }) {
    const [meta, setMeta] = useState(null);
    const [error, setError] = useState('');
    const [issueText, setIssueText] = useState('');
    const [issueMsg, setIssueMsg] = useState('');

    useEffect(() => {
        fetch(`${API}/api/payslip/link/${encodeURIComponent(token)}/meta`)
            .then(r => r.json())
            .then(d => { if (d.error) throw new Error(d.error); setMeta(d); })
            .catch(e => setError(e.message || 'Link expired or invalid'));
    }, [token]);

    const download = () => {
        window.location.href = `${API}/api/payslip/link/${encodeURIComponent(token)}`;
    };

    const reportIssue = async (e) => {
        e.preventDefault();
        if (!issueText.trim()) return;
        try {
            const res = await fetch(`${API}/api/payslip/support-case`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: meta?.employeeId,
                    year: meta?.year,
                    month: meta?.month,
                    description: issueText.trim(),
                    channel: 'sms_link',
                }),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'Could not submit');
            setIssueMsg(`Case ${d.case?.case_no || ''} opened. We will email you at ops-support.`);
            setIssueText('');
        } catch (err) {
            setIssueMsg(err.message);
        }
    };

    return (
        <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter, sans-serif', padding: '2rem' }}>
            <div style={{ maxWidth: 520, margin: '0 auto', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '2rem' }}>
                <div style={{ background: '#fef3c7', color: '#92400e', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                    <strong>TRIAL MODE</strong> — Payslip delivery is in trial until November 2026. Report errors to {OPS_SUPPORT}.
                </div>
                <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.35rem' }}>Your Payslip</h1>
                {error ? (
                    <p style={{ color: '#f87171' }}>{error}</p>
                ) : !meta ? (
                    <p style={{ color: '#94a3b8' }}>Loading…</p>
                ) : (
                    <>
                        <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                            Employee: <strong style={{ color: '#e2e8f0' }}>{meta.employeeId}</strong><br />
                            Valid until: {new Date(meta.expiresAt).toLocaleString('en-PK')}
                        </p>
                        <p style={{ fontSize: '0.88rem', margin: '1rem 0' }}>
                            Download the PDF and open it with your <strong>CNIC number (digits only, no dashes)</strong> as the password.
                        </p>
                        <button type="button" onClick={download}
                            style={{ width: '100%', padding: '12px', background: '#38bdf8', color: '#0f172a', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', marginBottom: '1.5rem' }}>
                            Download Payslip PDF
                        </button>
                        <form onSubmit={reportIssue}>
                            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: 6 }}>Report an issue with this payslip</label>
                            <textarea value={issueText} onChange={e => setIssueText(e.target.value)} rows={4}
                                style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: 10, fontSize: '0.88rem' }}
                                placeholder="Describe what looks wrong…" />
                            <button type="submit" style={{ marginTop: 8, padding: '8px 16px', background: 'transparent', border: '1px solid #475569', color: '#94a3b8', borderRadius: 8, cursor: 'pointer' }}>
                                Submit to {OPS_SUPPORT}
                            </button>
                        </form>
                        {issueMsg && <p style={{ marginTop: 12, fontSize: '0.85rem', color: '#22c55e' }}>{issueMsg}</p>}
                    </>
                )}
            </div>
        </div>
    );
}
