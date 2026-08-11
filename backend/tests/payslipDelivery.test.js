'use strict';

const { buildWorldAPayslipData, normalizeCnic } = require('../src/modules/payslip/dataBuilder');

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
