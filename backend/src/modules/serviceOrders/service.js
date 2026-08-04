'use strict';

const { renderInvoiceHtml } = require('./invoiceHtml');
const { seedPsoNorthZone, resyncNorthZoneFromSeed } = require('./seed');
const contractCrud = require('./contractCrud');
const verificationEmail = require('./verificationEmail');

const crud = require('./crud');
const billing = require('./billing');
const attendanceParse = require('./attendanceParse');
const driveAttendance = require('./driveAttendance');
const attendanceIngest = require('./attendanceIngest');
const sitesMeta = require('./sitesMeta');
const bulkOps = require('./bulkOps');
const exportsXlsx = require('./exports');

const {
    monthYearLabel,
    composeVerificationEmail,
    parseEmailList,
    resolveSiteFocalEmails,
    buildCcList,
    sendVerificationEmails,
    ALLIED_CC,
} = verificationEmail;

/** @deprecated use composeVerificationEmail — kept for existing imports */
function composeFocalEmail(opts) {
    const cc = buildCcList({ contractFocalEmail: opts.contractFocalEmail });
    const composed = composeVerificationEmail({
        siteName: opts.siteName,
        siteCode: opts.siteCode,
        month: opts.month,
        year: opts.year,
        invoiceHtml: opts.invoiceHtml,
        focalName: opts.focalName,
        primaryEmail: opts.primaryEmail,
        dryRun: opts.dryRun,
        intendedTo: opts.intendedTo,
    });
    return { ...composed, cc, signOff: 'Allied Services International (Pvt.) Ltd.' };
}

async function sendFocalEmail(sendAppEmail, payload) {
    if (process.env.EMAILS_ENABLED === 'false') {
        return { skipped: true, reason: 'emails_disabled' };
    }
    if (!sendAppEmail) {
        return { skipped: true, reason: 'no_mailer' };
    }
    const { to, subject, html, cc } = payload;
    if (!to || !to.length) {
        return { skipped: true, reason: 'no_recipients' };
    }
    return sendAppEmail({ to, subject, html, cc });
}

module.exports = {
    ...crud,
    ...billing,
    ...attendanceParse,
    ...driveAttendance,
    ...attendanceIngest,
    ...sitesMeta,
    ...bulkOps,
    ...exportsXlsx,
    ...contractCrud,
    seedPsoNorthZone,
    resyncNorthZoneFromSeed,
    renderInvoiceHtml,
    composeFocalEmail,
    composeVerificationEmail,
    parseEmailList,
    resolveSiteFocalEmails,
    buildCcList,
    sendVerificationEmails,
    sendFocalEmail,
    monthYearLabel,
    ALLIED_CC,
};
