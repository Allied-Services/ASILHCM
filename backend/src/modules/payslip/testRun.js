'use strict';

const path = require('path');
const fs = require('fs');
const { buildWorldAPayslipData, normalizeCnic } = require('./dataBuilder');
const { renderPayslipHtml, renderEmailCoverHtml, OPS_SUPPORT } = require('./template');
const { buildProtectedPayslipPdf } = require('./pdfProtect');
const { frontendBase } = require('./service');
const { normalisePhone } = require('../../../lib/sms');

const YEAR = 2026;
const MONTH = 7;
const MONTH_NAME = 'July';

function buildSamples(destEmail, destPhone) {
    return [
        {
            emp: {
                id: 'ASIL-TEST-0701',
                name: 'Ahmed Raza Khan',
                designation: 'Facility Supervisor',
                client: 'Wafi Energy',
                location: 'Karachi — Port Qasim',
                cnic: '42101-3344556-7',
                bank_name: 'HBL',
                bank_account: '00123456789012',
                salary: 65000,
                email: destEmail,
                primary_contact: destPhone,
            },
            pay: {
                paid_days: 26, ot2_hrs: 12, ot3_hrs: 4, opd_claim: 3500, reimbursement: 2200,
                arrears: 0, special_allowance: 1500, fuel_mobile: 1000, bonus_amount: 0,
                wht: 1850, eobi_ee: 400, advance_deduction: 2000, loan_deduction: 0, other_deduction: 0,
            },
        },
        {
            emp: {
                id: 'ASIL-TEST-0702',
                name: 'Fatima Noor',
                designation: 'Admin Officer',
                client: 'PSO North Zone',
                location: 'Islamabad — HQ',
                cnic: '61101-9988776-5',
                bank_name: 'Meezan Bank',
                bank_account: '99001122334455',
                salary: 85000,
                email: destEmail,
                primary_contact: destPhone,
            },
            pay: {
                paid_days: 24, ot2_hrs: 6, ot3_hrs: 0, opd_claim: 5000, reimbursement: 1800,
                arrears: 2500, special_allowance: 0, fuel_mobile: 2000, bonus_amount: 5000,
                wht: 4200, eobi_ee: 400, advance_deduction: 0, loan_deduction: 3000, other_deduction: 500,
            },
        },
        {
            emp: {
                id: 'ASIL-TEST-0703',
                name: 'Bilal Hussain',
                designation: 'Security Guard',
                client: 'CORO SS94',
                location: 'Lahore — SS94',
                cnic: '35202-1122334-1',
                bank_name: 'UBL',
                bank_account: '44556677889900',
                salary: 42000,
                email: destEmail,
                primary_contact: destPhone,
            },
            pay: {
                paid_days: 26, ot2_hrs: 20, ot3_hrs: 8, opd_claim: 1200, reimbursement: 800,
                arrears: 0, special_allowance: 0, fuel_mobile: 0, bonus_amount: 0,
                wht: 0, eobi_ee: 400, advance_deduction: 1000, loan_deduction: 0, other_deduction: 0,
            },
        },
        {
            emp: {
                id: 'ASIL-TEST-0704',
                name: 'Sana Iqbal',
                designation: 'Payroll Coordinator',
                client: 'ASIL Head Office',
                location: 'Karachi — HO',
                cnic: '42201-5566778-9',
                bank_name: 'Bank Alfalah',
                bank_account: '77889900112233',
                salary: 110000,
                email: destEmail,
                primary_contact: destPhone,
            },
            pay: {
                paid_days: 26, ot2_hrs: 3, ot3_hrs: 2, opd_claim: 8000, reimbursement: 4500,
                arrears: 0, special_allowance: 5000, fuel_mobile: 3000, bonus_amount: 10000,
                wht: 9800, eobi_ee: 400, advance_deduction: 0, loan_deduction: 5000, other_deduction: 0,
            },
        },
        {
            emp: {
                id: 'ASIL-TEST-0705',
                name: 'Usman Ali Shah',
                designation: 'Technician',
                client: 'Wafi Energy',
                location: 'Hyderabad — Depot',
                cnic: '41303-6677889-2',
                bank_name: 'JazzCash',
                bank_account: '03001234567',
                salary: 48000,
                email: destEmail,
                primary_contact: destPhone,
            },
            pay: {
                paid_days: 22, ot2_hrs: 8, ot3_hrs: 6, opd_claim: 2500, reimbursement: 3200,
                arrears: 1500, special_allowance: 0, fuel_mobile: 500, bonus_amount: 0,
                wht: 650, eobi_ee: 400, advance_deduction: 0, loan_deduction: 1500, other_deduction: 250,
            },
        },
    ];
}

