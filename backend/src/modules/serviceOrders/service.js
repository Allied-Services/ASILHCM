'use strict';

const { MONTH_NAMES } = require('./attendanceParse');
const { renderInvoiceHtml } = require('./invoiceHtml');
const { seedPsoNorthZone } = require('./seed');

const crud = require('./crud');
const billing = require('./billing');
const attendanceParse = require('./attendanceParse');
const driveAttendance = require('./driveAttendance');
const attendanceIngest = require('./attendanceIngest');
const sitesMeta = require('./sitesMeta');

function monthYearLabel(month, year) {
    const m = Number(month);
    const y = Number(year);
    if (!m || !y) return '';
    return `${MONTH_NAMES[m - 1]} ${y}`;
}

function composeFocalEmail({ siteName, siteCode, month, year, invoiceHtml, payrollSummaryHtml }) {
    const period = monthYearLabel(month, year);
    const subject = `Proforma Invoice & Monthly Payroll Report — ${siteName || siteCode} [${period}]`;
    const html = `
      <p>Dear Client Focal,</p>
      <p>Please find attached the proforma invoice and monthly payroll report for <strong>${siteName || siteCode}</strong> for <strong>${period}</strong>.</p>
      ${payrollSummaryHtml || ''}
      <hr/>
      ${invoiceHtml || '<p>Invoice preview attached separately.</p>'}
      <p style="margin-top:24px">Regards,<br/><strong>SHAHZAIB</strong><br/>Head of Operations<br/>Allied Services International (Pvt.) Ltd.</p>
    `;
    return {
        subject,
        html,
        cc: ['shahzaib@asil.com.pk'],
        signOff: 'SHAHZAIB — Head of Operations',
    };
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
    seedPsoNorthZone,
    renderInvoiceHtml,
    composeFocalEmail,
    sendFocalEmail,
    monthYearLabel,
};
