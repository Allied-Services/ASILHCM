#!/usr/bin/env node
'use strict';
/**
 * Seed staging DB from Excel Master Data + June-26 sheet for payroll reconciliation.
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   node audit/seed_june26_from_master.js           # dry-run (default)
 *   node audit/seed_june26_from_master.js --execute # apply changes
 */
const fs = require('fs');
const path = require('path');
const backendRoot = path.join(__dirname, '..', 'backend');
require(path.join(backendRoot, 'node_modules', 'dotenv')).config({
  path: path.join(backendRoot, '.env.local'),
});
const { Pool } = require(path.join(backendRoot, 'node_modules', 'pg'));
const XLSX = require(path.join(backendRoot, 'node_modules', 'xlsx'));

const XLSX_PATH = process.env.JUNE26_XLSX
  || 'G:\\My Drive\\Experiments\\BPOFMSystem\\Attachments\\BPO FM Payroll & Invoice File (1).xlsx';
const TARGET_MONTH = 6;
const TARGET_YEAR = 2026;
const EXECUTE = process.argv.includes('--execute');

const CONTRACTS = {
  BPO: { id: 'CTR-1773046722553', name: 'Business Process Outsourcing (BPO)' },
  FM_TRADING: { id: 'CTR-1773048523696', name: 'Facility Management (Trading & Supply)' },
  FM: { id: 'CTR-1773048704450', name: 'Facility Management' },
  PSO_OPS: { id: 'CTR-1778149976025', name: 'Operations Handling LMT Korangi & LMP-A Keamari' },
  PSO_JAN: { id: 'CTR-1773053337970', name: 'Janitorial Services LMT Korangi & LMP-A Kemari' },
  PSO_CON_PUNJAB: { id: 'CTR-1773054060255', name: 'Conservancy Services Punjab' },
  PSO_CON_KPK: { id: 'CTR-1773054204870', name: 'Conservancy Services KPK' },
  PSO_CON_GB: { id: 'CTR-1773054335402', name: 'Conservancy Services Gilgit Baltistan' },
};

const POLICY_TEMPLATE_CONTRACT = 'CTR-1773048704450';

// Master Data column indices (0-based, row 2 = headers, data from row 4)
const MD = {
  ASIL_BU: 1,
  EMPLOYEE_ID: 2,
  ACTIVE: 3,
  CLIENT: 4,
  CLIENT_BU: 5,
  DEPT: 6,
  DESIGNATION: 7,
  LOCATION: 8,
  PROVINCE: 9,
  NAME: 10,
  SALARY: 19,
};

// June-26 column indices (0-based, headers row 1, data from row 4)
const JUNE = {
  EMPLOYEE_ID: 1,
  MONTH: 14,
  YEAR: 15,
  NEW_SALARY: 17,
  WORKING_DAYS: 18,
  PAID_DAYS: 19,
  OT2: 21,
  OT3: 22,
  OPD: 24,
  EXPENSE: 25,
  ARREARS: 26,
  SPECIAL_ALLOWANCE: 27,
  FUEL_MOBILE: 28,
  OTHER_DEDUCTION: 29,
  GROSS: 30,
  INCOME_TAX: 31,
  PF: 32,
};

// PSO Operational PR June-26 — same column layout as June-26 (no month filter)
const PSO = {
  EMPLOYEE_ID: 1,
  WORKING_DAYS: 18,
  PAID_DAYS: 19,
  OT2: 21,
  OT3: 22,
  OPD: 24,
  EXPENSE: 25,
  ARREARS: 26,
  SPECIAL_ALLOWANCE: 27,
  FUEL_MOBILE: 28,
  OTHER_DEDUCTION: 29,
  GROSS: 30,
  INCOME_TAX: 31,
  PF: 32,
  NET_PAY: 35,
};

const stats = {
  employeesUpdated: 0,
  salariesFixed: 0,
  contractsAssigned: 0,
  policiesInserted: 0,
  overridesUpserted: 0,
  skipped: 0,
};

