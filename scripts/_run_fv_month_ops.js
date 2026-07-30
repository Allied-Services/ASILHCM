'use strict';
/**
 * Drive-pull + apply all PSO sites, invoice compute/persist, World B payroll.
 * Env: JWT_SECRET (required). Optional: STAGING_BASE_URL, MONTH, YEAR, CONTRACT_ID
 *
 *   $env:MONTH=6; $env:YEAR=2026; node scripts/_run_fv_month_ops.js
 */
const path = require('path');
const fs = require('fs');

function resolveJwt() {
  const roots = [
    path.join(__dirname, '..', 'backend', 'node_modules', 'jsonwebtoken'),
    'C:/Projects/ASILHCM-Staging/backend/node_modules/jsonwebtoken',
    'C:/temp/BPOFMSystem-backend/node_modules/jsonwebtoken',
  ];
  for (const r of roots) {
    try { return require(r); } catch (_) { /* next */ }
  }
  return require('jsonwebtoken');
}

async function httpJson(base, method, urlPath, token, body) {
  const res = await fetch(base + urlPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitHealth(base, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(base + '/health');
      if (r.ok) return r.json();
    } catch (_) { /* cold start */ }
    await sleep(5000);
  }
  throw new Error('staging health timeout');
}

async function main() {
  const secret = process.env.JWT_SECRET || process.env.STAGING_JWT_SECRET;
  const base = (process.env.STAGING_BASE_URL || 'https://asil-hcm-staging.onrender.com').replace(/\/$/, '');
  const month = parseInt(process.env.MONTH || '6', 10);
  const year = parseInt(process.env.YEAR || '2026', 10);
  const contractId = process.env.CONTRACT_ID || 'CTR-PSO-NORTH-ZONE';
  if (!secret) {
    console.error('BLOCKER: JWT_SECRET missing');
    process.exit(3);
  }

  const jwt = resolveJwt();
  const token = jwt.sign(
    { id: '1', email: 'shezad.mumtaz@asil.com.pk', role: 'superadmin', name: 'Shezad Mumtaz' },
    secret,
    { expiresIn: '3h' }
  );

  console.log('== health ==');
  const health = await waitHealth(base);
  console.log(JSON.stringify({ status: health.status, commit: health.commit, migrations: health.migrations }));

  const sosRes = await httpJson(base, 'GET', `/api/fixed-value/service-orders?contractId=${encodeURIComponent(contractId)}`, token);
  const soList = Array.isArray(sosRes.json) ? sosRes.json : [];
  console.log('SERVICE_ORDERS', sosRes.status, soList.length);
  if (sosRes.status !== 200 || !soList.length) {
    console.error('FAIL list', JSON.stringify(sosRes.json).slice(0, 400));
    process.exit(1);
  }

  const siteResults = [];
  for (const so of soList) {
    const soId = so.id;
    const siteCode = so.site_code || so.siteCode;
    const row = {
      siteCode, soId, matched: 'N', fileName: null, pullOk: false, pullCode: null,
      overrides: 0, deductions: 0, skips: 0, skipReasons: [], errors: 0, applyStatus: null,
    };

    const pull = await httpJson(base, 'POST', `/api/fixed-value/service-orders/${encodeURIComponent(soId)}/attendance/drive`, token, { month, year });
    row.pullOk = pull.status === 200 && pull.json && pull.json.ok !== false;
    row.pullCode = (pull.json && (pull.json.code || pull.json.error)) || (pull.status !== 200 ? 'HTTP_' + pull.status : null);
    if (pull.json && pull.json.matched) {
      row.matched = 'Y';
      row.fileName = pull.json.fileName || pull.json.matched.name || null;
    } else if (pull.json && pull.json.fileName) {
      row.matched = 'Y';
      row.fileName = pull.json.fileName;
    }

    if (row.pullOk && pull.json && pull.json.parse && Array.isArray(pull.json.parse.rows)) {
      const apply = await httpJson(base, 'POST', `/api/fixed-value/service-orders/${encodeURIComponent(soId)}/attendance/apply`, token, {
        month,
        year,
        rows: pull.json.parse.rows,
        monthDays: pull.json.parse.monthDays || new Date(year, month, 0).getDate(),
      });
      row.applyStatus = apply.status;
      if (apply.status === 200 && apply.json) {
        row.overrides = Number(apply.json.overrides || 0);
        row.deductions = Number(apply.json.deductions || 0);
        const skipped = apply.json.skipped || [];
        row.skips = skipped.length;
        row.skipReasons = [...new Set(skipped.map((s) => s.reason || 'unknown'))];
        row.errors = (apply.json.errors || []).length;
        if (row.skips) row.skipSample = skipped.slice(0, 5);
      } else {
        row.pullCode = row.pullCode || ('APPLY_HTTP_' + apply.status + ':' + JSON.stringify(apply.json).slice(0, 200));
      }
    }

    siteResults.push(row);
    console.log(
      'SITE', siteCode,
      'matched=' + row.matched,
      'file=' + (row.fileName || '-'),
      'ov=' + row.overrides,
      'ded=' + row.deductions,
      'skips=' + row.skips,
      'err=' + row.errors,
      'code=' + (row.pullCode || 'ok')
    );
  }

  // Invoice compute + persist for ALL sites
  const invoices = [];
  for (const so of soList) {
    const soId = so.id;
    const siteCode = so.site_code || so.siteCode;
    const inv = await httpJson(base, 'POST', `/api/fixed-value/service-orders/${encodeURIComponent(soId)}/invoice/compute`, token, { month, year });
    const body = inv.json || {};
    const entry = {
      siteCode,
      soId,
      computeStatus: inv.status,
      gross: body.gross,
      totalDeductions: body.totalDeductions,
      net: body.net ?? body.netTaxable,
      provincialSt: body.provincialSt ?? body.salesTax,
      incomeWht: body.incomeWht ?? body.wht,
      grandTotal: body.grandTotal,
      deductionCount: Array.isArray(body.deductions) ? body.deductions.length : null,
      error: inv.status !== 200 ? (body.error || body.code || JSON.stringify(body).slice(0, 200)) : null,
      persistStatus: null,
      invoiceId: null,
      invoiceNumber: null,
    };

    if (inv.status === 200) {
      const pers = await httpJson(base, 'POST', `/api/fixed-value/service-orders/${encodeURIComponent(soId)}/invoice/persist`, token, { month, year });
      entry.persistStatus = pers.status;
      entry.invoiceId = pers.json && pers.json.invoice && pers.json.invoice.id;
      entry.invoiceNumber = pers.json && pers.json.invoice && (pers.json.invoice.invoice_number || pers.json.invoice.invoiceNumber);
      entry.persistedGrand = pers.json && (pers.json.computed?.grandTotal ?? pers.json.invoice?.grand_total);
      if (pers.status !== 200) {
        entry.error = (pers.json && (pers.json.error || pers.json.code)) || ('PERSIST_' + pers.status);
      }
    }
    invoices.push(entry);
    console.log(
      'INV', siteCode,
      'gross=' + entry.gross,
      'ded=' + entry.totalDeductions,
      'st=' + entry.provincialSt,
      'wht=' + entry.incomeWht,
      'grand=' + entry.grandTotal,
      'persist=' + entry.persistStatus,
      'id=' + (entry.invoiceId || '-')
    );
  }

  const reg = await httpJson(base, 'GET', `/api/fixed-value/registry?contractId=${encodeURIComponent(contractId)}&month=${month}&year=${year}`, token);
  const regRows = Array.isArray(reg.json) ? reg.json : [];

  // World B payroll
  const pay = await httpJson(base, 'POST', '/api/payroll-runs/compute', token, { contractId, month, year });
  const payBody = pay.json || {};
  let rows = Array.isArray(payBody.rows) ? payBody.rows : [];
  const runId = payBody.run?.id || payBody.runId || payBody.id || null;

  // If compute returns run without rows, fetch run detail
  if (!rows.length && runId) {
    const detail = await httpJson(base, 'GET', `/api/payroll-runs/${encodeURIComponent(runId)}`, token);
    if (detail.json && Array.isArray(detail.json.rows)) rows = detail.json.rows;
    else if (detail.json && detail.json.run && Array.isArray(detail.json.run.rows)) rows = detail.json.run.rows;
  }
  if (!rows.length) {
    const list = await httpJson(base, 'GET', `/api/payroll-runs?contractId=${encodeURIComponent(contractId)}&month=${month}&year=${year}`, token);
    const runs = Array.isArray(list.json) ? list.json : (list.json?.runs || []);
    console.log('PAYROLL_LIST', list.status, Array.isArray(runs) ? runs.length : 0, JSON.stringify(runs).slice(0, 400));
  }

  const sample = rows.slice(0, 5).map((r) => ({
    emp: r.employee_name || r.name || r.employee_id,
    gratuity: r.gratuity ?? r.gratuity_amount,
    life: r.life_insurance ?? r.lifeInsurance ?? r.life_ins,
    bonus: r.bonus ?? r.bonus_amount,
    net: r.net_pay ?? r.netPay,
  }));
  const grat150 = rows.filter((r) => Number(r.gratuity ?? r.gratuity_amount) === 150).length;
  const life150 = rows.filter((r) => Number(r.life_insurance ?? r.lifeInsurance ?? r.life_ins) === 150).length;
  const bonusNonZero = rows.filter((r) => Number(r.bonus ?? r.bonus_amount ?? 0) !== 0).length;

  const payroll = {
    status: pay.status,
    ok: payBody.ok,
    runId,
    rowCount: rows.length || payBody.rowCount || null,
    grat150,
    life150,
    bonusNonZero,
    error: payBody.error || payBody.code || (pay.status >= 400 ? JSON.stringify(payBody).slice(0, 400) : null),
    sample,
    warnings: (payBody.warnings || []).slice(0, 10),
  };
  console.log('PAYROLL', JSON.stringify({
    status: payroll.status, runId: payroll.runId, rowCount: payroll.rowCount,
    grat150, life150, bonusNonZero, error: payroll.error,
  }));

  const outPath = path.join(__dirname, '..', 'audit', `_fv_ops_${year}_${String(month).padStart(2, '0')}.json`);
  const summary = {
    at: new Date().toISOString(),
    month,
    year,
    contractId,
    health,
    siteResults,
    invoices,
    registryCount: regRows.length,
    registry: regRows.map((r) => ({
      id: r.id,
      site: r.site_code || r.siteCode,
      invoice_number: r.invoice_number,
      grand_total: r.grand_total,
      status: r.status,
    })),
    payroll,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log('WROTE', outPath);

  const unmatched = siteResults.filter((s) => s.matched !== 'Y' || !s.pullOk);
  if (unmatched.length) {
    console.log('UNMATCHED_OR_FAILED', unmatched.map((s) => s.siteCode + ':' + (s.pullCode || 'no_file')).join(', '));
  }
}

main().catch((err) => {
  console.error('ERR', err && err.stack ? err.stack : err);
  process.exit(2);
});
