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
            ot3_hrs: 0,
            wht: 1000,
            eobi_ee: 400,
            net: 50000,
        };
        const data = buildWorldAPayslipData(emp, pay, 'None');
        const labels = data.additions.map(a => a.label);
        expect(labels.some(l => l.includes('Gross Salary'))).toBe(true);
        expect(labels.some(l => l.includes('Basic'))).toBe(false);
        expect(labels.some(l => l.includes('Overtime'))).toBe(true);
        expect(data.netPay).toBe(50000);
    });

    test('overtime and reimbursements appear only in earnings — no duplicate detail blocks', () => {
        const emp = { id: 'ASIL-1', name: 'Test', salary: 65000, cnic: '4210112345678' };
        const pay = {
            paid_days: 26,
            ot2_hrs: 12,
            ot3_hrs: 4,
            opd_claim: 3500,
            reimbursement: 2200,
            special_allowance: 1500,
            fuel_mobile: 1000,
            wht: 0,
            eobi_ee: 400,
            net: 84050,
        };
        const data = buildWorldAPayslipData(emp, pay, 'None');
        const labels = data.additions.map(a => a.label);
        expect(labels).toContain('Overtime 2X (12 hrs)');
        expect(labels).toContain('Overtime 3X (4 hrs)');
        expect(labels).toContain('Medical Reimbursement (OPD)');
        expect(labels).toContain('Expense Reimbursement');
        // Single earnings list — OT hours are not duplicated as a second block
        expect(labels.filter(l => l.startsWith('Overtime')).length).toBe(2);
        expect(data.grossTotal - data.totalDeductions).toBe(data.netPay);
    });
});
