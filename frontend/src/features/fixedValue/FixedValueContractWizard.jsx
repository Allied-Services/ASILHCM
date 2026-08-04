import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft, ArrowRight, Check, Plus, Trash2, X, Save,
} from 'lucide-react';
import { api } from '../../api';
import './FixedValueOps.css';
import './FixedValueContractWizard.css';

const STEPS = [
    { key: 'client', label: 'Client & Contract' },
    { key: 'policy', label: 'Commercial Policy' },
    { key: 'terms', label: 'Terms & References' },
    { key: 'sites', label: 'Sites & SOs' },
    { key: 'lines', label: 'SO Lines' },
    { key: 'review', label: 'Review & Save' },
];

const CORO_EXPECTED = 4136919.94;
const emptyLine = () => ({
    line_number: '1',
    name: '',
    unit: 'MON',
    quantity: 1,
    rate: 0,
    is_manpower_dependent: true,
    roles: [{ designation: '', count: 1 }],
});
const emptySite = () => ({
    site_code: '',
    name: '',
    province: 'Punjab',
    so_id: '',
    so_number: '',
    meta: { taxRate: 0.16, province: 'Punjab', contractMonths: 12, focalEnabled: false, focalEmail: '' },
    lines: [emptyLine()],
});

function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

function money(n) {
    return round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildInitial(detail) {
    if (!detail) {
        return {
            id: '',
            client_id: '',
            contract_name: '',
            service_type: 'Fixed Value / Conservancy',
            location: '',
            start_date: '',
            end_date: '',
            headcount: 0,
            region_province: 'Punjab',
            client_focal_name: '',
            client_focal_email: '',
            credit_days: 30,
            costs: { eobi: 400, life_insurance: 150, bonus_months: 0, eosb_type: 'Gratuity' },
            financials: { wht_pct: 15, service_charges_pct: 0, credit_cycle_days: 30 },
            meta: {
                fv_product: 'conservancy_multi_site',
                external_so_number: '',
                contract_months: 12,
                expected_monthly_gross: null,
                security_deposit: { amount: 0, currency: 'PKR', notes: '' },
                sla: { summary: '', tat_penalties_text: '', retention_pct: 10 },
                invoice_notes_default: '',
            },
            policy: {
                billing_model: 'service_order_deduction',
                attendance_input_mode: 'full_ledger',
                income_tax_wht_pct: 15,
                sales_tax_rate: 0.16,
                sales_tax_exempt: false,
                credit_days: 30,
                bonus_accrual_months: 0,
                gratuity_accrual_months: 12,
            },
            sites: [emptySite()],
        };
    }

    const meta = typeof detail.meta === 'string' ? JSON.parse(detail.meta || '{}') : (detail.meta || {});
    const costs = typeof detail.costs === 'string' ? JSON.parse(detail.costs || '{}') : (detail.costs || {});
    const financials = typeof detail.financials === 'string' ? JSON.parse(detail.financials || '{}') : (detail.financials || {});
    const orders = detail.service_orders || [];

    return {
        id: detail.id,
        client_id: detail.client_id || '',
        contract_name: detail.contract_name || '',
        service_type: detail.service_type || 'Fixed Value / Conservancy',
        location: detail.location || '',
        start_date: detail.start_date ? String(detail.start_date).slice(0, 10) : '',
        end_date: detail.end_date ? String(detail.end_date).slice(0, 10) : '',
        headcount: detail.headcount || 0,
        region_province: detail.region_province || 'Punjab',
        client_focal_name: detail.client_focal_name || '',
        client_focal_email: detail.client_focal_email || '',
        credit_days: detail.credit_days || detail.policy_credit_days || 30,
        costs,
        financials,
        meta: {
            fv_product: meta.fv_product || 'conservancy_multi_site',
            external_so_number: meta.external_so_number || '',
            contract_months: meta.contract_months || 12,
            expected_monthly_gross: meta.expected_monthly_gross ?? null,
            security_deposit: meta.security_deposit || { amount: 0, currency: 'PKR', notes: '' },
            sla: meta.sla || { summary: '', tat_penalties_text: '', retention_pct: 10 },
            invoice_notes_default: meta.invoice_notes_default || '',
        },
        policy: {
            billing_model: detail.billing_model || 'service_order_deduction',
            attendance_input_mode: detail.attendance_input_mode || 'full_ledger',
            income_tax_wht_pct: detail.income_tax_wht_pct ?? 15,
            sales_tax_rate: detail.sales_tax_rate ?? 0.16,
            sales_tax_exempt: !!detail.sales_tax_exempt,
            credit_days: detail.policy_credit_days || detail.credit_days || 30,
            bonus_accrual_months: detail.bonus_accrual_months ?? 0,
            gratuity_accrual_months: detail.gratuity_accrual_months ?? 12,
        },
        sites: orders.length ? orders.map((o) => {
            const om = typeof o.meta === 'string' ? JSON.parse(o.meta || '{}') : (o.meta || {});
            const lines = Array.isArray(o.lines) ? o.lines : [];
            return {
                site_code: o.site_code || '',
                name: o.name || '',
                province: om.province || detail.region_province || 'Punjab',
                so_id: o.id,
                so_number: o.so_number || '',
                meta: {
                    taxRate: om.taxRate ?? detail.sales_tax_rate ?? 0.16,
                    province: om.province || detail.region_province || 'Punjab',
                    contractMonths: om.contractMonths || 12,
                    focalEnabled: !!om.focalEnabled,
                    focalEmail: om.focalEmail || '',
                    requiredAt: om.requiredAt || '',
                },
                lines: lines.length ? lines.map((l, idx) => ({
                    line_number: l.line_number || String(idx + 1),
                    name: l.name || '',
                    unit: l.unit || 'MON',
                    quantity: 1,
                    rate: Number(l.rate || 0),
                    is_manpower_dependent: !!l.is_manpower_dependent,
                    roles: Array.isArray(l.roles) && l.roles.length ? l.roles : [{ designation: '', count: 1 }],
                })) : [emptyLine()],
            };
        }) : [emptySite()],
    };
}

export default function FixedValueContractWizard({
    mode = 'create',
    contractId = null,
    onClose,
    onSaved,
}) {
    const [stepIdx, setStepIdx] = useState(0);
    const [form, setForm] = useState(() => buildInitial(null));
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [msg, setMsg] = useState('');
    const [activeSiteIdx, setActiveSiteIdx] = useState(0);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError('');
            try {
                const cl = await api.getClients();
                if (!cancelled) setClients(Array.isArray(cl) ? cl : []);
                if (mode === 'edit' && contractId) {
                    const detail = await api.getFixedValueContract(contractId);
                    if (!cancelled) setForm(buildInitial(detail));
                }
            } catch (e) {
                if (!cancelled) setError(e.message || 'Failed to load wizard');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [mode, contractId]);

    const monthlyGross = useMemo(
        () => form.sites.reduce(
            (acc, s) => acc + (s.lines || []).reduce((n, l) => n + Number(l.rate || 0), 0),
            0
        ),
        [form.sites]
    );
    const taxRate = Number(form.policy.sales_tax_exempt ? 0 : (form.policy.sales_tax_rate || 0));
    const st = round2(monthlyGross * taxRate);
    const grand = round2(monthlyGross + st);
    const isCoro = form.meta.fv_product === 'coro_retail_ops';
    const expected = Number(form.meta.expected_monthly_gross != null ? form.meta.expected_monthly_gross : (isCoro ? CORO_EXPECTED : 0));
    const lineSumOk = !isCoro || round2(monthlyGross) === round2(expected || CORO_EXPECTED);

    const patch = (path, value) => {
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

    const validateStep = () => {
        const key = STEPS[stepIdx].key;
        if (key === 'client') {
            if (!form.id?.trim()) return 'Contract ID is required';
            if (!form.contract_name?.trim()) return 'Contract name is required';
            if (!form.client_id) return 'Select a client';
            if (!form.start_date || !form.end_date) return 'Start and end dates are required';
        }
        if (key === 'sites') {
            if (!form.sites.length) return 'Add at least one site';
            for (const s of form.sites) {
                if (!s.site_code || !s.name) return 'Each site needs site code and name';
            }
        }
        if (key === 'lines') {
            for (const s of form.sites) {
                if (!s.lines?.length) return `Site ${s.site_code} needs at least one line`;
                for (const l of s.lines) {
                    if (!l.name) return 'Every line needs a name';
                    if (!(Number(l.rate) >= 0)) return 'Line rates must be numeric';
                }
            }
            if (!lineSumOk) {
                return `CORO line rates must sum to ${money(expected || CORO_EXPECTED)} (currently ${money(monthlyGross)})`;
            }
        }
        return '';
    };

    const next = () => {
        const err = validateStep();
        if (err) { setError(err); return; }
        setError('');
        setStepIdx((i) => Math.min(STEPS.length - 1, i + 1));
    };
    const back = () => {
        setError('');
        setStepIdx((i) => Math.max(0, i - 1));
    };

    const toPayload = () => ({
        id: form.id.trim(),
        client_id: form.client_id,
        contract_name: form.contract_name.trim(),
        service_type: form.service_type,
        location: form.location,
        start_date: form.start_date,
        end_date: form.end_date,
        headcount: Number(form.headcount) || 0,
        region_province: form.region_province,
        client_focal_name: form.client_focal_name?.trim() || null,
        client_focal_email: form.client_focal_email?.trim() || null,
        credit_days: Number(form.credit_days) || 30,
        costs: form.costs,
        financials: form.financials,
        meta: {
            ...form.meta,
            expected_monthly_gross: isCoro ? (expected || CORO_EXPECTED) : form.meta.expected_monthly_gross,
        },
        policy: {
            ...form.policy,
            billing_model: 'service_order_deduction',
            effective_from: form.start_date,
            effective_to: form.end_date,
        },
        sites: form.sites.map((s) => ({
            site_code: s.site_code.trim().toUpperCase(),
            name: s.name.trim(),
            province: s.province || form.region_province,
            so_id: s.so_id?.trim() || undefined,
            so_number: s.so_number || s.site_code,
            meta: {
                ...s.meta,
                siteCode: s.site_code.trim().toUpperCase(),
                province: s.province || form.region_province,
            },
            lines: (s.lines || []).map((l, idx) => ({
                line_number: l.line_number || String(idx + 1),
                name: l.name,
                unit: l.unit || 'MON',
                quantity: 1,
                rate: Number(l.rate || 0),
                total_amount: Number(l.rate || 0),
                is_manpower_dependent: !!l.is_manpower_dependent,
                roles: (l.roles || []).filter(r => r.designation || r.count).map(r => ({
                    designation: r.designation || '',
                    count: Number(r.count) || 0,
                })),
            })),
        })),
    });

    const save = async () => {
        const err = validateStep();
        if (err) { setError(err); return; }
        if (!lineSumOk) {
            setError(`CORO line rates must sum to ${money(expected || CORO_EXPECTED)}`);
            return;
        }
        setSaving(true);
        setError('');
        setMsg('');
        try {
            const payload = toPayload();
            const result = mode === 'edit'
                ? await api.updateFixedValueContract(contractId || payload.id, payload)
                : await api.createFixedValueContract(payload);
            setMsg('Contract saved');
            onSaved?.(result);
        } catch (e) {
            setError(e.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const activeSite = form.sites[activeSiteIdx] || form.sites[0];

    if (loading) {
        return (
            <div className="fv-wizard-overlay">
                <div className="fv-wizard-panel"><p className="fv-lead">Loading contract wizard…</p></div>
            </div>
        );
    }

    return (
        <div className="fv-wizard-overlay">
            <div className="fv-wizard-panel">
                <div className="fv-wizard-header">
                    <div>
                        <h2>{mode === 'edit' ? 'Edit Fixed Value Contract' : 'New Fixed Value Contract'}</h2>
                        <p className="fv-lead">Monthly rates and T&amp;Cs live on the contract — not in seed code.</p>
                    </div>
                    <button type="button" className="btn-secondary" onClick={onClose} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>

                <div className="fv-wizard-steps">
                    {STEPS.map((s, i) => (
                        <button
                            key={s.key}
                            type="button"
                            className={`fv-wizard-step ${i === stepIdx ? 'active' : ''} ${i < stepIdx ? 'done' : ''}`}
                            onClick={() => setStepIdx(i)}
                        >
                            <span>{i + 1}</span>
                            {s.label}
                        </button>
                    ))}
                </div>

                {(error || msg) && (
                    <div className={`fv-banner ${error ? 'error' : 'ok'}`}>{error || msg}</div>
                )}

                <div className="fv-wizard-body">
                    {STEPS[stepIdx].key === 'client' && (
                        <div className="fv-form-grid">
                            <label>Contract ID
                                <input value={form.id} disabled={mode === 'edit'} onChange={(e) => patch('id', e.target.value)} placeholder="CTR-PSO-CORO-MA" />
                            </label>
                            <label>Contract name
                                <input value={form.contract_name} onChange={(e) => patch('contract_name', e.target.value)} />
                            </label>
                            <label>Client
                                <select value={form.client_id} onChange={(e) => patch('client_id', e.target.value)}>
                                    <option value="">Select client…</option>
                                    {clients.map((c) => (
                                        <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                                    ))}
                                </select>
                            </label>
                            <label>Service type
                                <input value={form.service_type} onChange={(e) => patch('service_type', e.target.value)} />
                            </label>
                            <label>Location
                                <input value={form.location} onChange={(e) => patch('location', e.target.value)} />
                            </label>
                            <label>Region / province
                                <input value={form.region_province} onChange={(e) => patch('region_province', e.target.value)} />
                            </label>
                            <label>Start date
                                <input type="date" value={form.start_date} onChange={(e) => patch('start_date', e.target.value)} />
                            </label>
                            <label>End date
                                <input type="date" value={form.end_date} onChange={(e) => patch('end_date', e.target.value)} />
                            </label>
                            <label>Headcount
                                <input type="number" value={form.headcount} onChange={(e) => patch('headcount', Number(e.target.value))} />
                            </label>
                            <label>Contract focal (client) — name
                                <input value={form.client_focal_name} onChange={(e) => patch('client_focal_name', e.target.value)} placeholder="Ms. Asmat Awan" />
                            </label>
                            <label>Contract focal — email (always CC on verification emails)
                                <input value={form.client_focal_email} onChange={(e) => patch('client_focal_email', e.target.value)} placeholder="Asmat.K.Awan@psopk.com" />
                            </label>
                            <label>Product family
                                <select value={form.meta.fv_product} onChange={(e) => {
                                    patch('meta.fv_product', e.target.value);
                                    if (e.target.value === 'coro_retail_ops') patch('meta.expected_monthly_gross', CORO_EXPECTED);
                                }}>
                                    <option value="conservancy_multi_site">Conservancy (multi-site)</option>
                                    <option value="coro_retail_ops">CORO retail ops</option>
                                </select>
                            </label>
                        </div>
                    )}

                    {STEPS[stepIdx].key === 'policy' && (
                        <div className="fv-form-grid">
                            <label>Billing model
                                <input value="service_order_deduction" disabled />
                            </label>
                            <label>Attendance mode
                                <select value={form.policy.attendance_input_mode} onChange={(e) => patch('policy.attendance_input_mode', e.target.value)}>
                                    <option value="full_ledger">full_ledger</option>
                                    <option value="present_days_only">present_days_only</option>
                                </select>
                            </label>
                            <label>Income tax WHT %
                                <input type="number" value={form.policy.income_tax_wht_pct} onChange={(e) => patch('policy.income_tax_wht_pct', Number(e.target.value))} />
                            </label>
                            <label>Sales tax rate
                                <input type="number" step="0.01" value={form.policy.sales_tax_rate} onChange={(e) => patch('policy.sales_tax_rate', Number(e.target.value))} />
                            </label>
                            <label className="fv-check">
                                <input type="checkbox" checked={!!form.policy.sales_tax_exempt} onChange={(e) => patch('policy.sales_tax_exempt', e.target.checked)} />
                                Sales tax exempt
                            </label>
                            <label>Credit days
                                <input type="number" value={form.policy.credit_days} onChange={(e) => patch('policy.credit_days', Number(e.target.value))} />
                            </label>
                        </div>
                    )}

                    {STEPS[stepIdx].key === 'terms' && (
                        <div className="fv-form-grid">
                            <label>External SO number
                                <input value={form.meta.external_so_number} onChange={(e) => patch('meta.external_so_number', e.target.value)} />
                            </label>
                            <label>Security deposit amount
                                <input type="number" value={form.meta.security_deposit?.amount || 0} onChange={(e) => patch('meta.security_deposit.amount', Number(e.target.value))} />
                            </label>
                            <label>Retention %
                                <input type="number" value={form.meta.sla?.retention_pct || 0} onChange={(e) => patch('meta.sla.retention_pct', Number(e.target.value))} />
                            </label>
                            <label className="fv-span-2">Security deposit notes
                                <textarea rows={2} value={form.meta.security_deposit?.notes || ''} onChange={(e) => patch('meta.security_deposit.notes', e.target.value)} />
                            </label>
                            <label className="fv-span-2">SLA summary
                                <textarea rows={2} value={form.meta.sla?.summary || ''} onChange={(e) => patch('meta.sla.summary', e.target.value)} />
                            </label>
                            <label className="fv-span-2">TAT / penalty text (manual deductions only)
                                <textarea rows={3} value={form.meta.sla?.tat_penalties_text || ''} onChange={(e) => patch('meta.sla.tat_penalties_text', e.target.value)} />
                            </label>
                            <label className="fv-span-2">Default invoice notes
                                <textarea rows={2} value={form.meta.invoice_notes_default || ''} onChange={(e) => patch('meta.invoice_notes_default', e.target.value)} />
                            </label>
                        </div>
                    )}

                    {STEPS[stepIdx].key === 'sites' && (
                        <div>
                            <div className="fv-actions" style={{ marginBottom: 12 }}>
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
                                            <input value={s.so_id} onChange={(e) => setSite(idx, { ...s, so_id: e.target.value })} placeholder="SO-PSO-CORO-SS94" />
                                        </label>
                                        <label>SO number
                                            <input value={s.so_number} onChange={(e) => setSite(idx, { ...s, so_number: e.target.value })} />
                                        </label>
                                        <label>Site tax rate
                                            <input type="number" step="0.01" value={s.meta.taxRate} onChange={(e) => setSite(idx, { ...s, meta: { ...s.meta, taxRate: Number(e.target.value) } })} />
                                        </label>
                                        <label>Terminal focal email(s) — comma-separated TO
                                            <input value={s.meta.focalEmail || ''} placeholder="first.last@psopk.com, second.last@psopk.com" onChange={(e) => setSite(idx, { ...s, meta: { ...s.meta, focalEmail: e.target.value, focalEnabled: !!e.target.value } })} />
                                        </label>
                                    </div>
                                    {form.sites.length > 1 && (
                                        <button type="button" className="btn-secondary" onClick={() => setForm((p) => ({ ...p, sites: p.sites.filter((_, i) => i !== idx) }))}>
                                            <Trash2 size={14} /> Remove site
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {STEPS[stepIdx].key === 'lines' && (
                        <div>
                            <div className="fv-actions" style={{ marginBottom: 12 }}>
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
                                                    <th>Monthly rate</th>
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
                                                                value={(l.roles || []).map(r => `${r.designation}:${r.count}`).join(', ')}
                                                                onChange={(e) => {
                                                                    const roles = e.target.value.split(',').map((part) => {
                                                                        const [d, c] = part.split(':').map(x => x.trim());
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
                                {isCoro && (
                                    <div className="fv-kpi">
                                        <div className="label">CORO target</div>
                                        <div className="value" style={{ color: lineSumOk ? 'var(--success, #3d9)' : 'var(--danger, #f66)' }}>
                                            {money(expected || CORO_EXPECTED)} {lineSumOk ? '✓' : '≠'}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {STEPS[stepIdx].key === 'review' && (
                        <div className="fv-review">
                            <p><strong>{form.contract_name}</strong> ({form.id})</p>
                            <p className="fv-lead">Client {form.client_id} · {form.start_date} → {form.end_date}</p>
                            <p className="fv-lead">Sites: {form.sites.map(s => s.site_code).join(', ')}</p>
                            <p className="fv-lead">External SO: {form.meta.external_so_number || '—'}</p>
                            <div className="fv-kpi-grid">
                                <div className="fv-kpi"><div className="label">Monthly gross</div><div className="value">{money(monthlyGross)}</div></div>
                                <div className="fv-kpi"><div className="label">+ ST</div><div className="value">{money(grand)}</div></div>
                            </div>
                            {!lineSumOk && (
                                <div className="fv-banner error">
                                    CORO line sum {money(monthlyGross)} must equal {money(expected || CORO_EXPECTED)} before save.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="fv-wizard-footer">
                    <button type="button" className="btn-secondary" disabled={stepIdx === 0} onClick={back}>
                        <ArrowLeft size={14} /> Back
                    </button>
                    {stepIdx < STEPS.length - 1 ? (
                        <button type="button" className="btn-primary" onClick={next}>
                            Next <ArrowRight size={14} />
                        </button>
                    ) : (
                        <button type="button" className="btn-primary" disabled={saving || !lineSumOk} onClick={save}>
                            <Save size={14} /> {saving ? 'Saving…' : 'Save contract'}
                        </button>
                    )}
                    {STEPS[stepIdx].key === 'review' && lineSumOk && (
                        <span className="fv-lead" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Check size={14} /> Ready to save
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
