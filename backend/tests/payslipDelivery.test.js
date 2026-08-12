'use strict';

const { buildWorldAPayslipData, normalizeCnic } = require('../src/modules/payslip/dataBuilder');
const { buildSmsMessage, payslipPdfLink, backendBase } = require('../src/modules/payslip/service');
const { renderPayslipHtml } = require('../src/modules/payslip/template');

describe('payslip dataBuilder', () => {
    test('normalizeCnic strips dashes', () => {
        expect(normalizeCnic('42101-1234567-8')).toBe('4210112345678');
    });

    test('snapshot payslip shows full gross + absent deduction and keeps net', () => {
        const emp = { id: 'ASILFM/SPL/22/79', name: 'Nisar', salary: 40000, cnic: '4240192494053' };
        const pay = {
            year: 2026,
            month: 7,
            paid_days: 27.1,
            other_deduction: 1667,
            wht: 0,
            eobi_ee: 400,
            net: 34062,
            computed_json: {
                basicPaid: 36129,
                grossMonthly: 36129,
                netPay: 34062,
                incomeTax: 0,
                eobi_ee: 400,
                pfEE: 0,
                advanceDed: 0,
                loanDed: 0,
                ot2hrs: 0,
                ot3hrs: 0,
                otAmount: 0,
                opdClaim: 0,
                reimb: 0,
                arrears: 0,
                splAllow: 0,
                fuelMob: 0,
                bonusDisbursed: 0,
                pd: 27.1,
                absentDays: 0,
                absenceDeduction: 0,
            },
        };
        const data = buildWorldAPayslipData(emp, pay, 'None');
        const grossLine = data.additions.find(a => a.label === 'Gross Salary');
        const absentLine = data.deductions.find(d => String(d.label).startsWith('Absent Deductions'));
        expect(grossLine.amount).toBe(40000);
        expect(absentLine).toBeTruthy();
        expect(absentLine.label).toMatch(/3 days/);
        expect(absentLine.amount).toBeCloseTo(3870.97, 1);
        expect(data.netPay).toBe(34062);
        expect(data.grossTotal - data.totalDeductions).toBeCloseTo(data.netPay, 1);
        expect(data.paidDays).toBe(28);
        expect(data.workingDays).toBe(31);

        const html = renderPayslipHtml(data, { year: 2026, month: 7 });
        expect(html).toContain('Absent Deductions (3 days)');
        expect(html).not.toContain('Paid Days:');
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

describe('sendPayslips selection scope', () => {
    const { sendPayslips } = require('../src/modules/payslip/service');

    test('rejects empty selection without sendAll', async () => {
        const pool = { query: jest.fn() };
        await expect(sendPayslips(pool, {}, {
            year: 2026, month: 7, confirm: true, employeeIds: [], sendAll: false,
        })).rejects.toMatchObject({ code: 'SELECTION_REQUIRED' });
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('rejects send when selected employee is unlocked', async () => {
        const pool = {
            query: jest.fn(async (sql) => {
                const s = String(sql);
                if (s.includes('FROM payment_batches')) {
                    return { rows: [{ id: 'b1', status: 'Confirmed' }] };
                }
                if (s.includes('SELECT employee_id, locked')) {
                    return { rows: [{ employee_id: 'E1', locked: false }] };
                }
                return { rows: [] };
            }),
        };
        await expect(sendPayslips(pool, {}, {
            year: 2026, month: 7, confirm: true, employeeIds: ['E1'], sendAll: false,
        })).rejects.toMatchObject({ code: 'NOT_ALL_LOCKED' });
    });
});
