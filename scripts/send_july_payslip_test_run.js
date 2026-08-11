'use strict';

/**
 * Internal QA: generate 5 sample July payslips and deliver to a fixed email + SMS.
 *
 * Usage (from backend/):
 *   PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/google-chrome \
 *   node -r dotenv/config ../scripts/send_july_payslip_test_run.js
 *
 * Optional:
 *   TEST_PAYSLIP_EMAIL / TEST_PAYSLIP_PHONE
 *   --dry-run
 */

const path = require('path');
const fs = require('fs');
const { runJulyPayslipTestDelivery } = require('../backend/src/modules/payslip/testRun');
const { sendAppEmail } = require('../backend/src/core/mailer');
const { sendJazzSMS } = require('../backend/lib/sms');

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const destEmail = process.env.TEST_PAYSLIP_EMAIL || 'shezad.mumtaz@asil.com.pk';
    const destPhone = process.env.TEST_PAYSLIP_PHONE || '03008275688';
    const artifactDir = path.join(__dirname, '../audit/payslip-test-run-july');

    if (!process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync('/usr/local/bin/google-chrome')) {
        process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/local/bin/google-chrome';
    }

    console.log(`July payslip test run → email ${destEmail}, SMS ${destPhone}${dryRun ? ' (dry-run)' : ''}`);

    const summary = await runJulyPayslipTestDelivery(
        { sendAppEmail, sendJazzSMS },
        { destEmail, destPhone, dryRun, artifactDir }
    );

    for (const row of summary.results) {
        console.log(JSON.stringify({
            id: row.id,
            name: row.name,
            netPay: row.netPay,
            email: row.email?.ok ? 'sent' : (row.email?.skipped ? `skipped:${row.email.reason}` : `failed:${row.email?.error || ''}`),
            sms: row.sms?.ok ? 'sent' : (row.sms?.skipped ? `skipped:${row.sms.reason}` : `failed:${row.sms?.error || ''}`),
        }));
    }
    console.log(`Wrote ${path.join(artifactDir, 'summary.json')}`);
    if (!dryRun && (summary.emailed === 0 || summary.smsed === 0)) {
        console.error('Delivery incomplete — check RESEND_API_KEY / JAZZ_SMS_* / JAZZ_HTTPS_PROXY');
        process.exitCode = 2;
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
