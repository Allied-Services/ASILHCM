import React, { useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com';

function emptyOt() {
  return { claim_type: 'OT', claim_date: '', ot_hours: '', ot_multiplier: 'Double', nature: '', time_from: '', time_to: '' };
}
function emptyExp() {
  return { claim_type: 'EXPENSE', claim_date: '', amount: '', description: '', expense_type: '' };
}
function emptyMed() {
  return { claim_type: 'MEDICAL', claim_date: '', amount: '', description: '', patient_name: '' };
}

export default function ClaimsFillPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', []);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [otRows, setOtRows] = useState([emptyOt()]);
  const [expRows, setExpRows] = useState([]);
  const [medRows, setMedRows] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    try {
      const r = await fetch(`${API}/api/portal-claims/fill/${token}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to load');
      setData(d);
      if (!selected && d.submissions?.[0]) setSelected(d.submissions[0].employee_id);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { if (token) load(); else setError('Missing token in link'); }, [token]);

  useEffect(() => {
    if (!data || !selected) return;
    const items = (data.items || []).filter(i => {
      const sub = data.submissions.find(s => s.employee_id === selected);
      return sub && i.submission_id === sub.id;
    });
    const ots = items.filter(i => i.claim_type === 'OT').map(i => ({
      claim_type: 'OT', claim_date: i.claim_date?.slice?.(0, 10) || i.claim_date || '',
      ot_hours: i.ot_hours || '', ot_multiplier: i.ot_multiplier || 'Double',
      nature: i.nature || '', time_from: i.time_from || '', time_to: i.time_to || '',
    }));
    const exps = items.filter(i => i.claim_type === 'EXPENSE').map(i => ({
      claim_type: 'EXPENSE', claim_date: i.claim_date?.slice?.(0, 10) || '',
      amount: i.amount || '', description: i.description || '', expense_type: i.expense_type || '',
    }));
    const meds = items.filter(i => i.claim_type === 'MEDICAL').map(i => ({
      claim_type: 'MEDICAL', claim_date: i.claim_date?.slice?.(0, 10) || '',
      amount: i.amount || '', description: i.description || '', patient_name: i.patient_name || '',
    }));
    setOtRows(ots.length ? ots : [emptyOt()]);
    setExpRows(exps);
    setMedRows(meds);
  }, [selected, data]);

  const sub = data?.submissions?.find(s => s.employee_id === selected);
  const locked = sub && ['approved', 'in_payroll'].includes(sub.status);
  const fillClosed = data?.period?.fill_closed;

  const save = async (confirmNoClaims = false) => {
    setBusy(true); setMsg(''); setError('');
    try {
      const items = confirmNoClaims ? [] : [...otRows, ...expRows, ...medRows].filter(r => {
        if (r.claim_type === 'OT') return r.claim_date && r.ot_hours;
        return r.claim_date && r.amount;
      });
      const r = await fetch(`${API}/api/portal-claims/fill/${token}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: selected, items, confirmNoClaims }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Save failed');
      setMsg(confirmNoClaims ? 'No Claims confirmed.' : `Saved (${d.status}).`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadSupport = async (file) => {
    if (!file || !selected) return;
    setBusy(true); setError('');
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const contentBase64 = btoa(binary);
      const r = await fetch(`${API}/api/portal-claims/fill/${token}/attachment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selected,
          filename: file.name,
          mimeType: file.type,
          contentBase64,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      setMsg(`Uploaded ${file.name}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return <Shell><p style={{ color: '#b91c1c' }}>{error}</p></Shell>;
  }
  if (!data) return <Shell><p>Loading…</p></Shell>;

  const pct = data.completion?.total
    ? Math.round((data.completion.submitted / data.completion.total) * 100)
    : 0;

  return (
    <Shell>
      <h1 style={{ margin: '0 0 6px', fontSize: '1.35rem' }}>ASIL Monthly Claims</h1>
      <p style={{ margin: 0, color: '#64748b' }}>
        Claim month {data.period.claim_month}/{data.period.claim_year} · Submit by day 22 · Completion {pct}%
        ({data.completion.submitted}/{data.completion.total})
      </p>
      {fillClosed && <Banner color="#b91c1c">Payroll entry is closed. Raise claims next month.</Banner>}
      {error && <Banner color="#b91c1c">{error}</Banner>}
      {msg && <Banner color="#15803d">{msg}</Banner>}

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, marginTop: 20 }}>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, background: '#fff' }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: '#64748b', marginBottom: 8 }}>EMPLOYEES</div>
          {data.submissions.map(s => (
            <button
              key={s.employee_id}
              type="button"
              onClick={() => setSelected(s.employee_id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', marginBottom: 6,
                padding: '8px 10px', borderRadius: 8, border: selected === s.employee_id ? '1px solid #2563eb' : '1px solid #e2e8f0',
                background: selected === s.employee_id ? '#eff6ff' : '#fff', cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{s.employee_name}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{s.status}</div>
            </button>
          ))}
        </div>

        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, background: '#fff' }}>
          {!sub ? <p>Select an employee</p> : (
            <>
              <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>{sub.employee_name}</h2>
              <p style={{ color: '#64748b', fontSize: 13 }}>{sub.employee_id} · {sub.client || '—'} · {sub.location || '—'}</p>
              {locked && <Banner color="#b45309">Locked after approval. Raise further claims next month.</Banner>}

              <Section title="Overtime">
                {otRows.map((row, i) => (
                  <Row key={i}>
                    <input type="date" disabled={locked || fillClosed} value={row.claim_date} onChange={e => setOtRows(rs => rs.map((r, j) => j === i ? { ...r, claim_date: e.target.value } : r))} />
                    <input placeholder="Hours" disabled={locked || fillClosed} value={row.ot_hours} onChange={e => setOtRows(rs => rs.map((r, j) => j === i ? { ...r, ot_hours: e.target.value } : r))} />
                    <select disabled={locked || fillClosed} value={row.ot_multiplier} onChange={e => setOtRows(rs => rs.map((r, j) => j === i ? { ...r, ot_multiplier: e.target.value } : r))}>
                      <option>Single</option><option>Double</option><option>Triple</option>
                    </select>
                    <input placeholder="Nature of work" disabled={locked || fillClosed} value={row.nature} onChange={e => setOtRows(rs => rs.map((r, j) => j === i ? { ...r, nature: e.target.value } : r))} />
                  </Row>
                ))}
                {!locked && !fillClosed && <button type="button" onClick={() => setOtRows(r => [...r, emptyOt()])}>+ OT row</button>}
              </Section>

              <Section title="Expense (support required)">
                {expRows.map((row, i) => (
                  <Row key={i}>
                    <input type="date" disabled={locked || fillClosed} value={row.claim_date} onChange={e => setExpRows(rs => rs.map((r, j) => j === i ? { ...r, claim_date: e.target.value } : r))} />
                    <input placeholder="Amount" disabled={locked || fillClosed} value={row.amount} onChange={e => setExpRows(rs => rs.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))} />
                    <input placeholder="Description" disabled={locked || fillClosed} value={row.description} onChange={e => setExpRows(rs => rs.map((r, j) => j === i ? { ...r, description: e.target.value } : r))} />
                  </Row>
                ))}
                {!locked && !fillClosed && <button type="button" onClick={() => setExpRows(r => [...r, emptyExp()])}>+ Expense row</button>}
              </Section>

              <Section title="Medical (support required)">
                {medRows.map((row, i) => (
                  <Row key={i}>
                    <input type="date" disabled={locked || fillClosed} value={row.claim_date} onChange={e => setMedRows(rs => rs.map((r, j) => j === i ? { ...r, claim_date: e.target.value } : r))} />
                    <input placeholder="Amount" disabled={locked || fillClosed} value={row.amount} onChange={e => setMedRows(rs => rs.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))} />
                    <input placeholder="Patient" disabled={locked || fillClosed} value={row.patient_name} onChange={e => setMedRows(rs => rs.map((r, j) => j === i ? { ...r, patient_name: e.target.value } : r))} />
                    <input placeholder="Description" disabled={locked || fillClosed} value={row.description} onChange={e => setMedRows(rs => rs.map((r, j) => j === i ? { ...r, description: e.target.value } : r))} />
                  </Row>
                ))}
                {!locked && !fillClosed && <button type="button" onClick={() => setMedRows(r => [...r, emptyMed()])}>+ Medical row</button>}
              </Section>

              {!locked && !fillClosed && (
                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>Upload support (PDF/JPG/PNG)</label>
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e => uploadSupport(e.target.files?.[0])} />
                </div>
              )}

              {!locked && !fillClosed && (
                <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                  <button type="button" disabled={busy} onClick={() => save(false)} style={btnPrimary}>Submit / Update</button>
                  <button type="button" disabled={busy} onClick={() => save(true)} style={btnGhost}>Confirm No Claims</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#f1f5f9,#e2e8f0)', padding: '24px 16px', fontFamily: 'Segoe UI, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
function Banner({ children, color }) {
  return <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#fff', borderLeft: `4px solid ${color}`, color }}>{children}</div>;
}
function Section({ title, children }) {
  return <div style={{ marginTop: 16 }}><div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title}</div>{children}</div>;
}
function Row({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, marginBottom: 8 }}>{children}</div>;
}
const btnPrimary = { background: '#2563eb', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' };
const btnGhost = { background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1', padding: '10px 16px', borderRadius: 8, cursor: 'pointer' };
