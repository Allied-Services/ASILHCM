#!/usr/bin/env node
'use strict';
/**
 * Seed July 2026 WAFI payroll_transactions from HCM master + WAFI claims CSV.
 * Uses prSheetEngine (same as backend tests / gap report bonus check).
 *
 * Usage:
 *   node audit/seed_july_wafi_payroll.js [--dry-run]
 *
 * Env: DATABASE_URL from backend/.env
 */
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..', 'backend');
const tempRoot = 'C:/temp/BPOFMSystem-backend';

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

loadEnvFile(path.join(backendRoot, '.env'));
loadEnvFile(path.join(backendRoot, '.env.local'));

function req(name) {
    for (const root of [tempRoot, backendRoot]) {
        try { return require(path.join(root, 'node_modules', name)); }
        catch (_) { /* try next */ }
    }
    throw new Error(`Cannot load module ${name}`);
}

const { Pool } = req('pg');
const {
    computePrSheetRow,
    resolvePayrollSheetBonus,
    computeMedicalCoverage,
} = require(path.join(fs.existsSync(tempRoot) ? tempRoot : backendRoot, 'src', 'payroll', 'prSheetEngine'));
const { loadBonusWorkingMap } = require(path.join(
    fs.existsSync(tempRoot) ? tempRoot : backendRoot,
    'src', 'payroll', 'julyBonusAccrual',
));

const WAFI_CLIENT = 'Wafi Energy Pakistan Pvt Ltd';
const MONTH = 7;
const YEAR = 2026;
const DRY_RUN = process.argv.includes('--dry-run');

const VERIFY_CSV = path.join(__dirname, 'july_inputs', 'july_verify.csv');
const CLAIMS_CSV = path.join(__dirname, 'july_inputs', 'wafi_claims_import.csv');

