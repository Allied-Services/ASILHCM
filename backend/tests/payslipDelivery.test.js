'use strict';

jest.mock('../src/modules/payslip/pdfProtect', () => ({
    buildProtectedPayslipPdf: jest.fn(async () => Buffer.from('%PDF-fake')),
}));

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

describe('payslip contact validation', () => {
    const { isUsableEmail } = require('../src/modules/payslip/service');
    const { firstValidPkMobile } = require('../lib/sms');

    test('rejects placeholder emails', () => {
        expect(isUsableEmail('N/A')).toBe('');
        expect(isUsableEmail('A.Ahmed-Contractor@wafi-energy.com')).toBe('A.Ahmed-Contractor@wafi-energy.com');
    });

    test('accepts first valid PK mobile and rejects N/A', () => {
        expect(firstValidPkMobile('N/A')).toBe('');
        expect(firstValidPkMobile('0300-1234567')).toBe('03001234567');
        expect(firstValidPkMobile('0313-4468633/0313-5536560')).toBe('03134468633');
    });

    test('send query does not select nonexistent employees.contact / employees.contract', () => {
        const fs = require('fs');
        const path = require('path');
        const src = fs.readFileSync(path.join(__dirname, '../src/modules/payslip/service.js'), 'utf8');
        expect(src).not.toMatch(/e\.contact\b/);
        expect(src).not.toMatch(/e\.contract,/);
        expect(src).toMatch(/e\.primary_contact/);
        expect(src).toMatch(/e\.contract_name/);
    });
});

