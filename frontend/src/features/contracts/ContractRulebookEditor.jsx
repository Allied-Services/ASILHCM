import React, { useEffect, useState } from 'react';
import { api } from '../../api';

const EOBI_WAGE_PRESETS = [
  { id: 'federal', label: 'Federal / lowest 40,000', value: 40000 },
  { id: 'sindh', label: 'Sindh 43,000', value: 43000 },
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

function eobiFromMinWage(minWage) {
  const mw = Number(minWage) > 0 ? Number(minWage) : 40000;
  return { mw, ee: Math.round(mw * 0.01), er: Math.round(mw * 0.05) };
}

const fieldStyle = {
  background: 'var(--bg-dark)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  padding: '8px 10px',
  color: 'var(--text)',
  fontSize: '0.9rem',
  outline: 'none',
  width: '100%',
};

export default function ContractRulebookEditor({ contractId, onCommercialChange }) {
  const [rulebook, setRulebook] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!contractId) {
      setRulebook(null);
      return;
    }
    let cancelled = false;
    api.getRulebook(contractId)
      .then((rb) => {
        if (cancelled) return;
        setRulebook(rb);
        onCommercialChange?.(rb.commercial_type);
      })
      .catch(() => {
        if (cancelled) return;
        setRulebook({
          commercial_type: 'cost_plus',
          routing_mode: 'auto',
          allied_contract_focal_email: '',
          dedicated_payroll_resource_email: '',
          eobi_min_wage: null,
        });
      });
    return () => { cancelled = true; };
  }, [contractId]);

  if (!contractId || !rulebook) return null;

  const soOn = rulebook.commercial_type === 'fixed_value';
  const eobi = eobiFromMinWage(rulebook.eobi_min_wage);

  const save = async (next = rulebook) => {
    setSaving(true);
    setErr('');
    setMsg('');
    try {
      const saved = await api.saveRulebook(contractId, next);
      setRulebook(saved);
      onCommercialChange?.(saved.commercial_type);
      setMsg('Contract settings saved.');
    } catch (e) {
      setErr(e.message);
    }
    setSaving(false);
  };

  const toggleSo = async (on) => {
    const next = {
      ...rulebook,
      commercial_type: on ? 'fixed_value' : 'cost_plus',
      billing_model: on ? 'service_order_deduction' : rulebook.billing_model,
    };
    setRulebook(next);
    await save(next);
  };

  return (
    <div style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '10px', padding: '1rem', marginTop: '1rem' }}>
      <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', marginBottom: '0.75rem' }}>
        Contract commercial settings
      </div>
      {err && <div style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: '0.6rem' }}>{err}</div>}
      {msg && <div style={{ color: '#22c55e', fontSize: '0.82rem', marginBottom: '0.6rem' }}>{msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Commercial type</span>
          <select
            value={rulebook.commercial_type || 'cost_plus'}
            onChange={(e) => setRulebook((r) => ({ ...r, commercial_type: e.target.value }))}
            style={fieldStyle}
          >
            <option value="cost_plus">Cost + fee</option>
            <option value="fixed_value">Fixed value (Service Order invoice)</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', paddingTop: '1.3rem' }}>
          <input
            type="checkbox"
            checked={soOn}
            onChange={(e) => toggleSo(e.target.checked)}
            style={{ accentColor: 'var(--primary)', width: 16, height: 16 }}
          />
          <span style={{ fontSize: '0.85rem' }}>Enable Service Order logic</span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>ASIL Contract Focal</span>
          <input
            value={rulebook.allied_contract_focal_email || ''}
            onChange={(e) => setRulebook((r) => ({ ...r, allied_contract_focal_email: e.target.value }))}
            placeholder="focal@asil.com.pk"
            style={fieldStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Dedicated Payroll Resource</span>
          <input
            value={rulebook.dedicated_payroll_resource_email || ''}
            onChange={(e) => setRulebook((r) => ({ ...r, dedicated_payroll_resource_email: e.target.value }))}
            placeholder="defaults to Contract Focal"
            style={fieldStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Claims routing</span>
          <select
            value={rulebook.routing_mode || 'auto'}
            onChange={(e) => setRulebook((r) => ({ ...r, routing_mode: e.target.value }))}
            style={fieldStyle}
          >
            {ROUTING_MODES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>EOBI minimum wage</span>
          <input
            type="number"
            min="0"
            step="1000"
            value={rulebook.eobi_min_wage ?? ''}
            onChange={(e) => setRulebook((r) => ({
              ...r,
              eobi_min_wage: e.target.value === '' ? null : Number(e.target.value),
            }))}
            placeholder="40000"
            style={fieldStyle}
          />
          <span style={{ display: 'flex', gap: '0.4rem', marginTop: 6, flexWrap: 'wrap' }}>
            {EOBI_WAGE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn-secondary"
                style={{
                  padding: '0.25rem 0.65rem',
                  fontSize: '0.75rem',
                  borderColor: Number(rulebook.eobi_min_wage) === p.value || (rulebook.eobi_min_wage == null && p.value === 40000)
                    ? 'rgba(56, 189, 248, 0.55)'
                    : undefined,
                }}
                onClick={() => setRulebook((r) => ({ ...r, eobi_min_wage: p.value }))}
              >
                {p.label}
              </button>
            ))}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Employee deduction Rs. {eobi.ee.toLocaleString()} · Employer Rs. {eobi.er.toLocaleString()}
            {rulebook.eobi_min_wage == null ? ' (default Federal / lowest 40,000)' : ''}
          </span>
        </label>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
        Payroll engine is inferred: Fixed Value uses the run engine. Cost + fee keeps the Payroll Sheet.
      </p>
      <button type="button" className="btn-primary" disabled={saving} onClick={() => save()} style={{ marginTop: '0.85rem' }}>
        {saving ? 'Saving…' : 'Save contract settings'}
      </button>
    </div>
  );
}
