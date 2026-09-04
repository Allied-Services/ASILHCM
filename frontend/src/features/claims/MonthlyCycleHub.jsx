import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Settings, Users, Send, Activity, Wallet, FilePenLine, ListChecks } from 'lucide-react';
import { api } from '../../api';
import ClaimRequestCampaign from './ClaimRequestCampaign';
import PortalClaimsHub from './PortalClaimsHub';
import './PortalClaimsHub.css';
import './MonthlyCycleHub.css';

const SECTIONS = [
  { key: 'setup', label: 'Setup', icon: Settings },
  { key: 'people', label: 'People', icon: Users },
  { key: 'collect', label: 'Collect', icon: Send },
  { key: 'track', label: 'Track', icon: Activity },
  { key: 'corrections', label: 'Corrections', icon: FilePenLine },
  { key: 'payroll', label: 'Payroll', icon: Wallet },
  { key: 'close', label: 'Close', icon: ListChecks },
];

const ROUTING_MODES = [
  { id: 'auto', label: 'Auto (Focal / LM; official mailbox submit is final)' },
  { id: 'employee_then_focal', label: 'a. Employee → Focal' },
  { id: 'employee_then_lm', label: 'b. Employee → LM' },
  { id: 'focal_then_lm', label: 'c. Focal → LM' },
  { id: 'focal_only', label: 'd. Focal final' },
  { id: 'lm_only', label: 'e. LM final' },
  { id: 'employee_then_asil', label: 'f. Employee → Dedicated Payroll' },
  { id: 'asil_supervisor_then_focal', label: 'g. ASIL Site Supervisor → Contract Focal' },
];

const INPUT_MODES = [
  { id: 'full_ledger', label: 'Full ledger' },
  { id: 'hours', label: 'Hours only' },
  { id: 'days', label: 'Days only' },
  { id: 'absent_only', label: 'Absent / deductions only' },
];

const CLAIM_TYPE_OPTIONS = [
  { id: 'ATTENDANCE', label: 'Attendance', hint: 'Days, hours, or absent-only — used with a machine / client file' },
  { id: 'OT', label: 'Overtime' },
  { id: 'EXPENSE', label: 'Expense reimbursement' },
  { id: 'MEDICAL', label: 'Medical reimbursement' },
];

const COLLECTION_MODES = [
  { id: 'monthly_form', label: 'Monthly form (Wafi default)' },
  { id: 'machine_file', label: 'Machine file upload (PSO phase)' },
  { id: 'daily_marks', label: 'Daily supervisor marks' },
  { id: 'mixed', label: 'Mixed (site decides later)' },
];

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))].sort();
}

function canEditMonthlyCyclePack(user) {
  return ['superadmin', 'finance_manager', 'operations'].includes(user?.role)
    || !!(user?.permissions?.monthly_cycle?.subPerms || []).includes('edit');
}

function canAssignMonthlyCyclePeople(user) {
  return ['superadmin', 'finance_manager', 'operations', 'payroll_initiator', 'payroll'].includes(user?.role)
    || !!(user?.permissions?.monthly_cycle?.subPerms || []).includes('edit');
}

