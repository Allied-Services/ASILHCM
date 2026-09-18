import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Download, Lock, RefreshCw } from 'lucide-react';
import { api } from '../../api';
import {
  boardDownloadRows,
  downloadCsv,
  followingMonth,
  mergeReviewPeople,
  reviewStageOf,
  rowsToCsv,
} from './cycleDeskExport';

const STAGES = [
  { id: '', label: 'All stages' },
  { id: 'not_started', label: 'Not started' },
  { id: 'waiting_fill', label: 'Waiting fill' },
  { id: 'waiting_lm', label: 'Waiting LM' },
  { id: 'no_claims', label: 'No Claims' },
  { id: 'ready', label: 'Ready / review' },
  { id: 'submitted', label: 'Pending approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'pushed', label: 'Pushed' },
  { id: 'locked', label: 'Locked' },
];

function currentWorkPeriod() {
  const now = new Date();
  const payMonth = now.getMonth() + 1;
  const payYear = now.getFullYear();
  const work = new Date(payYear, payMonth - 2, 1);
  return { month: work.getMonth() + 1, year: work.getFullYear() };
}

function contractClient(c) {
  return c.clientName || c.client || c.client_name || '';
}

function contractName(c) {
  return c.contractName || c.contract_name || c.name || c.id;
}

function stageLabel(p) {
  return p.controlLabel || STAGES.find((s) => s.id === reviewStageOf(p))?.label || reviewStageOf(p);
}

export default function ReviewDesk({ user }) {
  const period = currentWorkPeriod();
  const [month, setMonth] = useState(period.month);
  const [year, setYear] = useState(period.year);
  const [client, setClient] = useState('');
  const [contractId, setContractId] = useState('');
  const [contracts, setContracts] = useState([]);
  const [stage, setStage] = useState('');
  const [peopleAll, setPeopleAll] = useState([]);
  const [bankIncomplete, setBankIncomplete] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [drawer, setDrawer] = useState(null);
  const [reason, setReason] = useState('');
  const [sourceNote, setSourceNote] = useState('');

  useEffect(() => {
    api.getContracts().then((rows) => setContracts(Array.isArray(rows) ? rows : [])).catch(() => setContracts([]));
  }, []);

  const clients = useMemo(
    () => [...new Set(contracts.map(contractClient).filter(Boolean))].sort(),
    [contracts]
  );
  const contractsForClient = useMemo(
    () => contracts.filter((c) => !client || contractClient(c) === client),
    [contracts, client]
  );

  async function load() {
    if (!client) {
      setPeopleAll([]);
      setPicked(new Set());
      setErr('');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const pay = followingMonth(month, year);
      const [ledger, board] = await Promise.all([
        api.getPayrollInputDesk({
          workMonth: month,
          workYear: year,
          contractId,
          client,
        }),
        api.portalClaimsResponse({
          workMonth: String(month),
          workYear: String(year),
          payMonth: String(pay.month),
          payYear: String(pay.year),
          client,
          contract: contractId,
        }),
      ]);
      setPeopleAll(mergeReviewPeople(board.people || [], ledger.people || []));
      setBankIncomplete(ledger.bankIncomplete || 0);
      setPicked(new Set());
    } catch (e) {
      setErr(e.message || 'Could not load the review desk');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, [month, year, client, contractId]);

  const people = useMemo(
    () => (stage ? peopleAll.filter((p) => reviewStageOf(p) === stage) : peopleAll),
    [peopleAll, stage]
  );
  const allIds = people.map((p) => p.employeeId);
  const allOn = allIds.length > 0 && allIds.every((id) => picked.has(id));
  const noClaimsCount = peopleAll.filter((p) => reviewStageOf(p) === 'no_claims').length;
  const waitingLmCount = peopleAll.filter((p) => reviewStageOf(p) === 'waiting_lm').length;

  function toggleAll() {
    setPicked(allOn ? new Set() : new Set(allIds));
  }

  function toggleOne(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportExcel() {
    const rows = boardDownloadRows(people);
    downloadCsv(
      `review_desk_${year}-${String(month).padStart(2, '0')}.csv`,
      rowsToCsv(rows)
    );
  }

  async function lockSelected() {
    const ids = [...picked];
    if (!ids.length && !contractId) {
      setErr('Tick people, or choose a contract, then Lock.');
      return;
    }
    if (!window.confirm(`Lock ${ids.length || 'this contract'} on the Payroll Sheet?`)) return;
    setBusy(true);
    try {
      await api.lockPayroll(year, month, ids, { contractId });
      await load();
    } catch (e) {
      setErr(e.message || 'Lock failed');
    } finally {
      setBusy(false);
    }
  }

  async function pushSelected() {
    setBusy(true);
    try {
      await api.calculatePayroll(year, month, {
        contractId: contractId || undefined,
        employeeIds: picked.size ? [...picked] : undefined,
        sourceMode: 'canonical',
      });
      await load();
    } catch (e) {
      setErr(e.message || 'Push to Payroll Sheet failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveIntervention() {
    if (!drawer || !reason.trim()) {
      setErr('A reason is required when payroll approves on behalf of a Focal or LM.');
      return;
    }
    setBusy(true);
    try {
      await api.intervenePayrollInput({
        employeeId: drawer.employeeId,
        contractId: drawer.contractId || contractId,
        workMonth: month,
        workYear: year,
        itemType: drawer.itemType || 'OT',
        hours: drawer.hours,
        amount: drawer.amount,
        presentDays: drawer.presentDays,
        absentDays: drawer.absentDays,
        reason: reason.trim(),
        sourceNote: sourceNote.trim(),
      });
      setDrawer(null);
      setReason('');
      setSourceNote('');
      await load();
    } catch (e) {
      setErr(e.message || 'Intervention failed');
    } finally {
      setBusy(false);
    }
  }

  const selectedContract = useMemo(
    () => contracts.find((c) => String(c.id) === String(contractId)),
    [contracts, contractId]
  );

  return (
    <div className="mch-panel review-desk">
      <div className="mch-people-actions">
        <label>
          Month
          <input type="number" min="1" max="12" value={month} onChange={(e) => setMonth(Number(e.target.value))} />
        </label>
        <label>
          Year
          <input type="number" min="2026" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </label>
        <label>
          Client
          <select
            value={client}
            onChange={(e) => { setClient(e.target.value); setContractId(''); }}
          >
            <option value="">Select client…</option>
            {clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Contract
          <select value={contractId} disabled={!client} onChange={(e) => setContractId(e.target.value)}>
            <option value="">{client ? 'All contracts' : 'Select client first'}</option>
            {contractsForClient.map((c) => (
              <option key={c.id} value={c.id}>{contractName(c)}</option>
            ))}
          </select>
        </label>
        <label>
          Stage
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((s) => <option key={s.id || 'all'} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn-secondary" disabled={busy || !client} onClick={load}>
          <RefreshCw size={14} /> Refresh
        </button>
        <button type="button" className="btn-secondary" disabled={!people.length} onClick={exportExcel}>
          <Download size={14} /> Download
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={pushSelected}>
          Push to Payroll Sheet
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={lockSelected}>
          <Lock size={14} /> Lock
        </button>
      </div>
      <p className="mch-muted">
        {!client
          ? 'Select a client to see everyone — including who is stuck and who has No Claims.'
          : `${people.length} showing of ${peopleAll.length} people${selectedContract ? ` on ${contractName(selectedContract)}` : ''}. Waiting LM ${waitingLmCount} · No Claims ${noClaimsCount}.`}
        {' '}Tick people (or leave empty to use the contract), then Lock and Push.
        {user?.email ? ` Signed in as ${user.email}.` : ''}
      </p>
      {bankIncomplete > 0 && (
        <p className="review-desk-warn">
          {bankIncomplete} people are missing a bank account or 03 mobile. Fix Employee Information before the HBL file can be produced.
        </p>
      )}
      {err && <p className="mch-error">{err}</p>}
      <div className="review-desk-table-wrap">
        <table className="review-desk-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th>Employee</th>
              <th>Stage</th>
              <th>Email goes to</th>
              <th>Approver</th>
              <th>Type</th>
              <th>Days / hours / amount</th>
              <th>Bank</th>
              <th>Sheet</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {people.flatMap((p) => (p.items.length ? p.items : [{ id: 'empty', itemType: '—', status: '—' }]).map((item) => (
              <tr key={`${p.employeeId}-${item.id}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={picked.has(p.employeeId)}
                    onChange={() => toggleOne(p.employeeId)}
                    aria-label={`Select ${p.employeeId}`}
                  />
                </td>
                <td>
                  <strong>{p.name || p.employeeId}</strong>
                  <div className="mch-muted">{p.employeeId} · {p.location || '—'}</div>
                </td>
                <td>{stageLabel(p)}</td>
                <td>{p.mailedTo || '—'}</td>
                <td>{p.approver || '—'}</td>
                <td>{item.itemType}</td>
                <td>
                  {item.presentDays != null ? `${item.presentDays} present` : ''}
                  {item.absentDays != null ? ` / ${item.absentDays} absent` : ''}
                  {item.hours != null ? ` ${item.hours}h` : ''}
                  {item.amount != null ? ` Rs. ${item.amount}` : ''}
                  {!p.items.length ? (p.noClaims ? 'No Claims' : (p.next || '—')) : ''}
                </td>
                <td className={p.bankReady === false ? 'review-desk-bank-bad' : ''}>
                  {p.bankReady === false ? (p.bankLabels || []).join(', ') || 'Incomplete' : (p.bankReady ? 'Ready' : '—')}
                </td>
                <td>{p.locked ? 'Locked' : (p.sheetPaidDays != null ? `${p.sheetPaidDays} PD` : '—')}</td>
                <td>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setDrawer({ ...p, ...item })}
                  >
                    Intervene
                  </button>
                </td>
              </tr>
            )))}
            {!client && (
              <tr>
                <td colSpan={10} className="mch-muted">Select a client first. The full roster — including No Claims — is not loaded until you do.</td>
              </tr>
            )}
            {client && !people.length && (
              <tr>
                <td colSpan={10} className="mch-muted">{busy ? 'Loading…' : 'No people for this client / stage.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {drawer && (
        <div className="review-desk-drawer">
          <h3><ClipboardCheck size={16} /> Approve or edit on behalf of Focal / LM</h3>
          <p>{drawer.name || drawer.employeeId} · {drawer.itemType}</p>
          <label>
            Reason (required)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
          </label>
          <label>
            Source (email / message)
            <input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder="e.g. WhatsApp from LM 18 Sep" />
          </label>
          <div className="mch-people-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={saveIntervention}>Save intervention</button>
            <button type="button" className="btn-secondary" onClick={() => setDrawer(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
