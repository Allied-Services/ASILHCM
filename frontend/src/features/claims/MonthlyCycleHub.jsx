import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Settings, Users, Send, Activity, Wallet } from 'lucide-react';
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
  { key: 'payroll', label: 'Payroll', icon: Wallet },
];

const CLAIM_TYPE_OPTIONS = [
  { id: 'ATTENDANCE', label: 'Attendance', hint: 'PSO phase — not collected yet' },
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

function MonthlyCycleSetup() {
  const [contracts, setContracts] = useState([]);
  const [contractId, setContractId] = useState('');
  const [policy, setPolicy] = useState(null);
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
      return;
    }
    setErr('');
    api.getClaimsPolicy(contractId).then(setPolicy).catch((e) => setErr(e.message));
  }, [contractId]);

  const toggleType = (typeId) => {
    setPolicy((p) => {
      const cur = new Set(p?.enabled_types || []);
      if (cur.has(typeId)) cur.delete(typeId);
      else cur.add(typeId);
      return { ...p, enabled_types: [...cur] };
    });
  };

  const save = async () => {
    if (!contractId || !policy) return;
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const saved = await api.updateClaimsPolicy(contractId, policy);
      setPolicy(saved);
      setMsg('Contract pack saved.');
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  const selected = contracts.find((c) => c.id === contractId);

  return (
    <div className="mch-panel">
      <p className="mch-lead">
        Choose what each contract collects each month: claim types, how attendance is captured, deadlines, and whether a separate reviewer step is required.
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
                    disabled={opt.id === 'ATTENDANCE'}
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
          <div className="mch-block">
            <h3>Calendar &amp; pay timing</h3>
            <div className="mch-form-grid mch-form-grid-3">
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
              <label>
                <span className="lbl">Submit by (day)</span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={policy.submit_deadline_day ?? 18}
                  onChange={(e) => setPolicy((p) => ({ ...p, submit_deadline_day: parseInt(e.target.value, 10) || 18 }))}
                />
              </label>
              <label>
                <span className="lbl">Approve by (day)</span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={policy.approve_deadline_day ?? 22}
                  onChange={(e) => setPolicy((p) => ({ ...p, approve_deadline_day: parseInt(e.target.value, 10) || 22 }))}
                />
              </label>
            </div>
          </div>
          <label className="mch-check mch-check-inline">
            <input
              type="checkbox"
              checked={!!policy.reviewer_required}
              onChange={(e) => setPolicy((p) => ({ ...p, reviewer_required: e.target.checked }))}
            />
            <span>Require separate reviewer step (between claimer and approver)</span>
          </label>
          {selected && (
            <p className="mch-muted">
              Active pack for <strong>{selected.name}</strong>: {(policy.enabled_types || []).join(', ') || 'none'} · {policy.collection_mode}
            </p>
          )}
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save contract pack'}
          </button>
        </>
      )}
    </div>
  );
}

function MonthlyCyclePeople() {
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
        <label><span className="lbl">Reviewer email (optional)</span>
          <input value={reviewerEmail} onChange={(e) => setReviewerEmail(e.target.value)} placeholder="reviewer@…" />
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
        <button type="button" className="btn-primary" disabled={saving} onClick={assign}>
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

export default function MonthlyCycleHub({ user }) {
  const [section, setSection] = useState('track');

  return (
    <div className="mch-root">
      <header className="mch-header">
        <div className="mch-title-row">
          <CalendarRange size={22} />
          <div>
            <h1>Monthly Cycle</h1>
            <p>One place to configure, assign people, collect claims, track progress, and send to payroll.</p>
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

      {section === 'setup' && <MonthlyCycleSetup />}
      {section === 'people' && <MonthlyCyclePeople />}
      {section === 'collect' && (
        <div className="mch-panel">
          <ClaimRequestCampaign user={user} />
        </div>
      )}
      {section === 'track' && (
        <PortalClaimsHub user={user} lockSection="response" hideSectionNav />
      )}
      {section === 'payroll' && (
        <PortalClaimsHub user={user} lockSection="response" hideSectionNav initialFilter="ready_for_payroll" />
      )}
    </div>
  );
}