function MonthlyCycleSetup({ user }) {
  const [contracts, setContracts] = useState([]);
  const [contractId, setContractId] = useState('');
  const [policy, setPolicy] = useState(null);
  const [rulebook, setRulebook] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api.getContracts().then((list) => {
      const rows = Array.isArray(list) ? list : (list?.contracts || []);
      setContracts(rows.map((c) => ({
        id: c.id,
        name: c.contractName || c.contract_name || c.id,
        client: c.clientName || c.client || '',
      })).sort((a, b) => String(a.name).localeCompare(String(b.name))));
    }).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!contractId) {
      setPolicy(null);
      setRulebook(null);
      return;
    }
    setErr('');
    api.getClaimsPolicy(contractId).then(setPolicy).catch((e) => setErr(e.message));
    api.getRulebook(contractId).then(setRulebook).catch(() => setRulebook({
      commercial_type: 'cost_plus',
      payroll_engine: 'legacy',
      routing_mode: 'auto',
      allied_contract_focal_email: '',
      dedicated_payroll_resource_email: '',
      attendance_input_mode: 'full_ledger',
    }));
  }, [contractId]);

  const canEdit = canEditMonthlyCyclePack(user);

  const toggleType = (typeId) => {
    if (!canEdit) return;
    setPolicy((p) => {
      const cur = new Set(p?.enabled_types || []);
      if (cur.has(typeId)) cur.delete(typeId);
      else cur.add(typeId);
      return { ...p, enabled_types: [...cur] };
    });
  };

  const save = async () => {
    if (!canEdit || !contractId || !policy) return;
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const saved = await api.updateClaimsPolicy(contractId, policy);
      setPolicy(saved);
      const focal = String(rulebook?.allied_contract_focal_email || '').trim();
      if (rulebook && focal.includes('@')) {
        const rb = await api.saveRulebook(contractId, { ...rulebook, claims: policy });
        setRulebook(rb);
        setMsg('Contract pack and rulebook saved.');
      } else {
        setMsg('Contract pack saved.');
      }
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  const selected = contracts.find((c) => c.id === contractId);

  return (
    <div className="mch-panel">
      <p className="mch-lead">
        Choose what each contract collects each month: claim types, how attendance is captured, optional calendar deadlines, and whether a separate reviewer step is required.
      </p>
      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}
      <div className="mch-form-grid">
        <label>
          <span className="lbl">Contract</span>
          <select value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">Select contract…</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.client ? ` · ${c.client}` : ''}</option>
            ))}
          </select>
        </label>
      </div>
      {policy && (
        <>
          <div className="mch-block">
            <h3>Claim types enabled</h3>
            <div className="mch-check-grid">
              {CLAIM_TYPE_OPTIONS.map((opt) => (
                <label key={opt.id} className="mch-check">
                  <input
                    type="checkbox"
                    checked={(policy.enabled_types || []).includes(opt.id)}
                    onChange={() => toggleType(opt.id)}
                  />
                  <span>{opt.label}</span>
                  {opt.hint && <span className="hint">{opt.hint}</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="mch-block">
            <h3>Collection mode</h3>
            <select
              value={policy.collection_mode || 'monthly_form'}
              onChange={(e) => setPolicy((p) => ({ ...p, collection_mode: e.target.value }))}
            >
              {COLLECTION_MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          {rulebook && (
            <div className="mch-block">
              <h3>Contract rulebook</h3>
              <div className="mch-form-grid mch-form-grid-2">
                <label>
                  <span className="lbl">Commercial type</span>
                  <select
                    value={rulebook.commercial_type || 'cost_plus'}
                    onChange={(e) => setRulebook((r) => ({ ...r, commercial_type: e.target.value }))}
                  >
                    <option value="cost_plus">Cost-plus (salary + fee)</option>
                    <option value="fixed_value">Fixed value (Service Order invoice)</option>
                  </select>
                </label>
                <label>
                  <span className="lbl">Payroll engine</span>
                  <select
                    value={rulebook.payroll_engine || 'legacy'}
                    onChange={(e) => setRulebook((r) => ({ ...r, payroll_engine: e.target.value }))}
                  >
                    <option value="legacy">Legacy — Payroll Sheet pays</option>
                    <option value="runs">Runs — Sheet is view-only</option>
                  </select>
                </label>
                <label>
                  <span className="lbl">ASIL Contract Focal (required)</span>
                  <input
                    value={rulebook.allied_contract_focal_email || ''}
                    onChange={(e) => setRulebook((r) => ({ ...r, allied_contract_focal_email: e.target.value }))}
                    placeholder="focal@asil.com.pk"
                  />
                </label>
                <label>
                  <span className="lbl">Dedicated Payroll Resource</span>
                  <input
                    value={rulebook.dedicated_payroll_resource_email || ''}
                    onChange={(e) => setRulebook((r) => ({ ...r, dedicated_payroll_resource_email: e.target.value }))}
                    placeholder="defaults to Contract Focal"
                  />
                </label>
                <label>
                  <span className="lbl">Claims routing</span>
                  <select
                    value={rulebook.routing_mode || 'auto'}
                    onChange={(e) => setRulebook((r) => ({ ...r, routing_mode: e.target.value }))}
                  >
                    {ROUTING_MODES.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="lbl">Client file mode</span>
                  <select
                    value={rulebook.attendance_input_mode || 'full_ledger'}
                    onChange={(e) => setRulebook((r) => ({ ...r, attendance_input_mode: e.target.value }))}
                  >
                    {INPUT_MODES.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}
          <div className="mch-block">
            <div className="mch-block-head">
              <h3>Calendar &amp; pay timing</h3>
              <label className="mch-check mch-check-inline mch-check-tight">
                <input
                  type="checkbox"
                  checked={!!policy.calendar_apply}
                  onChange={(e) => setPolicy((p) => ({
                    ...p,
                    calendar_apply: e.target.checked,
                    ...(e.target.checked
                      ? {}
                      : { submit_deadline_day: null, approve_deadline_day: null }),
                  }))}
                />
                <span>Apply</span>
              </label>
            </div>
            <p className="mch-muted">Optional. Check to apply. Add a deadline only when this contract uses one.</p>
            {policy.calendar_apply && (
              <>
                <div className="mch-form-grid">
                  <label>
                    <span className="lbl">When claims pay</span>
                    <select
                      value={policy.claims_pay_timing || 'following_month'}
                      onChange={(e) => setPolicy((p) => ({ ...p, claims_pay_timing: e.target.value }))}
                    >
                      <option value="following_month">Following month salary</option>
                      <option value="same_month">Same month salary</option>
                    </select>
                  </label>
                </div>
                <div className="mch-deadline-card">
                  <label className="mch-check mch-check-inline mch-check-tight">
                    <input
                      type="checkbox"
                      checked={policy.submit_deadline_day != null}
                      onChange={(e) => setPolicy((p) => ({
                        ...p,
                        submit_deadline_day: e.target.checked ? (p.submit_deadline_day || 18) : null,
                        submit_deadline_month: p.submit_deadline_month || 'following_month',
                      }))}
                    />
                    <span>Add submit deadline</span>
                  </label>
                  {policy.submit_deadline_day != null && (
                    <div className="mch-form-grid mch-form-grid-2">
                      <label>
                        <span className="lbl">Submit by (day)</span>
                        <input
                          type="number"
                          min={1}
                          max={28}
                          value={policy.submit_deadline_day}
                          onChange={(e) => setPolicy((p) => ({
                            ...p,
                            submit_deadline_day: parseInt(e.target.value, 10) || 18,
                          }))}
                        />
                      </label>
                      <label>
                        <span className="lbl">Deadline month</span>
                        <select
                          value={policy.submit_deadline_month || 'following_month'}
                          onChange={(e) => setPolicy((p) => ({ ...p, submit_deadline_month: e.target.value }))}
                        >
                          <option value="current_month">Current month</option>
                          <option value="following_month">Following month</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
                <div className="mch-deadline-card">
                  <label className="mch-check mch-check-inline mch-check-tight">
                    <input
                      type="checkbox"
                      checked={policy.approve_deadline_day != null}
                      onChange={(e) => setPolicy((p) => ({
                        ...p,
                        approve_deadline_day: e.target.checked ? (p.approve_deadline_day || 22) : null,
                        approve_deadline_month: p.approve_deadline_month || 'following_month',
                      }))}
                    />
                    <span>Add approve deadline</span>
                  </label>
                  {policy.approve_deadline_day != null && (
                    <div className="mch-form-grid mch-form-grid-2">
                      <label>
                        <span className="lbl">Approve by (day)</span>
                        <input
                          type="number"
                          min={1}
                          max={28}
                          value={policy.approve_deadline_day}
                          onChange={(e) => setPolicy((p) => ({
                            ...p,
                            approve_deadline_day: parseInt(e.target.value, 10) || 22,
                          }))}
                        />
                      </label>
                      <label>
                        <span className="lbl">Deadline month</span>
                        <select
                          value={policy.approve_deadline_month || 'following_month'}
                          onChange={(e) => setPolicy((p) => ({ ...p, approve_deadline_month: e.target.value }))}
                        >
                          <option value="current_month">Current month</option>
                          <option value="following_month">Following month</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <label className="mch-check mch-check-inline">
            <input
              type="checkbox"
              checked={!!policy.reviewer_required}
              onChange={(e) => setPolicy((p) => ({ ...p, reviewer_required: e.target.checked }))}
            />
            <span>Require separate reviewer step (only then is Reviewer used)</span>
          </label>
          {selected && (
            <p className="mch-muted">
              Active pack for <strong>{selected.name}</strong>: {(policy.enabled_types || []).join(', ') || 'none'} · {policy.collection_mode}
            </p>
          )}
          {!canEdit && (
            <p className="mch-muted">View only — contract pack edits need finance manager, operations, or superadmin access.</p>
          )}
          <button type="button" className="btn-primary" disabled={saving || !canEdit} onClick={save}>
            {saving ? 'Saving…' : 'Save contract pack'}
          </button>
        </>
      )}
    </div>
  );
}

function MonthlyCyclePeople({ user }) {
  const canAssign = canAssignMonthlyCyclePeople(user);
  const [emps, setEmps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [fClient, setFClient] = useState('');
  const [fContract, setFContract] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [claimAuthority, setClaimAuthority] = useState('');
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [lmEmail, setLmEmail] = useState('');
  const [lmName, setLmName] = useState('');

  useEffect(() => {
    api.getEmployees()
      .then((d) => setEmps((d.employees || []).filter((e) => e.active === 'Yes')))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  const clientOpts = useMemo(() => uniq(emps.map((e) => e.client)), [emps]);
  const contractOpts = useMemo(
    () => uniq(emps.filter((e) => !fClient || e.client === fClient).map((e) => e.contractName)),
    [emps, fClient],
  );
  const locationOpts = useMemo(
    () => uniq(emps.filter((e) => (!fClient || e.client === fClient) && (!fContract || e.contractName === fContract)).map((e) => e.location)),
    [emps, fClient, fContract],
  );

  const filtered = emps.filter((e) =>
    (!fClient || e.client === fClient)
    && (!fContract || e.contractName === fContract)
    && (!fLocation || e.location === fLocation));

  const toggleId = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    const ids = filtered.map((e) => e.id);
    const allOn = ids.length && ids.every((id) => selectedIds.includes(id));
    setSelectedIds(allOn ? selectedIds.filter((id) => !ids.includes(id)) : [...new Set([...selectedIds, ...ids])]);
  };

  const assign = async () => {
    if (!canAssign) return;
    if (!selectedIds.length) return alert('Select at least one employee.');
    const patch = { employee_ids: selectedIds };
    if (claimAuthority.trim()) patch.claim_authority = claimAuthority.trim();
    if (reviewerEmail.trim()) patch.claims_reviewer_email = reviewerEmail.trim();
    if (lmEmail.trim()) patch.line_manager_email = lmEmail.trim();
    if (lmName.trim()) patch.line_manager_name = lmName.trim();
    if (Object.keys(patch).length === 1) return alert('Enter at least one role email or name to assign.');
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const r = await api.portalClaimsPeopleBulkUpdate(patch);
      setMsg(`Updated ${r.updated} employee(s).`);
      const d = await api.getEmployees();
      setEmps((d.employees || []).filter((e) => e.active === 'Yes'));
      setSelectedIds([]);
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  if (loading) return <div className="mch-panel">Loading employees…</div>;

  return (
    <div className="mch-panel">
      <p className="mch-lead">
        Assign who fills claims (Claimer / Focal), optional Reviewer, and Approver (Line Manager). These map to the same fields Portal Claims uses today.
      </p>
      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}
      <div className="mch-form-grid mch-form-grid-3">
        <label><span className="lbl">Client</span>
          <select value={fClient} onChange={(e) => { setFClient(e.target.value); setFContract(''); setFLocation(''); setSelectedIds([]); }}>
            <option value="">All</option>
            {clientOpts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label><span className="lbl">Contract</span>
          <select value={fContract} onChange={(e) => { setFContract(e.target.value); setFLocation(''); setSelectedIds([]); }}>
            <option value="">All</option>
            {contractOpts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label><span className="lbl">Location</span>
          <select value={fLocation} onChange={(e) => { setFLocation(e.target.value); setSelectedIds([]); }}>
            <option value="">All</option>
            {locationOpts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <div className="mch-form-grid mch-form-grid-2">
        <label><span className="lbl">Claimer / Focal email</span>
          <input value={claimAuthority} onChange={(e) => setClaimAuthority(e.target.value)} placeholder="focal@wafi-energy.com" />
        </label>
        <label><span className="lbl">Reviewer email (unused unless pack requires it)</span>
          <input value={reviewerEmail} onChange={(e) => setReviewerEmail(e.target.value)} placeholder="leave blank unless Setup turns Reviewer on" />
        </label>
        <label><span className="lbl">Approver / LM email</span>
          <input value={lmEmail} onChange={(e) => setLmEmail(e.target.value)} placeholder="lm@wafi-energy.com" />
        </label>
        <label><span className="lbl">Approver / LM name</span>
          <input value={lmName} onChange={(e) => setLmName(e.target.value)} placeholder="Line manager name" />
        </label>
      </div>
      <div className="mch-people-actions">
        <button type="button" className="btn-secondary" onClick={toggleAll}>
          {filtered.length && filtered.every((e) => selectedIds.includes(e.id)) ? 'Clear selection' : `Select all (${filtered.length})`}
        </button>
        <button type="button" className="btn-primary" disabled={saving || !canAssign} onClick={assign}>
          {saving ? 'Saving…' : `Apply to ${selectedIds.length} selected`}
        </button>
      </div>
      <div className="mch-people-table-wrap">
        <table className="mch-people-table">
          <thead>
            <tr>
              <th />
              <th>Employee</th>
              <th>Location</th>
              <th>Claimer</th>
              <th>Reviewer</th>
              <th>Approver</th>
              <th>Setup</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const missing = !e.claimAuthority && !e.claim_authority && !e.lineManagerEmail && !e.line_manager_email;
              return (
                <tr key={e.id}>
                  <td>
                    <input type="checkbox" checked={selectedIds.includes(e.id)} onChange={() => toggleId(e.id)} />
                  </td>
                  <td>{e.name}<div className="hint">{e.id}</div></td>
                  <td>{e.location || '—'}</td>
                  <td>{e.claimAuthority || e.claim_authority || '—'}</td>
                  <td>{e.claimsReviewerEmail || e.claims_reviewer_email || '—'}</td>
                  <td>{e.lineManagerEmail || e.line_manager_email || '—'}</td>
                  <td>{missing ? <span className="mch-badge-warn">Setup needed</span> : 'OK'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MachineFileCollect() {
  const [contracts, setContracts] = useState([]);
  const [contractId, setContractId] = useState('');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [mode, setMode] = useState('full_ledger');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [pack, setPack] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getContracts().then((list) => {
      const rows = Array.isArray(list) ? list : (list?.contracts || []);
      setContracts(rows.map((c) => ({
        id: c.id,
        name: c.contractName || c.contract_name || c.id,
      })));
    }).catch((e) => setErr(e.message));
  }, []);

  const upload = async () => {
    if (!contractId || !text.trim()) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.uploadCycleFile({
        contractId, month, year, input_mode: mode, fileName, text,
      });
      setPack(r);
      setMsg(`Draft ${r.import?.id} — ${r.rows?.length || 0} rows. Edit then submit.`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const submit = async () => {
    if (!pack?.import?.id) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.submitCycleFile(pack.import.id);
      setPack(r);
      setMsg('Submitted into Monthly Cycle attendance.');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="mch-block">
      <h3>Machine / client file</h3>
      <p className="mch-muted">Upload CSV or TSV, edit unmatched rows, then submit. Hours, days, or absent-only files are supported.</p>
      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}
      <div className="mch-form-grid mch-form-grid-3">
        <label><span className="lbl">Contract</span>
          <select value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">Select…</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label><span className="lbl">Month</span>
          <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10) || 1)} />
        </label>
        <label><span className="lbl">Year</span>
          <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || year)} />
        </label>
        <label><span className="lbl">File mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {INPUT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
      </div>
      <label className="mch-file">
        <span className="lbl">Paste CSV / TSV</span>
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="employee_id,name,present_days,absent_days,ot2,ot3" />
      </label>
      <label>
        <span className="lbl">Or choose a file</span>
        <input
          type="file"
          accept=".csv,.tsv,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            const reader = new FileReader();
            reader.onload = () => setText(String(reader.result || ''));
            reader.readAsText(f);
          }}
        />
      </label>
      <div className="mch-people-actions">
        <button type="button" className="btn-primary" disabled={busy} onClick={upload}>{busy ? 'Working…' : 'Upload draft'}</button>
        <button type="button" className="btn-secondary" disabled={busy || pack?.import?.status !== 'draft'} onClick={submit}>Submit into cycle</button>
      </div>
      {pack?.rows?.length > 0 && (
        <div className="mch-people-table-wrap">
          <table className="mch-people-table">
            <thead>
              <tr><th>Employee</th><th>Present</th><th>Absent</th><th>Hours</th><th>OT2</th><th>OT3</th><th>Match</th></tr>
            </thead>
            <tbody>
              {pack.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee_name || r.employee_id || '—'}</td>
                  <td>{r.present_days ?? '—'}</td>
                  <td>{r.absent_days ?? '—'}</td>
                  <td>{r.hours ?? '—'}</td>
                  <td>{r.ot2_hours ?? '—'}</td>
                  <td>{r.ot3_hours ?? '—'}</td>
                  <td>{r.matched ? 'OK' : <span className="mch-badge-warn">Unmatched</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MonthClosePanel() {
  const [contracts, setContracts] = useState([]);
  const [contractId, setContractId] = useState('');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getContracts().then((list) => {
      const rows = Array.isArray(list) ? list : (list?.contracts || []);
      setContracts(rows.map((c) => ({
        id: c.id,
        name: c.contractName || c.contract_name || c.id,
      })));
    }).catch((e) => setErr(e.message));
  }, []);

  const load = async () => {
    if (!contractId) return;
    setBusy(true); setErr('');
    try { setData(await api.getMonthClose(contractId, year, month)); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const raiseInvoice = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      await api.raiseCostPlusInvoice(contractId, year, month);
      setMsg('Cost-plus invoice drafted from the locked sheet.');
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const closePack = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      await api.createSheetClosePack(contractId, year, month);
      setMsg('Close pack created from the locked sheet.');
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const downloadStatutory = async () => {
    setBusy(true); setErr('');
    try {
      const files = await api.getStatutoryFiles(year, month, contractId);
      const blob = new Blob([JSON.stringify(files, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `statutory_${contractId}_${year}-${String(month).padStart(2, '0')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="mch-panel">
      <p className="mch-lead">Nine-step month close for one contract: cycle, conflicts, calculate, lock, invoice, pay, payslips, compliance.</p>
      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}
      <div className="mch-form-grid mch-form-grid-3">
        <label><span className="lbl">Contract</span>
          <select value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">Select…</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label><span className="lbl">Month</span>
          <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10) || 1)} />
        </label>
        <label><span className="lbl">Year</span>
          <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || year)} />
        </label>
      </div>
      <div className="mch-people-actions">
        <button type="button" className="btn-primary" disabled={busy || !contractId} onClick={load}>Refresh checklist</button>
        <button type="button" className="btn-secondary" disabled={busy || !contractId} onClick={raiseInvoice}>Raise cost-plus invoice</button>
        <button type="button" className="btn-secondary" disabled={busy || !contractId} onClick={closePack}>Create close pack</button>
        <button type="button" className="btn-secondary" disabled={busy || !contractId} onClick={downloadStatutory}>Statutory files</button>
      </div>
      {data?.steps && (
        <ol className="mch-close-list">
          {data.steps.map((s) => (
            <li key={s.key} className={s.done ? 'is-done' : ''}>
              <strong>{s.label}</strong>
              <span className="hint">{s.detail}</span>
            </li>
          ))}
        </ol>
      )}
      {data?.progress && (
        <p className="mch-muted">{data.progress.done}/{data.progress.total} steps done · engine {data.engine} · {data.contract?.commercial_type}</p>
      )}
    </div>
  );
}

function ContactsSeedBar() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const seed = async () => {
    setErr(''); setMsg('');
    try {
      const r = await api.seedOrgContacts();
      setMsg(`Seeded ${r.inserted || 0} contacts from existing Focal / LM / supervisor fields.`);
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="mch-block">
      <h3>Contacts</h3>
      <p className="mch-muted">One contact record per role (client Focal, LM, ASIL Contract Focal, site supervisor). Seed from current employee/contract columns once.</p>
      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}
      <button type="button" className="btn-secondary" onClick={seed}>Seed contacts from existing fields</button>
    </div>
  );
}

export default function MonthlyCycleHub({ user }) {
  const [section, setSection] = useState('track');
  const [manualSeed, setManualSeed] = useState(null);
  const [comms, setComms] = useState(null);

  useEffect(() => {
    api.getCommunicationsStatus().then(setComms).catch(() => setComms(null));
  }, []);

  return (
    <div className="mch-root">
      <header className="mch-header">
        <div className="mch-title-row">
          <CalendarRange size={22} />
          <div>
            <h1>Monthly Cycle</h1>
            <p>One place to configure the rulebook, assign people, collect claims or a machine file, track, correct, and close the month.</p>
            {comms && comms.mode !== 'on' && (
              <p className="mch-muted">Live mail/SMS: <strong>{comms.email}</strong> · SMS {comms.sms}. No Wafi or personal inboxes until verification.</p>
            )}
          </div>
        </div>
        <nav className="mch-nav">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`mch-nav-btn${section === key ? ' is-on' : ''}`}
              onClick={() => setSection(key)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
      </header>

      {section === 'setup' && <MonthlyCycleSetup user={user} />}
      {section === 'people' && (
        <>
          <ContactsSeedBar />
          <MonthlyCyclePeople user={user} />
        </>
      )}
      {section === 'collect' && (
        <div className="mch-panel">
          <MachineFileCollect />
          <ClaimRequestCampaign user={user} />
        </div>
      )}
      {section === 'track' && (
        <PortalClaimsHub
          user={user}
          lockSection="response"
          hideSectionNav
          onOpenManual={(seed) => { setManualSeed(seed); setSection('corrections'); }}
        />
      )}
      {section === 'corrections' && (
        <PortalClaimsHub
          user={user}
          lockSection="manual"
          hideSectionNav
          manualSeed={manualSeed}
          onManualSeedConsumed={() => setManualSeed(null)}
        />
      )}
      {section === 'payroll' && (
        <PortalClaimsHub
          user={user}
          lockSection="response"
          hideSectionNav
          initialFilter="payroll_desk"
          initialWorkMonth={7}
          initialWorkYear={2026}
          initialPayMonth={8}
          initialPayYear={2026}
        />
      )}
      {section === 'close' && <MonthClosePanel />}
    </div>
  );
}
