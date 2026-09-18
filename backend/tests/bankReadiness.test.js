'use strict';

const fs = require('fs');
const path = require('path');
const {
    assessBankReadiness,
    incompleteBankPayload,
    summarizeEmployees,
} = require('../src/payroll/bankReadiness');

describe('assessBankReadiness', () => {
    const readyHbl = {
        id: 'ASIL/PSO-1',
        name: 'Ready Person',
        bank_name: 'HBL',
        bank_account: '05627900214003',
        account_title: 'Ready Person',
        primary_contact: '0303-3519952',
    };

    test('HBL row with account and 03 mobile is ready', () => {
        const r = assessBankReadiness(readyHbl);
        expect(r.ok).toBe(true);
        expect(r.issues).toEqual([]);
        expect(r.phone).toBe('03033519952');
    });

    test('other-bank IBAN supplies the bank code', () => {
        const r = assessBankReadiness({
            ...readyHbl,
            bank_name: 'MCB',
            bank_account: 'PK81MUCB0729601211002407',
        });
        expect(r.ok).toBe(true);
        expect(r.issues).not.toContain('missing_bank_code');
    });

    test('missing account or mobile is not ready', () => {
        expect(assessBankReadiness({ ...readyHbl, bank_account: '' }).ok).toBe(false);
        expect(assessBankReadiness({ ...readyHbl, primary_contact: '0515505605' }).issues)
            .toContain('missing_phone');
        expect(assessBankReadiness({ ...readyHbl, bank_name: '' }).issues)
            .toContain('missing_bank_name');
    });

    test('other bank without IBAN or stored code is incomplete', () => {
        const r = assessBankReadiness({
            ...readyHbl,
            bank_name: 'Unknown Rural Bank',
            bank_account: '12345678901234',
        });
        expect(r.ok).toBe(false);
        expect(r.issues).toContain('missing_bank_code');
    });

    test('account title missing is listed but does not block the file', () => {
        const r = assessBankReadiness({ ...readyHbl, account_title: '' });
        expect(r.issues).toContain('missing_account_title');
        expect(r.ok).toBe(true);
    });

    test('incompleteBankPayload is 422-shaped and lists only blockers', () => {
        const payload = incompleteBankPayload([
            readyHbl,
            { ...readyHbl, id: 'ASIL/PSO-2', name: 'No Phone', primary_contact: '' },
        ]);
        expect(payload.code).toBe('BANK_DETAILS_INCOMPLETE');
        expect(payload.incomplete).toBe(1);
        expect(payload.ready).toBe(1);
        expect(payload.employees).toHaveLength(1);
        expect(payload.employees[0].id).toBe('ASIL/PSO-2');
        expect(payload.error).toMatch(/not produced/i);
    });

    test('summarizeEmployees counts ready vs incomplete', () => {
        const s = summarizeEmployees([
            readyHbl,
            { ...readyHbl, id: 'X', bank_account: '' },
        ]);
        expect(s.ready).toBe(1);
        expect(s.incomplete).toBe(1);
    });
});

describe('HBL export and payslip send include PSO locked rows', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const payslipSrc = fs.readFileSync(path.join(__dirname, '../src/modules/payslip/service.js'), 'utf8');

    test('HBL same/other export refuse incomplete bank details', () => {
        const start = serverSrc.indexOf("type === 'hbl_same'");
        const block = serverSrc.slice(start, start + 2500);
        expect(block).toMatch(/BANK_DETAILS_INCOMPLETE|incompleteBankPayload/);
        expect(block).toMatch(/hbl_other/);
        expect(block).toMatch(/assessBankReadiness/);
    });

    test('payslip readiness has no Wafi-only client filter', () => {
        const start = payslipSrc.indexOf('async function getPayslipReadiness');
        const block = payslipSrc.slice(start, start + 1800);
        expect(block).toMatch(/FROM payroll_transactions pt/);
        expect(block).toMatch(/pt\.locked = TRUE/);
        expect(block).not.toMatch(/wafi/i);
        expect(block).not.toMatch(/e\.client\s*=/i);
    });
});