function num(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/,/g, '').replace(/[^\d.\-]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeId(id) {
  return String(id || '').trim().toUpperCase().replace(/\s+/g, '');
}

function cellVal(ws, row, col) {
  const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
  if (!cell) return '';
  return cell.v;
}

function normalizeBu(bu) {
  return String(bu || '').trim().replace(/\s+/g, '').toUpperCase();
}

function resolveContract({ asilBu, clientBu, province }) {
  const bu = normalizeBu(asilBu);
  const cbu = String(clientBu || '').trim();
  const prov = String(province || '').trim();

  if (bu === 'WAFIBPO') return CONTRACTS.BPO;
  if (bu === 'WAFIFM') {
    if (cbu === 'Trading & Supply') return CONTRACTS.FM_TRADING;
    return CONTRACTS.FM;
  }
  if (bu === 'PSOFM') {
    if (cbu === 'Conservancy Services') {
      if (prov === 'Punjab') return CONTRACTS.PSO_CON_PUNJAB;
      if (prov === 'KPK') return CONTRACTS.PSO_CON_KPK;
      if (prov === 'Gilgit Baltistan') return CONTRACTS.PSO_CON_GB;
      return null;
    }
    if (cbu === 'Janitorial Services') return CONTRACTS.PSO_JAN;
    if (
      cbu === 'Operation Handling Services'
      || cbu === 'Operation Handling Services (Temp)'
      || cbu === 'CORO 94 MA'
    ) return CONTRACTS.PSO_OPS;
  }
  return null;
}

function parseMasterData(wb) {
  const ws = wb.Sheets['Master Data'];
  if (!ws) throw new Error('Sheet "Master Data" not found');
  const range = XLSX.utils.decode_range(ws['!ref']);
  const map = new Map();
  for (let r = 3; r <= range.e.r; r += 1) {
    const rawId = String(cellVal(ws, r, MD.EMPLOYEE_ID) || '').trim();
    if (!rawId || !/^ASIL/i.test(rawId)) continue;
    const employeeId = normalizeId(rawId);
    const asilBu = String(cellVal(ws, r, MD.ASIL_BU) || '').trim();
    const clientBu = String(cellVal(ws, r, MD.CLIENT_BU) || '').trim();
    const province = String(cellVal(ws, r, MD.PROVINCE) || '').trim();
    const contract = resolveContract({ asilBu, clientBu, province });
    map.set(employeeId, {
      employee_id: employeeId,
      name: String(cellVal(ws, r, MD.NAME) || '').trim(),
      active: String(cellVal(ws, r, MD.ACTIVE) || '').trim(),
      client: String(cellVal(ws, r, MD.CLIENT) || '').trim(),
      bu: asilBu,
      client_bu: clientBu,
      dept: String(cellVal(ws, r, MD.DEPT) || '').trim(),
      designation: String(cellVal(ws, r, MD.DESIGNATION) || '').trim(),
      location: String(cellVal(ws, r, MD.LOCATION) || '').trim(),
      province,
      salary: num(cellVal(ws, r, MD.SALARY)),
      contract_id: contract?.id || null,
      contract_name: contract?.name || null,
    });
  }
  return map;
}

function parseJune26Overrides(wb) {
  const ws = wb.Sheets['June-26'];
  if (!ws) throw new Error('Sheet "June-26" not found');
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = 3; r <= Math.min(512, range.e.r); r += 1) {
    const rawId = String(cellVal(ws, r, JUNE.EMPLOYEE_ID) || '').trim();
    if (!rawId || !/^ASIL/i.test(rawId)) continue;
    const m = num(cellVal(ws, r, JUNE.MONTH));
    const y = num(cellVal(ws, r, JUNE.YEAR));
    if (m !== TARGET_MONTH || y !== TARGET_YEAR) continue;

    const workingDays = num(cellVal(ws, r, JUNE.WORKING_DAYS));
    const paidDays = num(cellVal(ws, r, JUNE.PAID_DAYS));
    const ot2 = num(cellVal(ws, r, JUNE.OT2));
    const ot3 = num(cellVal(ws, r, JUNE.OT3));
    const opd = num(cellVal(ws, r, JUNE.OPD));
    const expense = num(cellVal(ws, r, JUNE.EXPENSE));
    const arrears = num(cellVal(ws, r, JUNE.ARREARS));
    const specialAllowance = num(cellVal(ws, r, JUNE.SPECIAL_ALLOWANCE));
    const fuelMobile = num(cellVal(ws, r, JUNE.FUEL_MOBILE));
    const otherDeduction = num(cellVal(ws, r, JUNE.OTHER_DEDUCTION));
    const newSalary = num(cellVal(ws, r, JUNE.NEW_SALARY));
    const pfDeduction = num(cellVal(ws, r, JUNE.PF));
    const incomeTax = num(cellVal(ws, r, JUNE.INCOME_TAX));
    const isPsoOt1x = /^ASIL\/PSO-/i.test(rawId);

    rows.push({
      employee_id: normalizeId(rawId),
      working_days: workingDays > 0 ? workingDays : null,
      present_days: paidDays > 0 ? paidDays : null,
      ot1_hours: isPsoOt1x ? ot2 : 0,
      ot2_hours: isPsoOt1x ? 0 : ot2,
      ot3_hours: ot3,
      opd,
      expense,
      arrears,
      special_allowance: specialAllowance,
      fuel_mobile: fuelMobile,
      other_deduction: otherDeduction,
      pf_deduction: pfDeduction,
      income_tax: incomeTax,
      salary_override: newSalary > 0 ? newSalary : null,
      new_salary: newSalary > 0 ? newSalary : null,
      source: 'june26_seed',
    });
  }
  return rows;
}

