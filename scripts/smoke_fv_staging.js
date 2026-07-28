#!/usr/bin/env node
'use strict';
/**
 * Authenticated Fixed Value staging API smoke (no Google OAuth UI).
 *
 * Required env:
 *   JWT_SECRET          â€” must match Render asil-hcm-staging JWT_SECRET
 * Optional:
 *   STAGING_BASE_URL    â€” default https://asil-hcm-staging.onrender.com
 *   STAGING_DATABASE_URL / DATABASE_URL â€” used only to pick a real superadmin email if present
 *   SMOKE_EMAIL / SMOKE_USER_ID â€” override JWT subject
 *
 * Usage (PowerShell):
 *   $env:JWT_SECRET="..."
 *   node scripts/smoke_fv_staging.js
 */

const path = require('path');
const fs = require('fs');

function loadDotenv() {
  const candidates = [
    path.join(__dirname, '..', 'backend', '.env.local'),
    path.join(__dirname, '..', 'backend', '.env.staging'),
    path.join(__dirname, '..', 'backend', '.env'),
    path.join('C:/Projects/ASILHCM-Staging/backend/.env.local'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const dotenvPath = path.join(path.dirname(p), 'node_modules', 'dotenv');
      require(dotenvPath).config({ path: p, quiet: true });
      console.log('loaded_env_file=' + p);
      return;
    } catch (_) {
      // parse manually
      for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
        if (!line || line.trim().startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i < 0) continue;
        const k = line.slice(0, i).trim();
        let v = line.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[k]) process.env[k] = v;
      }
      console.log('loaded_env_file=' + p);
      return;
    }
  }
  console.log('loaded_env_file=none');
}

function resolveJwt() {
  const roots = [
    path.join(__dirname, '..', 'backend', 'node_modules', 'jsonwebtoken'),
    'C:/Projects/ASILHCM-Staging/backend/node_modules/jsonwebtoken',
  ];
  for (const r of roots) {
    try { return require(r); } catch (_) { /* next */ }
  }
  return require('jsonwebtoken');
}

function resolvePg() {
  const roots = [
    path.join(__dirname, '..', 'backend', 'node_modules', 'pg'),
    'C:/Projects/ASILHCM-Staging/backend/node_modules/pg',
  ];
  for (const r of roots) {
    try { return require(r); } catch (_) { /* next */ }
  }
  return null;
}

async function pickActor() {
  if (process.env.SMOKE_EMAIL) {
    return { email: process.env.SMOKE_EMAIL, id: process.env.SMOKE_USER_ID || 'smoke-superadmin', role: 'superadmin' };
  }
  const dbUrl = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
  const Pg = resolvePg();
  if (dbUrl && Pg) {
    const pool = new Pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
      const { rows } = await pool.query(
        `SELECT id, email, role FROM hcm_users WHERE role = 'superadmin' ORDER BY last_login DESC NULLS LAST, email LIMIT 1`
      );
      if (rows[0]) return { id: String(rows[0].id), email: rows[0].email, role: 'superadmin' };
    } finally {
      await pool.end();
    }
  }
  return { id: 'smoke-superadmin', email: 'smoke-superadmin@asil.com.pk', role: 'superadmin' };
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
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

function result(name, pass, detail) {
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  ' + detail : ''));
  return pass;
}

async function main() {
  loadDotenv();
  const secret = process.env.JWT_SECRET || process.env.STAGING_JWT_SECRET;
  const base = (process.env.STAGING_BASE_URL || 'https://asil-hcm-staging.onrender.com').replace(/\/$/, '');

  if (!secret) {
    console.error('BLOCKER: staging JWT_SECRET not in local env');
    console.error('Set JWT_SECRET (or STAGING_JWT_SECRET) to the Render asil-hcm-staging value, then re-run.');
    process.exit(3);
  }

  const jwt = resolveJwt();
  const actor = await pickActor();
  const token = jwt.sign(
    { id: actor.id, email: actor.email, role: 'superadmin', name: actor.email },
    secret,
    { expiresIn: '15m' }
  );
  console.log('actor_email=' + actor.email);
  console.log('base=' + base);

  let failed = 0;

  // 1) contracts
  const contracts = await httpJson(base, 'GET', '/api/fixed-value/contracts', token);
  const contractList = Array.isArray(contracts.json) ? contracts.json : (contracts.json && contracts.json.contracts) || [];
  const pso = contractList.find((c) => String(c.id || c.contract_id || '').includes('PSO') || String(c.name || c.contract_name || '').toLowerCase().includes('pso'));
  const contractId = (pso && (pso.id || pso.contract_id)) || 'CTR-PSO-NORTH-ZONE';
  if (!result('GET /api/fixed-value/contracts', contracts.status === 200, 'status=' + contracts.status + ' count=' + contractList.length)) failed++;

  // 2) service orders â€” expect 12
  const sos = await httpJson(base, 'GET', `/api/fixed-value/service-orders?contractId=${encodeURIComponent(contractId)}`, token);
  const soList = Array.isArray(sos.json) ? sos.json : (sos.json && sos.json.serviceOrders) || (sos.json && sos.json.rows) || [];
  if (!result('GET /api/fixed-value/service-orders', sos.status === 200 && soList.length === 12, 'status=' + sos.status + ' count=' + soList.length + ' expected=12')) failed++;

  // 3) invoice compute Tarujabba March 2026 â€” expect grand 2479745
  const inv = await httpJson(base, 'POST', '/api/fixed-value/service-orders/SO-PSO-TARUJABBA/invoice/compute', token, { month: 3, year: 2026 });
  const grand = inv.json && (inv.json.grandTotal != null ? inv.json.grandTotal : inv.json.grand_total);
  if (!result('POST .../SO-PSO-TARUJABBA/invoice/compute', inv.status === 200 && Number(grand) === 2479745, 'status=' + inv.status + ' grandTotal=' + grand + ' expected=2479745')) failed++;

  // 4) registry
  const reg = await httpJson(base, 'GET', `/api/fixed-value/registry?contractId=${encodeURIComponent(contractId)}&month=3&year=2026`, token);
  const regRows = Array.isArray(reg.json) ? reg.json : (reg.json && (reg.json.rows || reg.json.registry || reg.json.items)) || [];
  const regOk = reg.status === 200;
  if (!result('GET /api/fixed-value/registry', regOk, 'status=' + reg.status + (Array.isArray(regRows) ? ' rows=' + regRows.length : ''))) failed++;

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('ERR', err && err.message ? err.message : err);
  process.exit(2);
});
