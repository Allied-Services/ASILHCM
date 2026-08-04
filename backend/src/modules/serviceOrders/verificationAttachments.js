'use strict';

const { htmlToPdf } = require('../../core/htmlToPdf');
const { getPayrollRuns } = require('../payrollrun/service');
const { filterPayrollRowsForSite, renderSitePayrollHtml, periodLabel } = require('./sitePayrollHtml');

function safeFilePart(s) {
    return String(s || 'site').replace(/[^\w.-]+/g, '_').slice(0, 48);
}

async function buildVerificationPdfAttachments(pool, {
    computed,
    renderInvoiceHtml,
    contractId,
    month,
    year,
    siteCode,
    siteName,
}) {
    const periodSlug = safeFilePart(periodLabel(month, year).replace(/\s+/g, '_'));
    const siteSlug = safeFilePart(siteCode || siteName);

    const invoiceHtml = renderInvoiceHtml({ computed }, { format: 'invoice_letterhead' });
    const payrollData = await getPayrollRuns(pool, { contractId, month, year });
    const siteRows = filterPayrollRowsForSite(payrollData.rows || [], siteCode, siteName);
    const payrollHtml = renderSitePayrollHtml({
        siteName,
        siteCode,
        month,
        year,
        contractName: computed.contractName,
        rows: siteRows,
    });

    const attachments = [];
    const warnings = [];

    try {
        const invoicePdf = await htmlToPdf(invoiceHtml);
        if (invoicePdf) {
            attachments.push({
                filename: `Proforma_Invoice_${siteSlug}_${periodSlug}.pdf`,
                content: invoicePdf,
            });
        } else {
            warnings.push('invoice_pdf_unavailable');
        }
    } catch (err) {
        console.error('[verificationAttachments] invoice PDF', err);
        warnings.push('invoice_pdf_failed');
    }

    try {
        const payrollPdf = await htmlToPdf(payrollHtml);
        if (payrollPdf) {
            attachments.push({
                filename: `Payroll_${siteSlug}_${periodSlug}.pdf`,
                content: payrollPdf,
            });
        } else {
            warnings.push('payroll_pdf_unavailable');
        }
    } catch (err) {
        console.error('[verificationAttachments] payroll PDF', err);
        warnings.push('payroll_pdf_failed');
    }

    return { attachments, warnings, payrollHeadcount: siteRows.length };
}

module.exports = {
    buildVerificationPdfAttachments,
    safeFilePart,
};