function parsePsoOperationalOverrides(wb) {
  const ws = wb.Sheets['PSO Operational PR June-26'];
  if (!ws) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = 3; r <= Math.min(168, range.e.r); r += 1) {
    const rawId = String(cellVal(ws, r, PSO.EMPLOYEE_ID) || '').trim();
    if (!rawId || !/^ASIL/i.test(rawId)) continue;
    const net = num(cellVal(ws, r, PSO.NET_PAY));
    const gross = num(cellVal(ws, r, PSO.GROSS));
    if (net <= 0 && gross <= 0) continue;

    const workingDays = num(cellVal(ws, r, PSO.WORKING_DAYS));
    const paidDays = num(cellVal(ws, r, PSO.PAID_DAYS));
    const pfDeduction = num(cellVal(ws, r, PSO.PF));
    const incomeTax = num(cellVal(ws, r, PSO.INCOME_TAX));
    const ot2Raw = num(cellVal(ws, r, PSO.OT2));
    const ot3Raw = num(cellVal(ws, r, PSO.OT3));

    rows.push({
      employee_id: normalizeId(rawId),
      working_days: workingDays > 0 ? workingDays : null,
      present_days: paidDays > 0 ? paidDays : null,
      ot1_hours: ot2Raw,
      ot2_hours: 0,
      ot3_hours: ot3Raw,
      opd: num(cellVal(ws, r, PSO.OPD)),
      expense: num(cellVal(ws, r, PSO.EXPENSE)),
      arrears: num(cellVal(ws, r, PSO.ARREARS)),
      special_allowance: num(cellVal(ws, r, PSO.SPECIAL_ALLOWANCE)),
      fuel_mobile: num(cellVal(ws, r, PSO.FUEL_MOBILE)),
      other_deduction: num(cellVal(ws, r, PSO.OTHER_DEDUCTION)),
      pf_deduction: pfDeduction,
      income_tax: incomeTax,
      new_salary: null,
      source: 'pso_ops_june26_seed',
    });
  }
  return rows;
}

function mergeOverrideRows(juneRows, psoRows) {
  const map = new Map();
  for (const row of juneRows) map.set(row.employee_id, { ...row });
  // PSO operational sheet overrides June-26 for employees only on PSO sheet
  for (const row of psoRows) {
    if (!map.has(row.employee_id)) {
      map.set(row.employee_id, row);
    }
  }
  return [...map.values()];
}

