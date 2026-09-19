export const CORO_EXPECTED = 4136919.94;

export const emptyRole = () => ({ designation: '', count: 1, rate: 0 });

export const emptyLine = () => ({
  line_number: '1',
  name: '',
  unit: 'MON',
  quantity: 1,
  rate: 0,
  is_manpower_dependent: true,
  roles: [emptyRole()],
});

export function normalizeRoles(roles) {
  if (!Array.isArray(roles) || !roles.length) return [emptyRole()];
  return roles.map((r) => ({
    designation: r.designation || r.role || '',
    count: Number(r.count) || 0,
    rate: Number(r.rate ?? r.monthly_rate ?? r.monthlyRate ?? 0) || 0,
  }));
}

export function roleCountOf(roles) {
  return normalizeRoles(roles).reduce((n, r) => n + (Number(r.count) || 0), 0);
}

export function roleRateSum(roles) {
  return normalizeRoles(roles).reduce((n, r) => n + (Number(r.rate) || 0) * (Number(r.count) || 0), 0);
}

export function siteLineTotals(site) {
  const lines = site?.lines || [];
  let manpower = 0;
  let nonManpower = 0;
  for (const l of lines) {
    const amt = Number(l.rate || 0);
    if (l.is_manpower_dependent) manpower += amt;
    else nonManpower += amt;
  }
  return { manpower: round2(manpower), nonManpower: round2(nonManpower), total: round2(manpower + nonManpower) };
}

export function lineRateWarning(line) {
  if (!line?.is_manpower_dependent) return '';
  const roles = (line.roles || []).filter((r) => r.designation || r.count || r.rate);
  if (!roles.length) return 'Add the manpower roles for this line.';
  const sum = round2(roleRateSum(roles));
  const rate = round2(Number(line.rate || 0));
  if (sum > 0 && rate > 0 && sum !== rate) {
    return `Role rates sum to ${money(sum)}; line total is ${money(rate)}.`;
  }
  return '';
}

export const emptySite = () => ({
  site_code: '',
  name: '',
  province: 'Punjab',
  so_id: '',
  so_number: '',
  meta: { taxRate: 0.16, province: 'Punjab', contractMonths: 12, focalEnabled: false, focalEmail: '' },
  lines: [emptyLine()],
});

export function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function money(n) {
  return round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildInitial(detail) {
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
          roles: normalizeRoles(l.roles),
        })) : [emptyLine()],
      };
    }) : [emptySite()],
  };
}

export function formToPayload(form) {
  const isCoro = form.meta?.fv_product === 'coro_retail_ops';
  const expected = Number(form.meta?.expected_monthly_gross != null ? form.meta.expected_monthly_gross : (isCoro ? CORO_EXPECTED : 0));
  return {
    id: String(form.id || '').trim(),
    client_id: form.client_id,
    contract_name: String(form.contract_name || '').trim(),
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
      expected_monthly_gross: isCoro ? (expected || CORO_EXPECTED) : form.meta?.expected_monthly_gross,
    },
    policy: {
      ...form.policy,
      billing_model: 'service_order_deduction',
      effective_from: form.start_date,
      effective_to: form.end_date,
    },
    sites: (form.sites || []).map((s) => ({
      site_code: String(s.site_code || '').trim().toUpperCase(),
      name: String(s.name || '').trim(),
      province: s.province || form.region_province,
      so_id: s.so_id?.trim() || undefined,
      so_number: s.so_number || s.site_code,
      meta: {
        ...s.meta,
        siteCode: String(s.site_code || '').trim().toUpperCase(),
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
        roles: (l.roles || []).filter((r) => r.designation || r.count || r.rate).map((r) => ({
          designation: r.designation || '',
          count: Number(r.count) || 0,
          rate: Number(r.rate || 0) || 0,
        })),
      })),
    })),
  };
}

export function monthlyGrossOf(form) {
  return (form.sites || []).reduce(
    (acc, s) => acc + (s.lines || []).reduce((n, l) => n + Number(l.rate || 0), 0),
    0
  );
}
