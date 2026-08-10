#!/usr/bin/env node
'use strict';
/**
 * Verify July 2026 final payroll CSV against prSheetEngine + July bonus accrual sheet.
 * Usage: node audit/verify_july_final_csv.js [path-to-csv]
 */
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..', 'backend');
const tempRoot = 'C:/temp/BPOFMSystem-backend';

function reqModule(relPath) {
    for (const root of [tempRoot, backendRoot]) {
        try { return require(path.join(root, relPath)); }
        catch (_) { /* try next */ }
    }
    throw new Error(`Cannot load ${relPath}`);
}

const { computePrSheetRow, resolvePayrollSheetBonus } = reqModule('src/payroll/prSheetEngine');
const { loadBonusWorkingMap } = reqModule('src/payroll/julyBonusAccrual');

const DEFAULT_CSV = path.join(
    __dirname, '..', 'Attachments', 'BPO FM Payroll & Invoice File - Jul Review on 9th August.csv',
);

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

function num(v) {
    if (v == null || v === '') return 0;
    const n = Number(String(v).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
}

function parseFinalCsv(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '');
    const lines = raw.split('\n').filter(Boolean);
    let hdrs = parseCsvLine(lines[0]);
    let start = 1;
    if (!hdrs.some((h) => h.includes('Net Pay'))) {
        hdrs = parseCsvLine(`${lines[0]}${lines[1] || ''}`);
        start = 2;
    }
    const idx = (name) => hdrs.findIndex((h) => h === name || h.startsWith(name));

    const rows = [];
    for (let i = start; i < lines.length; i += 1) {
        const v = parseCsvLine(lines[i]);
        const id = v[idx('ASIL Employee Code')];
        if (!id || !/^ASIL/i.test(id)) continue;
        rows.push({
            id,
            salary: num(v[idx('New Salary')]),
            paidDays: num(v[idx('Paid Days')]) || 31,
            workingDays: num(v[idx('Working Days')]) || 31,
            ot2: num(v[idx('OT Hrs @ 2X')]),
            ot3: num(v[idx('OT Hrs @ 3X')]),
            otAmount: num(v[idx('Overtime Amount')]),
            opd: num(v[idx('OPD Claim')]),
            expense: num(v[idx('Expense Reimbursement')]),
            arrears: num(v[idx('Arrears')]),
            fuelMobile: num(v[idx('Other Allowance Fuel | Mobile')]),
            otherDeduction: num(v[idx('Other Deduction')]),
            excelBonus: num(v[idx('Bonus Disbursement')]),
            excelGross: num(v[idx('Gross Monthly Salary')]),
            excelNet: num(v[idx('Net Pay for the Month')]),
            excelWht: num(v[idx('Income Tax')]),
            excelPf: num(v[idx('PF (Deduction)')]),
            excelEobi: num(v[idx('EOBI (Employee)')]) || 400,
        });
    }
    return rows;
}

function computeRow(excel, bonusDisbursement, opts = {}) {
    const useModelA = opts.useModelA !== false
        && excel.paidDays >= excel.workingDays;
    const base = {
        newSalary: excel.salary,
        ot2: excel.ot2,
        ot3: excel.ot3,
        overtimeAmount: excel.otAmount || undefined,
        opd: excel.opd,
        expense: excel.expense,
        arrears: excel.arrears,
        fuelMobile: excel.fuelMobile,
        otherDeduction: excel.otherDeduction,
        bonusDisbursement,
        specialAllowance: 0,
        wht: excel.excelWht,
        pfDeduction: excel.excelPf,
        eobiEmployee: excel.excelEobi,
    };
    if (useModelA) {
        return computePrSheetRow({
            ...base,
            presentDays: excel.paidDays,
            expectedDays: 30,
            modelA: true,
        });
    }
    return computePrSheetRow({
        ...base,
        paidDays: excel.paidDays,
        workingDays: excel.workingDays,
    });
}

const csvPath = process.argv[2] || DEFAULT_CSV;
if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
}

const rows = parseFinalCsv(csvPath);
const bonusMap = loadBonusWorkingMap();
let ok = 0;
const fails = [];

for (const ex of rows) {
    const bonus = resolvePayrollSheetBonus({
        employeeId: ex.id,
        month: 7,
        year: 2026,
        bonusMap,
    });
    const calc = computeRow(ex, bonus);
    const netOk = Math.abs(calc.netPay - ex.excelNet) <= 1;
    const grossOk = Math.abs(calc.gross - ex.excelGross) <= 1;
    const bonusOk = Math.abs(bonus - ex.excelBonus) <= 1 || (ex.excelBonus === 0 && bonus === 0);
    if (netOk && grossOk && bonusOk) {
        ok += 1;
    } else {
        fails.push({
            id: ex.id,
            excelNet: ex.excelNet,
            hcmNet: calc.netPay,
            excelGross: ex.excelGross,
            hcmGross: calc.gross,
            excelBonus: ex.excelBonus,
            hcmBonus: bonus,
        });
    }
}

console.log(`Rows: ${rows.length} | Match: ${ok} | Fail: ${fails.length}`);
const e208 = rows.find((r) => r.id.includes('208/21'));
if (e208) {
    const bonus = resolvePayrollSheetBonus({ employeeId: e208.id, month: 7, year: 2026, bonusMap });
    const contractBonus = e208.salary;
    const right = computeRow(e208, bonus);
    const wrong = computeRow(e208, contractBonus);
    console.log('\nASIL/SPL-208/21');
    console.log('  Excel gross/net:', e208.excelGross, '/', e208.excelNet);
    console.log('  Correct (accrual bonus', bonus + '):', right.gross, '/', right.netPay);
    console.log('  Wrong (contract 1-mo bonus):', wrong.gross, '/', wrong.netPay);
    console.log('  User phantom 98180 extra vs gross:', 98180 - e208.excelGross);
}

if (fails.length) {
    console.log('\nFirst mismatches:');
    fails.slice(0, 20).forEach((f) => {
        console.log(`  ${f.id}: net ${f.excelNet} vs ${f.hcmNet} | gross ${f.excelGross} vs ${f.hcmGross} | bonus ${f.excelBonus} vs ${f.hcmBonus}`);
    });
}

process.exit(fails.length ? 1 : 0);
