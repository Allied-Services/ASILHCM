'use strict';

const { buildWorldAPayslipData } = require('../src/modules/payslip/dataBuilder');
const { renderPayslipHtml, renderEmailCoverHtml } = require('../src/modules/payslip/template');

describe('payslip HTML layout — no duplicate OT/reimb panels', () => {
    test('earnings → gross → deductions → net, without Overtime Detail / Reimbursements cards', () => {
        const data = buildWorldAPayslipData(
            { id: 'ASIL-TEST', name: 'Layout Test', salary: 65000, cnic: '4210112345678' },
            {
                paid_days: 26, ot2_hrs: 12, ot3_hrs: 4, opd_claim: 3500, reimbursement: 2200,
                special_allowance: 1500, fuel_mobile: 1000, wht: 780, eobi_ee: 400, net: 83270,
            },
            'None'
        );
        const html = renderPayslipHtml(data, { year: 2026, month: 7 });

        expect(html).toContain('GROSS TOTAL');
        expect(html).toContain('Deductions');
        expect(html).toContain('Net Salary Payable');
        expect(html).toContain('Overtime 2X (12 hrs)');
        expect(html).toContain('Medical Reimbursement (OPD)');
        expect(html).not.toContain('Overtime Detail');
        expect(html).not.toContain('Total Overtime');
        expect(html).not.toContain('Total Reimbursements');
        expect(html).not.toContain('summary-strip');
        expect(html).not.toContain('Tax Deductions');
        expect(html).not.toContain('Other Deductions');
        expect(html).not.toContain('Paid Days:');
        expect(html).not.toContain('paid-days-badge');
        expect(html).toContain('alt="Allied Services logo"');
        expect(html).toContain('data:image/png;base64,');
        expect(html.indexOf('GROSS TOTAL')).toBeLessThan(html.indexOf('Deductions'));
        expect(html.indexOf('Deductions')).toBeLessThan(html.indexOf('Net Salary Payable'));
    });

    test('email cover has no portal URL', () => {
        const html = renderEmailCoverHtml({
            emp: { name: 'Layout Test' },
            monthName: 'August',
            year: 2026,
            frontendUrl: 'http://localhost:5173',
            netPay: 40000,
        });
        expect(html).toContain('Dear Layout Test');
        expect(html).toContain('password-protected PDF');
        expect(html).not.toContain('Portal:');
        expect(html).not.toContain('localhost');
        expect(html).not.toContain('5173');
    });
});