async function seedContractPolicies(pool, dryRun) {
  const targets = [
    CONTRACTS.BPO.id,
    CONTRACTS.FM_TRADING.id,
    CONTRACTS.PSO_CON_KPK.id,
    CONTRACTS.PSO_CON_GB.id,
  ];
  const inserted = [];

  for (const contractId of targets) {
    const { rows: existing } = await pool.query(
      'SELECT id FROM contract_policies WHERE contract_id = $1 LIMIT 1',
      [contractId],
    );
    if (existing.length) {
      inserted.push({ contractId, action: 'exists' });
      continue;
    }

    const { rows: template } = await pool.query(
      `SELECT billing_model, attendance_input_mode, standard_month_days, ot_allowed,
              ot_monthly_cap_hours, ot_client_managed, ot_divisor_days, ot_divisor_hours,
              service_charge_pct, medical_annual_cap, medical_cycle_anchor, credit_days,
              invoice_frequency, invoice_day_of_month, po_required, challans_required,
              reminder_cadence, edu_cess_enabled, bonus_accrual_months, gratuity_accrual_months,
              income_tax_wht_pct, use_calendar_working_days, working_days_override,
              sales_tax_rate, sales_tax_exempt
       FROM contract_policies WHERE contract_id = $1
       ORDER BY effective_from DESC, id DESC LIMIT 1`,
      [POLICY_TEMPLATE_CONTRACT],
    );
    if (!template.length) throw new Error(`Template policy not found for ${POLICY_TEMPLATE_CONTRACT}`);

    const t = template[0];
  const policyChoice = contractId === CONTRACTS.BPO.id
    ? 'Copied from Wafi FM (CTR-1773048704450) — headcount_rate, full_ledger, calendar working days, 18% service charge'
    : 'Copied from Wafi FM (CTR-1773048704450) — same policy; FM Trading uses identical payroll rules';

    if (!dryRun) {
      await pool.query(
        `INSERT INTO contract_policies (
           contract_id, billing_model, attendance_input_mode, standard_month_days,
           ot_allowed, ot_monthly_cap_hours, ot_client_managed, ot_divisor_days, ot_divisor_hours,
           service_charge_pct, medical_annual_cap, medical_cycle_anchor, credit_days,
           invoice_frequency, invoice_day_of_month, po_required, challans_required,
           reminder_cadence, edu_cess_enabled, bonus_accrual_months, gratuity_accrual_months,
           income_tax_wht_pct, use_calendar_working_days, working_days_override,
           sales_tax_rate, sales_tax_exempt, effective_from
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'2020-01-01'
         )`,
        [
          contractId,
          t.billing_model, t.attendance_input_mode, t.standard_month_days,
          t.ot_allowed, t.ot_monthly_cap_hours, t.ot_client_managed, t.ot_divisor_days, t.ot_divisor_hours,
          t.service_charge_pct, t.medical_annual_cap, t.medical_cycle_anchor, t.credit_days,
          t.invoice_frequency, t.invoice_day_of_month, t.po_required, JSON.stringify(t.challans_required || []),
          JSON.stringify(t.reminder_cadence || []), t.edu_cess_enabled, t.bonus_accrual_months, t.gratuity_accrual_months,
          t.income_tax_wht_pct, t.use_calendar_working_days, t.working_days_override,
          t.sales_tax_rate, t.sales_tax_exempt,
        ],
      );
    }
    stats.policiesInserted += 1;
    inserted.push({ contractId, action: 'inserted', rationale: policyChoice });
  }
  return inserted;
}

async function updateEmployees(pool, masterMap, juneSalaryMap, dryRun) {
  const { rows: dbEmployees } = await pool.query(
    `SELECT id, salary, contract_id, contract_name, bu, client, client_bu, designation, province, active
     FROM employees`,
  );
  const updates = [];

  for (const emp of dbEmployees) {
    const key = normalizeId(emp.id);
    const md = masterMap.get(key);
    if (!md) continue;

    const patch = {};
    const dbSalary = Number(emp.salary || 0);
    // June-26 "New Salary" is payroll truth for this period; Master Data col T can be stale
    const juneSalary = juneSalaryMap.get(key);
    const targetSalary = (juneSalary > 0 ? juneSalary : md.salary);
    if (targetSalary > 0 && Math.abs(dbSalary - targetSalary) > 0.01) {
      patch.salary = targetSalary;
      stats.salariesFixed += 1;
    }
    if (md.contract_id && emp.contract_id !== md.contract_id) {
      patch.contract_id = md.contract_id;
      patch.contract_name = md.contract_name;
      stats.contractsAssigned += 1;
    }
    if (md.bu && emp.bu !== md.bu) patch.bu = md.bu;
    if (md.client && emp.client !== md.client) patch.client = md.client;
    if (md.client_bu && emp.client_bu !== md.client_bu) patch.client_bu = md.client_bu;
    if (md.designation && emp.designation !== md.designation) patch.designation = md.designation;
    if (md.province && emp.province !== md.province) patch.province = md.province;
    if (md.active && String(emp.active) !== md.active) patch.active = md.active;

    if (!Object.keys(patch).length) {
      stats.skipped += 1;
      continue;
    }

    updates.push({ id: emp.id, patch });
  }

  if (!dryRun) {
    for (const u of updates) {
      const cols = Object.keys(u.patch);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const vals = [u.id, ...cols.map((c) => u.patch[c])];
      await pool.query(`UPDATE employees SET ${sets}, updated_at = NOW() WHERE id = $1`, vals);
      stats.employeesUpdated += 1;
    }
  } else {
    stats.employeesUpdated = updates.length;
  }

  return updates.slice(0, 20);
}

