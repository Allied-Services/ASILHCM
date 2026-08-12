#!/usr/bin/env node
'use strict';

/**
 * Proves, against live data, that every consumer of a payroll month shows the same numbers.
 *
 * The Payroll Sheet writes one snapshot per employee-month into
 * `payroll_transactions.computed_json`. The sheet UI, the locked CSV export, the bank file
 * and the payslip are all meant to be views of it. When they each recomputed payroll
 * instead, they disagreed in production — the export invented tax on bonus-excluded rows
 * and the 305-person July Wafi export came out Rs. 155,559 away from the sheet.
 *
 * `backend/tests/payrollSnapshotParity.test.js` pins this on fixtures. This script runs the
 * same check on real rows, so a month can be signed off before it is paid.
 *
 * Read-only: it issues a single SELECT and writes nothing.
 *
 * What it does NOT prove: that re-running Calculate reproduces the stored snapshot. That
 * needs the full input assembly (claims, bonus accrual, monthly hub) and belongs in the
 * engine tests, not here.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/verify_live_parity.js --month 7 --year 2026 \
 *       --client "Wafi Energy Pakistan Pvt Ltd" [--expect-net 43953273] [--show 10]
 *
 * Exit code 0 only when every row agrees.
 */

const path = require('path');

const BACKEND = path.join(__dirname, '..', 'backend');
const { readPayrollSnapshot, exportRowFromSnapshot } = require(path.join(BACKEND, 'src', 'payroll', 'snapshotView'));
const { buildWorldAPayslipData } = require(path.join(BACKEND, 'src', 'modules', 'payslip', 'dataBuilder'));