function buildSms(emp, data) {
    const net = data.netPay.toLocaleString('en-PK');
    const ot = data.overtime;
    const msg = `ASIL TEST: ${MONTH_NAME} ${YEAR} payslip for ${emp.name}. Net Rs.${net}. OT2 ${ot.ot2Hrs}h/OT3 ${ot.ot3Hrs}h. PDF emailed. Password: CNIC. ${OPS_SUPPORT}`;
    return msg.length <= 160
        ? msg
        : `ASIL TEST: ${MONTH_NAME} ${YEAR} payslip (${emp.id}) Net Rs.${net}. Check email. Password: CNIC. ${OPS_SUPPORT}`.slice(0, 160);
}

/**
 * Generate 5 sample July payslips and optionally email + SMS to fixed QA destinations.
 */
async function runJulyPayslipTestDelivery(deps, opts = {}) {
    const {
        destEmail = 'shezad.mumtaz@asil.com.pk',
        destPhone = '03008275688',
        dryRun = false,
        artifactDir = null,
    } = opts;
    const { sendAppEmail, sendJazzSMS } = deps;

    if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });

    const samples = buildSamples(destEmail, destPhone);
    const results = [];

    for (const sample of samples) {
        const { emp, pay } = sample;
        const data = buildWorldAPayslipData(emp, pay, 'None');
        data.netPay = data.grossTotal - data.totalDeductions;
        pay.net = data.netPay;

        const html = renderPayslipHtml(data, { year: YEAR, month: MONTH });
        if (artifactDir) {
            fs.writeFileSync(path.join(artifactDir, `${emp.id}.html`), html, 'utf8');
        }

        const cnic = normalizeCnic(emp.cnic);
        let pdfBytes = null;
        let pdfError = null;
        try {
            pdfBytes = await buildProtectedPayslipPdf(data, { year: YEAR, month: MONTH }, cnic);
            if (artifactDir) fs.writeFileSync(path.join(artifactDir, `${emp.id}.pdf`), pdfBytes);
        } catch (err) {
            pdfError = err.code || err.message;
            console.error(`[payslip-test-run pdf] ${emp.id}`, err);
        }

        const cover = renderEmailCoverHtml({
            emp,
            monthName: MONTH_NAME,
            year: YEAR,
            frontendUrl: frontendBase(),
            netPay: data.netPay,
            testRun: true,
        });
        if (artifactDir) {
            fs.writeFileSync(path.join(artifactDir, `${emp.id}.email.html`), cover, 'utf8');
        }

        let emailResult = { skipped: true, reason: 'dry_run' };
        let smsResult = { skipped: true, reason: 'dry_run' };

        if (!dryRun) {
            if (sendAppEmail) {
                try {
                    if (pdfBytes) {
                        emailResult = await sendAppEmail({
                            to: destEmail,
                            subject: `TEST RUN — Salary Slip — ${emp.name} — ${MONTH_NAME} ${YEAR} | ASIL`,
                            html: cover,
                            attachments: [{
                                filename: `PaySlip_${emp.name.replace(/[^a-zA-Z0-9 ]/g, '_')}_${MONTH_NAME}_${YEAR}.pdf`,
                                content: pdfBytes,
                            }],
                        });
                    } else {
                        emailResult = await sendAppEmail({
                            to: destEmail,
                            subject: `TEST RUN — Salary Slip — ${emp.name} — ${MONTH_NAME} ${YEAR} | ASIL (HTML)`,
                            html: `${cover}<hr>${html}`,
                        });
                    }
                } catch (err) {
                    emailResult = { ok: false, error: err.message };
                }
            } else {
                emailResult = { skipped: true, reason: 'no_mailer' };
            }

            if (sendJazzSMS) {
                try {
                    const phone = normalisePhone(destPhone);
                    smsResult = await sendJazzSMS(phone, buildSms(emp, data));
                } catch (err) {
                    smsResult = { ok: false, error: err.message };
                }
            } else {
                smsResult = { skipped: true, reason: 'no_sms' };
            }
        }

        results.push({
            id: emp.id,
            name: emp.name,
            netPay: data.netPay,
            overtime: data.overtime,
            reimbursements: data.reimbursements,
            taxDeductions: data.taxDeductions,
            totalDeductions: data.totalDeductions,
            pdfError,
            email: emailResult,
            sms: smsResult,
        });
    }

    const summary = {
        ok: true,
        year: YEAR,
        month: MONTH,
        destEmail,
        destPhone,
        dryRun,
        emailed: results.filter(r => r.email?.ok).length,
        smsed: results.filter(r => r.sms?.ok).length,
        results,
    };
    if (artifactDir) {
        fs.writeFileSync(path.join(artifactDir, 'summary.json'), JSON.stringify(summary, null, 2));
    }
    return summary;
}

module.exports = {
    YEAR,
    MONTH,
    MONTH_NAME,
    buildSamples,
    runJulyPayslipTestDelivery,
};