const POLICY = {
    standard_month_days: 30,
    service_charge_pct: 0.18,
    edu_cess_enabled: false,
    ot_divisor_days: 26,
    ot_divisor_hours: 8,
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

function parseCsvLine(line) {
    const vals = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    vals.push(cur.trim());
    return vals;
}

function parseVerifyRows() {
    const raw = fs.readFileSync(VERIFY_CSV, 'utf8').replace(/\r/g, '');
    const lines = raw.split('\n').filter(Boolean);
    let headerLine = lines[0];
    let dataStart = 1;
    if (!headerLine.includes('Net Pay for the Month') && lines.length > 1) {
        headerLine = lines.slice(0, 2).join('').replace(/\n/g, '');
        dataStart = 2;
    }
    const hdrs = parseCsvLine(headerLine).map(h => h.replace(/"/g, '').trim());
    const col = (n) => hdrs.findIndex(h => h === n || h.startsWith(n));

    const map = new Map();
    for (let i = dataStart; i < lines.length; i += 1) {
        const vals = parseCsvLine(lines[i]);
        const obj = {};
        hdrs.forEach((h, j) => { obj[h] = vals[j] || ''; });
        const id = normalizeId(obj['ASIL Employee Code']);
        if (!id || !/^ASIL/i.test(id)) continue;
        if (String(obj.Client || '').trim() !== WAFI_CLIENT) continue;
        const active = String(obj.Active || '').toLowerCase();
        if (active === 'no' || active === 'false') continue;
        if (num(obj['Month #']) !== MONTH || num(obj.Year) !== YEAR) continue;

        map.set(id, {
            paidDays: num(obj['Paid Days']) || 30,
            ot2: num(obj['OT Hrs @ 2X']),
            ot3: num(obj['OT Hrs @ 3X']),
            opd: num(obj['OPD Claim']),
            expense: num(obj['Expense Reimbursement']),
            arrears: num(obj.Arrears),
            fuelMobile: num(obj['Other Allowance Fuel | Mobile']),
            otherDeduction: num(obj['Other Deduction']),
            excelNet: num(obj['Net Pay for the Month']),
        });
    }
    return map;
}

function parseClaimsRows() {
    const raw = fs.readFileSync(CLAIMS_CSV, 'utf8').replace(/\r/g, '');
    const lines = raw.split('\n').filter(Boolean);
    const hdrs = parseCsvLine(lines[0]).map(h => h.trim());
    const idx = (n) => hdrs.indexOf(n);
    const map = new Map();
    for (let i = 1; i < lines.length; i += 1) {
        const vals = parseCsvLine(lines[i]);
        const id = normalizeId(vals[idx('ASIL Employee Code')]);
        if (!id) continue;
        map.set(id, {
            paidDays: num(vals[idx('Present Days')]) || null,
            ot2: num(vals[idx('OT Hrs @ 2X')]),
            ot3: num(vals[idx('OT Hrs @ 3X')]),
            opd: num(vals[idx('OPD')]),
            expense: num(vals[idx('Expense Reimbursement')]),
            arrears: num(vals[idx('Arrears')]),
            fuelMobile: num(vals[idx('Other Allowance Fuel | Mobile')]),
            otherDeduction: num(vals[idx('Other Deduction')]),
            remarks: vals[idx('Remarks')] || '',
        });
    }
    return map;
}

function mergeInputs(excelRow, claimsRow) {
    const base = excelRow || {
        paidDays: 30, ot2: 0, ot3: 0, opd: 0, expense: 0,
        arrears: 0, fuelMobile: 0, otherDeduction: 0,
    };
    if (!claimsRow) return { ...base, remarks: '' };
    // Excel verify is authoritative for totals; claims file fills gaps (June OT/OPD/reimb)
    const pick = (claimVal, excelVal) => {
        const c = Number(claimVal) || 0;
        const e = Number(excelVal) || 0;
        return Math.max(c, e);
    };
    return {
        paidDays: claimsRow.paidDays ?? base.paidDays,
        ot2: pick(claimsRow.ot2, base.ot2),
        ot3: pick(claimsRow.ot3, base.ot3),
        opd: pick(claimsRow.opd, base.opd),
        expense: pick(claimsRow.expense, base.expense),
        arrears: pick(claimsRow.arrears, base.arrears),
        fuelMobile: pick(claimsRow.fuelMobile, base.fuelMobile),
        otherDeduction: pick(claimsRow.otherDeduction, base.otherDeduction),
        remarks: claimsRow.remarks || '',
    };
}

async function ensureRemarksColumn(pool) {
    const { rows } = await pool.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'payroll_transactions' AND column_name = 'remarks'
    `);
    if (rows.length) return;
    console.log('[seed] Adding payroll_transactions.remarks column...');
    if (!DRY_RUN) {
        await pool.query('ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS remarks TEXT');
    }
}

async function main() {
    const dbUrl = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL not set');

    const excelMap = parseVerifyRows();
    const claimsMap = parseClaimsRows();
    const bonusMap = loadBonusWorkingMap();
    console.log(`Excel WAFI rows: ${excelMap.size}, claims import rows: ${claimsMap.size}, bonus sheet: ${bonusMap.size}`);

    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await ensureRemarksColumn(pool);

    const locked = await pool.query(
        'SELECT 1 FROM payroll_transactions WHERE year=$1 AND month=$2 AND locked=TRUE LIMIT 1',
        [YEAR, MONTH],
    );
    if (locked.rows.length) {
        throw new Error('July 2026 payroll is locked — unlock before seeding');
    }

    const { rows: employees } = await pool.query(
        `SELECT e.id, e.name, e.salary, e.doj, e.contract_id,
                e.spouse_name, e.child1_name, e.child2_name,
                c.costs AS contract_costs, c.financials AS contract_financials
         FROM employees e
         LEFT JOIN contracts c ON c.id = e.contract_id
         WHERE LOWER(TRIM(e.client)) = LOWER($1)
           AND COALESCE(LOWER(TRIM(e.active)), 'yes') IN ('yes', 'true', '1')`,
        [WAFI_CLIENT],
    );

    let saved = 0;
    let within1 = 0;
    let totalHcmNet = 0;
    const bigGaps = [];

    for (const emp of employees) {
        const eid = normalizeId(emp.id);
        const excelRow = excelMap.get(eid);
        const claimsRow = claimsMap.get(eid);
        const inp = mergeInputs(excelRow, claimsRow);
        const costs = emp.contract_costs || {};
        const financials = emp.contract_financials || {};

        const bonusDisbursement = resolvePayrollSheetBonus({
            employeeId: emp.id,
            contractId: emp.contract_id,
            salary: emp.salary,
            doj: emp.doj,
            month: MONTH,
            year: YEAR,
            bonusMonths: costs.bonus_months,
            bonusMinMonths: costs.bonus_min_months,
            disbursementMonth: costs.bonus_disbursement_month,
            bonusMap,
        });

        const medicalCoverage = computeMedicalCoverage(emp, costs);

        const calc = computePrSheetRow({
            newSalary: Number(emp.salary) || 0,
            presentDays: inp.paidDays,
            expectedDays: 30,
            modelA: true,
            ot2: inp.ot2,
            ot3: inp.ot3,
            opd: inp.opd,
            expense: inp.expense,
            arrears: inp.arrears,
            fuelMobile: inp.fuelMobile,
            otherDeduction: inp.otherDeduction,
            specialAllowance: 0,
            bonusDisbursement,
            medicalCoverage,
            lifeInsurance: Number(costs.life_insurance) || 150,
            contractBonusMonths: costs.bonus_months,
            salesTaxRate: (Number(financials.sales_tax_pct) || 0) / 100,
        }, {
            ...POLICY,
            service_charge_pct: (Number(financials.service_charges_pct) || 18) / 100,
        });

        totalHcmNet += calc.netPay;
        if (excelRow) {
            const delta = Math.abs(calc.netPay - excelRow.excelNet);
            if (delta <= 1) within1 += 1;
            else if (bigGaps.length < 20) {
                bigGaps.push({ id: emp.id, name: emp.name, excel: excelRow.excelNet, hcm: calc.netPay, delta });
            }
        }

        if (DRY_RUN) continue;

        await pool.query(`
            INSERT INTO payroll_transactions
                (month, year, employee_id, paid_days, ot2_hrs, ot3_hrs, opd_claim,
                 reimbursement, arrears, bonus_amount, special_allowance, fuel_mobile,
                 other_deduction, gross, net, wht, eobi_ee, service_charges, sales_tax,
                 total_invoice, remarks, created_by, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
            ON CONFLICT (employee_id, month, year) DO UPDATE SET
                paid_days=$4, ot2_hrs=$5, ot3_hrs=$6, opd_claim=$7,
                reimbursement=$8, arrears=$9, bonus_amount=$10, special_allowance=$11,
                fuel_mobile=$12, other_deduction=$13,
                gross=$14, net=$15, wht=$16, eobi_ee=$17,
                service_charges=$18, sales_tax=$19, total_invoice=$20,
                remarks=$21, updated_at=NOW()
        `, [
            MONTH, YEAR, emp.id,
            inp.paidDays, inp.ot2, inp.ot3, inp.opd, inp.expense, inp.arrears,
            bonusDisbursement, 0, inp.fuelMobile, inp.otherDeduction,
            calc.gross, calc.netPay, calc.wht, calc.eobiEmployee,
            calc.serviceCharges, calc.salesTax, calc.totalCost,
            inp.remarks || null,
            'seed_july_wafi_payroll',
        ]);
        saved += 1;
    }

    console.log(JSON.stringify({
        dryRun: DRY_RUN,
        employees: employees.length,
        saved,
        excelRows: excelMap.size,
        within1VsExcel: within1,
        totalHcmNet: Math.round(totalHcmNet),
        topGaps: bigGaps.sort((a, b) => b.delta - a.delta).slice(0, 10),
    }, null, 2));

    await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