function arg(name, fallback = null) {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MONTH = Number(arg('month'));
const YEAR = Number(arg('year'));
const CLIENT = arg('client');
const CONTRACT = arg('contract');
const EMPLOYEE = arg('employee');
const EXPECT_NET = arg('expect-net') != null ? Number(arg('expect-net')) : null;
const SHOW = Number(arg('show', '10'));

if (!MONTH || !YEAR || (!CLIENT && !CONTRACT && !EMPLOYEE)) {
    console.error('Usage: --month <1-12> --year <yyyy> (--client "<name>" | --contract <id> | --employee <id>) [--expect-net N] [--show N]');
    process.exit(2);
}

const money = (v) => Math.round(Number(v) || 0).toLocaleString('en-PK');

async function main() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');

    const { Client } = require(path.join(BACKEND, 'node_modules', 'pg'));
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
    await client.connect();

    let filter = 'e.contract_id = $3';
    if (EMPLOYEE) filter = 'pt.employee_id = $3';
    else if (CLIENT) filter = 'e.client = $3';
    const { rows } = await client.query(`
        SELECT pt.*, e.name, e.salary, e.client, e.contract_name, e.contract_id,
               c.costs->>'eosb_type' AS eosb_type
        FROM payroll_transactions pt
        JOIN employees e ON e.id = pt.employee_id
        LEFT JOIN contracts c ON c.contract_name = e.contract_name
        WHERE pt.month = $1 AND pt.year = $2 AND ${filter}
        ORDER BY pt.employee_id
    `, [MONTH, YEAR, EMPLOYEE || CLIENT || CONTRACT]);
    await client.end();

    if (!rows.length) {
        console.error(`No payroll_transactions rows for ${MONTH}/${YEAR} and ${EMPLOYEE || CLIENT || CONTRACT}.`);
        process.exit(1);
    }

    const totals = { snapshotNet: 0, exportNet: 0, payslipNet: 0, columnNet: 0, snapshotTax: 0, exportTax: 0, payslipTax: 0 };
    const problems = [];
    let noSnapshot = 0;

    for (const row of rows) {
        const snap = readPayrollSnapshot(row);
        if (!snap) {
            noSnapshot += 1;
            continue;
        }

        const emp = { ...row, _eosb_type: row.eosb_type || 'None' };
        const exp = exportRowFromSnapshot(emp, row, snap);
        const slip = buildWorldAPayslipData(emp, row, row.eosb_type || 'None');
        const slipTaxRow = slip.deductions.find((d) => d.label === 'Income Tax (WHT)');
        const slipTax = slipTaxRow ? slipTaxRow.amount : 0;
        const snapNet = Math.round(Number(snap.netPay) || 0);
        const snapGross = Math.round(Number(snap.grossMonthly) || 0);
        const snapTax = Math.round(Number(snap.incomeTax) || 0);
        const columnNet = Math.round(Number(row.net) || 0);

        totals.snapshotNet += snapNet;
        totals.exportNet += exp.netPay;
        totals.payslipNet += slip.netPay;
        totals.columnNet += columnNet;
        totals.snapshotTax += snapTax;
        totals.exportTax += exp.wht;
        totals.payslipTax += slipTax;

        const fail = [];
        if (exp.netPay !== snapNet) fail.push(`export net ${exp.netPay} vs snapshot ${snapNet}`);
        if (slip.netPay !== snapNet) fail.push(`payslip net ${slip.netPay} vs snapshot ${snapNet}`);
        if (exp.grossM !== snapGross) fail.push(`export gross ${exp.grossM} vs snapshot ${snapGross}`);
        if (slip.grossTotal !== snapGross) fail.push(`payslip gross ${slip.grossTotal} vs snapshot ${snapGross}`);
        if (exp.wht !== snapTax) fail.push(`export tax ${exp.wht} vs snapshot ${snapTax}`);
        if (slipTax !== snapTax) fail.push(`payslip tax ${slipTax} vs snapshot ${snapTax}`);
        // A hidden row is only a valid way to show zero.
        if (snapTax > 0 && !slipTaxRow) fail.push(`payslip omits a tax row while ${snapTax} was deducted`);
        if (slip.grossTotal - slip.totalDeductions !== slip.netPay) fail.push('payslip does not balance');
        if (exp.grossM - exp.totalDed !== exp.netPay) fail.push('export row does not balance');
        // The scalar column is what legacy readers and the AP queue still use.
        if (columnNet !== snapNet) fail.push(`net column ${columnNet} vs snapshot ${snapNet}`);

        if (fail.length) problems.push({ id: row.employee_id, name: row.name, fail });

        // One row is a spot check, so show the three views side by side rather than a total.
        if (rows.length === 1) {
            console.log(`\n${row.employee_id} — ${row.name}, salary ${money(row.salary)}, locked: ${row.locked}`);
            console.log(`  sheet snapshot   gross ${money(snapGross)}   tax ${money(snapTax)}   net ${money(snapNet)}`);
            console.log(`  locked export    gross ${money(exp.grossM)}   tax ${money(exp.wht)}   net ${money(exp.netPay)}`);
            console.log(`  payslip          gross ${money(slip.grossTotal)}   tax ${slipTaxRow ? money(slipTax) : '0 (row hidden)'}   net ${money(slip.netPay)}`);
        }
    }

    let scope = `contract ${CONTRACT}`;
    if (EMPLOYEE) scope = `employee ${EMPLOYEE}`;
    else if (CLIENT) scope = `client "${CLIENT}"`;
    console.log(`\nJuly-style parity check — ${MONTH}/${YEAR}, ${scope}`);
    console.log(`Rows: ${rows.length}   with snapshot: ${rows.length - noSnapshot}   legacy (no snapshot): ${noSnapshot}\n`);
    console.log(`Net pay   sheet snapshot ${money(totals.snapshotNet)}   export ${money(totals.exportNet)}   payslips ${money(totals.payslipNet)}   net column ${money(totals.columnNet)}`);
    console.log(`Income tax  snapshot ${money(totals.snapshotTax)}   export ${money(totals.exportTax)}   payslips ${money(totals.payslipTax)}`);

    let ok = problems.length === 0;

    if (EXPECT_NET != null) {
        const delta = totals.snapshotNet - EXPECT_NET;
        console.log(`\nExpected net ${money(EXPECT_NET)} — difference ${money(delta)}`);
        if (delta !== 0) ok = false;
    }

    if (problems.length) {
        console.log(`\n${problems.length} row(s) disagree. First ${Math.min(SHOW, problems.length)}:`);
        for (const p of problems.slice(0, SHOW)) {
            console.log(`  ${p.id} ${p.name}: ${p.fail.join('; ')}`);
        }
    } else {
        console.log('\nEvery row agrees: sheet, export, payslip and the stored net column are identical.');
    }

    process.exit(ok ? 0 : 1);
}

main().catch((err) => {
    console.error('[verify_live_parity]', err.message);
    process.exit(1);
});