describe('sendPayslips selection scope', () => {
    const { sendPayslips, getPayslipReadiness, getPaidEmployeeIds } = require('../src/modules/payslip/service');

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
                if (s.includes('SELECT employee_id, locked')) {
                    return { rows: [{ employee_id: 'E1', locked: false }] };
                }
                if (s.includes('FROM payment_ledger')) {
                    return { rows: [{ employee_id: 'E1' }] };
                }
                return { rows: [] };
            }),
        };
        await expect(sendPayslips(pool, {}, {
            year: 2026, month: 7, confirm: true, employeeIds: ['E1'], sendAll: false,
        })).rejects.toMatchObject({ code: 'NOT_ALL_LOCKED' });
    });

    test('rejects scoped send when one selected employee has no SALARY ledger row', async () => {
        const pool = {
            query: jest.fn(async (sql) => {
                const s = String(sql);
                if (s.includes('SELECT employee_id, locked')) {
                    return { rows: [
                        { employee_id: 'E1', locked: true },
                        { employee_id: 'E2', locked: true },
                    ] };
                }
                if (s.includes('FROM payment_ledger')) {
                    return { rows: [{ employee_id: 'E1' }] };
                }
                return { rows: [] };
            }),
        };
        await expect(sendPayslips(pool, {}, {
            year: 2026, month: 7, confirm: true, employeeIds: ['E1', 'E2'], sendAll: false,
        })).rejects.toMatchObject({
            code: 'NOT_PAID',
            detail: { unpaid: ['E2'] },
        });
    });

    test('proceeds past paid gate when every selected employee has a SALARY ledger row', async () => {
        const pool = {
            query: jest.fn(async (sql) => {
                const s = String(sql);
                if (s.includes('SELECT employee_id, locked')) {
                    return { rows: [{ employee_id: 'E1', locked: true }] };
                }
                if (s.includes('FROM payment_ledger')) {
                    return { rows: [{ employee_id: 'E1' }] };
                }
                if (s.includes('COUNT(*)::int AS total')) {
                    return { rows: [{ total: 1, locked_count: 1 }] };
                }
                if (s.includes('AS phone')) {
                    return { rows: [{ id: 'E1', name: 'Emp 1', email: 'e1@x.test', phone: '03001234567', cnic: '4210112345678', locked: true }] };
                }
                if (s.includes('FROM payslip_delivery_batches') && s.includes('SELECT id, status')) {
                    return { rows: [] };
                }
                if (s.includes('INSERT INTO payslip_delivery_batches')) {
                    return { rows: [{ id: 99 }] };
                }
                if (s.includes('ANY($4::text[])')) {
                    return { rows: [{
                        id: 'E1', name: 'Emp 1', email: 'e1@x.test', primary_contact: '03001234567',
                        contact: '03001234567', cnic: '4210112345678', designation: 'Guard',
                        client: 'C', location: 'Karachi', bank_name: 'HBL', bank_account: '1',
                        contract_name: 'CTR', contract: 'CTR', salary: 40000,
                        paid_days: 31, gross: 40000, net: 38000, ot2_hrs: 0, ot3_hrs: 0,
                        opd_claim: 0, reimbursement: 0, arrears: 0, special_allowance: 0,
                        fuel_mobile: 0, bonus_amount: 0, wht: 0, eobi_ee: 400,
                        advance_deduction: 0, loan_deduction: 0, other_deduction: 0,
                        locked: true, year: 2026, month: 7, computed_json: null,
                    }] };
                }
                if (s.includes('INSERT INTO payslip_documents')) {
                    return { rows: [{ id: 1, pdf_bytes: Buffer.from('pdf') }] };
                }
                if (s.includes('INSERT INTO payslip_delivery_log')) {
                    return { rows: [] };
                }
                if (s.includes('UPDATE payslip_delivery_batches')) {
                    return { rows: [] };
                }
                if (s.includes("SET paid_on")) {
                    return { rows: [] };
                }
                if (s.includes('eosb_type')) {
                    return { rows: [{ eosb_type: 'None' }] };
                }
                return { rows: [] };
            }),
        };
        const result = await sendPayslips(pool, {}, {
            year: 2026, month: 7, confirm: true, employeeIds: ['E1'], sendAll: false,
        });
        expect(result.ok).toBe(true);
        expect(result.total).toBe(1);
        const recipientSql = pool.query.mock.calls
            .map((c) => String(c[0]))
            .find((s) => s.includes('FROM payroll_transactions pt') && s.includes('AND e.id = ANY($4::text[])'));
        expect(recipientSql).toBeTruthy();
        const recipientParams = pool.query.mock.calls.find((c) => String(c[0]) === recipientSql)[1];
        expect(recipientParams[3]).toEqual(['E1']);
    });
});

