import React, { useEffect, useMemo, useRef, useState } from 'react';
import { validateOtRowClient, otRateHintForDate } from './claimsTimeParse.js';
import {
  buildWizardSteps,
  STEP_LABELS,
  nextStep,
  prevStep,
  stepIndex,
  syncOtHours,
  countMeaningfulRows,
  prepareItemsForSave,
  buildClaimSummary,
  supportCategoryLabel,
  attachmentsForSupportType,
  isMeaningfulOtRow,
} from './claimsFillHelpers.js';
import { buildClaimPeopleStory } from './claimsPeople.js';

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

function scrollToFeedback(ref) {
  requestAnimationFrame(() => {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      ref?.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } catch { /* ignore */ }
  });
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
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [wizardStep, setWizardStep] = useState('ot');
  const feedbackRef = useRef(null);
  const prevSelectedRef = useRef(null);
  const rowsDirtyRef = useRef(false);
  const suppressDirtyRef = useRef(false);

  const hydrateRowsFromServer = (session, employeeId) => {
    if (!session || !employeeId) return;
    const subRow = session.submissions?.find((s) => s.employee_id === employeeId);
    const items = (session.items || []).filter((i) => subRow && i.submission_id === subRow.id);
    const ots = items.filter((i) => i.claim_type === 'OT').map((i) => ({
      claim_type: 'OT',
      claim_date: i.claim_date?.slice?.(0, 10) || i.claim_date || '',
      ot_hours: i.ot_hours || '',
      ot_multiplier: i.ot_multiplier || 'Double',
      nature: i.nature || '',
      time_from: i.time_from || '',
      time_to: i.time_to || '',
    }));
    const exps = items.filter((i) => i.claim_type === 'EXPENSE').map((i) => ({
      claim_type: 'EXPENSE',
      claim_date: i.claim_date?.slice?.(0, 10) || i.claim_date || '',
      amount: i.amount || '',
      description: i.description || '',
      expense_type: i.expense_type || '',
    }));
    const meds = items.filter((i) => i.claim_type === 'MEDICAL').map((i) => ({
      claim_type: 'MEDICAL',
      claim_date: i.claim_date?.slice?.(0, 10) || i.claim_date || '',
      amount: i.amount || '',
      description: i.description || '',
      patient_name: i.patient_name || '',
    }));
    suppressDirtyRef.current = true;
    setOtRows(ots.length ? syncOtHours(ots) : [emptyOt()]);
    setExpRows(exps);
    setMedRows(meds);
    queueMicrotask(() => { suppressDirtyRef.current = false; });
  };

  const markRowsDirty = () => {
    if (!suppressDirtyRef.current) rowsDirtyRef.current = true;
  };

  const updateOtRow = (idx, patch) => {
    markRowsDirty();
    setOtRows((rs) => syncOtHours(rs.map((r, j) => (j === idx ? { ...r, ...patch } : r))));
  };

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
    const employeeChanged = prevSelectedRef.current !== selected;
    if (employeeChanged || !rowsDirtyRef.current) {
      hydrateRowsFromServer(data, selected);
    }
    if (employeeChanged) {
      const steps = buildWizardSteps(
        data.submissions?.find((s) => s.employee_id === selected)?.enabled_types
          || data.contractPack?.enabled_types,
      );
      setWizardStep(steps[0] || 'review');
      prevSelectedRef.current = selected;
      rowsDirtyRef.current = false;
    }
  }, [selected, data]);

  const patchAttachment = (attachment, submissionId) => {
    setData((prev) => {
      if (!prev) return prev;
      const att = { ...attachment, submission_id: submissionId };
      const rest = (prev.attachments || []).filter((a) => a.id !== att.id);
      return { ...prev, attachments: [...rest, att] };
    });
  };

  const sub = data?.submissions?.find((s) => s.employee_id === selected);
  const wizardSteps = useMemo(
    () => buildWizardSteps(sub?.enabled_types || data?.contractPack?.enabled_types),
    [sub?.enabled_types, data?.contractPack?.enabled_types],
  );
  const locked = sub && ['approved', 'in_payroll'].includes(sub.status);
  const submittedLocked = sub && ['submitted', 'approved', 'in_payroll', 'no_claims'].includes(sub.status);
  const fillClosed = data?.period?.fill_closed;
  const atts = (data?.attachments || []).filter((a) => sub && a.submission_id === sub.id);
  const pkHolidays = data?.pkHolidays || {};
  const summary = buildClaimSummary({ otRows, expRows, medRows, attachments: atts, pkHolidays });
  const isSelfFinalApproved = locked && ['lm_only', 'focal_only'].includes(sub?.routing_profile) && sub?.status === 'approved';
  const people = sub ? buildClaimPeopleStory(sub) : null;
  const canEdit = !locked && !fillClosed;
  const canSubmit = !busy && canEdit && summary.supportBlockers.length === 0 && summary.totals.lineCount > 0;

  const save = async (confirmNoClaims = false, asDraft = false) => {
    setBusy(true);
    setMsg('');
    setError('');
    setJustSubmitted(false);
    try {
      const claimMonth = data?.period?.claim_month;
      const claimYear = data?.period?.claim_year;
      const otPrepared = syncOtHours(otRows);
      if (!confirmNoClaims && otPrepared.some((r) => isMeaningfulOtRow(r))) {
        const clientErrors = [];
        otPrepared.forEach((r, i) => {
          if (!isMeaningfulOtRow(r)) return;
          validateOtRowClient(r, claimMonth, claimYear).forEach((e) => clientErrors.push(`OT line ${i + 1}: ${e}`));
        });
        if (clientErrors.length) throw new Error(clientErrors.join('\n'));
      }
      const items = prepareItemsForSave(otPrepared, expRows, medRows, confirmNoClaims, pkHolidays);
      const r = await fetch(`${API}/api/portal-claims/fill/${token}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: selected, items, confirmNoClaims, asDraft }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || (Array.isArray(d.errors) ? d.errors.join('\n') : 'Save failed'));
      const submitted = !asDraft && !confirmNoClaims && ['submitted', 'approved'].includes(d.status);
      setJustSubmitted(submitted);
      setMsg(d.message || (confirmNoClaims ? 'No Claims confirmed.' : asDraft ? 'Draft saved.' : 'Submitted.'));
      rowsDirtyRef.current = false;
      if (submitted) setWizardStep('review');
      await load();
      scrollToFeedback(feedbackRef);
      return true;
    } catch (e) {
      setError(e.message);
      scrollToFeedback(feedbackRef);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const goToReview = async () => {
    if (canEdit && summary.totals.lineCount > 0) {
      const ok = await save(false, true);
      if (!ok) return;
    }
    setWizardStep('review');
  };

  const uploadSupport = async (file, category) => {
    if (!file || !selected) return;
    setBusy(true);
    setError('');
    setMsg('');
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
      const savedAs = d.category || d.attachment?.category || category;
      setMsg(`Uploaded ${file.name} (${supportCategoryLabel(savedAs)})`);
      if (d.attachment && sub?.id) patchAttachment(d.attachment, sub.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadExcel = async (file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setMsg('');
    setJustSubmitted(false);
    try {
      const contentBase64 = await fileToBase64(file);
      const r = await fetch(`${API}/api/portal-claims/fill/${token}/import-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentBase64 }),
      });
      const d = await r.json();
      if (!r.ok) {
        const details = (d.parseErrors || []).slice(0, 12).join('\n');
        throw new Error((d.error || 'Excel import failed') + (details ? `\n\n${details}` : ''));
      }
      const notes = (d.parseErrors || []).length
        ? `\n\nPlease fix these rows and re-upload:\n${d.parseErrors.slice(0, 12).join('\n')}`
        : '';
      setMsg((d.message || 'Excel imported as draft.') + notes);
      const rr = await fetch(`${API}/api/portal-claims/fill/${token}`);
      const d2 = await rr.json();
      if (d2?.submissions) {
        rowsDirtyRef.current = false;
        setData(d2);
        const firstOk = (d.results || []).find((x) => x.ok)?.employeeId
          || d2.submissions.find((s) => s.status === 'draft')?.employee_id
          || d2.submissions[0]?.employee_id;
        if (firstOk) setSelected(firstOk);
      }
      scrollToFeedback(feedbackRef);
    } catch (e) {
      setError(e.message);
      scrollToFeedback(feedbackRef);
    } finally {
      setBusy(false);
    }
  };

  const clearAllOt = () => {
    if (!window.confirm('Remove all overtime lines for this employee? You can add them again later.')) return;
    markRowsDirty();
    setOtRows([]);
  };

  if (error && !data) {
    return <Shell><Alert tone="bad">{error}</Alert></Shell>;
  }
  if (!data) return <Shell><p className="claims-muted">Loading your claims form…</p></Shell>;

  const pct = data.completion?.total
    ? Math.round((data.completion.submitted / data.completion.total) * 100)
    : 0;
  const banner = data?.period?.banner;
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const claimLabel = banner?.claimLabel || (data?.period ? `${monthNames[data.period.claim_month] || data.period.claim_month} ${data.period.claim_year}` : '');
  const settleLabel = banner?.settlementLabel || (data?.period?.settlement_month ? `${monthNames[data.period.settlement_month]} ${data.period.settlement_year}` : 'following month');
  const templateHref = data.templateUrl || `${API}/api/portal-claims/fill/${encodeURIComponent(token)}/template.xlsx`;

  if (fillClosed) {
    return (
      <Shell>
        <header className="claims-header">
          <div className="claims-brand">ASIL HCM</div>
          <h1 className="claims-title">Deadline has expired</h1>
          <p className="claims-lead">
            The submit window for <strong>{claimLabel || 'this cycle'}</strong> is closed.
            You cannot add or change claims from this link.
          </p>
        </header>
        <Alert tone="bad" prominent>
          Deadline has expired. Raise claims next month.
        </Alert>
      </Shell>
    );
  }

  const stepCounts = {
    ot: countMeaningfulRows(otRows, 'OT'),
    expense: countMeaningfulRows(expRows, 'EXPENSE'),
    medical: countMeaningfulRows(medRows, 'MEDICAL'),
    supports: summary.attachments.length,
    review: summary.totals.lineCount,
  };

  return (
    <Shell>
      <header className="claims-header">
        <div className="claims-brand">ASIL HCM</div>
        <h1 className="claims-title">Submit monthly claims</h1>
        <p className="claims-lead">
          Claiming for: <strong>{claimLabel}</strong>
          {' · '}Submit by: <strong>day {data.period.submit_deadline_day || 18}</strong>
          {' · '}LM approve by: <strong>day {data.period.approve_deadline_day || 22}</strong>
          {' · '}Paid with: <strong>{settleLabel} salary</strong>
        </p>
        <p className="claims-muted">Progress {pct}% ({data.completion.submitted}/{data.completion.total})</p>
      </header>

      <div className="claims-card claims-card-info">
        <div className="claims-card-title">Your deadlines</div>
        <p className="claims-body">
          Submit all claims for <strong>{claimLabel}</strong> by <strong>day {data.period.submit_deadline_day || 18}</strong>.
          Your Line Manager approves by <strong>day {data.period.approve_deadline_day || 22}</strong>.
          Approved amounts are paid with your <strong>{settleLabel}</strong> salary.
        </p>
      </div>

      <HowItWorks templateHref={templateHref} />

      <div ref={feedbackRef} />
      {error && <Alert tone="bad"><pre className="claims-pre">{error}</pre></Alert>}
      {(justSubmitted || msg) && (
        <Alert tone="good" prominent={justSubmitted}>
          {justSubmitted && <div className="claims-success-title">Submitted successfully</div>}
          <pre className="claims-pre">{msg}</pre>
        </Alert>
      )}

      <div className="claims-card">
        <div className="claims-card-title">Option A — Excel (recommended)</div>
        <p className="claims-body-sm">
          Download <strong>your</strong> workbook — Employee Code and Name are already filled. Upload loads a <strong>draft</strong>.
          If the file has Expense or Medical amounts, upload support files before final submit.
        </p>
        <div className="claims-actions">
          <a href={templateHref} className="claims-btn-primary" download>Download my Excel (prefilled)</a>
          {canEdit && (
            <label className="claims-btn-ghost claims-file-label">
              Upload filled Excel
              <input type="file" accept=".xlsx,.xls" hidden disabled={busy} onChange={(e) => { uploadExcel(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
        </div>
      </div>

      <div className="claims-card claims-card-main">
        <div className="claims-card-title">Option B — Enter on screen (step by step)</div>
        <div className="claims-fill-grid">
          <aside className="claims-sidebar">
            <div className="claims-sidebar-label">YOUR EMPLOYEES</div>
            {data.submissions.map((s) => (
              <button
                key={s.employee_id}
                type="button"
                className={`claims-emp-btn${selected === s.employee_id ? ' is-on' : ''}`}
                onClick={() => setSelected(s.employee_id)}
              >
                <div className="claims-emp-name">{s.employee_name}</div>
                <div className="claims-emp-status">{statusLabel(s.status)}</div>
              </button>
            ))}
          </aside>

          <section className="claims-main-panel">
            {!sub ? <p className="claims-muted">Select an employee</p> : (
              <>
                <h2 className="claims-emp-title">{sub.employee_name}</h2>
                <p className="claims-muted claims-emp-meta">
                  {sub.employee_id} · {sub.client || '—'} · {sub.location || '—'}
                </p>
                {people && <ClaimPeopleCard story={people} />}
                {locked && !justSubmitted && (
                  <Alert tone={isSelfFinalApproved ? 'good' : 'warn'}>
                    {isSelfFinalApproved
                      ? `${people.headline} It is locked for the following month’s salary. Contact ops-support@asil.com.pk if you need a correction before payroll.`
                      : `${people.headline} Locked after approval. Raise further claims next month.`}
                  </Alert>
                )}

                {wizardStep !== 'review' && (
                  <ClaimSummaryPanel
                    summary={summary}
                    claimLabel={claimLabel}
                    onEditStep={setWizardStep}
                    readOnly={submittedLocked && !canEdit}
                  />
                )}

                <div className="claims-steps" role="tablist" aria-label="Claim entry steps">
                  {wizardSteps.map((s, i) => {
                    const count = stepCounts[s];
                    const done = s === 'review'
                      ? summary.totals.lineCount > 0
                      : count > 0;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="tab"
                        aria-selected={wizardStep === s}
                        className={`claims-step-pill${wizardStep === s ? ' is-current' : ''}${done ? ' is-done' : ''}`}
                        onClick={() => (s === 'review' ? goToReview() : setWizardStep(s))}
                      >
                        {i + 1}. {STEP_LABELS[s]}
                        {count > 0 && s !== 'review' ? ` (${count})` : ''}
                      </button>
                    );
                  })}
                </div>

                {wizardStep === 'ot' && (
                  <Section title="Step 1 — Overtime">
                    <Hint>
                      Only dates in <strong>{claimLabel}</strong> are accepted.
                      Enter <strong>OT Start / OT End</strong> for overtime after normal duty — not your full shift.
                      Example: 5:00 PM–8:00 PM. Each line stays visible below.
                    </Hint>
                    {otRows.length === 0 && (
                      <p className="claims-muted">No overtime lines yet.</p>
                    )}
                    {otRows.map((row, i) => {
                      const rateHint = otRateHintForDate(row.claim_date, pkHolidays);
                      return (
                      <div key={`ot-${i}`} className="claims-row-card">
                        <div className="claims-row-head">
                          <strong>OT line {i + 1}</strong>
                          {canEdit && otRows.length > 0 && (
                            <button
                              type="button"
                              className="claims-link-btn"
                              onClick={() => { markRowsDirty(); setOtRows((rs) => rs.filter((_, j) => j !== i)); }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        <Row>
                          <Field label="Date (DD/MM/YYYY)">
                            <input type="date" disabled={!canEdit} value={row.claim_date} onChange={(e) => updateOtRow(i, { claim_date: e.target.value })} className="claims-inp" />
                          </Field>
                          <Field label="OT Start Time">
                            <input disabled={!canEdit} placeholder="5:00 PM, 5PM, or 1700" value={row.time_from || ''} onChange={(e) => updateOtRow(i, { time_from: e.target.value })} className="claims-inp" />
                          </Field>
                          <Field label="OT End Time">
                            <input disabled={!canEdit} placeholder="7:00 PM, 7PM, or 1900" value={row.time_to || ''} onChange={(e) => updateOtRow(i, { time_to: e.target.value })} className="claims-inp" />
                          </Field>
                          <Field label="OT Hours (auto)">
                            <input disabled placeholder="from Start→End" value={row.ot_hours} readOnly className="claims-inp claims-inp-readonly" />
                          </Field>
                          <Field label="Nature of work">
                            <input disabled={!canEdit} value={row.nature} onChange={(e) => updateOtRow(i, { nature: e.target.value })} className="claims-inp" />
                          </Field>
                        </Row>
                        {rateHint && (rateHint.tone === 'sunday' || rateHint.tone === 'holiday') && (
                          <p className={`claims-ot-rate-hint claims-ot-rate-hint--${rateHint.tone}`}>{rateHint.message}</p>
                        )}
                      </div>
                    );})}
                    {canEdit && (
                      <div className="claims-actions">
                        <button type="button" onClick={() => { markRowsDirty(); setOtRows((r) => [...r, emptyOt()]); }} className="claims-btn-ghost">+ Add another OT line</button>
                        {otRows.length > 0 && (
                          <button type="button" onClick={clearAllOt} className="claims-btn-ghost">Clear all OT lines</button>
                        )}
                      </div>
                    )}
                    <StepNavButtons step="ot" steps={wizardSteps} setStep={setWizardStep} canEdit={canEdit} />
                  </Section>
                )}

                {wizardStep === 'expense' && (
                  <Section title="Step 2 — Expense Reimbursement">
                    {expRows.length === 0 && <p className="claims-muted">No expense lines yet — add one if needed.</p>}
                    {expRows.map((row, i) => (
                      <div key={`exp-${i}`} className="claims-row-card">
                        <div className="claims-row-head">
                          <strong>Expense line {i + 1}</strong>
                          {canEdit && (
                            <button type="button" className="claims-link-btn" onClick={() => { markRowsDirty(); setExpRows((rs) => rs.filter((_, j) => j !== i)); }}>Remove</button>
                          )}
                        </div>
                        <Row>
                          <Field label="Date"><input type="date" disabled={!canEdit} value={row.claim_date} onChange={(e) => { markRowsDirty(); setExpRows((rs) => rs.map((r, j) => (j === i ? { ...r, claim_date: e.target.value } : r))); }} className="claims-inp" /></Field>
                          <Field label="Amount (PKR)"><input disabled={!canEdit} value={row.amount} onChange={(e) => { markRowsDirty(); setExpRows((rs) => rs.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r))); }} className="claims-inp" /></Field>
                          <Field label="Description"><input disabled={!canEdit} value={row.description} onChange={(e) => { markRowsDirty(); setExpRows((rs) => rs.map((r, j) => (j === i ? { ...r, description: e.target.value } : r))); }} className="claims-inp" /></Field>
                        </Row>
                      </div>
                    ))}
                    {canEdit && (
                      <div className="claims-actions">
                        <button type="button" onClick={() => { markRowsDirty(); setExpRows((r) => [...r, emptyExp()]); }} className="claims-btn-ghost">+ Add expense line</button>
                      </div>
                    )}
                    <StepNavButtons step="expense" steps={wizardSteps} setStep={setWizardStep} canEdit={canEdit} />
                  </Section>
                )}

                {wizardStep === 'medical' && (
                  <Section title="Step 3 — Medical Reimbursement">
                    {medRows.length === 0 && <p className="claims-muted">No medical lines yet — add one if needed.</p>}
                    {medRows.map((row, i) => (
                      <div key={`med-${i}`} className="claims-row-card">
                        <div className="claims-row-head">
                          <strong>Medical line {i + 1}</strong>
                          {canEdit && (
                            <button type="button" className="claims-link-btn" onClick={() => { markRowsDirty(); setMedRows((rs) => rs.filter((_, j) => j !== i)); }}>Remove</button>
                          )}
                        </div>
                        <Row>
                          <Field label="Date"><input type="date" disabled={!canEdit} value={row.claim_date} onChange={(e) => { markRowsDirty(); setMedRows((rs) => rs.map((r, j) => (j === i ? { ...r, claim_date: e.target.value } : r))); }} className="claims-inp" /></Field>
                          <Field label="Amount (PKR)"><input disabled={!canEdit} value={row.amount} onChange={(e) => { markRowsDirty(); setMedRows((rs) => rs.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r))); }} className="claims-inp" /></Field>
                          <Field label="Patient"><input disabled={!canEdit} value={row.patient_name} onChange={(e) => { markRowsDirty(); setMedRows((rs) => rs.map((r, j) => (j === i ? { ...r, patient_name: e.target.value } : r))); }} className="claims-inp" /></Field>
                          <Field label="Description"><input disabled={!canEdit} value={row.description} onChange={(e) => { markRowsDirty(); setMedRows((rs) => rs.map((r, j) => (j === i ? { ...r, description: e.target.value } : r))); }} className="claims-inp" /></Field>
                        </Row>
                      </div>
                    ))}
                    {canEdit && (
                      <div className="claims-actions">
                        <button type="button" onClick={() => { markRowsDirty(); setMedRows((r) => [...r, emptyMed()]); }} className="claims-btn-ghost">+ Add medical line</button>
                      </div>
                    )}
                    <StepNavButtons step="medical" steps={wizardSteps} setStep={setWizardStep} canEdit={canEdit} />
                  </Section>
                )}

                {wizardStep === 'supports' && (
                  <Section title="Step 4 — Supports — upload matching receipts">
                    <Hint>
                      Upload support files only for claim types you entered above.
                      {summary.hasExpense && summary.hasMedical
                        ? ' Expense and Medical need two separate uploads.'
                        : summary.hasMedical
                          ? ' You entered Medical claims — use the Medical supports upload below.'
                          : summary.hasExpense
                            ? ' You entered Expense claims — use the Expense supports upload below.'
                            : ' No Expense or Medical amounts entered — supports are not required.'}
                    </Hint>
                    {canEdit && (
                      <div className="claims-upload-grid">
                        {summary.hasExpense && (
                          <label className="claims-upload-label">
                            Expense Reimbursement supports
                            {!summary.hasExpenseSupport ? <span className="claims-required"> (required)</span> : null}
                            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.zip" className="claims-file-input"
                              onChange={(e) => { uploadSupport(e.target.files?.[0], 'expense_support'); e.target.value = ''; }} />
                          </label>
                        )}
                        {summary.hasMedical && (
                          <label className="claims-upload-label">
                            Medical Reimbursement supports
                            {!summary.hasMedicalSupport ? <span className="claims-required"> (required)</span> : null}
                            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.zip" className="claims-file-input"
                              onChange={(e) => { uploadSupport(e.target.files?.[0], 'medical_support'); e.target.value = ''; }} />
                          </label>
                        )}
                        {!summary.hasExpense && !summary.hasMedical && (
                          <p className="claims-muted">No support uploads needed — continue to Review or add Expense/Medical lines first.</p>
                        )}
                      </div>
                    )}
                    <SupportFilesList summary={summary} />
                    <StepNavButtons step="supports" steps={wizardSteps} setStep={setWizardStep} onGoReview={goToReview} canEdit={canEdit} nextLabel="Continue to Review" />
                  </Section>
                )}

                {wizardStep === 'review' && (
                  <Section title="Step 5 — Review & Confirm">
                    <Hint>
                      Check every line below. When everything looks correct, click <strong>Confirm &amp; Submit</strong>.
                      Use <strong>Save Draft</strong> if you want to come back later.
                    </Hint>
                    <ClaimSummaryPanel summary={summary} claimLabel={claimLabel} onEditStep={setWizardStep} detailed />
                    {summary.supportBlockers.length > 0 && (
                      <Alert tone="warn">
                        Submit is blocked until you upload: {summary.supportBlockers.join(' · ')}.
                        You can still Save Draft.
                      </Alert>
                    )}
                    {summary.totals.lineCount === 0 && (
                      <Alert tone="warn">No claim lines entered yet. Go back and add OT, Expense, or Medical — or use Confirm No Claims.</Alert>
                    )}
                    {(justSubmitted || sub.status === 'submitted' || sub.status === 'approved') && (
                      <Alert tone="good" prominent={justSubmitted}>
                        <div className="claims-success-title">Submission receipt</div>
                        <p className="claims-body-sm">
                          Status: <strong>{statusLabel(sub.status)}</strong>.
                          {sub.status === 'submitted' && ' Your claim has been sent for approval. To make changes, contact ops-support@asil.com.pk before the deadline.'}
                          {sub.status === 'approved' && ` ${people.headline} This claim is locked.`}
                        </p>
                      </Alert>
                    )}
                    {sub.status === 'draft' && !justSubmitted && summary.totals.lineCount > 0 && (
                      <Alert tone="good">Draft saved — review everything here, then Confirm &amp; Submit when ready.</Alert>
                    )}
                  </Section>
                )}

                {canEdit && (
                  <div className="claims-footer-actions">
                    {wizardStep === 'review' ? (
                      <button type="button" disabled={!canSubmit} onClick={() => save(false, false)} className="claims-btn-primary">
                        Confirm &amp; Submit
                      </button>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => goToReview()} className="claims-btn-ghost">
                        Go to Review
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => save(false, true)} className="claims-btn-ghost">Save Draft</button>
                    <button type="button" disabled={busy} onClick={() => save(true, false)} className="claims-btn-ghost">Confirm No Claims</button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}

function ClaimSummaryPanel({ summary, claimLabel, onEditStep, detailed = false, readOnly = false }) {
  const groups = [
    { key: 'ot', title: 'Overtime', lines: summary.otLines, step: 'ot', total: `${summary.totals.otHours}h total` },
    { key: 'exp', title: 'Expense', lines: summary.expenseLines, step: 'expense', total: `PKR ${summary.totals.expense.toLocaleString('en-PK')}` },
    { key: 'med', title: 'Medical', lines: summary.medicalLines, step: 'medical', total: `PKR ${summary.totals.medical.toLocaleString('en-PK')}` },
  ];

  return (
    <div className="claims-summary">
      <div className="claims-summary-head">
        <div>
          <div className="claims-summary-title">Your claim summary — {claimLabel}</div>
          <div className="claims-muted">{summary.totals.lineCount} line(s) entered</div>
        </div>
        {!readOnly && (
          <div className="claims-summary-links">
            {groups.map((g) => (
              <button key={g.key} type="button" className="claims-link-btn" onClick={() => onEditStep(g.step)}>Edit {g.title}</button>
            ))}
            <button type="button" className="claims-link-btn" onClick={() => onEditStep('supports')}>Edit Supports</button>
          </div>
        )}
      </div>
      {groups.map((g) => (
        <div key={g.key} className="claims-summary-group">
          <div className="claims-summary-group-head">
            <strong>{g.title}</strong>
            <span className="claims-muted">{g.lines.length ? g.total : 'None'}</span>
          </div>
          {g.lines.length === 0 ? (
            <p className="claims-muted claims-summary-empty">No {g.title.toLowerCase()} lines</p>
          ) : (
            <ul className="claims-summary-list">
              {g.lines.map((line) => (
                <li key={line.key}>
                  <span className="claims-summary-date">{line.date || '—'}</span>
                  <span>{line.detail}</span>
                  {line.extra ? <span className="claims-muted"> · {line.extra}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {detailed && (
        <SupportFilesList summary={summary} compact />
      )}
    </div>
  );
}

function SupportFilesList({ summary, compact = false }) {
  const expenseAtts = attachmentsForSupportType(summary.attachments, 'expense');
  const medicalAtts = attachmentsForSupportType(summary.attachments, 'medical');
  const workbookAtts = attachmentsForSupportType(summary.attachments, 'workbook');
  const hasAny = expenseAtts.length || medicalAtts.length || workbookAtts.length;
  if (!hasAny) {
    return compact ? null : <p className="claims-muted claims-summary-empty">No support files uploaded yet</p>;
  }
  const renderGroup = (title, files) => files.length ? (
    <div className={compact ? 'claims-summary-group' : 'claims-support-group'}>
      <div className="claims-summary-group-head">
        <strong>{title}</strong>
        <span className="claims-muted">{files.length} file(s)</span>
      </div>
      <ul className={compact ? 'claims-summary-list' : 'claims-attach-list'}>
        {files.map((a) => (
          <li key={a.id}>{a.filename}</li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <div className="claims-support-groups">
      {renderGroup('Expense supports', expenseAtts)}
      {renderGroup('Medical supports', medicalAtts)}
      {renderGroup('Excel workbook', workbookAtts)}
    </div>
  );
}

function StepNavButtons({ step, steps, setStep, onGoReview, canEdit, nextLabel }) {
  if (!canEdit) return null;
  const wizardSteps = steps || buildWizardSteps();
  const isFirst = stepIndex(step, wizardSteps) === 0;
  const reviewIdx = wizardSteps.indexOf('review');
  const preReview = reviewIdx > 0 ? wizardSteps[reviewIdx - 1] : 'review';
  const isLast = step === preReview;
  const handleNext = () => {
    if (step === 'supports' && onGoReview) onGoReview();
    else if (isLast && onGoReview) onGoReview();
    else setStep(nextStep(step, wizardSteps));
  };
  return (
    <div className="claims-step-nav">
      {!isFirst && (
        <button type="button" className="claims-btn-ghost" onClick={() => setStep(prevStep(step, wizardSteps))}>← Back</button>
      )}
      {!isLast && step !== 'review' && (
        <button type="button" className="claims-btn-primary" onClick={handleNext}>
          {nextLabel || 'Continue →'}
        </button>
      )}
    </div>
  );
}

function HowItWorks({ templateHref }) {
  return (
    <div className="claims-card claims-card-muted">
      <div className="claims-card-title">How this works (simple)</div>
      <ol className="claims-how-list">
        <li><strong>Option A:</strong> Download <a href={templateHref} className="claims-link">your Excel</a>. <strong>Option B:</strong> enter step-by-step — all lines stay visible in the summary.</li>
        <li>Add OT, Expense, and Medical on separate steps. Click any step number to jump back.</li>
        <li>Upload support files if you claimed Expense or Medical, then Review &amp; Confirm before submit.</li>
        <li>Questions: <a href="mailto:ops-support@asil.com.pk" className="claims-link">ops-support@asil.com.pk</a></li>
      </ol>
    </div>
  );
}

function statusLabel(s) {
  const map = {
    invited: 'Not started',
    draft: 'Draft — not submitted yet',
    submitted: 'Submitted — waiting approval',
    approved: 'Approved',
    rejected: 'Rejected',
    no_claims: 'No Claims confirmed',
    in_payroll: 'In payroll',
  };
  return map[s] || s;
}

function Shell({ children }) {
  return (
    <div className="claims-shell">
      <div className="claims-shell-inner">{children}</div>
      <style>{CLAIMS_FILL_CSS}</style>
    </div>
  );
}

function ClaimPeopleCard({ story }) {
  if (!story) return null;
  return (
    <div className="claims-people">
      <div className="claims-people-title">{story.headline}</div>
      <dl className="claims-people-list">
        {story.lines.map((row) => (
          <div key={row.label} className="claims-people-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Alert({ children, tone, prominent }) {
  const cls = `claims-alert claims-alert-${tone}${prominent ? ' is-prominent' : ''}`;
  return <div className={cls}>{children}</div>;
}

function Hint({ children }) {
  return <div className="claims-hint">{children}</div>;
}

function Section({ title, children }) {
  return <div className="claims-section"><div className="claims-section-title">{title}</div>{children}</div>;
}

function Field({ label, children }) {
  return <label className="claims-field"><span className="claims-field-label">{label}</span>{children}</label>;
}

function Row({ children }) {
  return <div className="claims-row">{children}</div>;
}

const CLAIMS_FILL_CSS = `
.claims-shell { min-height: 100vh; background: linear-gradient(165deg,#eef2ff 0%,#f8fafc 40%,#ecfeff 100%); padding: 28px 16px 48px; font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; }
.claims-shell-inner { max-width: 980px; margin: 0 auto; }
.claims-brand { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; color: #1d4ed8; text-transform: uppercase; }
.claims-title { margin: 4px 0 8px; font-size: 1.55rem; font-weight: 700; }
.claims-lead, .claims-body, .claims-body-sm { margin: 0; color: #334155; line-height: 1.55; }
.claims-body-sm { font-size: 13px; }
.claims-muted { color: #64748b; font-size: 13px; }
.claims-pre { margin: 0; white-space: pre-wrap; font-family: inherit; }
.claims-card { border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; background: #fff; box-shadow: 0 1px 2px rgba(15,23,42,0.04); margin-bottom: 16px; }
.claims-card-info { background: #eff6ff; border-color: #bfdbfe; }
.claims-card-muted { background: #f8fafc; }
.claims-card-main { border-width: 2px; }
.claims-card-title { font-weight: 700; margin-bottom: 8px; }
.claims-fill-grid { display: grid; grid-template-columns: minmax(200px,240px) 1fr; gap: 16px; }
.claims-sidebar { border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; background: #fff; }
.claims-sidebar-label { font-weight: 700; font-size: 11px; color: #64748b; margin-bottom: 10px; letter-spacing: 0.04em; }
.claims-emp-btn { display: block; width: 100%; text-align: left; margin-bottom: 8px; padding: 10px 12px; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; cursor: pointer; color: #0f172a; }
.claims-emp-btn.is-on { border: 2px solid #2563eb; background: #eff6ff; }
.claims-emp-name { font-weight: 650; font-size: 13px; }
.claims-emp-status { font-size: 11px; color: #64748b; margin-top: 2px; }
.claims-main-panel { border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; background: #fff; }
.claims-emp-title { margin: 0 0 4px; font-size: 1.15rem; }
.claims-emp-meta { margin: 0 0 12px; }
.claims-steps { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0; }
.claims-step-pill { font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 20px; border: 1px solid #e2e8f0; background: #f8fafc; color: #64748b; cursor: pointer; }
.claims-step-pill.is-current { background: #2563eb; border-color: #2563eb; color: #fff; }
.claims-step-pill.is-done:not(.is-current) { background: #ecfdf5; border-color: #86efac; color: #166534; }
.claims-summary { border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px; background: #f8fafc; margin-bottom: 14px; }
.claims-summary-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.claims-summary-title { font-weight: 700; color: #0f172a; }
.claims-summary-links { display: flex; gap: 8px; flex-wrap: wrap; }
.claims-summary-group { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0; }
.claims-summary-group-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.claims-summary-list { margin: 0; padding-left: 18px; color: #334155; font-size: 13px; line-height: 1.6; }
.claims-summary-date { display: inline-block; min-width: 88px; font-weight: 600; }
.claims-summary-empty { margin: 0; }
.claims-row-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 10px; background: #fff; }
.claims-row-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.claims-row { display: grid; grid-template-columns: repeat(auto-fit,minmax(130px,1fr)); gap: 10px; }
.claims-field { display: block; }
.claims-field-label { display: block; font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px; }
.claims-inp { width: 100%; padding: 9px 10px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; color: #0f172a; font-size: 14px; box-sizing: border-box; }
.claims-inp-readonly { background: #f8fafc; }
.claims-actions, .claims-step-nav, .claims-footer-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.claims-btn-primary { background: #2563eb; color: #fff; border: none; padding: 11px 18px; border-radius: 10px; font-weight: 650; cursor: pointer; font-size: 14px; text-decoration: none; display: inline-block; }
.claims-btn-ghost { background: #fff; color: #0f172a; border: 1px solid #cbd5e1; padding: 10px 14px; border-radius: 10px; cursor: pointer; font-size: 13px; font-weight: 550; }
.claims-link-btn, .claims-link { background: none; border: none; color: #1d4ed8; cursor: pointer; font-size: 13px; font-weight: 600; text-decoration: underline; padding: 0; }
.claims-file-label { cursor: pointer; }
.claims-upload-grid { display: grid; gap: 10px; max-width: 520px; }
.claims-upload-label { color: #0f172a; font-size: 13px; font-weight: 600; }
.claims-file-input { display: block; margin-top: 6px; }
.claims-support-groups { display: grid; gap: 12px; margin-top: 10px; }
.claims-support-group { border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; background: #f8fafc; }
.claims-ot-rate-hint { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; font-size: 13px; line-height: 1.45; }
.claims-ot-rate-hint--sunday { background: #eff6ff; border: 1px solid #93c5fd; color: #1e40af; }
.claims-ot-rate-hint--holiday { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; }
.claims-attach-list, .claims-how-list { margin: 0; padding-left: 18px; color: #334155; font-size: 13px; line-height: 1.6; }
.claims-section { margin-top: 8px; }
.claims-section-title { font-weight: 700; font-size: 14px; margin-bottom: 10px; }
.claims-hint { padding: 10px 12px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; color: #334155; font-size: 13px; line-height: 1.5; margin-bottom: 10px; }
.claims-alert { margin-top: 10px; margin-bottom: 8px; padding: 12px 14px; border-radius: 10px; line-height: 1.55; font-size: 14px; }
.claims-alert-good { background: #f0fdf4; border: 2px solid #86efac; color: #15803d; }
.claims-alert-warn { background: #fffbeb; border: 2px solid #fcd34d; color: #b45309; }
.claims-alert-bad { background: #fef2f2; border: 2px solid #fca5a5; color: #b91c1c; }
.claims-alert.is-prominent { padding: 16px 18px; font-size: 15px; box-shadow: 0 4px 16px rgba(22,101,52,0.12); }
.claims-success-title { font-weight: 800; font-size: 16px; margin-bottom: 6px; }
.claims-people { margin: 10px 0 12px; padding: 12px 14px; border-radius: 10px; background: #eff6ff; border: 1px solid #bfdbfe; color: #0f172a; }
.claims-people-title { font-weight: 700; font-size: 14px; line-height: 1.45; margin-bottom: 8px; }
.claims-people-list { margin: 0; }
.claims-people-row { display: grid; grid-template-columns: 148px 1fr; gap: 8px; font-size: 13px; line-height: 1.45; margin-top: 4px; }
.claims-people-row dt { margin: 0; color: #64748b; font-weight: 600; }
.claims-people-row dd { margin: 0; font-weight: 650; color: #0f172a; }
@media (max-width: 560px) { .claims-people-row { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .claims-fill-grid { grid-template-columns: 1fr !important; } }
`;
