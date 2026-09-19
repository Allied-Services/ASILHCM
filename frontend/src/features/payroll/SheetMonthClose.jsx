import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import '../claims/MonthlyCycleHub.css';

/**
 * Month-close checklist, close pack, and statutory export.
 * Cost-plus invoice lives on Invoices (AR).
 */
export default function SheetMonthClose({ contractId, year, month, enabled }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = !!(enabled && contractId && year && month);

  useEffect(() => {
    if (!ready) {
      setData(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setErr('');
    api.getMonthClose(contractId, year, month)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [ready, contractId, year, month]);

  const closePack = async () => {
    if (!ready) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await api.createSheetClosePack(contractId, year, month);
      setMsg('Close pack created from the locked sheet.');
      setData(await api.getMonthClose(contractId, year, month));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const downloadStatutory = async () => {
    if (!ready) return;
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

  const progress = useMemo(() => data?.progress, [data]);

  if (!enabled) return null;

  return (
    <div className="mch-panel" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 6px' }}>Month close</h3>
      <p className="mch-muted">Checklist, close pack, and statutory files for the selected contract. Cost-plus invoices are raised on Invoices (AR).</p>
      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}
      {!contractId && <p className="mch-muted">Select one contract to close this month.</p>}
      <div className="mch-people-actions">
        <button type="button" className="btn-secondary" disabled={busy || !ready} onClick={closePack}>Create close pack</button>
        <button type="button" className="btn-secondary" disabled={busy || !ready} onClick={downloadStatutory}>Statutory files</button>
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
      {progress && (
        <p className="mch-muted">{progress.done}/{progress.total} steps done · engine {data.engine} · {data.contract?.commercial_type}</p>
      )}
    </div>
  );
}
