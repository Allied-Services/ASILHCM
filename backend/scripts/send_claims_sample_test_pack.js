#!/usr/bin/env node
'use strict';
/**
 * Send SAMPLE 4-routing test pack — all mail goes to CLAIMS_SAMPLE_EMAIL only.
 * Usage: CLAIMS_SAMPLE_EMAIL=shezad@gmail.com node backend/scripts/send_claims_sample_test_pack.js --month=7 --year=2026
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const { createCampaign } = require('../src/modules/claims/portalService');

function arg(name) {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : null;
}

async function sendAppEmail({ to, subject, html }) {
    const { Resend } = require('resend');
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY not set');
    const sample = (process.env.CLAIMS_SAMPLE_EMAIL || '').toLowerCase();
    const recipients = String(to || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const r of recipients) {
        if (r.toLowerCase() !== sample) {
            throw new Error(`SAFETY: refused to send to ${r} — only CLAIMS_SAMPLE_EMAIL (${sample}) allowed`);
        }
    }
    const from = process.env.EMAIL_FROM || 'ASIL HCM <noreply@asil.com.pk>';
    const resend = new Resend(key);
    const result = await resend.emails.send({ from, to: recipients, subject, html });
    console.log('[send]', subject, '→', recipients.join(','), result?.data?.id || result);
    return result;
}

async function main() {
    if (!process.env.CLAIMS_SAMPLE_EMAIL) {
        throw new Error('Set CLAIMS_SAMPLE_EMAIL (e.g. shezad@gmail.com) before running.');
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');

    const month = parseInt(arg('month') || '7', 10);
    const year = parseInt(arg('year') || '2026', 10);
    const dryRun = process.argv.includes('--dry-run');

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        console.log(`SAMPLE test pack claim month ${month}/${year} dryRun=${dryRun} → ${process.env.CLAIMS_SAMPLE_EMAIL}`);
        const result = await createCampaign(pool, {
            campaignMonth: month,
            campaignYear: year,
            sendAppEmail: dryRun ? null : sendAppEmail,
            dryRun,
            campaignMode: 'sample',
            testPackFour: true,
        });
        console.log(JSON.stringify({
            fillerCount: result.fillerCount,
            employeeCount: result.employeeCount,
            invites: (result.invites || []).map(i => ({
                roleLabel: i.roleLabel, ok: i.ok, mailTo: i.mailTo, employeeCount: i.employeeCount,
            })),
            skipped: result.skipped?.length,
        }, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
