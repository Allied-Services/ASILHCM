import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../api';
import {
  CORO_EXPECTED,
  buildInitial,
  emptyLine,
  emptySite,
  formToPayload,
  money,
  monthlyGrossOf,
  round2,
} from './fvContractForm';
import './FixedValueOps.css';

/**
 * Contract-baseline SO catalog (terms, sites, line rates).
 * This is not monthly achievement — Monthly Cycle records what was earned this period.
 */
export default function FixedValueBaselineChapter({ contractId, clientId, contractName, startDate, endDate }) {
  const [form, setForm] = useState(null);
  const [activeSiteIdx, setActiveSiteIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!contractId) {
      setForm(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getFixedValueContract(contractId)
      .then((detail) => {
        if (cancelled) return;
        const next = buildInitial(detail);
        if (clientId) next.client_id = clientId;
        if (contractName) next.contract_name = next.contract_name || contractName;
        if (startDate) next.start_date = next.start_date || String(startDate).slice(0, 10);
        if (endDate) next.end_date = next.end_date || String(endDate).slice(0, 10);
        setForm(next);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Failed to load service-order baseline');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [contractId, clientId, contractName, startDate, endDate]);

  const monthlyGross = useMemo(() => (form ? monthlyGrossOf(form) : 0), [form]);
  const taxRate = Number(form?.policy?.sales_tax_exempt ? 0 : (form?.policy?.sales_tax_rate || 0));
  const st = round2(monthlyGross * taxRate);
  const grand = round2(monthlyGross + st);
  const isCoro = form?.meta?.fv_product === 'coro_retail_ops';
  const expected = Number(form?.meta?.expected_monthly_gross != null ? form.meta.expected_monthly_gross : (isCoro ? CORO_EXPECTED : 0));
  const lineSumOk = !isCoro || round2(monthlyGross) === round2(expected || CORO_EXPECTED);
  const activeSite = form?.sites?.[activeSiteIdx] || form?.sites?.[0];

  const patchMeta = (path, value) => {
    setForm((prev) => {
      const next = structuredClone(prev);
      const parts = path.split('.');
      let cur = next;
      for (let i = 0; i < parts.length - 1; i += 1) cur = cur[parts[i]];
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const setSite = (idx, updater) => {
    setForm((prev) => {
      const sites = [...prev.sites];
      sites[idx] = typeof updater === 'function' ? updater(sites[idx]) : updater;
      return { ...prev, sites };
    });
  };

  const save = async () => {
    if (!form || !contractId) return;
    for (const s of form.sites) {
      if (!s.site_code || !s.name) {
        setError('Each site needs a site code and name');
        return;
      }
      if (!s.lines?.length) {
        setError(`Site ${s.site_code} needs at least one line`);
        return;
      }
      for (const l of s.lines) {
        if (!l.name) {
          setError('Every line needs a description');
          return;
        }
        if (!(Number(l.rate) >= 0)) {
          setError('Line rates must be numeric');
          return;
        }
      }
    }
    if (!lineSumOk) {
      setError(`CORO line rates must sum to ${money(expected || CORO_EXPECTED)}`);
      return;
    }
    setSaving(true);
    setError('');
    setMsg('');
    try {
      await api.updateFixedValueContract(contractId, formToPayload(form));
      setMsg('Contract baseline saved. Monthly achievement is recorded in Monthly Cycle.');
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!contractId) {
    return (
      <div className="fv-site-card" style={{ marginTop: '1rem' }}>
        <p className="fv-lead">Save this contract first, then add the service-order baseline (sites and line rates).</p>
      </div>
    );
  }
  if (loading) return <p className="fv-lead">Loading contract baseline…</p>;

  return (
    <div className="fv-ops" style={{ marginTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
        Contract baseline — service orders
      </h3>
      <p className="fv-lead">
        Standing monthly catalog: terms, depots, and agreed line rates. Do not use this table for what was achieved this month.
      </p>
      {error && <div className="fv-banner error">{error}</div>}
      {msg && <div className="fv-banner ok">{msg}</div>}

      {form && (
        <>
          <div className="fv-form-grid">
            <label>External SO number
              <input value={form.meta.external_so_number} onChange={(e) => patchMeta('meta.external_so_number', e.target.value)} />
            </label>
            <label>Security deposit amount
              <input type="number" value={form.meta.security_deposit?.amount || 0} onChange={(e) => patchMeta('meta.security_deposit.amount', Number(e.target.value))} />
            </label>
            <label>Retention %
              <input type="number" value={form.meta.sla?.retention_pct || 0} onChange={(e) => patchMeta('meta.sla.retention_pct', Number(e.target.value))} />
            </label>
            <label className="fv-span-2">Security deposit notes
              <textarea rows={2} value={form.meta.security_deposit?.notes || ''} onChange={(e) => patchMeta('meta.security_deposit.notes', e.target.value)} />
            </label>
            <label className="fv-span-2">SLA summary
              <textarea rows={2} value={form.meta.sla?.summary || ''} onChange={(e) => patchMeta('meta.sla.summary', e.target.value)} />
            </label>
            <label className="fv-span-2">TAT / penalty text (manual deductions only)
              <textarea rows={3} value={form.meta.sla?.tat_penalties_text || ''} onChange={(e) => patchMeta('meta.sla.tat_penalties_text', e.target.value)} />
            </label>
            <label className="fv-span-2">Default invoice notes
              <textarea rows={2} value={form.meta.invoice_notes_default || ''} onChange={(e) => patchMeta('meta.invoice_notes_default', e.target.value)} />
            </label>
          </div>

          <div className="fv-actions" style={{ margin: '12px 0' }}>
            <button type="button" className="btn-secondary" onClick={() => setForm((p) => ({ ...p, sites: [...p.sites, emptySite()] }))}>
              <Plus size={14} /> Add site
            </button>
          </div>
          {form.sites.map((s, idx) => (
            <div key={idx} className="fv-site-card">
              <div className="fv-form-grid">
                <label>Site code
                  <input value={s.site_code} onChange={(e) => setSite(idx, { ...s, site_code: e.target.value })} />
                </label>
                <label>Display name
                  <input value={s.name} onChange={(e) => setSite(idx, { ...s, name: e.target.value })} />
                </label>
                <label>Province
                  <input value={s.province} onChange={(e) => setSite(idx, { ...s, province: e.target.value, meta: { ...s.meta, province: e.target.value } })} />
                </label>
                <label>SO id (optional)
                  <input value={s.so_id} onChange={(e) => setSite(idx, { ...s, so_id: e.target.value })} />
                </label>
                <label>SO number
                  <input value={s.so_number} onChange={(e) => setSite(idx, { ...s, so_number: e.target.value })} />
                </label>
                <label>Site tax rate
                  <input type="number" step="0.01" value={s.meta.taxRate} onChange={(e) => setSite(idx, { ...s, meta: { ...s.meta, taxRate: Number(e.target.value) } })} />
                </label>
                <label>Terminal focal email(s)
                  <input value={s.meta.focalEmail || ''} onChange={(e) => setSite(idx, { ...s, meta: { ...s.meta, focalEmail: e.target.value, focalEnabled: !!e.target.value } })} />
                </label>
              </div>
              {form.sites.length > 1 && (
                <button type="button" className="btn-secondary" onClick={() => {
                  setForm((p) => ({ ...p, sites: p.sites.filter((_, i) => i !== idx) }));
                  setActiveSiteIdx(0);
                }}>
                  <Trash2 size={14} /> Remove site
                </button>
              )}
            </div>
          ))}

          <div className="fv-actions" style={{ margin: '12px 0' }}>
            {form.sites.map((s, idx) => (
              <button
                key={s.site_code || idx}
                type="button"
                className={idx === activeSiteIdx ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setActiveSiteIdx(idx)}
              >
                {s.site_code || `Site ${idx + 1}`}
              </button>
            ))}
          </div>

          {activeSite && (
            <div className="fv-site-card">
              <div className="fv-actions" style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setSite(activeSiteIdx, {
                    ...activeSite,
                    lines: [...activeSite.lines, { ...emptyLine(), line_number: String(activeSite.lines.length + 1) }],
                  })}
                >
                  <Plus size={14} /> Add line
                </button>
              </div>
              <div className="fv-table-wrap">
                <table className="fv-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Description</th>
                      <th>Monthly rate (baseline)</th>
                      <th>Roles (count)</th>
                      <th>Manpower</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {activeSite.lines.map((l, li) => (
                      <tr key={li}>
                        <td>{l.line_number || li + 1}</td>
                        <td>
                          <input value={l.name} onChange={(e) => {
                            const lines = [...activeSite.lines];
                            lines[li] = { ...l, name: e.target.value };
                            setSite(activeSiteIdx, { ...activeSite, lines });
                          }} />
                        </td>
                        <td>
                          <input type="number" step="0.01" value={l.rate} onChange={(e) => {
                            const lines = [...activeSite.lines];
                            lines[li] = { ...l, rate: Number(e.target.value) };
                            setSite(activeSiteIdx, { ...activeSite, lines });
                          }} />
                        </td>
                        <td>
                          <input
                            value={(l.roles || []).map((r) => `${r.designation}:${r.count}`).join(', ')}
                            onChange={(e) => {
                              const roles = e.target.value.split(',').map((part) => {
                                const [d, c] = part.split(':').map((x) => x.trim());
                                return { designation: d || '', count: Number(c) || 0 };
                              });
                              const lines = [...activeSite.lines];
                              lines[li] = { ...l, roles };
                              setSite(activeSiteIdx, { ...activeSite, lines });
                            }}
                            placeholder="Attendant:50, Janitor:4"
                          />
                        </td>
                        <td>
                          <input type="checkbox" checked={!!l.is_manpower_dependent} onChange={(e) => {
                            const lines = [...activeSite.lines];
                            lines[li] = { ...l, is_manpower_dependent: e.target.checked };
                            setSite(activeSiteIdx, { ...activeSite, lines });
                          }} />
                        </td>
                        <td>
                          {activeSite.lines.length > 1 && (
                            <button type="button" className="btn-secondary" onClick={() => {
                              setSite(activeSiteIdx, {
                                ...activeSite,
                                lines: activeSite.lines.filter((_, i) => i !== li),
                              });
                            }}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="fv-kpi-grid" style={{ marginTop: 12 }}>
            <div className="fv-kpi"><div className="label">Monthly gross</div><div className="value">{money(monthlyGross)}</div></div>
            <div className="fv-kpi"><div className="label">Sales tax</div><div className="value">{money(st)}</div></div>
            <div className="fv-kpi"><div className="label">Grand</div><div className="value">{money(grand)}</div></div>
          </div>

          <div className="fv-actions" style={{ marginTop: 12 }}>
            <button type="button" className="btn-primary" disabled={saving || !lineSumOk} onClick={save}>
              <Save size={14} /> {saving ? 'Saving…' : 'Save contract baseline'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
