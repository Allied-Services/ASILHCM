#!/usr/bin/env node
'use strict';
/**
 * UAT: generate payslip PDFs for N random employees and deliver ONLY to sample email/phone.
 * Bypasses lock/paid gate — pipeline test only.
 *
 * Usage:
 *   PAYSLIP_SAMPLE_EMAIL=shezad.mumtaz@asil.com.pk \
 *   PAYSLIP_SAMPLE_PHONE=03008275688 \
 *   PUPPETEER_EXECUTABLE_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" \
 *   node backend/scripts/send_payslip_uat_sample.js --year=2026 --month=7 --count=5
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Pool } = require('pg');
const { buildWorldAPayslipData, normalizeCnic } = require('../src/modules/payslip/dataBuilder');
const { buildProtectedPayslipPdf } = require('../src/modules/payslip/pdfProtect');
const { renderEmailCoverHtml } = require('../src/modules/payslip/template');
const { mintAccessToken, TOKEN_TTL_DAYS } = require('../src/modules/payslip/tokenStore');
const { sendJazzSMS, normalisePhone } = require('../lib/sms');

const SAMPLE_EMAIL = (process.env.PAYSLIP_SAMPLE_EMAIL || '').trim().toLowerCase();
const SAMPLE_PHONE = normalisePhone(process.env.PAYSLIP_SAMPLE_PHONE || '');

function arg(name, fallback) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : fallback;
}

async function sendAppEmail({ to, subject, html, attachments }) {
    const { Resend } = require('resend');
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY not set');
    const recipients = String(to || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const r of recipients) {
        if (r !== SAMPLE_EMAIL) {
            throw new Error(`SAFETY: refused to send to ${r} — only PAYSLIP_SAMPLE_EMAIL (${SAMPLE_EMAIL}) allowed`);
        }
    }
    const from = process.env.EMAIL_FROM || 'ASIL HCM <noreply@asil.com.pk>';
    const resend = new Resend(key);
    const result = await resend.emails.send({ from, to: recipients, subject, html, attachments });
    console.log('[email]', subject, '→', recipients.join(','), result?.data?.id || result?.error || 'ok');
    return result;
}

async function getContractEosbType(pool, contractName) {
    if (!contractName) return 'None';
    const { rows } = await pool.query(
        `SELECT c.costs->>'eosb_type' AS eosb_type FROM contracts c WHERE c.contract_name = $1 LIMIT 1`,
        [contractName]
    );
    return rows[0]?.eosb_type || 'None';
}

async function main() {
    if (!SAMPLE_EMAIL) throw new Error('Set PAYSLIP_SAMPLE_EMAIL before running.');
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY required');

    const year = parseInt(arg('year', '2026'), 10);
    const month = parseInt(arg('month', '7'), 10);
    const count = parseInt(arg('count', '5'), 10);
    const dryRun = process.argv.includes('--dry-run');
    const frontendUrl = (process.env.FRONTEND_URL || 'https://asil-hcm-frontend.onrender.com').replace(/\/$/, '');
    const monthName = new Date(2000, month - 1, 1).toLocaleString('en-PK', { month: 'long' });

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
    });

    const { rows: targets } = await pool.query(
        `SELECT e.id, e.name, e.email, e.primary_contact, e.cnic, e.designation,
                e.client, e.location, e.bank_name, e.bank_account, e.contract_name, e.salary,
                pt.paid_days, pt.gross, pt.net, pt.ot2_hrs, pt.ot3_hrs, pt.opd_claim, pt.reimbursement,
                pt.arrears, pt.special_allowance, pt.fuel_mobile, pt.bonus_amount, pt.wht, pt.eobi_ee,
                pt.advance_deduction, pt.loan_deduction, pt.other_deduction, pt.locked
         FROM payroll_transactions pt
         JOIN employees e ON e.id = pt.employee_id
         WHERE pt.year = $1 AND pt.month = $2
           AND e.cnic IS NOT NULL
           AND length(regexp_replace(e.cnic, '[^0-9]', '', 'g')) >= 5
         ORDER BY random()
         LIMIT $3`,
        [year, month, count]
    );

    if (!targets.length) {
        throw new Error(`No employees with CNIC found for ${monthName} ${year}`);
    }

    console.log(`UAT payslip sample: ${targets.length} employees → ${SAMPLE_EMAIL}${SAMPLE_PHONE ? ` + SMS ${SAMPLE_PHONE}` : ''} dryRun=${dryRun}`);

    const results = [];
    for (const row of targets) {
        const emp = row;
        const cnic = normalizeCnic(emp.cnic);
        const eosbType = await getContractEosbType(pool, emp.contract_name || emp.contract);
        const data = buildWorldAPayslipData(emp, row, eosbType);

        if (dryRun) {
            results.push({ id: emp.id, name: emp.name, dryRun: true });
            continue;
        }

        const pdfBytes = await buildProtectedPayslipPdf(data, { year, month }, cnic);
        if (!pdfBytes) throw new Error('PDF generation failed — set PUPPETEER_EXECUTABLE_PATH to Chrome on Windows');

        const safeName = (emp.name || 'Employee').replace(/[^a-zA-Z0-9 ]/g, '_').trim();
        const cover = renderEmailCoverHtml({ emp, monthName, year, frontendUrl });
        await sendAppEmail({
            to: SAMPLE_EMAIL,
            subject: `TRIAL UAT — ${emp.name} — ${monthName} ${year} | ASIL`,
            html: cover + `<p style="font-size:12px;color:#666">UAT sample for employee <strong>${emp.name}</strong> (${emp.id}). Password = CNIC no dashes.</p>`,
            attachments: [{
                filename: `PaySlip_${safeName}_${monthName}_${year}.pdf`,
                content: Buffer.from(pdfBytes).toString('base64'),
            }],
        });

        let smsStatus = 'skipped';
        if (SAMPLE_PHONE && process.env.JAZZ_SMS_USER && process.env.JAZZ_SMS_PASS) {
            const { rows: docRows } = await pool.query(
                `INSERT INTO payslip_documents (employee_id, year, month, pdf_bytes, content_hash, batch_id)
                 VALUES ($1, $2, $3, $4, encode(sha256($4::bytea), 'hex'), NULL)
                 ON CONFLICT (employee_id, year, month) DO UPDATE SET pdf_bytes = EXCLUDED.pdf_bytes
                 RETURNING id`,
                [emp.id, year, month, pdfBytes]
            );
            const { rawToken } = await mintAccessToken(pool, {
                employeeId: emp.id, year, month, documentId: docRows[0].id,
            });
            const link = `${frontendUrl}/p/${rawToken}`;
            const sms = `ASIL TRIAL UAT: ${emp.name.slice(0, 20)} ${monthName} ${year}. ${link} (${TOKEN_TTL_DAYS}d). PW: CNIC.`;
            const smsResult = await sendJazzSMS(SAMPLE_PHONE, sms.slice(0, 160));
            smsStatus = smsResult?.ok ? 'sent' : `failed:${smsResult?.response || 'unknown'}`;
            console.log('[sms]', emp.name, '→', SAMPLE_PHONE, smsStatus);
        } else if (SAMPLE_PHONE) {
            smsStatus = 'skipped_no_jazz_env';
        }

        results.push({ id: emp.id, name: emp.name, email: 'sent', sms: smsStatus });
    }

    console.log(JSON.stringify({ ok: true, year, month, count: results.length, results }, null, 2));
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
