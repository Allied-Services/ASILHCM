'use strict';

const { buildWorldAPayslipData, normalizeCnic } = require('../src/modules/payslip/dataBuilder');
const { buildSmsMessage, payslipPdfLink, backendBase } = require('../src/modules/payslip/service');

describe('payslip dataBuilder', () => {
    test('normalizeCnic strips dashes', () => {
        expect(normalizeCnic('42101-1234567-8')).toBe('4210112345678');
    });

    test('buildWorldAPayslipData uses gross salary line not basic split', () => {
        const emp = { id: 'ASIL-1', name: 'Test', salary: 52000, cnic: '4210112345678' };
        const pay = {
            paid_days: 26,
            ot2_hrs: 4,
            ot3_hrs: 2,
            opd_claim: 1000,
            reimbursement: 500,
            wht: 1000,
            eobi_ee: 400,
            net: 50000,
        };
        const data = buildWorldAPayslipData(emp, pay, 'None');
        const labels = data.additions.map(a => a.label);
        expect(labels.some(l => l.includes('Gross Salary'))).toBe(true);
        expect(labels.some(l => l.includes('Basic'))).toBe(false);
        expect(labels.some(l => l.includes('Overtime 2X'))).toBe(true);
        expect(labels.some(l => l.includes('Overtime 3X'))).toBe(true);
        expect(labels.some(l => l.includes('Medical Reimbursement'))).toBe(true);
        expect(labels.some(l => l.includes('Expense Reimbursement'))).toBe(true);
        expect(data.overtime.ot2Hrs).toBe(4);
        expect(data.overtime.ot3Hrs).toBe(2);
        expect(data.overtime.otAmount).toBe(data.overtime.ot2Amount + data.overtime.ot3Amount);
        expect(data.reimbursements.medical).toBe(1000);
        expect(data.reimbursements.expense).toBe(500);
        expect(data.taxDeductions).toBe(1000);
        expect(data.netPay).toBe(50000);
    });
});

describe('payslip SMS message', () => {
    const token = 'a'.repeat(32);

    test('includes direct PDF link and CNIC password, no salary/OT amounts', () => {
        process.env.APP_BASE_URL = 'https://asilhcm.onrender.com';
        delete process.env.BACKEND_URL;
        const sms = buildSmsMessage(token);
        const link = payslipPdfLink(token);
        expect(link).toBe(`${backendBase()}/api/payslip/link/${token}`);
        expect(sms).toContain(link);
        expect(sms).toMatch(/Password: CNIC \(13 digits, no dashes\)/);
        expect(sms).not.toMatch(/Rs\.|salary|OT|overtime|net/i);
        expect(sms.length).toBeLessThanOrEqual(160);
    });

    test('stays within 160 chars on staging backend host', () => {
        process.env.APP_BASE_URL = 'https://asil-hcm-staging.onrender.com';
        const sms = buildSmsMessage(token);
        expect(sms).toContain('/api/payslip/link/');
        expect(sms.length).toBeLessThanOrEqual(160);
    });
});
