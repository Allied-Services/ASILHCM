import React, { useEffect, useMemo, useState } from 'react';
import { buildClaimPeopleStory } from './claimsPeople.js';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';

export default function ClaimsApprovePage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', []);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('pending'); // pending | all | decided

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
      setMsg(decision === 'approved'
        ? 'Approved — ASIL finance will push to payroll after review.'
        : 'Rejected — Claim Authority will be notified.');
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
    return <Shell><Alert tone="bad">{error}</Alert></Shell>;
  }
  if (!data) return <Shell><p style={{ color: '#334155' }}>Loading approval pack…</p></Shell>;

  const fillerKeys = Object.keys(data.byFiller || {});
  const settle = data.period.settlement_month
    ? `${data.period.settlement_month}/${data.period.settlement_year}`
    : 'following month';
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const claimLabel = data?.period
    ? `${monthNames[data.period.claim_month] || data.period.claim_month} ${data.period.claim_year}`
    : 'this cycle';

  if (data.period.approve_closed) {
    return (
      <Shell>
        <header style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: '#15803d', textTransform: 'uppercase' }}>ASIL HCM · Line Manager</div>
          <h1 style={{ margin: '4px 0 8px', fontSize: '1.55rem', color: '#0f172a', fontWeight: 700 }}>Deadline has expired</h1>
          <p style={{ margin: 0, color: '#334155', lineHeight: 1.55, maxWidth: 720 }}>
            The approval window for <strong>{claimLabel}</strong> is closed.
            You cannot approve or reject claims from this link.
          </p>
        </header>
        <Alert tone="bad">Deadline has expired. Raise claims next month.</Alert>
      </Shell>
    );
  }

  return (
    <Shell>
      <header style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: '#15803d', textTransform: 'uppercase' }}>ASIL HCM · Line Manager</div>
        <h1 style={{ margin: '4px 0 8px', fontSize: '1.55rem', color: '#0f172a', fontWeight: 700 }}>Approve Claims</h1>
        <p style={{ margin: 0, color: '#334155', lineHeight: 1.55, maxWidth: 720 }}>
          Claim month <strong>{data.period.claim_month}/{data.period.claim_year}</strong>
          {' · '}LM approve by day <strong>{data.period.approve_deadline_day || 22}</strong>
          {' · '}Settlement in payroll for <strong>{settle}</strong>
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
          <Stat label="Pending" value={data.completion.pending} tone="#b45309" />
          <Stat label="Final review" value={data.completion.final_review || 0} tone="#c2410c" />
          <Stat label="Approved" value={data.completion.approved} tone="#15803d" />
          <Stat label="Rejected" value={data.completion.rejected || 0} tone="#b91c1c" />
          <Stat label="Total" value={data.completion.total} tone="#334155" />
        </div>
        <p style={{ margin: '12px 0 0', color: '#64748b', fontSize: 13, lineHeight: 1.5, maxWidth: 720 }}>
          This link stays the same all month. Outstanding claims remain here until you decide.
          After day {data.period.approve_deadline_day || 22} the approval window closes; anything still pending rolls to the next month’s cycle.
        </p>
      </header>

      {error && <Alert tone="bad">{error}</Alert>}
      {msg && <Alert tone="good">{msg}</Alert>}

      <div style={{ display: 'flex', gap: 8, margin: '12px 0 16px', flexWrap: 'wrap' }}>
        {[
          { id: 'pending', label: 'Outstanding' },
          { id: 'all', label: 'All' },
          { id: 'decided', label: 'Already decided' },
        ].map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            style={{
              padding: '8px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              border: filter === f.id ? '2px solid #15803d' : '1px solid #cbd5e1',
              background: filter === f.id ? '#f0fdf4' : '#fff',
              color: '#0f172a',
            }}
          >{f.label}</button>
        ))}
      </div>

      {fillerKeys.length === 0 && (
        <div style={{ ...card, color: '#475569' }}>No claims in this pack yet.</div>
      )}

      {fillerKeys.map(filler => {
        const list = (data.byFiller[filler] || []).filter(sub => {
          if (filter === 'pending') return sub.status === 'submitted';
          if (filter === 'decided') return ['approved', 'rejected', 'in_payroll', 'no_claims'].includes(sub.status);
          return true;
        });
        if (!list.length) return null;
        return (
          <div key={filler} style={{ ...card, marginBottom: 16 }}>
            <h2 style={{ margin: '0 0 14px', fontSize: '0.95rem', color: '#0f172a' }}>
              From Claim Authority: <span style={{ color: '#1d4ed8' }}>{filler}</span>
            </h2>
            {list.map(sub => {
              const items = (data.items || []).filter(i => i.submission_id === sub.id);
              const atts = (data.attachments || []).filter(a => a.submission_id === sub.id);
              const ot1 = sumOt(items, 1);
              const ot2 = sumOt(items, 2);
              const ot3 = sumOt(items, 3);
              const exp = items.filter(i => i.claim_type === 'EXPENSE').reduce((s, i) => s + Number(i.amount || 0), 0);
              const med = items.filter(i => i.claim_type === 'MEDICAL').reduce((s, i) => s + Number(i.amount || 0), 0);
              const story = buildClaimPeopleStory(sub);
              return (
                <div key={sub.id} style={{
                  border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 12,
                  background: sub.status === 'submitted' ? '#fff' : '#f8fafc',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>{sub.employee_name}</div>
                      {sub.is_final_review && (
                        <div style={{
                          display: 'inline-block', marginTop: 6, padding: '4px 10px', borderRadius: 999,
                          background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412',
                          fontSize: 12, fontWeight: 700,
                        }}>
                          Final review — second rejection is final
                        </div>
                      )}
                      <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>
                        {sub.employee_id} · {sub.client || '—'} · {sub.location || '—'}
                      </div>
                      <StatusPill status={sub.status} />
                      <div style={{
                        marginTop: 10, padding: '10px 12px', borderRadius: 10,
                        background: '#eff6ff', border: '1px solid #bfdbfe',
                        color: '#0f172a', fontSize: 13, lineHeight: 1.45,
                      }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>{story.headline}</div>
                        {story.lines.map((row) => (
                          <div key={row.label}><span style={{ color: '#64748b', fontWeight: 600 }}>{row.label}: </span>{row.value}</div>
                        ))}
                      </div>
                      <div style={{
                        marginTop: 10, padding: '10px 12px', borderRadius: 10, background: '#eff6ff',
                        border: '1px solid #bfdbfe', color: '#0f172a', fontSize: 14, fontWeight: 600, lineHeight: 1.5,
                      }}>
                        OT 1× {ot1}h · OT 2× {ot2}h · OT 3× {ot3}h
                        <br />
                        Expense PKR {fmt(exp)} · Medical PKR {fmt(med)}
                      </div>
                    </div>
                    {sub.status === 'submitted' && !data.period.approve_closed && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" disabled={busy} style={btnOk} onClick={() => decide(sub.id, 'approved')}>Approve</button>
                        <button type="button" disabled={busy} style={btnNo} onClick={() => decide(sub.id, 'rejected')}>Reject</button>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#64748b', marginBottom: 8, letterSpacing: '0.04em' }}>LINE ITEMS</div>
                    {items.length === 0 && <div style={{ color: '#64748b', fontSize: 13 }}>No line items</div>}
                    <div style={{ display: 'grid', gap: 8 }}>
                      {items.map(i => (
                        <div key={i.id} style={{
                          padding: '10px 12px', borderRadius: 10, background: '#fff',
                          border: '1px solid #e2e8f0', color: '#0f172a', fontSize: 13, lineHeight: 1.45,
                        }}>
                          <strong style={{ color: '#1e293b' }}>{i.claim_type}</strong>
                          {' · '}{String(i.claim_date).slice(0, 10)}
                          {i.claim_type === 'OT'
                            ? <> · <strong>{i.ot_hours}</strong>h {i.ot_multiplier || ''} · {i.nature || i.description || '—'}</>
                            : <> · <strong>PKR {fmt(i.amount)}</strong> · {i.patient_name ? `${i.patient_name} · ` : ''}{i.description || '—'}</>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {atts.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: '#64748b', marginBottom: 6, letterSpacing: '0.04em' }}>SUPPORTS</div>
                        {atts.map(a => (
                          <button key={a.id} type="button" style={linkBtn} onClick={() => openAttachment(a.id, a.filename)}>
                            📎 {a.filename}{a.category ? ` (${a.category})` : ''}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </Shell>
  );
}

function sumOt(items, factor) {
  return items.filter(i => i.claim_type === 'OT' && Number(i.ot_multiplier_factor) === factor)
    .reduce((s, i) => s + Number(i.ot_hours || 0), 0);
}
function fmt(n) {
  return Number(n || 0).toLocaleString('en-PK');
}
function StatusPill({ status }) {
  const map = {
    submitted: { bg: '#fff7ed', c: '#c2410c', t: 'Awaiting your decision' },
    approved: { bg: '#f0fdf4', c: '#15803d', t: 'Approved' },
    in_payroll: { bg: '#f0fdf4', c: '#15803d', t: 'In payroll' },
    no_claims: { bg: '#f0fdf4', c: '#15803d', t: 'No Claims confirmed' },
    rejected: { bg: '#fef2f2', c: '#b91c1c', t: 'Rejected' },
  };
  const m = map[status] || { bg: '#f1f5f9', c: '#475569', t: status };
  return (
    <span style={{
      display: 'inline-block', marginTop: 8, padding: '3px 10px', borderRadius: 999,
      background: m.bg, color: m.c, fontSize: 12, fontWeight: 700,
    }}>{m.t}</span>
  );
}
function Stat({ label, value, tone }) {
  return (
    <div style={{
      minWidth: 90, padding: '10px 14px', borderRadius: 12, background: '#fff',
      border: '1px solid #e2e8f0',
    }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 750, color: tone }}>{value}</div>
    </div>
  );
}
function Shell({ children }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(165deg,#ecfdf5 0%,#f8fafc 45%,#eff6ff 100%)',
      padding: '28px 16px 48px',
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      color: '#0f172a',
    }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
function Alert({ children, tone }) {
  const c = tone === 'good' ? '#15803d' : '#b91c1c';
  const bg = tone === 'good' ? '#f0fdf4' : '#fef2f2';
  return (
    <div style={{
      marginTop: 10, marginBottom: 8, padding: '12px 14px', borderRadius: 10,
      background: bg, border: `1px solid ${c}33`, color: c, lineHeight: 1.55, fontSize: 14,
    }}>{children}</div>
  );
}

const card = {
  border: '1px solid #e2e8f0', borderRadius: 14, padding: 16, background: '#fff',
  boxShadow: '0 1px 2px rgba(15,23,42,0.04)', color: '#0f172a',
};
const btnOk = { background: '#15803d', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 10, fontWeight: 700, cursor: 'pointer' };
const btnNo = { background: '#dc2626', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 10, fontWeight: 700, cursor: 'pointer' };
const linkBtn = {
  background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', cursor: 'pointer',
  padding: '6px 10px', marginRight: 8, marginBottom: 6, borderRadius: 8, fontSize: 13, fontWeight: 600,
};
