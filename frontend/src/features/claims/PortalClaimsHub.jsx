import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';

const TEST_FILLERS = [
  'shezad.mumtaz@asil.com.pk',
  'rabia.bhutto@asil.com.pk',
  'laiba.mughal@asil.com.pk',
];
const TEST_APPROVER = 'huzaifa.rafaqat@asil.com.pk';

export default function PortalClaimsHub({ user }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [channel, setChannel] = useState('');
  const [claims, setClaims] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [periodId, setPeriodId] = useState(null);

  // Manual override form
  const [ov, setOv] = useState({
    employeeId: '', month: now.getMonth() + 1, year: now.getFullYear(),
    ot1Hours: 0, ot2Hours: 0, ot3Hours: 0, expenseAmount: 0, medicalAmount: 0,
    mode: 'add', reason: '', dryRun: true,
  });
  const [ovPreview, setOvPreview] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const q = new URLSearchParams({ month: String(month), year: String(year) });
      if (channel) q.set('channel', channel);
      const d = await api.portalClaimsList(Object.fromEntries(q));
      setClaims(d.claims || []);
    } catch (e) {
      setErr(e.message);
    }
  }, [month, year, channel]);

  useEffect(() => { load(); }, [load]);

  const runSampleCampaign = async (dryRun) => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const d = await api.portalClaimsCampaign({
        month, year, dryRun,
        onlyEmails: TEST_FILLERS,
      });
      setPeriodId(d.period?.id || null);
      setMsg(dryRun
        ? `Dry-run: ${d.fillerCount} fillers / ${d.employeeCount} employees. Skipped: ${d.skipped?.length || 0}`
        : `Campaign sent to ${d.invites?.filter(i => i.ok).length || 0} filler(s). Check inboxes.`);
      if (!dryRun && d.invites) {
        console.log('[PortalClaims] invite links', d.invites);
      }
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const notifyApprovers = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.portalClaimsNotifyApprovers(periodId, month, year);
      if (d.periodId) setPeriodId(d.periodId);
      setMsg(`Approver packs: ${(d.packs || []).map(p => `${p.approverEmail} (${p.count} pending)`).join(', ') || 'none pending'}${d.periodId ? ` · periodId=${d.periodId}` : ''}`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const exportTieout = async () => {
    try {
      const d = await api.portalClaimsTieout(month, year);
      const lines = [['Employee', 'Name', 'Client', 'Channel', 'OT1', 'OT2', 'OT3', 'Expense', 'Medical', 'Status']];
      for (const r of d.portal || []) {
        lines.push([r.employee_id, r.name, r.client, r.channel, r.ot1_hours, r.ot2_hours, r.ot3_hours, r.expense, r.medical, r.status]);
      }
      lines.push([]);
      lines.push(['MANUAL OVERRIDES']);
      for (const r of d.manual || []) {
        lines.push([r.employee_id, r.name, r.client, 'manual_override', r.ot1_hours, r.ot2_hours, r.ot3_hours, r.expense_amount, r.medical_amount, r.mode]);
      }
      const csv = lines.map(row => row.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claims_payroll_tieout_${year}_${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    }
  };

  const runOverride = async (commit) => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.portalClaimsManualOverride({ ...ov, dryRun: !commit });
      setOvPreview(d);
      if (d.warning) setMsg(d.warning);
      if (commit) {
        setMsg('Override applied.');
        await load();
      } else {
        setMsg('Dry-run preview ready — review before Commit.');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const isSuper = user?.role === 'superadmin';

  return (
    <div style={{ padding: '1.25rem' }}>
      <h2 style={{ margin: '0 0 4px' }}>Claims</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Portal claims + manual ADD OT / CLAIMS. Test fillers: {TEST_FILLERS.join(', ')} · Approver: {TEST_APPROVER}
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -4, maxWidth: 820, lineHeight: 1.5 }}>
        Approver emails (default <strong>immediate</strong> on each submit): same stable link all month shows outstanding + already decided.
        Production modes via env <code>CLAIMS_APPROVER_NOTIFY_MODE</code>: <code>immediate</code> | <code>daily</code> | <code>day22</code>.
        After day 25 the approval window closes; pending items wait for next month.
      </p>

      {err && <div style={{ color: '#b91c1c', marginBottom: 10 }}>{err}</div>}
      {msg && <div style={{ color: '#15803d', marginBottom: 10 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <label>Month <input type="number" min={1} max={12} value={month} onChange={e => setMonth(+e.target.value)} style={{ width: 60 }} /></label>
        <label>Year <input type="number" value={year} onChange={e => setYear(+e.target.value)} style={{ width: 80 }} /></label>
        <select value={channel} onChange={e => setChannel(e.target.value)}>
          <option value="">All channels</option>
          <option value="portal">Portal only</option>
          <option value="manual_override">Manual overrides only</option>
          <option value="excel">Excel fallback</option>
        </select>
        <button type="button" className="btn-secondary" onClick={load}>Refresh</button>
        <button type="button" className="btn-secondary" onClick={exportTieout}>Export claims→payroll</button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => runSampleCampaign(true)}>Dry-run sample campaign</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => runSampleCampaign(false)}>Send sample invites (3 fillers)</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={notifyApprovers}>Email Huzaifa approval pack</button>
        {periodId && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>periodId={periodId}</span>}
      </div>

      <div style={{ overflowX: 'auto', marginBottom: 28 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={th}>Employee</th>
              <th style={th}>Client</th>
              <th style={th}>Filler</th>
              <th style={th}>Approver</th>
              <th style={th}>Channel</th>
              <th style={th}>Status</th>
              <th style={th}>Items</th>
              <th style={th}>Supports</th>
            </tr>
          </thead>
          <tbody>
            {claims.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 12, color: 'var(--text-muted)' }}>No claims for this filter.</td></tr>
            )}
            {claims.map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={td}>{c.employee_name}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.employee_id}</div></td>
                <td style={td}>{c.client || '—'}</td>
                <td style={td}>{c.filler_email}</td>
                <td style={td}>{c.approver_email || '—'}</td>
                <td style={td}>{c.channel}</td>
                <td style={td}>{c.status}</td>
                <td style={td}>{c.item_count}</td>
                <td style={td}>{c.attachment_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginBottom: 8 }}>ADD OT / CLAIMS (Payroll override)</h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 820, lineHeight: 1.5 }}>
        Use when claims missed the portal or need a correction. Finance can <strong>Add</strong>.
        Superadmin can <strong>Replace</strong> or <strong>Remove</strong>. Always dry-run first.
        Every committed override emails <strong>huzaifa.rafaqat@asil.com.pk</strong> and <strong>shezad.mumtaz@asil.com.pk</strong> with the change list.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10, maxWidth: 960 }}>
        <Field label="ASIL Employee Code">
          <input value={ov.employeeId} onChange={e => setOv(o => ({ ...o, employeeId: e.target.value }))} placeholder="e.g. ASIL/SPL-001" style={fieldInp} />
        </Field>
        <Field label="Period Month (1–12)">
          <input type="number" min={1} max={12} value={ov.month} onChange={e => setOv(o => ({ ...o, month: +e.target.value }))} style={fieldInp} />
        </Field>
        <Field label="Period Year">
          <input type="number" value={ov.year} onChange={e => setOv(o => ({ ...o, year: +e.target.value }))} style={fieldInp} />
        </Field>
        <Field label="OT 1× Hours">
          <input type="number" value={ov.ot1Hours} onChange={e => setOv(o => ({ ...o, ot1Hours: e.target.value }))} style={fieldInp} />
        </Field>
        <Field label="OT 2× Hours">
          <input type="number" value={ov.ot2Hours} onChange={e => setOv(o => ({ ...o, ot2Hours: e.target.value }))} style={fieldInp} />
        </Field>
        <Field label="OT 3× Hours (Eid only)">
          <input type="number" value={ov.ot3Hours} onChange={e => setOv(o => ({ ...o, ot3Hours: e.target.value }))} style={fieldInp} />
        </Field>
        <Field label="Expense Amount (PKR)">
          <input type="number" value={ov.expenseAmount} onChange={e => setOv(o => ({ ...o, expenseAmount: e.target.value }))} style={fieldInp} />
        </Field>
        <Field label="Medical Amount (PKR)">
          <input type="number" value={ov.medicalAmount} onChange={e => setOv(o => ({ ...o, medicalAmount: e.target.value }))} style={fieldInp} />
        </Field>
        <Field label="Mode">
          <select value={ov.mode} onChange={e => setOv(o => ({ ...o, mode: e.target.value }))} style={fieldInp}>
            <option value="add">Add</option>
            {isSuper && <option value="replace">Replace (superadmin)</option>}
            {isSuper && <option value="remove">Remove (superadmin)</option>}
          </select>
        </Field>
        <Field label="Reason (required)" span>
          <input value={ov.reason} onChange={e => setOv(o => ({ ...o, reason: e.target.value }))} placeholder="Why this override is needed" style={fieldInp} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => runOverride(false)}>Dry-run</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => runOverride(true)}>Commit</button>
        <a
          href={`${import.meta.env.VITE_API_URL || 'https://asilhcm.onrender.com'}/api/portal-claims/manual-override/template`}
          style={{ alignSelf: 'center', fontSize: 13 }}
        >
          Download import template
        </a>
      </div>
      {ovPreview && (
        <pre style={{ marginTop: 12, background: 'var(--bg-dark)', padding: 12, borderRadius: 8, fontSize: 12, overflow: 'auto' }}>
          {JSON.stringify({ before: ovPreview.before, after: ovPreview.after, warning: ovPreview.warning }, null, 2)}
        </pre>
      )}
    </div>
  );
}

const th = { padding: '8px 6px', fontSize: 12, color: 'var(--text-muted)' };
const td = { padding: '8px 6px', verticalAlign: 'top' };
const fieldInp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-dark)', color: 'var(--text)', boxSizing: 'border-box' };

function Field({ label, children, span }) {
  return (
    <label style={{ display: 'block', gridColumn: span ? '1 / -1' : undefined }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
