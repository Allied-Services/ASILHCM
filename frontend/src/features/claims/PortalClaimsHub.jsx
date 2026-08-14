import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import ClaimRequestCampaign from './ClaimRequestCampaign';

const SHEZAD_TEST = 'shezad.mumtaz@asil.com.pk';

export default function PortalClaimsHub({ user }) {
  const now = new Date();
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return n.getMonth() === 0 ? 12 : n.getMonth();
  });
  const [year, setYear] = useState(() => {
    const n = new Date();
    return n.getMonth() === 0 ? n.getFullYear() - 1 : n.getFullYear();
  });
  const [campaignMode, setCampaignMode] = useState('sample');
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
  const [expanded, setExpanded] = useState({});
  const [rules, setRules] = useState([]);
  const [eligibleCount, setEligibleCount] = useState(null);
  const [rulePreview, setRulePreview] = useState(null);
  const [editingRule, setEditingRule] = useState(null);

  const loadRules = useCallback(async () => {
    try {
      const d = await api.portalClaimsEligibilityRules();
      setRules(d.rules || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  const loadEligible = useCallback(async () => {
    try {
      const d = await api.portalClaimsEligible();
      setEligibleCount((d.employees || []).length);
    } catch { setEligibleCount(null); }
  }, []);

  useEffect(() => { loadEligible(); }, [loadEligible]);

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

  const runCampaign = async (dryRun, opts = {}) => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const payload = {
        month, year, dryRun,
        campaignMode,
        testPackFour: !!opts.testPackFour,
      };
      const d = await api.portalClaimsCampaign(payload);
      setPeriodId(d.period?.id || null);
      setMsg(dryRun
        ? `Dry-run (${campaignMode}): ${d.fillerCount} packs / ${d.employeeCount} employees. Skipped: ${d.skipped?.length || 0}`
        : `${campaignMode.toUpperCase()} campaign sent — ${d.invites?.filter(i => i.ok).length || 0} email(s). ${campaignMode === 'sample' ? `Check ${SHEZAD_TEST}` : ''}`);
      if (!dryRun && d.invites) console.log('[PortalClaims] invites', d.invites);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const flushSample = async () => {
    if (!window.confirm('Delete all SAMPLE-mode portal claim periods for Wafi? This cannot be undone.')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.portalClaimsFlushSample({ claimMonth: month, claimYear: year, client: 'wafi' });
      setMsg(`Flushed ${d.deletedPeriods || 0} sample period(s).`);
      setPeriodId(null);
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

  const resetSample = async () => {
    if (!window.confirm('Clear ONLY the 3 sample test employees’ portal claims (Shezad/Rabia/Laiba) so you can re-test? Payroll OT/expense columns for those test IDs will be zeroed.')) {
      return;
    }
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api.portalClaimsResetSample();
      setPeriodId(null);
      setMsg(`Sample cleared: ${(d.clearedSubmissions || []).map(s => `${s.employee_id} was ${s.status}`).join('; ') || 'nothing to clear'}. Now Send sample invites again.`);
      await load();
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
        Portal Claims — Wafi August rollout. Eligible employees: {eligibleCount ?? '…'} · Sample emails → {SHEZAD_TEST}
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -4, maxWidth: 820, lineHeight: 1.5 }}>
        Approver emails (default <strong>immediate</strong> on each submit): same stable link all month shows outstanding + already decided.
        Production modes via env <code>CLAIMS_APPROVER_NOTIFY_MODE</code>: <code>immediate</code> | <code>daily</code> | <code>day22</code>.
        After day 25 the approval window closes; pending items wait for next month.
      </p>

      <ClaimRequestCampaign
        user={user}
        onPeriodChange={(m, y) => { setMonth(m); setYear(y); }}
      />

      {err && <div style={{ color: '#b91c1c', marginBottom: 10 }}>{err}</div>}
      {msg && <div style={{ color: '#15803d', marginBottom: 10 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <label>Claim month <input type="number" min={1} max={12} value={month} onChange={e => setMonth(+e.target.value)} style={{ width: 60 }} title="Month work was done (e.g. 7 = July)" /></label>
        <label>Year <input type="number" value={year} onChange={e => setYear(+e.target.value)} style={{ width: 80 }} /></label>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Submit by day 17 · LM approve by day 22 · paid following month</span>
        <select value={channel} onChange={e => setChannel(e.target.value)}>
          <option value="">All channels</option>
          <option value="portal">Portal only</option>
          <option value="manual_override">Manual overrides only</option>
          <option value="excel">Excel fallback</option>
        </select>
        <button type="button" className="btn-secondary" onClick={load}>Refresh</button>
        <button type="button" className="btn-secondary" onClick={exportTieout}>Export claims→payroll</button>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: '12px 14px', background: 'rgba(56,189,248,0.08)', borderRadius: 10, border: '1px solid rgba(56,189,248,0.2)' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Campaign mode:</span>
        {['sample', 'actual'].map(m => (
          <button key={m} type="button" onClick={() => setCampaignMode(m)}
            style={{
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13,
              border: campaignMode === m ? '2px solid #38bdf8' : '1px solid var(--border)',
              background: campaignMode === m ? 'rgba(56,189,248,0.15)' : 'transparent',
              color: campaignMode === m ? '#38bdf8' : 'var(--text-muted)',
            }}>
            {m.toUpperCase()}
          </button>
        ))}
        {campaignMode === 'sample' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>All emails → Shezad · no payroll write · no confirmation emails</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => runCampaign(true)}>Dry-run campaign</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => runCampaign(false)}>
          Launch {campaignMode.toUpperCase()} campaign
        </button>
        {campaignMode === 'sample' && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => runCampaign(false, { testPackFour: true })}>
            Send 4-routing test pack
          </button>
        )}
        <button type="button" className="btn-secondary" disabled={busy} onClick={notifyApprovers}>Notify approvers</button>
        {user?.role === 'superadmin' && (
          <>
            <button type="button" className="btn-secondary" disabled={busy} onClick={resetSample}>Reset legacy sample employees</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={flushSample} style={{ borderColor: '#b91c1c', color: '#fca5a5' }}>
              Flush SAMPLE Wafi data
            </button>
          </>
        )}
        {periodId && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>periodId={periodId}</span>}
      </div>

      {rules.length > 0 && (
        <div style={{ marginBottom: 20, padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Eligibility rules</div>
          {rules.map(r => (
            <div key={r.id} style={{ fontSize: 13, marginBottom: 10, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong style={{ color: 'var(--text)' }}>{r.name}</strong>
                {r.client_pattern ? <span>· client ~ {r.client_pattern}</span> : null}
                {(r.dept_exclude || []).length ? <span>· exclude: {r.dept_exclude.join(', ')}</span> : null}
                {!r.active ? <span style={{ color: '#fca5a5' }}>(inactive)</span> : null}
                <button type="button" className="btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={async () => {
                    try {
                      const d = await api.portalClaimsPreviewEligibilityRule(r.id);
                      setRulePreview({ ruleId: r.id, name: r.name, ...d });
                    } catch (e) { setErr(e.message); }
                  }}>Preview matches</button>
                {(user?.role === 'superadmin' || user?.role === 'finance_manager') && (
                  <button type="button" className="btn-secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={() => setEditingRule({ ...r, dept_exclude_str: (r.dept_exclude || []).join(', ') })}>Edit</button>
                )}
              </div>
            </div>
          ))}
          {rulePreview && (
            <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-dark)', borderRadius: 8, fontSize: 12 }}>
              <strong>{rulePreview.name}</strong> matches <strong>{rulePreview.count}</strong> active employee(s).
              {(rulePreview.employees || []).length > 0 && (
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {rulePreview.employees.slice(0, 10).map(e => (
                    <li key={e.id}>{e.id} — {e.name} ({e.dept || '—'})</li>
                  ))}
                </ul>
              )}
              <button type="button" className="btn-secondary" style={{ marginTop: 8, padding: '4px 10px', fontSize: 11 }} onClick={() => setRulePreview(null)}>Close</button>
            </div>
          )}
          {editingRule && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-dark)', borderRadius: 8 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Edit rule</div>
              <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
                <input value={editingRule.name} onChange={e => setEditingRule(x => ({ ...x, name: e.target.value }))} placeholder="Name" style={fieldInp} />
                <input value={editingRule.client_pattern || ''} onChange={e => setEditingRule(x => ({ ...x, client_pattern: e.target.value }))} placeholder="Client pattern (e.g. wafi)" style={fieldInp} />
                <input value={editingRule.dept_exclude_str || ''} onChange={e => setEditingRule(x => ({ ...x, dept_exclude_str: e.target.value }))} placeholder="Exclude depts (comma-separated)" style={fieldInp} />
                <label style={{ fontSize: 13 }}><input type="checkbox" checked={editingRule.active !== false} onChange={e => setEditingRule(x => ({ ...x, active: e.target.checked }))} /> Active</label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn-primary" disabled={busy} onClick={async () => {
                  setBusy(true);
                  try {
                    await api.portalClaimsSaveEligibilityRule({
                      id: editingRule.id,
                      name: editingRule.name,
                      priority: editingRule.priority,
                      active: editingRule.active !== false,
                      client_pattern: editingRule.client_pattern,
                      dept_exclude: (editingRule.dept_exclude_str || '').split(',').map(s => s.trim()).filter(Boolean),
                      eligible: editingRule.eligible !== false,
                    });
                    setEditingRule(null);
                    await loadRules();
                    setMsg('Eligibility rule saved.');
                  } catch (e) { setErr(e.message); }
                  finally { setBusy(false); }
                }}>Save</button>
                <button type="button" className="btn-secondary" onClick={() => setEditingRule(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ overflowX: 'auto', marginBottom: 28 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={th}></th>
              <th style={th}>Employee</th>
              <th style={th}>Client</th>
              <th style={th}>Status</th>
              <th style={th}>OT 1× / 2× / 3×</th>
              <th style={th}>Expense</th>
              <th style={th}>Medical</th>
              <th style={th}>Filler → Approver</th>
            </tr>
          </thead>
          <tbody>
            {claims.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 12, color: 'var(--text-muted)' }}>No claims for this filter.</td></tr>
            )}
            {claims.map(c => {
              const open = !!expanded[c.id];
              return (
                <React.Fragment key={c.id}>
                  <tr style={{ borderBottom: open ? 'none' : '1px solid var(--border)' }}>
                    <td style={td}>
                      <button type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 12 }}
                        onClick={() => setExpanded(e => ({ ...e, [c.id]: !e[c.id] }))}>
                        {open ? 'Hide' : 'Details'}
                      </button>
                    </td>
                    <td style={td}>{c.employee_name}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.employee_id}</div></td>
                    <td style={td}>{c.client || '—'}</td>
                    <td style={td}>{c.status}<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.channel}</div></td>
                    <td style={td}>{Number(c.ot1_hours || 0)} / {Number(c.ot2_hours || 0)} / {Number(c.ot3_hours || 0)} h</td>
                    <td style={td}>{Number(c.expense_amount || 0).toLocaleString()}</td>
                    <td style={td}>{Number(c.medical_amount || 0).toLocaleString()}</td>
                    <td style={td}>
                      <div style={{ fontSize: 12 }}>{c.filler_email}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>→ {c.approver_email || '—'}</div>
                    </td>
                  </tr>
                  {open && (
                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)' }}>
                      <td colSpan={8} style={{ padding: '10px 12px' }}>
                        {(c.items || []).length === 0 && <span style={{ color: 'var(--text-muted)' }}>No line items</span>}
                        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                          {(c.items || []).map(i => (
                            <li key={i.id}>
                              <strong>{i.claim_type}</strong> · {String(i.claim_date || '').slice(0, 10)}
                              {i.claim_type === 'OT'
                                ? <> · {i.ot_hours}h {i.ot_multiplier} · {i.nature || i.description || '—'}</>
                                : <> · PKR {Number(i.amount || 0).toLocaleString()} · {i.patient_name ? `${i.patient_name} · ` : ''}{i.description || '—'}</>}
                            </li>
                          ))}
                        </ul>
                        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                          Supports: {c.attachment_count || 0} · Claim month {c.claim_month}/{c.claim_year} · Settlement {c.settlement_month}/{c.settlement_year}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
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
        <Field label="OT 3× Hours (gazetted holidays)">
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
