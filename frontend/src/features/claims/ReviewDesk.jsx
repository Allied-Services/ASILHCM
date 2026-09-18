import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Download, Lock, RefreshCw } from 'lucide-react';
import { api } from '../../api';

const STAGES = [
  { id: '', label: 'All stages' },
  { id: 'submitted', label: 'Pending approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'pushed', label: 'Pushed' },
  { id: 'locked', label: 'Locked' },
];

function currentWorkPeriod() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function ReviewDesk({ user }) {
  const period = currentWorkPeriod();
  const [month, setMonth] = useState(period.month);
  const [year, setYear] = useState(period.year);
  const [contractId, setContractId] = useState('');
  const [contracts, setContracts] = useState([]);
  const [stage, setStage] = useState('');
  const [data, setData] = useState({ people: [], count: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [drawer, setDrawer] = useState(null);
  const [reason, setReason] = useState('');
  const [sourceNote, setSourceNote] = useState('');

  useEffect(() => {
    api.getContracts().then((rows) => setContracts(Array.isArray(rows) ? rows : [])).catch(() => setContracts([]));
  }, []);

  async function load() {
    setBusy(true);
    setErr('');
    try {
      const result = await api.getPayrollInputDesk({
        workMonth: month,
        workYear: year,
        contractId,
        stage,
      });
      setData(result);
      setPicked(new Set());
    } catch (e) {
      setErr(e.message || 'Could not load the review desk');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, [month, year, contractId, stage]);

  const people = data.people || [];
  const allIds = people.map((p) => p.employeeId);
  const allOn = allIds.length > 0 && allIds.every((id) => picked.has(id));

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
    const header = [
      'employee_id', 'name', 'client', 'location', 'item_type', 'present_days',
      'absent_days', 'hours', 'amount', 'status', 'approved_by', 'approved_via', 'reason', 'locked',
    ];
    const lines = [header.join(',')];
    for (const p of people) {
      if (picked.size && !picked.has(p.employeeId)) continue;
      for (const item of p.items || []) {
        lines.push([
          p.employeeId, p.name, p.client, p.location, item.itemType,
          item.presentDays, item.absentDays, item.hours, item.amount,
          item.status, item.approvedBy, item.approvedVia, item.reason,
          p.locked ? 'Y' : 'N',
        ].map(csvEscape).join(','));
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `review_desk_${year}-${String(month).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
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
          Contract
          <select value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">All contracts</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.contract_name || c.name || c.id}</option>
            ))}
          </select>
        </label>
        <label>
          Stage
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map((s) => <option key={s.id || 'all'} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn-secondary" disabled={busy} onClick={load}>
          <RefreshCw size={14} /> Refresh
        </button>
        <button type="button" className="btn-secondary" onClick={exportExcel}>
          <Download size={14} /> Excel
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={pushSelected}>
          Push to Payroll Sheet
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={lockSelected}>
          <Lock size={14} /> Lock
        </button>
      </div>
      <p className="mch-muted">
        {data.count || 0} people
        {selectedContract ? ` on ${selectedContract.contract_name || selectedContract.id}` : ''}.
        Tick people (or leave empty to use the contract), review, then Lock and Push.
        {user?.email ? ` Signed in as ${user.email}.` : ''}
      </p>
      {err && <p className="mch-error">{err}</p>}
      <div className="review-desk-table-wrap">
        <table className="review-desk-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" />
              </th>
              <th>Employee</th>
              <th>Type</th>
              <th>Days / hours / amount</th>
              <th>Stage</th>
              <th>Approved by</th>
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
                <td>{item.itemType}</td>
                <td>
                  {item.presentDays != null ? `${item.presentDays} present` : ''}
                  {item.absentDays != null ? ` / ${item.absentDays} absent` : ''}
                  {item.hours != null ? ` ${item.hours}h` : ''}
                  {item.amount != null ? ` Rs. ${item.amount}` : ''}
                </td>
                <td>{item.status}</td>
                <td>
                  {item.approvedBy || '—'}
                  {item.approvedVia ? ` (${item.approvedVia})` : ''}
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
            {!people.length && (
              <tr>
                <td colSpan={8} className="mch-muted">No ledger rows for this month yet. Submit a machine file or approve claims first.</td>
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