describe('getPayslipReadiness per-employee paid', () => {
    const { getPayslipReadiness, getPaidEmployeeIds } = require('../src/modules/payslip/service');

    test('getPaidEmployeeIds returns a Set from ledger join', async () => {
        const pool = {
            query: jest.fn(async () => ({ rows: [{ employee_id: 'E1' }, { employee_id: 'E3' }] })),
        };
        const paid = await getPaidEmployeeIds(pool, 2026, 7, ['E1', 'E2', 'E3']);
        expect(paid).toEqual(new Set(['E1', 'E3']));
        expect(String(pool.query.mock.calls[0][0])).toMatch(/payment_ledger/);
        expect(pool.query.mock.calls[0][1]).toEqual([2026, 7, ['E1', 'E2', 'E3']]);
    });

    test('reports paidCount/notPaid and canSend only when every scoped employee is paid', async () => {
        const pool = {
            query: jest.fn(async (sql) => {
                const s = String(sql);
                if (s.includes('COUNT(*)::int AS total')) {
                    return { rows: [{ total: 2, locked_count: 2 }] };
                }
                if (s.includes('FROM payment_ledger')) {
                    return { rows: [{ employee_id: 'E1' }] };
                }
                if (s.includes('FROM payroll_transactions pt') && s.includes('JOIN employees e')) {
                    return { rows: [
                        { id: 'E1', name: 'Paid Emp', email: 'a@x.test', phone: '03001111111', cnic: '4210111111111', locked: true },
                        { id: 'E2', name: 'Unpaid Emp', email: 'b@x.test', phone: '03002222222', cnic: '4210122222222', locked: true },
                    ] };
                }
                if (s.includes('FROM payslip_delivery_batches')) {
                    return { rows: [] };
                }
                return { rows: [] };
            }),
        };
        const r = await getPayslipReadiness(pool, 2026, 7, ['E1', 'E2']);
        expect(r.paid).toBe(false);
        expect(r.paidCount).toBe(1);
        expect(r.notPaid).toEqual([{ id: 'E2', name: 'Unpaid Emp' }]);
        expect(r.employees.find((e) => e.id === 'E1').paid).toBe(true);
        expect(r.employees.find((e) => e.id === 'E2').paid).toBe(false);
        expect(r.canSend).toBe(false);
        expect(r.allLocked).toBe(true);
        expect(r.paidIds).toEqual(['E1']);
        expect(r.emailSentCount).toBe(0);
        expect(r.smsSentCount).toBe(0);
        expect(r.remainingEmail).toEqual([{ id: 'E1', name: 'Paid Emp' }]);
        expect(r.needsForceResend).toBe(false);
    });

    test('counts Email/SMS sent and remaining from latest delivery log', async () => {
        const pool = {
            query: jest.fn(async (sql) => {
                const s = String(sql);
                if (s.includes('COUNT(*)::int AS total')) {
                    return { rows: [{ total: 2, locked_count: 2 }] };
                }
                if (s.includes('FROM payment_ledger')) {
                    return { rows: [{ employee_id: 'E1' }, { employee_id: 'E2' }] };
                }
                if (s.includes('FROM payroll_transactions pt') && s.includes('JOIN employees e')) {
                    return { rows: [
                        { id: 'E1', name: 'Has Email', email: 'a@x.test', phone: '03001111111', cnic: '4210111111111', locked: true },
                        { id: 'E2', name: 'Sms Only', email: 'N/A', phone: '03002222222', cnic: '4210122222222', locked: true },
                    ] };
                }
                if (s.includes('FROM payslip_delivery_batches')) {
                    return { rows: [{ id: 1, status: 'sent', sent_at: '2026-08-14T20:00:00Z' }] };
                }
                if (s.includes('DISTINCT ON (l.employee_id)')) {
                    return { rows: [
                        { employee_id: 'E1', email_status: 'sent', sms_status: 'skipped' },
                        { employee_id: 'E2', email_status: 'skipped', sms_status: 'sent' },
                    ] };
                }
                return { rows: [] };
            }),
        };
        const r = await getPayslipReadiness(pool, 2026, 7, []);
        expect(r.emailSentCount).toBe(1);
        expect(r.smsSentCount).toBe(1);
        expect(r.alreadyDeliveredCount).toBe(2);
        expect(r.remainingEmail).toEqual([]);
        expect(r.remainingSms.map((e) => e.id)).toEqual(['E1']);
        expect(r.needsForceResend).toBe(false);
        expect(r.employees.find((e) => e.id === 'E1').emailStatus).toBe('sent');
        expect(r.employees.find((e) => e.id === 'E2').smsStatus).toBe('sent');
    });
});

