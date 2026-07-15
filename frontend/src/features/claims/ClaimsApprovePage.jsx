import React, { useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';

export default function ClaimsApprovePage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', []);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    try {
      const r = await fetch(`${API}/api/portal-claims/approve/${token}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to load');
      setData(d);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { if (token) load(); else setError('Missing token'); }, [token]);

  const decide = async (submissionId, decision) => {
    const comment = decision === 'rejected' ? window.prompt('Rejection remark (optional):') || '' : '';
    setBusy(true); setMsg(''); setError('');
    try {
      const r = await fetch(`${API}/api/portal-claims/approve/${token}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, decision, comment }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Decision failed');
      setMsg(`Submission #${submissionId} ${decision}`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openAttachment = async (id, filename) => {
    const r = await fetch(`${API}/api/portal-claims/attachments/${id}`);
    const d = await r.json();
    if (!r.ok) { setError(d.error || 'Attachment failed'); return; }
    const byteChars = atob(d.content_base64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob = new Blob([bytes], { type: d.mime_type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || d.filename; a.click();
    URL.revokeObjectURL(url);
  };

  if (error && !data) {
    return <Shell><p style={{ color: '#b91c1c' }}>{error}</p></Shell>;
  }
  if (!data) return <Shell><p>Loading approval pack…</p></Shell>;

  const fillerKeys = Object.keys(data.byFiller || {});

  return (
    <Shell>
      <h1 style={{ margin: '0 0 6px', fontSize: '1.35rem' }}>Approve Claims</h1>
      <p style={{ margin: 0, color: '#64748b' }}>
        Claim month {data.period.claim_month}/{data.period.claim_year} · Approve by day 25 ·
        Pending {data.completion.pending} / {data.completion.total}
      </p>
      {data.period.approve_closed && <Banner color="#b91c1c">Approval window closed — contact ASIL if needed.</Banner>}
      {error && <Banner color="#b91c1c">{error}</Banner>}
      {msg && <Banner color="#15803d">{msg}</Banner>}

      {fillerKeys.map(filler => (
        <div key={filler} style={{ marginTop: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: '1rem' }}>From Claim Authority: {filler}</h2>
          {(data.byFiller[filler] || []).map(sub => {
            const items = (data.items || []).filter(i => i.submission_id === sub.id);
            const atts = (data.attachments || []).filter(a => a.submission_id === sub.id);
            const ot2 = items.filter(i => i.claim_type === 'OT' && Number(i.ot_multiplier_factor) === 2).reduce((s, i) => s + Number(i.ot_hours || 0), 0);
            const ot3 = items.filter(i => i.claim_type === 'OT' && Number(i.ot_multiplier_factor) === 3).reduce((s, i) => s + Number(i.ot_hours || 0), 0);
            const ot1 = items.filter(i => i.claim_type === 'OT' && Number(i.ot_multiplier_factor) === 1).reduce((s, i) => s + Number(i.ot_hours || 0), 0);
            const exp = items.filter(i => i.claim_type === 'EXPENSE').reduce((s, i) => s + Number(i.amount || 0), 0);
            const med = items.filter(i => i.claim_type === 'MEDICAL').reduce((s, i) => s + Number(i.amount || 0), 0);
            return (
              <div key={sub.id} style={{ borderTop: '1px solid #e2e8f0', padding: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{sub.employee_name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{sub.employee_id} · {sub.status} · {sub.client || '—'}</div>
                    <div style={{ fontSize: 13, marginTop: 6 }}>
                      OT 1× {ot1}h · OT 2× {ot2}h · OT 3× {ot3}h · Expense {exp} · Medical {med}
                    </div>
                    {atts.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {atts.map(a => (
                          <button key={a.id} type="button" style={linkBtn} onClick={() => openAttachment(a.id, a.filename)}>
                            📎 {a.filename}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {sub.status === 'submitted' && !data.period.approve_closed && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" disabled={busy} style={btnOk} onClick={() => decide(sub.id, 'approved')}>Approve</button>
                      <button type="button" disabled={busy} style={btnNo} onClick={() => decide(sub.id, 'rejected')}>Reject</button>
                    </div>
                  )}
                </div>
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, color: '#475569' }}>Line items</summary>
                  <ul style={{ fontSize: 13 }}>
                    {items.map(i => (
                      <li key={i.id}>{i.claim_type} · {String(i.claim_date).slice(0, 10)} · {i.ot_hours || i.amount} {i.ot_multiplier || ''} · {i.description || i.nature || ''}</li>
                    ))}
                  </ul>
                </details>
              </div>
            );
          })}
        </div>
      ))}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#f0fdf4,#ecfdf5)', padding: '24px 16px', fontFamily: 'Segoe UI, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
function Banner({ children, color }) {
  return <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#fff', borderLeft: `4px solid ${color}`, color }}>{children}</div>;
}
const btnOk = { background: '#15803d', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' };
const btnNo = { background: '#dc2626', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' };
const linkBtn = { background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, marginRight: 10, fontSize: 13 };
