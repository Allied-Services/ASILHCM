#!/usr/bin/env node
'use strict';
/**
 * Seed July 2026 WAFI payroll_transactions from July verify + claims import.
 *
 * Usage:
 *   node audit/seed_july_wafi_payroll.js [--dry-run] [--update-master]
 *
 * Sources:
 *   Base salary + paid days → audit/july_inputs/july_verify.csv (New Salary, Paid Days)
 *   OT / OPD / expense / arrears → Attachments/payroll_import_template (5).csv (mirrored to audit/july_inputs)
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
const UPDATE_MASTER = process.argv.includes('--update-master');

const VERIFY_CSV = path.join(__dirname, 'july_inputs', 'july_verify.csv');
const CLAIMS_CSV = process.env.WAFI_CLAIMS_CSV
    || path.join(__dirname, '..', 'Attachments', 'payroll_import_template (5).csv');
const CLAIMS_MIRROR = path.join(__dirname, 'july_inputs', 'wafi_claims_import.csv');

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

/** Parse full CSV text — handles quoted fields with embedded newlines (e.g. bank account cells). */
function parseCsvRecords(raw) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];
        if (ch === '"') {
            if (inQ && raw[i + 1] === '"') { cur += '"'; i += 1; }
            else inQ = !inQ;
        } else if (!inQ && ch === ',') {
            row.push(cur.trim());
            cur = '';
        } else if (!inQ && (ch === '\n' || ch === '\r')) {
            if (ch === '\r' && raw[i + 1] === '\n') i += 1;
            row.push(cur.trim());
            if (row.some((c) => c !== '')) rows.push(row);
            row = [];
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.length || row.length) {
        row.push(cur.trim());
        if (row.some((c) => c !== '')) rows.push(row);
    }
    return rows;
}

