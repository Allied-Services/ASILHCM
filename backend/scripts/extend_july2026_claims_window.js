require('dotenv').config();
const { Pool } = require('pg');
const portal = require('../src/modules/claims/portalService');
const { withClaimsPortalMail } = require('../src/modules/claims/claimsMail');
const { sendAppEmail } = require('../src/core/mailer');
const { sendJazzSMS } = require('../lib/sms');

async function main() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('FATAL: DATABASE_URL is not set.');
        process.exit(1);
    }
    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: true } });
    const announce = process.argv.includes('--announce');
    const remind = process.argv.includes('--remind');
    try {
        const extended = await portal.extendJuly2026ClaimsWindow(pool, { fillDay: 27, approveDay: 27 });
        console.log('[extend-july2026]', JSON.stringify(extended, null, 2));
        const mail = withClaimsPortalMail(sendAppEmail);
        if (announce) {
            const notice = await portal.sendDeadlineExtensionNotice(pool, mail, { fillDay: 27, approveDay: 27 });
            console.log('[extension-notice]', JSON.stringify(notice, null, 2));
        }
        if (remind) {
            const result = await portal.sendReminders(pool, mail, sendJazzSMS);
            console.log('[reminders]', JSON.stringify(result, null, 2));
        }
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