describe('sendPayslips remaining channel', () => {
    const { sendPayslips } = require('../src/modules/payslip/service');

    function mockPool({ lockRows, paidIds, employees, batch, deliveries, targets }) {
        return {
            query: jest.fn(async (sql) => {
                const s = String(sql);
                if (s.includes('SELECT employee_id, locked')) {
                    return { rows: lockRows };
                }
                if (s.includes('FROM payment_ledger')) {
                    return { rows: paidIds.map((employee_id) => ({ employee_id })) };
                }
                if (s.includes('COUNT(*)::int AS total')) {
                    return { rows: [{ total: employees.length, locked_count: employees.length }] };
                }
                if (s.includes('AS phone')) {
                    return { rows: employees };
                }
                if (s.includes('FROM payslip_delivery_batches') && s.includes('SELECT id, status')) {
                    return { rows: batch ? [batch] : [] };
                }
                if (s.includes('DISTINCT ON (l.employee_id)')) {
                    return { rows: deliveries };
                }
                if (s.includes('INSERT INTO payslip_delivery_batches')) {
                    return { rows: [{ id: 99 }] };
                }
                if (s.includes('FROM payroll_transactions pt') && s.includes('e.primary_contact')) {
                    return { rows: targets };
                }
                if (s.includes('INSERT INTO payslip_documents')) {
                    return { rows: [{ id: 1, pdf_bytes: Buffer.from('pdf') }] };
                }
                if (s.includes('INSERT INTO payslip_delivery_log')) {
                    return { rows: [] };
                }
                if (s.includes('WITH latest AS')) {
                    return { rows: [{ delivered: 1, email_count: 1, sms_count: 0, failed_count: 0 }] };
                }
                if (s.includes('UPDATE payslip_delivery_batches')) {
                    return { rows: [] };
                }
                if (s.includes('SET paid_on')) {
                    return { rows: [] };
                }
                if (s.includes('eosb_type')) {
                    return { rows: [{ eosb_type: 'None' }] };
                }
                return { rows: [] };
            }),
        };
    }

    const empRow = {
        id: 'E1', name: 'Emp 1', email: 'e1@x.test', primary_contact: '03001234567',
        phone: '03001234567', cnic: '4210112345678', designation: 'Guard',
        client: 'C', location: 'Karachi', bank_name: 'HBL', bank_account: '1',
        contract_name: 'CTR', salary: 40000, locked: true,
        paid_days: 31, gross: 40000, net: 38000, ot2_hrs: 0, ot3_hrs: 0,
        opd_claim: 0, reimbursement: 0, arrears: 0, special_allowance: 0,
        fuel_mobile: 0, bonus_amount: 0, wht: 0, eobi_ee: 400,
        advance_deduction: 0, loan_deduction: 0, other_deduction: 0,
        year: 2026, month: 7, computed_json: null,
    };

    test('blocks send-all only when no remaining email or SMS', async () => {
        const pool = mockPool({
            lockRows: [{ employee_id: 'E1', locked: true }],
            paidIds: ['E1'],
            employees: [{ ...empRow, phone: '03001234567' }],
            batch: { id: 1, status: 'sent', sent_at: '2026-08-14' },
            deliveries: [{ employee_id: 'E1', email_status: 'sent', sms_status: 'sent' }],
            targets: [empRow],
        });
        await expect(sendPayslips(pool, {}, {
            year: 2026, month: 7, confirm: true, employeeIds: [], sendAll: true,
        })).rejects.toMatchObject({ code: 'ALREADY_SENT' });
    });

    test('onlyMissing email is allowed when SMS already went out', async () => {
        const sendAppEmail = jest.fn(async () => ({ ok: true }));
        const sendJazzSMS = jest.fn(async () => ({ ok: true }));
        const pool = mockPool({
            lockRows: [{ employee_id: 'E1', locked: true }],
            paidIds: ['E1'],
            employees: [{ ...empRow, phone: '03001234567' }],
            batch: { id: 1, status: 'sent', sent_at: '2026-08-14' },
            deliveries: [{ employee_id: 'E1', email_status: 'skipped', sms_status: 'sent' }],
            targets: [empRow],
        });
        const result = await sendPayslips(pool, { sendAppEmail, sendJazzSMS }, {
            year: 2026, month: 7, confirm: true, employeeIds: ['E1'], onlyMissing: 'email',
        });
        expect(result.ok).toBe(true);
        expect(sendAppEmail).toHaveBeenCalledTimes(1);
        expect(sendJazzSMS).not.toHaveBeenCalled();
        expect(result.deliveries[0].smsDetail).toBe('channel_not_requested');
    });
});
