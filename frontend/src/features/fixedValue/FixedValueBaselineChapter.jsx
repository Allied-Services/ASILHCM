import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../api';
import {
  CORO_EXPECTED,
  buildInitial,
  emptyLine,
  emptyRole,
  emptySite,
  formToPayload,
  lineRateWarning,
  money,
  monthlyGrossOf,
  roleCountOf,
  roleRateSum,
  round2,
  siteLineTotals,
} from './fvContractForm';
import './FixedValueOps.css';

function RoleEditor({ roles, onChange, disabled }) {
  const list = roles?.length ? roles : [emptyRole()];
  const setRole = (idx, next) => {
    const copy = list.map((r, i) => (i === idx ? next : r));
    onChange(copy);
  };
  return (
    <div className="so-roles">
      <div className="so-role so-role-head">
        <span>Role</span>
        <span>Count</span>
        <span>Monthly rate</span>
        <span />
      </div>
      {list.map((r, i) => (
        <div key={i} className="so-role">
          <input
            value={r.designation || ''}
            placeholder="Designation"
            disabled={disabled}
            onChange={(e) => setRole(i, { ...r, designation: e.target.value })}
          />
          <input
            type="number"
            min="0"
            value={r.count ?? 0}
            disabled={disabled}
            onChange={(e) => setRole(i, { ...r, count: Number(e.target.value) || 0 })}
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={r.rate ?? 0}
            disabled={disabled}
            placeholder="Role rate"
            onChange={(e) => setRole(i, { ...r, rate: Number(e.target.value) || 0 })}
          />
          {list.length > 1 && !disabled && (
            <button type="button" className="btn-secondary" onClick={() => onChange(list.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" className="btn-secondary" onClick={() => onChange([...list, emptyRole()])}>
          <Plus size={14} /> Add role
        </button>
      )}
    </div>
  );
}

/**
 * Contract-baseline SO catalog (terms, sites, line rates).
 * This is not monthly achievement — Monthly Cycle records what was earned this period.
 */
export default function FixedValueBaselineChapter({ contractId, clientId, contractName, startDate, endDate }) {
  const [form, setForm] = useState(null);
  const [activeSiteIdx, setActiveSiteIdx] = useState(0);
  const [termsOpen, setTermsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [capacity, setCapacity] = useState(null);

  useEffect(() => {
    if (!contractId) {
      setForm(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getFixedValueRosterCapacity(contractId)
      .then((cap) => { if (!cancelled) setCapacity(cap); })
      .catch(() => { if (!cancelled) setCapacity(null); });
    api.getFixedValueContract(contractId)
      .then((detail) => {
        if (cancelled) return;
        const next = buildInitial(detail);
        if (clientId) next.client_id = clientId;
        if (contractName) next.contract_name = next.contract_name || contractName;
        if (startDate) next.start_date = next.start_date || String(startDate).slice(0, 10);
        if (endDate) next.end_date = next.end_date || String(endDate).slice(0, 10);
        setForm(next);
        setActiveSiteIdx(0);
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
  const safeIdx = Math.min(activeSiteIdx, Math.max((form?.sites?.length || 1) - 1, 0));
  const activeSite = form?.sites?.[safeIdx];
  const siteTotals = useMemo(() => (activeSite ? siteLineTotals(activeSite) : null), [activeSite]);

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

  const patchLine = (li, next) => {
    if (!activeSite) return;
    const lines = [...activeSite.lines];
    lines[li] = next;
    setSite(safeIdx, { ...activeSite, lines });
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
      <div className="fv-site-card">
        <p className="fv-lead">Save this contract first, then add the service-order baseline (sites and line rates).</p>
      </div>
    );
  }
  if (loading) return <p className="fv-lead">Loading contract baseline…</p>;

  return (
    <div className="so-chapter">
      <div className="so-head">
        <h3>Service orders</h3>
        <p className="fv-lead">Agreed monthly catalog for this contract. Use Monthly Cycle for what was achieved this month.</p>
      </div>
      {error && <div className="fv-banner error">{error}</div>}
      {msg && <div className="fv-banner ok">{msg}</div>}

      {form && (
        <>
          <div className="fv-kpi-grid">
            <div className="fv-kpi"><div className="label">Monthly gross</div><div className="value">{money(monthlyGross)}</div></div>
            <div className="fv-kpi"><div className="label">Sales tax</div><div className="value">{money(st)}</div></div>
            <div className="fv-kpi"><div className="label">Grand</div><div className="value">{money(grand)}</div></div>
          </div>
          {capacity?.roles?.length > 0 && (
            <div className="fv-banner" style={{ marginTop: '0.75rem' }}>
              <strong>Active roster vs Service Order</strong>
              <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
                {capacity.roles.map((r) => (
                  <li key={`${r.designation}-${r.site || 'all'}`} style={{ color: r.over ? '#ef4444' : 'inherit' }}>
                    {r.designation}{r.site ? ` · ${r.site}` : ''}: {r.assigned} / {r.allowed} assigned
                    {r.over ? ' — over capacity' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button type="button" className="so-terms-toggle" onClick={() => setTermsOpen((o) => !o)}>
            {termsOpen ? 'Hide contract terms' : 'Show contract terms (deposit, SLA, invoice notes)'}
          </button>
          {termsOpen && (
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
          )}

          <div className="so-workspace">
            <div className="so-site-list">
              <div className="so-site-list-head">
                <strong>Sites</strong>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setForm((p) => ({ ...p, sites: [...p.sites, emptySite()] }));
                    setActiveSiteIdx(form.sites.length);
                  }}
                >
                  <Plus size={14} /> Add
                </button>
              </div>
              {form.sites.map((s, idx) => (
                <button
                  key={s.site_code || idx}
                  type="button"
                  className={`so-site-btn${idx === safeIdx ? ' active' : ''}`}
                  onClick={() => setActiveSiteIdx(idx)}
                >
                  <span className="code">{s.site_code || `Site ${idx + 1}`}</span>
                  <span className="name">{s.name || 'Unnamed depot'}</span>
                </button>
              ))}
            </div>

            {activeSite && (
              <div className="fv-site-card">
                <div className="fv-form-grid">
                  <label>Site code
                    <input value={activeSite.site_code} onChange={(e) => setSite(safeIdx, { ...activeSite, site_code: e.target.value })} />
                  </label>
                  <label>Display name
                    <input value={activeSite.name} onChange={(e) => setSite(safeIdx, { ...activeSite, name: e.target.value })} />
                  </label>
                  <label>Province
                    <input value={activeSite.province} onChange={(e) => setSite(safeIdx, { ...activeSite, province: e.target.value, meta: { ...activeSite.meta, province: e.target.value } })} />
                  </label>
                  <label>SO id (optional)
                    <input value={activeSite.so_id} onChange={(e) => setSite(safeIdx, { ...activeSite, so_id: e.target.value })} />
                  </label>
                  <label>SO number
                    <input value={activeSite.so_number} onChange={(e) => setSite(safeIdx, { ...activeSite, so_number: e.target.value })} />
                  </label>
                  <label>Site tax rate
                    <input type="number" step="0.01" value={activeSite.meta.taxRate} onChange={(e) => setSite(safeIdx, { ...activeSite, meta: { ...activeSite.meta, taxRate: Number(e.target.value) } })} />
                  </label>
                  <label className="fv-span-2">Terminal focal email(s)
                    <input value={activeSite.meta.focalEmail || ''} onChange={(e) => setSite(safeIdx, { ...activeSite, meta: { ...activeSite.meta, focalEmail: e.target.value, focalEnabled: !!e.target.value } })} />
                  </label>
                </div>
                {form.sites.length > 1 && (
                  <button type="button" className="btn-secondary" onClick={() => {
                    setForm((p) => ({ ...p, sites: p.sites.filter((_, i) => i !== safeIdx) }));
                    setActiveSiteIdx(0);
                  }}>
                    <Trash2 size={14} /> Remove site
                  </button>
                )}

                <div className="fv-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSite(safeIdx, {
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
                        <th className="num">Line total</th>
                        <th>Roles / service count</th>
                        <th>Billing basis</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {activeSite.lines.map((l, li) => {
                        const warn = lineRateWarning(l);
                        return (
                          <tr key={li}>
                            <td>{l.line_number || li + 1}</td>
                            <td>
                              <input className="so-table-input" value={l.name} onChange={(e) => patchLine(li, { ...l, name: e.target.value })} />
                              {l.is_manpower_dependent && (
                                <div className="so-line-meta">
                                  {roleCountOf(l.roles)} role slot{roleCountOf(l.roles) === 1 ? '' : 's'}
                                  {roleRateSum(l.roles) > 0 ? ` · roles ${money(roleRateSum(l.roles))}` : ''}
                                </div>
                              )}
                              {warn && <div className="so-line-warn">{warn}</div>}
                            </td>
                            <td>
                              <input className="so-table-input" type="number" step="0.01" value={l.rate} onChange={(e) => patchLine(li, { ...l, rate: Number(e.target.value) })} />
                            </td>
                            <td className="so-roles-cell">
                              {l.is_manpower_dependent ? (
                                <RoleEditor roles={l.roles} onChange={(roles) => patchLine(li, { ...l, roles })} />
                              ) : (
                                <p className="so-non-mp">Non-manpower service. No headcount is billed against this line.</p>
                              )}
                            </td>
                            <td>
                              <select
                                className="so-table-input"
                                value={l.is_manpower_dependent ? 'manpower' : 'non_manpower'}
                                onChange={(e) => patchLine(li, {
                                  ...l,
                                  is_manpower_dependent: e.target.value === 'manpower',
                                  roles: e.target.value === 'manpower' ? (l.roles?.length ? l.roles : [emptyRole()]) : [],
                                })}
                              >
                                <option value="manpower">Manpower-based</option>
                                <option value="non_manpower">Not manpower</option>
                              </select>
                            </td>
                            <td>
                              {activeSite.lines.length > 1 && (
                                <button type="button" className="btn-secondary" onClick={() => {
                                  setSite(safeIdx, { ...activeSite, lines: activeSite.lines.filter((_, i) => i !== li) });
                                }}>
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {siteTotals && (
                      <tfoot>
                        <tr>
                          <td colSpan={2}>Site totals</td>
                          <td className="num">{money(siteTotals.total)}</td>
                          <td colSpan={3}>
                            Manpower {money(siteTotals.manpower)} · Non-manpower {money(siteTotals.nonManpower)}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="so-sticky-save">
            <button type="button" className="btn-primary" disabled={saving || !lineSumOk} onClick={save}>
              <Save size={14} /> {saving ? 'Saving…' : 'Save service orders'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
