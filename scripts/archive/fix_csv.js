const fs = require('fs');
const file = 'G:/My Drive/Experiments/BPOFMSystem/backend/server.js';
let content = fs.readFileSync(file, 'utf8');

// Build the new return object with correct column order (EOSB at column H, no Bonus Cash)
// We replace only the return object body, keeping surrounding structure intact
const oldReturnBody = [
    "                    'Month': monthLabel, 'Employee ID': emp.id, 'Name': emp.name,",
    "                    'CNIC': cnic(emp), 'Contract': emp.contract_name || bu(emp),",
    "                    'Location': emp.location||'', 'Province': emp.province||'',",
    "                    'Gross Salary': parseFloat(emp.salary)||0, 'Paid Days': c.pd,",
    "                    'OT @2X Hrs': c.ot2hrs, 'OT @3X Hrs': c.ot3hrs, 'OT Amount': c.otAmt,",
    "                    'OPD Claim': c.opd, 'Reimbursement': c.reimb, 'Arrears': c.arr,",
    "                    // Bug fix: Other Allowances was calculated but not exported",
    "                    'Other Allowances': c.other,",
    "                    'Spl Allowance': c.spl, 'Fuel/Mobile': c.fuel, 'Bonus (Cash)': c.bonus,",
    "                    'Gross Monthly': c.grossM,",
    "                    'Income Tax (WHT)': c.wht,",
    "                    'EOBI Employee (Rs.400)': c.eobi_ee,",
    "                    'PF Employee Deduction': c.pfDed,",
    "                    'Advance Deduction': c.advDed,",
    "                    'Loan Deduction': c.loanDed,",
    "                    'Other Deduction': c.otherDed,",
    "                    'Total Deductions': c.totalDed,",
    "                    'Net Pay to Employee': c.netPay,",
    "                    'EOBI Employer (Rs.2000)': c.eobi_er,",
    "                    'PF Employer Contribution': c.pfER,",
    "                    'Gratuity Accrual': c.gratuity,",
    "                    'EOSB Scheme': c.eosbType || 'None',",
    "                    'SESSI': c.sessi,",
    "                    'Life Insurance': c.lifeIns,",
    "                    'Medical (Employee)': c.medEE,",
    "                    'Medical (Spouse)': c.medSP,",
    "                    'Medical (Child 1)': c.medCh1,",
    "                    'Medical (Child 2)': c.medCh2,",
    "                    'Bonus Accrual (Monthly)': c.bonusAccrual,",
    "                    'Overhead (Fixed per Contract)': c.overhead,",
    "                    'Total Employer Cost': c.costBase,",
    "                    'Service Charges': c.sc,",
    "                    'Sales Tax': c.st,",
    "                    'Total Invoice Amount': c.inv,",
].join('\r\n');

const newReturnBody = [
    "                    'Month':             monthLabel,",
    "                    'Employee ID':       emp.id,",
    "                    'Name':             emp.name,",
    "                    'CNIC':             cnic(emp),",
    "                    'Contract':         emp.contract_name || bu(emp),",
    "                    'Location':         emp.location || '',",
    "                    'Province':         emp.province || '',",
    "                    // Column H -- per MD instruction",
    "                    'EOSB Scheme':      c.eosbType || 'None',",
    "                    // Salary & Earnings",
    "                    'Gross Salary':     parseFloat(emp.salary) || 0,",
    "                    'Paid Days':        c.pd,",
    "                    'OT @2X Hrs':       c.ot2hrs,",
    "                    'OT @3X Hrs':       c.ot3hrs,",
    "                    'OT Amount':        c.otAmt,",
    "                    'OPD Claim':        c.opd,",
    "                    'Reimbursement':    c.reimb,",
    "                    'Arrears':          c.arr,",
    "                    'Other Allowances': c.other,",
    "                    'Spl Allowance':    c.spl,",
    "                    'Fuel/Mobile':      c.fuel,",
    "                    'Gross Monthly':    c.grossM,",
    "                    // Employee Deductions",
    "                    'Income Tax (WHT)':         c.wht,",
    "                    'EOBI Employee (Rs.400)':   c.eobi_ee,",
    "                    'PF Employee Deduction':    c.pfDed,",
    "                    'Advance Deduction':        c.advDed,",
    "                    'Loan Deduction':           c.loanDed,",
    "                    'Other Deduction':          c.otherDed,",
    "                    'Total Deductions':         c.totalDed,",
    "                    'Net Pay to Employee':      c.netPay,",
    "                    // Employer Costs",
    "                    'EOBI Employer (Rs.2000)':  c.eobi_er,",
    "                    'PF Employer Contribution': c.pfER,",
    "                    'Gratuity Accrual':         c.gratuity,",
    "                    'SESSI':                    c.sessi,",
    "                    'Life Insurance':           c.lifeIns,",
    "                    'Medical (Employee)':       c.medEE,",
    "                    'Medical (Spouse)':         c.medSP,",
    "                    'Medical (Child 1)':        c.medCh1,",
    "                    'Medical (Child 2)':        c.medCh2,",
    "                    'Bonus Accrual (Monthly)':  c.bonusAccrual,",
    "                    'Overhead (Fixed per Contract)': c.overhead,",
    "                    'Total Employer Cost':      c.costBase,",
    "                    // Invoice",
    "                    'Service Charges':          c.sc,",
    "                    'Sales Tax':                c.st,",
    "                    'Total Invoice Amount':     c.inv,",
].join('\r\n');

if (!content.includes(oldReturnBody)) {
    console.error('ERROR: Exact pattern not found. Checking partial match...');
    // Show first 100 chars of what we expect vs what's there
    const idx = content.indexOf("'Month': monthLabel");
    if (idx > -1) {
        console.log('Found Month line at idx:', idx);
        console.log('Content around it:', JSON.stringify(content.slice(idx, idx + 150)));
    }
    process.exit(1);
}

const patched = content.replace(oldReturnBody, newReturnBody);
fs.writeFileSync(file, patched, 'utf8');
console.log('SUCCESS: CSV block patched.');
console.log('  - EOSB Scheme moved to column H');
console.log('  - Bonus (Cash) removed');