async function upsertOverrides(pool, overrideRows, dryRun) {
  const { rows: existingIds } = await pool.query('SELECT id FROM employees');
  const validIds = new Set(existingIds.map((r) => normalizeId(r.id)));

  let upserted = 0;
  for (const row of overrideRows) {
    if (!validIds.has(row.employee_id)) continue;

    if (!dryRun) {
      await pool.query(
        `INSERT INTO monthly_attendance_overrides (
           employee_id, period_month, period_year, present_days, working_days,
           ot1_hours, ot2_hours, ot3_hours, opd, expense, arrears,
           special_allowance, fuel_mobile, other_deduction,
           pf_deduction, income_tax, salary_override, source, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'seed_script')
         ON CONFLICT (employee_id, period_month, period_year) DO UPDATE SET
           present_days = EXCLUDED.present_days,
           working_days = EXCLUDED.working_days,
           ot1_hours = EXCLUDED.ot1_hours,
           ot2_hours = EXCLUDED.ot2_hours,
           ot3_hours = EXCLUDED.ot3_hours,
           opd = EXCLUDED.opd,
           expense = EXCLUDED.expense,
           arrears = EXCLUDED.arrears,
           special_allowance = EXCLUDED.special_allowance,
           fuel_mobile = EXCLUDED.fuel_mobile,
           other_deduction = EXCLUDED.other_deduction,
           pf_deduction = EXCLUDED.pf_deduction,
           income_tax = EXCLUDED.income_tax,
           salary_override = EXCLUDED.salary_override,
           source = EXCLUDED.source,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [
          row.employee_id, TARGET_MONTH, TARGET_YEAR, row.present_days, row.working_days,
          row.ot1_hours || 0, row.ot2_hours, row.ot3_hours, row.opd, row.expense, row.arrears,
          row.special_allowance, row.fuel_mobile, row.other_deduction,
          row.pf_deduction || 0, row.income_tax, row.salary_override,
          row.source || 'june26_seed',
        ],
      );
    }
    upserted += 1;
  }
  stats.overridesUpserted = upserted;
  return upserted;
}

async function main() {
  console.error(`[seed] Reading workbook: ${XLSX_PATH}`);
  const wb = XLSX.readFile(XLSX_PATH);
  const masterMap = parseMasterData(wb);
  const juneRows = parseJune26Overrides(wb);
  const psoRows = parsePsoOperationalOverrides(wb);
  const overrideRows = mergeOverrideRows(juneRows, psoRows);
  const juneSalaryMap = new Map(
    overrideRows.filter((r) => r.new_salary > 0).map((r) => [r.employee_id, r.new_salary]),
  );

  console.error(`[seed] Master Data: ${masterMap.size} employees`);
  console.error(`[seed] June-26 overrides: ${juneRows.length} rows`);
  console.error(`[seed] PSO Operational overrides: ${psoRows.length} rows (merged: ${overrideRows.length})`);
  console.error(`[seed] Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);

  const dbUrl = process.env.STAGING_DATABASE_URL;
  if (!dbUrl) throw new Error('STAGING_DATABASE_URL not set in backend/.env.local');

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: true } : false,
  });

  const dryRun = !EXECUTE;
  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');

    const policyResults = await seedContractPolicies(client, dryRun);
    const sampleUpdates = await updateEmployees(client, masterMap, juneSalaryMap, dryRun);
    const overrideCount = await upsertOverrides(client, overrideRows, dryRun);

    if (!dryRun) await client.query('COMMIT');

    const report = {
      mode: dryRun ? 'dry-run' : 'executed',
      masterDataEmployees: masterMap.size,
      june26OverrideRows: overrideRows.length,
      stats,
      policyChoices: policyResults,
      sampleEmployeeUpdates: sampleUpdates,
      contractMapping: {
        WafiBPO: CONTRACTS.BPO.id,
        'WafiFM+Trading&Supply': CONTRACTS.FM_TRADING.id,
        'WafiFM+other': CONTRACTS.FM.id,
        'PSOFM+Conservancy+Punjab': CONTRACTS.PSO_CON_PUNJAB.id,
        'PSOFM+Conservancy+KPK': CONTRACTS.PSO_CON_KPK.id,
        'PSOFM+Conservancy+Gilgit': CONTRACTS.PSO_CON_GB.id,
        'PSOFM+OpsHandling/CORO': CONTRACTS.PSO_OPS.id,
        'PSOFM+Janitorial': CONTRACTS.PSO_JAN.id,
      },
      policyTemplate: POLICY_TEMPLATE_CONTRACT,
      generatedAt: new Date().toISOString(),
    };

    const outPath = path.join(__dirname, 'june26_reconcile', 'seed_report.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    if (!dryRun) await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[seed_june26_from_master]', e.message || e);
  process.exit(2);
});
