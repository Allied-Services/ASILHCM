'use strict';

const { PDFDocument } = require('pdf-lib');
const { htmlToPdf } = require('../../core/htmlToPdf');
const { renderPayslipHtml } = require('./template');

async function buildProtectedPayslipPdf(data, { year, month }, cnicPassword) {
    const html = renderPayslipHtml(data, { year, month });
    const rawPdf = await htmlToPdf(html);
    if (!rawPdf) {
        const err = new Error('PDF_GENERATION_UNAVAILABLE');
        err.code = 'PDF_GENERATION_UNAVAILABLE';
        throw err;
    }

    const password = String(cnicPassword || '').replace(/\D/g, '');
    if (password.length < 5) {
        const err = new Error('MISSING_CNIC');
        err.code = 'MISSING_CNIC';
        throw err;
    }

    const pdfDoc = await PDFDocument.load(rawPdf);
    const encrypted = await pdfDoc.save({
        userPassword: password,
        ownerPassword: password,
        useObjectStreams: false,
    });
    return Buffer.from(encrypted);
}

module.exports = { buildProtectedPayslipPdf };