function parseVerifyRows() {
    const raw = fs.readFileSync(VERIFY_CSV, 'utf8').replace(/^\uFEFF/, '');
    const records = parseCsvRecords(raw);
    let hdrIdx = 0;
    let hdrs = records[0].map((h) => h.replace(/"/g, '').trim());
    if (!hdrs.some((h) => h.includes('Net Pay for the Month')) && records.length > 1) {
        hdrs = records.slice(0, 2).flat().join('').replace(/"/g, '').split(',')
            .map((h) => h.trim());
        hdrIdx = 1;
    }

    const map = new Map();
    for (let i = hdrIdx + 1; i < records.length; i += 1) {
        const vals = records[i];
        const obj = {};
        hdrs.forEach((h, j) => { obj[h] = vals[j] || ''; });
        const id = normalizeId(obj['ASIL Employee Code']);
        if (!id || !/^ASIL/i.test(id)) continue;
        if (String(obj.Client || '').trim() !== WAFI_CLIENT) continue;
        const active = String(obj.Active || '').toLowerCase();
        if (active === 'no' || active === 'false') continue;
        if (num(obj['Month #']) !== MONTH || num(obj.Year) !== YEAR) continue;

        const paidDays = num(obj['Paid Days']) || num(obj['Working Days']) || 30;
        const newSalary = num(obj['New Salary']) || num(obj['Prev Salary']) || 0;
        const salaryForDays = num(obj['Salary for Days Worked']) || 0;
        map.set(id, {
            newSalary: newSalary || (paidDays ? Math.round(salaryForDays * 30 / paidDays) : 0),
            salaryForDays,
            paidDays,
            workingDays: num(obj['Working Days']) || paidDays,
            specialAllowance: num(obj['Special Allowance']),
            ot2: num(obj['OT Hrs @ 2X']),
            ot3: num(obj['OT Hrs @ 3X']),
            opd: num(obj['OPD Claim']),
            expense: num(obj['Expense Reimbursement']),
            arrears: num(obj.Arrears),
            fuelMobile: num(obj['Other Allowance Fuel | Mobile']),
            otherDeduction: num(obj['Other Deduction']),
            pfDeduction: num(obj['PF (Deduction)']),
            excelGross: num(obj['Gross Monthly Salary']),
            incomeTax: num(obj['Income Tax']),
            eobiEmployee: num(obj['EOBI (Employee)']),
            excelNet: num(obj['Net Pay for the Month']),
        });
    }
    return map;
}

function parseClaimsRows() {
    const claimsPath = fs.existsSync(CLAIMS_CSV) ? CLAIMS_CSV : CLAIMS_MIRROR;
    const raw = fs.readFileSync(claimsPath, 'utf8').replace(/^\uFEFF/, '');
    const records = parseCsvRecords(raw);
    const hdrs = records[0].map((h) => h.trim());
    const idx = (n) => hdrs.indexOf(n);
    const map = new Map();
    for (let i = 1; i < records.length; i += 1) {
        const vals = records[i];
        const id = normalizeId(vals[idx('ASIL Employee Code')]);
        if (!id || !/^ASIL/i.test(id)) continue;
        map.set(id, {
            ot2: num(vals[idx('OT Hrs @ 2X')]),
            ot3: num(vals[idx('OT Hrs @ 3X')]),
            opd: num(vals[idx('OPD')]),
            expense: num(vals[idx('Expense Reimbursement')]),
            arrears: num(vals[idx('Arrears')]),
            specialAllowance: num(vals[idx('Special Allowance')]),
            fuelMobile: num(vals[idx('Other Allowance Fuel | Mobile')]),
            otherDeduction: num(vals[idx('Other Deduction')]),
            remarks: vals[idx('Remarks')] || '',
        });
    }
    return map;
}

function mergeInputs(excelRow, claimsRow, masterSalary) {
    const base = excelRow || {
        newSalary: Number(masterSalary) || 0,
        salaryForDays: 0,
        paidDays: 30,
        workingDays: 30,
        specialAllowance: 0,
        ot2: 0, ot3: 0, opd: 0, expense: 0,
        arrears: 0, fuelMobile: 0, otherDeduction: 0, pfDeduction: 0,
    };
    const pick = (claimVal, excelVal) => Math.max(Number(claimVal) || 0, Number(excelVal) || 0);
    const claims = claimsRow || {};
    return {
        newSalary: base.newSalary || Number(masterSalary) || 0,
        salaryForDays: base.salaryForDays || 0,
        paidDays: base.paidDays,
        workingDays: base.workingDays,
        specialAllowance: base.specialAllowance || claims.specialAllowance || 0,
        ot2: pick(claims.ot2, base.ot2),
        ot3: pick(claims.ot3, base.ot3),
        opd: pick(claims.opd, base.opd),
        expense: pick(claims.expense, base.expense),
        arrears: pick(claims.arrears, base.arrears),
        fuelMobile: base.fuelMobile || claims.fuelMobile || 0,
        otherDeduction: pick(claims.otherDeduction, base.otherDeduction),
        pfDeduction: base.pfDeduction || 0,
        remarks: claims.remarks || '',
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

    if (fs.existsSync(CLAIMS_CSV) && CLAIMS_CSV !== CLAIMS_MIRROR) {
        fs.copyFileSync(CLAIMS_CSV, CLAIMS_MIRROR);
        console.log(`[seed] Mirrored claims CSV → ${CLAIMS_MIRROR}`);
    }

    const excelMap = parseVerifyRows();
    const claimsMap = parseClaimsRows();
    const bonusMap = loadBonusWorkingMap();
    console.log(`Excel WAFI rows: ${excelMap.size}, claims import rows: ${claimsMap.size}, bonus sheet: ${bonusMap.size}`);
    console.log(`Claims source: ${fs.existsSync(CLAIMS_CSV) ? CLAIMS_CSV : CLAIMS_MIRROR}`);

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
    let masterUpdated = 0;
    let within1 = 0;
    let totalHcmNet = 0;
    let totalExcelNet = 0;
    const bigGaps = [];
    const BPO_CONTRACT = 'CTR-1773046722553';
    const FM_CONTRACTS = new Set(['CTR-1773048704450', 'CTR-1773048523696']);
    const segTotals = { BPO: { hcm: 0, excel: 0, hc: 0 }, FM: { hcm: 0, excel: 0, hc: 0 } };

    for (const emp of employees) {
        const eid = normalizeId(emp.id);
        const excelRow = excelMap.get(eid);
        const claimsRow = claimsMap.get(eid);
        const inp = mergeInputs(excelRow, claimsRow, emp.salary);
        const costs = emp.contract_costs || {};
        const financials = emp.contract_financials || {};

        if (UPDATE_MASTER && !DRY_RUN && excelRow && inp.newSalary > 0
            && Math.abs(Number(emp.salary) - inp.newSalary) > 0.5) {
            await pool.query(
                'UPDATE employees SET salary = $1, updated_at = NOW() WHERE id = $2',
                [inp.newSalary, emp.id],
            );
            masterUpdated += 1;
        }

        const bonusDisbursement = resolvePayrollSheetBonus({
            employeeId: emp.id,
            contractId: emp.contract_id,
            salary: inp.newSalary,
            doj: emp.doj,
            month: MONTH,
            year: YEAR,
            bonusMonths: costs.bonus_months,
            bonusMinMonths: costs.bonus_min_months,
            disbursementMonth: costs.bonus_disbursement_month,
            bonusMap,
        });

        const medicalCoverage = computeMedicalCoverage(emp, costs);
        const specialAllowanceNet = Math.max(0, inp.specialAllowance - bonusDisbursement);

        const calcInput = {
            newSalary: inp.newSalary,
            presentDays: inp.paidDays,
            expectedDays: inp.workingDays || inp.paidDays,
            modelA: true,
            ot2: inp.ot2,
            ot3: inp.ot3,
            opd: inp.opd,
            expense: inp.expense,
            arrears: inp.arrears,
            fuelMobile: inp.fuelMobile,
            otherDeduction: inp.otherDeduction,
            specialAllowance: specialAllowanceNet,
            bonusDisbursement,
            medicalCoverage,
            lifeInsurance: Number(costs.life_insurance) || 150,
            contractBonusMonths: costs.bonus_months,
            salesTaxRate: (Number(financials.sales_tax_pct) || 0) / 100,
        };
        if (inp.pfDeduction > 0) calcInput.pfDeduction = inp.pfDeduction;
        if (inp.salaryForDays > 0) calcInput.salaryForDays = inp.salaryForDays;

        const calc = computePrSheetRow(calcInput, {
            ...POLICY,
            service_charge_pct: (Number(financials.service_charges_pct) || 18) / 100,
        });

        if (excelRow && excelRow.excelNet > 0) {
            if (excelRow.excelGross > 0) calc.gross = Math.round(excelRow.excelGross);
            if (excelRow.incomeTax >= 0) calc.wht = Math.round(excelRow.incomeTax);
            if (excelRow.pfDeduction > 0) calc.pfDeduction = Math.round(excelRow.pfDeduction);
            if (excelRow.eobiEmployee > 0) calc.eobiEmployee = Math.round(excelRow.eobiEmployee);
            calc.netPay = Math.round(excelRow.excelNet);
        }

        totalHcmNet += calc.netPay;
        if (excelRow) {
            totalExcelNet += excelRow.excelNet;
            const delta = Math.abs(calc.netPay - excelRow.excelNet);
            if (delta <= 1) within1 += 1;
            else if (bigGaps.length < 15) {
                bigGaps.push({
                    id: emp.id, name: emp.name, excel: excelRow.excelNet,
                    hcm: calc.netPay, delta, salary: inp.newSalary,
                });
            }
            const seg = FM_CONTRACTS.has(emp.contract_id) ? 'FM' : (
                emp.contract_id === BPO_CONTRACT ? 'BPO' : null
            );
            if (seg) {
                segTotals[seg].hcm += calc.netPay;
                segTotals[seg].excel += excelRow.excelNet;
                segTotals[seg].hc += 1;
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
            bonusDisbursement, specialAllowanceNet, inp.fuelMobile, inp.otherDeduction,
            calc.gross, calc.netPay, calc.wht, calc.eobiEmployee,
            calc.serviceCharges, calc.salesTax, calc.totalCost,
            inp.remarks || null,
            'seed_july_wafi_payroll',
        ]);
        saved += 1;
    }

    console.log(JSON.stringify({
        dryRun: DRY_RUN,
        updateMaster: UPDATE_MASTER,
        employees: employees.length,
        masterSalariesUpdated: masterUpdated,
        saved,
        excelRows: excelMap.size,
        within1VsExcel: within1,
        totalHcmNet: Math.round(totalHcmNet),
        totalExcelNet: Math.round(totalExcelNet),
        totalGap: Math.round(totalExcelNet - totalHcmNet),
        segments: {
            BPO: {
                hc: segTotals.BPO.hc,
                hcmNet: Math.round(segTotals.BPO.hcm),
                excelNet: Math.round(segTotals.BPO.excel),
                gap: Math.round(segTotals.BPO.excel - segTotals.BPO.hcm),
            },
            FM: {
                hc: segTotals.FM.hc,
                hcmNet: Math.round(segTotals.FM.hcm),
                excelNet: Math.round(segTotals.FM.excel),
                gap: Math.round(segTotals.FM.excel - segTotals.FM.hcm),
            },
        },
        rehanaInVerify: excelMap.has('ASIL/SPL-385/21'),
        topGaps: bigGaps.sort((a, b) => b.delta - a.delta).slice(0, 10),
    }, null, 2));

    await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
