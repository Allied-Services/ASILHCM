import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { monthlyCycleSetupHref } from '../../navLinks';

/**
 * Cost-plus rate cards and OT/medical caps on the client-contract master.
 * Rulebook / claims pack stay on Monthly Cycle Setup.
 */
export default function ContractRatePolicyChapter({ contractId }) {
  const [policy, setPolicy] = useState({});
  const [rateCards, setRateCards] = useState([]);
  const [rateCardForm, setRateCardForm] = useState({ roleTitle: '', billRate: '', costRate: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const inputStyle = {
    width: '100%',
    background: 'var(--bg-dark)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 8,
    color: 'var(--text)',
  };

  const load = () => {
    if (!contractId) return;
    api.getContractPolicy(contractId).then((p) => setPolicy(p || {})).catch(() => setPolicy({}));
    api.getRateCards(contractId).then(setRateCards).catch(() => setRateCards([]));
  };

  useEffect(() => { load(); }, [contractId]);

  if (!contractId) return null;

  const savePolicy = async () => {
    setError('');
    try {
      await api.saveContractPolicy({ ...policy, contract_id: contractId });
      setMsg('OT and medical caps saved.');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setError(e.message);
    }
  };

  const addRateCard = async () => {
    setError('');
    if (!rateCardForm.roleTitle.trim() || !rateCardForm.billRate) {
      setError('Designation and bill rate are required');
      return;
    }
    try {
      await api.saveRateCard({
        contractId,
        roleTitle: rateCardForm.roleTitle.trim(),
        billRate: Number(rateCardForm.billRate),
        costRate: rateCardForm.costRate ? Number(rateCardForm.costRate) : null,
      });
      setRateCardForm({ roleTitle: '', billRate: '', costRate: '' });
      load();
      setMsg('Rate card added');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setError(e.message);
    }
  };

  const removeRateCard = async (id) => {
    if (!window.confirm('Remove this rate card?')) return;
    try {
      await api.deleteRateCard(id);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div style={{ background: 'rgba(148,163,184,0.07)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: 12, padding: '1.25rem', marginTop: '1.5rem' }}>
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        Rate cards &amp; OT caps
      </h3>
      <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
        Cost-plus designation rates and overtime/medical ceilings. Claims routing lives in{' '}
        <a href={monthlyCycleSetupHref(contractId)} style={{ color: 'var(--primary)' }}>Monthly Cycle → Setup</a>.
      </p>
      {error && <div style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: '0.75rem' }}>{error}</div>}
      {msg && <div style={{ color: '#22c55e', fontSize: '0.82rem', marginBottom: '0.75rem' }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>OT allowed
          <div><input type="checkbox" checked={policy.ot_allowed !== false} onChange={(e) => setPolicy((p) => ({ ...p, ot_allowed: e.target.checked }))} /></div>
        </label>
        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>OT monthly cap (hrs)
          <input type="number" value={policy.ot_monthly_cap_hours || ''} onChange={(e) => setPolicy((p) => ({ ...p, ot_monthly_cap_hours: e.target.value }))} style={inputStyle} />
        </label>
        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Medical annual cap (PKR)
          <input type="number" value={policy.medical_annual_cap || ''} onChange={(e) => setPolicy((p) => ({ ...p, medical_annual_cap: e.target.value }))} style={inputStyle} />
        </label>
        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Credit days
          <input type="number" value={policy.credit_days || 30} onChange={(e) => setPolicy((p) => ({ ...p, credit_days: e.target.value }))} style={inputStyle} />
        </label>
        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Service charge %
          <input type="number" step="0.01" value={policy.service_charge_pct ?? 0.18} onChange={(e) => setPolicy((p) => ({ ...p, service_charge_pct: e.target.value }))} style={inputStyle} />
        </label>
      </div>
      <button type="button" className="btn-secondary" onClick={savePolicy} style={{ marginBottom: '1.25rem' }}>Save OT / medical caps</button>

      {rateCards.length > 0 && (
        <table className="data-table" style={{ marginBottom: '0.75rem', width: '100%' }}>
          <thead>
            <tr><th>Designation</th><th>Monthly bill rate</th><th>Cost rate</th><th /></tr>
          </thead>
          <tbody>
            {rateCards.map((rc) => (
              <tr key={rc.id}>
                <td>{rc.role_title}</td>
                <td>{Number(rc.bill_rate || 0).toLocaleString()}</td>
                <td>{rc.cost_rate != null ? Number(rc.cost_rate).toLocaleString() : '—'}</td>
                <td>
                  <button type="button" className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => removeRateCard(rc.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
        <input placeholder="Designation" value={rateCardForm.roleTitle} onChange={(e) => setRateCardForm((f) => ({ ...f, roleTitle: e.target.value }))} style={inputStyle} />
        <input type="number" placeholder="Monthly bill rate" value={rateCardForm.billRate} onChange={(e) => setRateCardForm((f) => ({ ...f, billRate: e.target.value }))} style={inputStyle} />
        <input type="number" placeholder="Cost rate (optional)" value={rateCardForm.costRate} onChange={(e) => setRateCardForm((f) => ({ ...f, costRate: e.target.value }))} style={inputStyle} />
        <button type="button" className="btn-primary" onClick={addRateCard}>Add rate card</button>
      </div>
    </div>
  );
}
