'use strict';

const { buildWorldAPayslipData } = require('../src/modules/payslip/dataBuilder');
const { renderPayslipHtml } = require('../src/modules/payslip/template');

describe('payslip HTML layout (Payroll Sheet / Generate Payslips)', () => {
    const emp = {
        id: 'ASIL-TEST',
        name: 'Layout Test',
        salary: 65000,
        cnic: '4210112345678',
        designation: 'Analyst',
        client: 'Wafi',
        location: 'Karachi',
        bank_name: 'HBL',
        bank_account: '123456',
    };
    const pay = {
        paid_days: 26,
        ot2_hrs: 12,
        ot3_hrs: 4,
        opd_claim: 3500,
        reimbursement: 2200,
        special_allowance: 1500,
        fuel_mobile: 1000,
        wht: 780,
        eobi_ee: 400,
        net: 83270,
    };

    test('earnings → gross → deductions → net, with no OT/reimb detail cards', () => {
        const data = buildWorldAPayslipData(emp, pay, 'None');
        const html = renderPayslipHtml(data, { year: 2026, month: 7 });

        expect(html).toContain('Earnings &amp; Additions');
        expect(html).toContain('GROSS TOTAL');
        expect(html).toContain('Deductions');
        expect(html).toContain('NET SALARY PAYABLE');
        expect(html).toContain('Overtime 2X (12 hrs)');
        expect(html).toContain('Medical Reimbursement (OPD)');
        expect(html).toContain('Expense Reimbursement');

        // Historical Basic/HRA split and duplicate detail cards must not appear
        expect(html).not.toContain('Basic Salary');
        expect(html).not.toContain('House Rent Allowance');
        expect(html).not.toContain('OVERTIME DETAIL');
        expect(html).not.toContain('Total Overtime');
        expect(html).not.toContain('Total Reimbursements');

        const grossAt = html.indexOf('GROSS TOTAL');
        const dedAt = html.indexOf('Deductions');
        const netAt = html.indexOf('NET SALARY PAYABLE');
        expect(grossAt).toBeGreaterThan(-1);
        expect(dedAt).toBeGreaterThan(grossAt);
        expect(netAt).toBeGreaterThan(dedAt);
    });
});
