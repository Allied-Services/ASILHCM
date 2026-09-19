import React, { useEffect, useState } from 'react';
import { api } from '../../api';

export default function CostPlusInvoicePanel({ onRaised }) {
  const [contracts, setContracts] = useState([]);
  const [contractId, setContractId] = useState('');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
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

  const raiseInvoice = async () => {
    if (!contractId) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await api.raiseCostPlusInvoice(contractId, year, month);
      setMsg('Cost-plus invoice drafted from the locked Payroll Sheet.');
      if (onRaised) await onRaised();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', marginBottom: '1.25rem' }}>
      <strong>Cost-plus invoice</strong>
      <p style={{ margin: '4px 0 10px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
        Raise the locked-sheet cost-plus invoice here. Service Order invoices stay on Month Invoices / Fixed Value.
      </p>
      {err && <div className="pch-err">{err}</div>}
      {msg && <div className="pch-ok">{msg}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.75rem' }}>
          Contract
          <select value={contractId} onChange={(e) => setContractId(e.target.value)} style={{ minHeight: 36 }}>
            <option value="">Select…</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.75rem' }}>
          Month
          <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10) || 1)} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: '0.75rem' }}>
          Year
          <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value, 10) || year)} />
        </label>
        <button type="button" className="btn-primary" disabled={busy || !contractId} onClick={raiseInvoice}>
          Raise cost-plus invoice
        </button>
      </div>
    </div>
  );
}
