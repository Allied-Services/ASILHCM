'use strict';

/**
 * Bank-file readiness for locked Payroll Sheet rows.
 * HBL Checker and IBFT files are refused until account + mobile are complete.
 */

const { firstValidPkMobile } = require('../../lib/sms');
const { isHblSameBank } = require('./hblSameExport');
const { resolveBankCode } = require('./hblOtherExport');

const ISSUE_LABELS = {
    missing_bank_name: 'bank name',
    missing_account: 'account number',
    account_too_short: 'account number too short',
    missing_account_title: 'account title',
    missing_phone: 'mobile (03XXXXXXXXX)',
    missing_bank_code: 'other-bank code / IBAN',
};

const BLOCKING = new Set([
    'missing_bank_name',
    'missing_account',
    'account_too_short',
    'missing_phone',
    'missing_bank_code',
]);

function str(v) {
    return String(v == null ? '' : v).trim();
}

function accountDigits(raw) {
    return String(raw || '').replace(/\s+/g, '');
}

function assessBankReadiness(emp = {}) {
    const issues = [];
    const bankName = str(emp.bank_name || emp.bankName);
    const account = accountDigits(emp.bank_account || emp.bankAccount);
    const title = str(emp.account_title || emp.accountTitle);
    const phone = firstValidPkMobile(
        emp.primary_contact || emp.primaryContact || emp.contact || ''
    );

    if (!bankName) issues.push('missing_bank_name');
    if (!account) issues.push('missing_account');
    else if (account.length < 8) issues.push('account_too_short');
    if (!title) issues.push('missing_account_title');
    if (!phone) issues.push('missing_phone');
    if (bankName && !isHblSameBank(bankName) && !resolveBankCode({
        bank_name: bankName,
        bankName,
        bank_account: account,
        bankAccount: account,
    })) {
        issues.push('missing_bank_code');
    }

    const blocking = issues.filter((i) => BLOCKING.has(i));
    return {
        ok: blocking.length === 0,
        issues,
        blocking,
        labels: issues.map((i) => ISSUE_LABELS[i] || i),
        phone,
        account,
        bankName,
        title,
    };
}

function summarizeEmployees(emps) {
    const employees = (emps || []).map((e) => {
        const a = assessBankReadiness(e);
        return {
            id: e.id || e.employee_id,
            name: e.name || null,
            client: e.client || null,
            contract: e.contract_name || e.contract || null,
            location: e.location || null,
            locked: e.locked === true,
            bank_name: a.bankName,
            bank_account: a.account,
            phone: a.phone || str(e.primary_contact || e.primaryContact || e.contact),
            ok: a.ok,
            issues: a.issues,
            labels: a.labels,
        };
    });
    const incompleteEmployees = employees.filter((e) => !e.ok);
    return {
        ready: employees.length - incompleteEmployees.length,
        incomplete: incompleteEmployees.length,
        employees,
        incomplete_employees: incompleteEmployees,
    };
}

function incompleteBankPayload(emps) {
    const summary = summarizeEmployees(emps);
    return {
        error: `${summary.incomplete} locked employee(s) are missing a bank account or mobile. The bank file was not produced.`,
        code: 'BANK_DETAILS_INCOMPLETE',
        ready: summary.ready,
        incomplete: summary.incomplete,
        employees: summary.incomplete_employees,
    };
}

async function loadPayrollBankReadiness(pool, {
    year,
    month,
    client,
    contract,
} = {}) {
    const yr = parseInt(year, 10);
    const mo = parseInt(month, 10);
    if (!yr || !mo || mo < 1 || mo > 12) {
        const err = new Error('Invalid year/month');
        err.status = 400;
        throw err;
    }
    const params = [yr, mo];
    const where = ['pt.year = $1', 'pt.month = $2'];
    if (client && client !== 'All') {
        params.push(client);
        where.push(`COALESCE(pt.client, e.client) = $${params.length}`);
    }
    if (contract && contract !== 'All') {
        params.push(contract);
        where.push(`COALESCE(pt.contract_name, e.contract_name) = $${params.length}`);
    }
    const { rows } = await pool.query(
        `SELECT e.id, e.name, e.client, e.contract_name, e.location,
                e.bank_name, e.bank_account, e.account_title, e.primary_contact,
                pt.locked
         FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE ${where.join(' AND ')}
         ORDER BY e.name NULLS LAST`,
        params
    );
    return {
        year: yr,
        month: mo,
        ...summarizeEmployees(rows),
    };
}

module.exports = {
    ISSUE_LABELS,
    assessBankReadiness,
    summarizeEmployees,
    incompleteBankPayload,
    loadPayrollBankReadiness,
};
