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

async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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
  const atts = (data?.attachments || []).filter(a => sub && a.submission_id === sub.id);

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
      setMsg(d.message || (confirmNoClaims ? 'No Claims confirmed.' : 'Submitted.'));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadSupport = async (file, category) => {
    if (!file || !selected) return;
    setBusy(true); setError(''); setMsg('');
    try {
      const contentBase64 = await fileToBase64(file);
      const r = await fetch(`${API}/api/portal-claims/fill/${token}/attachment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selected,
          filename: file.name,
          mimeType: file.type,
          contentBase64,
          category,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      setMsg(`Uploaded ${file.name} (${category === 'expense_support' ? 'Expense supports' : 'Medical supports'})`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadExcel = async (file) => {
    if (!file) return;
    setBusy(true); setError(''); setMsg('');
    try {
      const contentBase64 = await fileToBase64(file);
      const r = await fetch(`${API}/api/portal-claims/fill/${token}/import-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentBase64 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Excel import failed');
      const okCount = (d.results || []).filter(x => x.ok).length;
      setMsg(`Excel imported for ${okCount} employee(s) as draft. ${d.parseErrors?.length ? `Notes: ${d.parseErrors.slice(0, 3).join('; ')}` : ''} Upload Expense/Medical supports if needed, then Submit.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return <Shell><Alert tone="bad">{error}</Alert></Shell>;
  }
  if (!data) return <Shell><p style={{ color: '#334155' }}>Loading your claims form…</p></Shell>;

  const pct = data.completion?.total
    ? Math.round((data.completion.submitted / data.completion.total) * 100)
    : 0;
  const templateHref = data.templateUrl || `${API}/api/portal-claims/template.xlsx`;

  return (
    <Shell>
      <header style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: '#1d4ed8', textTransform: 'uppercase' }}>ASIL HCM</div>
        <h1 style={{ margin: '4px 0 8px', fontSize: '1.55rem', color: '#0f172a', fontWeight: 700 }}>Submit monthly claims</h1>
        <p style={{ margin: 0, color: '#334155', maxWidth: 720, lineHeight: 1.55 }}>
          Claim month <strong>{data.period.claim_month}/{data.period.claim_year}</strong>
          {' · '}Deadline day 22 · Progress {pct}% ({data.completion.submitted}/{data.completion.total})
        </p>
      </header>

      <HowItWorks templateHref={templateHref} />

      {fillClosed && <Alert tone="bad">Entry closed for this cycle. Raise claims next month.</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}
      {msg && <Alert tone="good">{msg}</Alert>}

      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Option B — Excel (same sheet as last month)</div>
        <p style={{ margin: '0 0 10px', color: '#475569', fontSize: 13, lineHeight: 1.5 }}>
          Download the blank 3-sheet workbook (OT / Expense / Medical), fill it, then upload here.
          Rows load as a <strong>draft</strong> — still upload Expense & Medical supports separately, then Submit.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <a href={templateHref} style={btnLink} download>Download blank Excel template</a>
          {!locked && !fillClosed && (
            <label style={{ ...btnGhost, display: 'inline-block', cursor: 'pointer' }}>
              Upload filled Excel
              <input type="file" accept=".xlsx,.xls" hidden disabled={busy} onChange={e => uploadExcel(e.target.files?.[0])} />
            </label>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,240px) 1fr', gap: 16 }} className="claims-fill-grid">
        <aside style={card}>
          <div style={{ fontWeight: 700, fontSize: 11, color: '#64748b', marginBottom: 10, letterSpacing: '0.04em' }}>YOUR EMPLOYEES</div>
          {data.submissions.map(s => (
            <button
              key={s.employee_id}
              type="button"
              onClick={() => setSelected(s.employee_id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', marginBottom: 8,
                padding: '10px 12px', borderRadius: 10,
                border: selected === s.employee_id ? '2px solid #2563eb' : '1px solid #e2e8f0',
                background: selected === s.employee_id ? '#eff6ff' : '#fff',
                cursor: 'pointer', color: '#0f172a',
              }}
            >
              <div style={{ fontWeight: 650, fontSize: 13, color: '#0f172a' }}>{s.employee_name}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{statusLabel(s.status)}</div>
            </button>
          ))}
        </aside>

        <section style={card}>
          {!sub ? <p style={{ color: '#475569' }}>Select an employee</p> : (
            <>
              <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem', color: '#0f172a' }}>{sub.employee_name}</h2>
              <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 12px' }}>
                {sub.employee_id} · {sub.client || '—'} · {sub.location || '—'}
              </p>
              {locked && <Alert tone="warn">Locked after approval. Raise further claims next month.</Alert>}

              <Section title="1. Overtime (enter on screen)">
                <Hint>Usually <strong>Double (2×)</strong>. <strong>Triple (3×)</strong> only on gazetted Eid days.</Hint>
                {otRows.map((row, i) => (
                  <Row key={i}>
                    <Field label="Date"><input type="date" disabled={locked || fillClosed} value={row.claim_date} onChange={e => setOtRows(rs => rs.map((r, j) => j === i ? { ...r, claim_date: e.target.value } : r))} style={inp} /></Field>
                    <Field label="Hours"><input disabled={locked || fillClosed} value={row.ot_hours} onChange={e => setOtRows(rs => rs.map((r, j) => j === i ? { ...r, ot_hours: e.target.value } : r))} style={inp} /></Field>
                    <Field label="Rate">
                      <select disabled={locked || fillClosed} value={row.ot_multiplier} onChange={e => setOtRows(rs => rs.map((r, j) => j === i ? { ...r, ot_multiplier: e.target.value } : r))} style={inp}>
                        <option>Single</option><option>Double</option><option>Triple</option>
                      </select>
                    </Field>
                    <Field label="Nature of work"><input disabled={locked || fillClosed} value={row.nature} onChange={e => setOtRows(rs => rs.map((r, j) => j === i ? { ...r, nature: e.target.value } : r))} style={inp} /></Field>
                  </Row>
                ))}
                {!locked && !fillClosed && <button type="button" onClick={() => setOtRows(r => [...r, emptyOt()])} style={btnGhost}>+ OT row</button>}
              </Section>

              <Section title="2. Expense">
                {expRows.map((row, i) => (
                  <Row key={i}>
                    <Field label="Date"><input type="date" disabled={locked || fillClosed} value={row.claim_date} onChange={e => setExpRows(rs => rs.map((r, j) => j === i ? { ...r, claim_date: e.target.value } : r))} style={inp} /></Field>
                    <Field label="Amount (PKR)"><input disabled={locked || fillClosed} value={row.amount} onChange={e => setExpRows(rs => rs.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))} style={inp} /></Field>
                    <Field label="Description"><input disabled={locked || fillClosed} value={row.description} onChange={e => setExpRows(rs => rs.map((r, j) => j === i ? { ...r, description: e.target.value } : r))} style={inp} /></Field>
                  </Row>
                ))}
                {!locked && !fillClosed && <button type="button" onClick={() => setExpRows(r => [...r, emptyExp()])} style={btnGhost}>+ Expense row</button>}
              </Section>

              <Section title="3. Medical">
                {medRows.map((row, i) => (
                  <Row key={i}>
                    <Field label="Date"><input type="date" disabled={locked || fillClosed} value={row.claim_date} onChange={e => setMedRows(rs => rs.map((r, j) => j === i ? { ...r, claim_date: e.target.value } : r))} style={inp} /></Field>
                    <Field label="Amount (PKR)"><input disabled={locked || fillClosed} value={row.amount} onChange={e => setMedRows(rs => rs.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))} style={inp} /></Field>
                    <Field label="Patient"><input disabled={locked || fillClosed} value={row.patient_name} onChange={e => setMedRows(rs => rs.map((r, j) => j === i ? { ...r, patient_name: e.target.value } : r))} style={inp} /></Field>
                    <Field label="Description"><input disabled={locked || fillClosed} value={row.description} onChange={e => setMedRows(rs => rs.map((r, j) => j === i ? { ...r, description: e.target.value } : r))} style={inp} /></Field>
                  </Row>
                ))}
                {!locked && !fillClosed && <button type="button" onClick={() => setMedRows(r => [...r, emptyMed()])} style={btnGhost}>+ Medical row</button>}
              </Section>

              <Section title="4. Supports — two separate uploads">
                <Hint>If you entered Expense and/or Medical, upload <strong>two files</strong>: one for Expense receipts, one for Medical bills/prescriptions (PDF/JPG/PNG).</Hint>
                {!locked && !fillClosed && (
                  <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
                    <label style={{ color: '#0f172a', fontSize: 13, fontWeight: 600 }}>
                      Expense supports file
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.zip" style={{ display: 'block', marginTop: 6 }}
                        onChange={e => uploadSupport(e.target.files?.[0], 'expense_support')} />
                    </label>
                    <label style={{ color: '#0f172a', fontSize: 13, fontWeight: 600 }}>
                      Medical supports file
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.zip" style={{ display: 'block', marginTop: 6 }}
                        onChange={e => uploadSupport(e.target.files?.[0], 'medical_support')} />
                    </label>
                  </div>
                )}
                {atts.length > 0 && (
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: '#334155', fontSize: 13 }}>
                    {atts.map(a => (
                      <li key={a.id}>{a.filename} <span style={{ color: '#64748b' }}>({a.category || 'other'})</span></li>
                    ))}
                  </ul>
                )}
              </Section>

              {!locked && !fillClosed && (
                <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
                  <button type="button" disabled={busy} onClick={() => save(false)} style={btnPrimary}>Submit to Line Manager</button>
                  <button type="button" disabled={busy} onClick={() => save(true)} style={btnGhost}>Confirm No Claims</button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <style>{`@media (max-width: 720px) { .claims-fill-grid { grid-template-columns: 1fr !important; } }`}</style>
    </Shell>
  );
}

function HowItWorks({ templateHref }) {
  return (
    <div style={{ ...card, marginBottom: 16, background: '#f8fafc' }}>
      <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>How this works (simple)</div>
      <ol style={{ margin: 0, paddingLeft: 18, color: '#334155', fontSize: 14, lineHeight: 1.65 }}>
        <li>Fill claims on screen <strong>or</strong> download/upload the <a href={templateHref} style={{ color: '#1d4ed8' }}>Excel template</a>.</li>
        <li>Attach <strong>Expense supports</strong> and <strong>Medical supports</strong> as two separate files when needed.</li>
        <li>Submit → your Line Manager reviews → you get an email when decided → approved amounts pay with <strong>next month’s</strong> salary.</li>
      </ol>
    </div>
  );
}

function statusLabel(s) {
  const map = {
    invited: 'Not started', draft: 'Draft — not submitted yet', submitted: 'Sent to manager',
    approved: 'Approved', rejected: 'Rejected', no_claims: 'No claims', in_payroll: 'In payroll',
  };
  return map[s] || s;
}

function Shell({ children }) {
  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(165deg,#eef2ff 0%,#f8fafc 40%,#ecfeff 100%)',
      padding: '28px 16px 48px', fontFamily: '"Segoe UI", system-ui, sans-serif', color: '#0f172a',
    }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>{children}</div>
    </div>
  );
}
function Alert({ children, tone }) {
  const c = tone === 'good' ? '#15803d' : tone === 'warn' ? '#b45309' : '#b91c1c';
  const bg = tone === 'good' ? '#f0fdf4' : tone === 'warn' ? '#fffbeb' : '#fef2f2';
  return <div style={{ marginTop: 10, marginBottom: 8, padding: '12px 14px', borderRadius: 10, background: bg, border: `1px solid ${c}33`, color: c, lineHeight: 1.55, fontSize: 14 }}>{children}</div>;
}
function Hint({ children }) {
  return <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155', fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>{children}</div>;
}
function Section({ title, children }) {
  return <div style={{ marginTop: 18 }}><div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: '#0f172a' }}>{title}</div>{children}</div>;
}
function Field({ label, children }) {
  return <label style={{ display: 'block' }}><span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{label}</span>{children}</label>;
}
function Row({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 10 }}>{children}</div>;
}

const card = { border: '1px solid #e2e8f0', borderRadius: 14, padding: 16, background: '#fff', boxShadow: '0 1px 2px rgba(15,23,42,0.04)' };
const inp = { width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', fontSize: 14, boxSizing: 'border-box' };
const btnPrimary = { background: '#2563eb', color: '#fff', border: 'none', padding: '11px 18px', borderRadius: 10, fontWeight: 650, cursor: 'pointer', fontSize: 14 };
const btnGhost = { background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 550 };
const btnLink = { ...btnPrimary, textDecoration: 'none', display: 'inline-block' };
