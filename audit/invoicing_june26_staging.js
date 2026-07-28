#!/usr/bin/env node
'use strict';
/**
 * June 2026 staging invoicing helper — lock payroll runs + generate invoices.
 *
 * Usage:
 *   node audit/invoicing_june26_staging.js              # dry-run (default)
 *   node audit/invoicing_june26_staging.js --execute    # lock + invoice
 *
 * Requires STAGING_DATABASE_URL in backend/.env.local.
 * API equivalents (Payroll Run UI):
 *   POST /api/payroll-runs/compute   { contractId, month: 6, year: 2026 }
 *   POST /api/payroll-runs/:id/lock
 *   POST /api/payroll-runs/:id/invoice
 */
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({
  path: path.join(backendRoot, '.env.local'),
});
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const {
  computeRunForContract,
  lockRun,
  generateInvoiceFromRun,
} = require(path.join(backendRoot, 'src', 'modules', 'payrollrun', 'service'));

const EXECUTE = process.argv.includes('--execute');
const TARGET_MONTH = 6;
const TARGET_YEAR = 2026;
const ACTOR = 'audit:invoicing_june26_staging';

function rupee(n) {
  return Math.round(Number(n) || 0);
}

(async () => {
  if (!process.env.STAGING_DATABASE_URL) {
    console.error('FATAL: STAGING_DATABASE_URL not set in backend/.env.local');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.STAGING_DATABASE_URL,
    ssl: { rejectUnauthorized: true },
  });

  const { rows: runs } = await pool.query(
    `SELECT pr.id, pr.contract_id, pr.status, pr.invoice_id,
            c.contract_name, cl.name AS client_name,
            (SELECT COUNT(*)::int FROM payroll_run_rows r WHERE r.run_id = pr.id) AS row_count
     FROM payroll_runs pr
     JOIN contracts c ON c.id = pr.contract_id
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE pr.period_month = $1 AND pr.period_year = $2
     ORDER BY cl.name, c.contract_name`,
    [TARGET_MONTH, TARGET_YEAR]
  );

  if (!runs.length) {
    console.log('No June 2026 payroll runs found. Run june26_compute_all.js first.');
    await pool.end();
    return;
  }

  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(`June ${TARGET_YEAR} payroll runs: ${runs.length}\n`);

  const report = [];
  let blocked = 0;
  let ready = 0;
  let invoiced = 0;

  for (const run of runs) {
    const { rows: policyRows } = await pool.query(
      `SELECT * FROM contract_policies WHERE contract_id = $1`,
      [run.contract_id]
    );
    const policy = policyRows[0];
    const blockers = [];

    if (!policy) blockers.push('MISSING_CONTRACT_POLICY');
    if (run.row_count === 0) blockers.push('EMPTY_RUN');
    if (run.contract_id.startsWith('TEST')) blockers.push('TEST_CONTRACT');

    const { rows: totals } = await pool.query(
      `SELECT COALESCE(SUM((computed->>'netPay')::numeric), 0) AS net_total,
              COALESCE(SUM((computed->>'totalCost')::numeric), 0) AS bill_total
       FROM payroll_run_rows WHERE run_id = $1`,
      [run.id]
    );
    const netTotal = rupee(totals[0]?.net_total);
    const billTotal = rupee(totals[0]?.bill_total);

    const entry = {
      run_id: run.id,
      contract_id: run.contract_id,
      client: run.client_name,
      contract: run.contract_name,
      status: run.status,
      row_count: run.row_count,
      net_total: netTotal,
      bill_total: billTotal,
      invoice_id: run.invoice_id,
      blockers,
      actions: [],
    };

    if (run.status === 'invoiced' && run.invoice_id) {
      entry.actions.push('SKIP_ALREADY_INVOICED');
      invoiced += 1;
      report.push(entry);
      continue;
    }

    if (blockers.length) {
      blocked += 1;
      report.push(entry);
      continue;
    }

    // Recompute to pick up latest contract policies / overrides
    if (EXECUTE && run.status === 'draft') {
      const compute = await computeRunForContract(pool, {
        contractId: run.contract_id,
        month: TARGET_MONTH,
        year: TARGET_YEAR,
      });
      if (!compute.ok) {
        blockers.push(`COMPUTE_FAILED:${compute.error || compute.code || 'unknown'}`);
        blocked += 1;
        report.push(entry);
        continue;
      }
      entry.actions.push('RECOMPUTED');
    } else if (run.status === 'draft') {
      entry.actions.push('WOULD_RECOMPUTE');
    }

    if (run.status === 'draft' || run.status === 'proposed') {
      if (EXECUTE) {
        await lockRun(pool, { runId: run.id, lockedBy: ACTOR });
        entry.actions.push('LOCKED');
        entry.status = 'locked';
      } else {
        entry.actions.push('WOULD_LOCK');
        entry.status = 'locked'; // dry-run: assume lock succeeds for invoice preview
      }
    }

    const effectiveStatus = entry.status;

    if (effectiveStatus === 'locked' || run.status === 'locked') {
      if (EXECUTE) {
        try {
          const inv = await generateInvoiceFromRun(pool, {
            runId: run.id,
            generatedBy: ACTOR,
          });
          entry.actions.push(`INVOICED:${inv.invoice_id || inv.id}`);
          entry.invoice_id = inv.invoice_id || inv.id;
          entry.status = 'invoiced';
          ready += 1;
        } catch (err) {
          blockers.push(`INVOICE_FAILED:${err.message}`);
          blocked += 1;
        }
      } else {
        entry.actions.push('WOULD_INVOICE');
        ready += 1;
      }
    }

    report.push(entry);
  }

  console.log('Contract'.padEnd(40), 'Status'.padEnd(10), 'Rows', 'Net PKR'.padStart(12), 'Actions / Blockers');
  console.log('-'.repeat(100));
  for (const r of report) {
    const label = `${r.client || '?'} / ${r.contract || r.contract_id}`.slice(0, 38);
    const actions = r.blockers.length
      ? r.blockers.join(', ')
      : r.actions.join(' → ');
    console.log(
      label.padEnd(40),
      String(r.status).padEnd(10),
      String(r.row_count).padStart(4),
      String(r.net_total).padStart(12),
      actions
    );
  }

  console.log('\nSummary:');
  console.log(`  Already invoiced: ${invoiced}`);
  console.log(`  Ready to invoice: ${ready}`);
  console.log(`  Blocked:          ${blocked}`);
  console.log(`  Total runs:       ${runs.length}`);

  if (!EXECUTE) {
    console.log('\nDry-run only. Re-run with --execute after contract policies are updated on staging UI.');
  }

  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
