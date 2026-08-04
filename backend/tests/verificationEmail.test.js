'use strict';

jest.mock('../src/modules/serviceOrders/verificationAttachments', () => ({
    buildVerificationPdfAttachments: jest.fn(async () => ({
        attachments: [
            { filename: 'Proforma_Invoice_TARUJABBA_July_2026.pdf', content: Buffer.from('invoice-pdf') },
            { filename: 'Payroll_TARUJABBA_July_2026.pdf', content: Buffer.from('payroll-pdf') },
        ],
        warnings: [],
        payrollHeadcount: 5,
    })),
}));

const {
    parseEmailList,
    parseNameFromEmail,
    buildSalutation,
    composeVerificationEmail,
    buildCcList,
} = require('../src/modules/serviceOrders/verificationEmail');
const { buildVerificationPdfAttachments } = require('../src/modules/serviceOrders/verificationAttachments');

describe('verificationEmail', () => {
    test('parseEmailList splits comma-separated addresses', () => {
        expect(parseEmailList('a@psopk.com, b@psopk.com')).toEqual(['a@psopk.com', 'b@psopk.com']);
        expect(parseEmailList('')).toEqual([]);
    });

    test('parseNameFromEmail handles First.Last@domain', () => {
        expect(parseNameFromEmail('Asmat.K.Awan@psopk.com')).toBe('Asmat Awan');
    });

    test('buildSalutation prefers explicit focal name with title', () => {
        expect(buildSalutation({ focalName: 'Ms. Asmat Awan', primaryEmail: 'x@psopk.com' }))
            .toBe('Ms. Asmat Awan');
    });

    test('composeVerificationEmail lists PDF attachments when provided', () => {
        const { subject, html, salutation } = composeVerificationEmail({
            siteName: 'Tarujabba Depot',
            siteCode: 'TARUJABBA',
            month: 7,
            year: 2026,
            invoiceHtml: '<p>INV</p>',
            focalName: 'Mr. Ali Khan',
            dryRun: true,
            intendedTo: ['ali.khan@psopk.com'],
            attachmentNames: ['Proforma_Invoice_TARUJABBA_July_2026.pdf', 'Payroll_TARUJABBA_July_2026.pdf'],
        });
        expect(subject).toBe('Payroll & Invoice Verification for July 2026 — Tarujabba Depot');
        expect(salutation).toBe('Mr. Ali Khan');
        expect(html).toContain('DRY RUN');
        expect(html).toContain('proforma invoice');
        expect(html).toContain('Please find attached');
        expect(html).toContain('Proforma_Invoice_TARUJABBA_July_2026.pdf');
        expect(html).not.toContain('<p>INV</p>');
    });

    test('composeVerificationEmail falls back to inline invoice when no attachments', () => {
        const { html } = composeVerificationEmail({
            siteName: 'Tarujabba Depot',
            siteCode: 'TARUJABBA',
            month: 7,
            year: 2026,
            invoiceHtml: '<p>INV</p>',
            dryRun: false,
        });
        expect(html).toContain('<p>INV</p>');
    });

    test('buildCcList always includes allied focals and contract focal', () => {
        const cc = buildCcList({ contractFocalEmail: 'Asmat.K.Awan@psopk.com' });
        expect(cc).toEqual(expect.arrayContaining([
            'obaid.rana@asil.com.pk',
            'huzaifa.rafaqat@asil.com.pk',
            'asmat.k.awan@psopk.com',
        ]));
    });

    test('buildCcList can omit contract focal (dry run)', () => {
        const cc = buildCcList({ contractFocalEmail: 'Asmat.K.Awan@psopk.com', includeContractFocal: false });
        expect(cc).toEqual(['obaid.rana@asil.com.pk', 'huzaifa.rafaqat@asil.com.pk']);
        expect(cc).not.toContain('asmat.k.awan@psopk.com');
    });

    test('sendVerificationEmails loads service orders by status not missing active column', async () => {
        const { sendVerificationEmails } = require('../src/modules/serviceOrders/verificationEmail');
        const pool = {
            query: jest.fn(async (sql) => {
                if (sql.includes('FROM contracts')) {
                    return { rows: [{ id: 'CTR-1', contract_name: 'Test', client_focal_name: null, client_focal_email: null }] };
                }
                if (sql.includes('FROM service_orders')) {
                    expect(sql).not.toMatch(/\bactive\b/i);
                    expect(sql).toMatch(/status/i);
                    return { rows: [{ id: 'SO-1', site_code: 'TARUJABBA', name: 'Tarujabba', meta: {} }] };
                }
                return { rows: [] };
            }),
        };
        const prevKey = process.env.RESEND_API_KEY;
        delete process.env.RESEND_API_KEY;
        const result = await sendVerificationEmails(pool, jest.fn(), {
            contractId: 'CTR-1',
            month: 7,
            year: 2026,
            dryRun: true,
            computeSoInvoice: jest.fn(async () => ({ siteName: 'Tarujabba', gross: 0, lineItems: [], deductions: [] })),
            renderInvoiceHtml: jest.fn(() => '<p>x</p>'),
        });
        if (prevKey) process.env.RESEND_API_KEY = prevKey;
        expect(buildVerificationPdfAttachments).toHaveBeenCalled();
        expect(result.results).toHaveLength(1);
        expect(result.results[0].skipped).toBe(true);
        expect(result.results[0].reason).toBe('missing_key_or_recipients');
        expect(result.message).toMatch(/RESEND_API_KEY/i);
        expect(result.sent).toBe(0);
    });

    test('dry run ignores EMAILS_ENABLED=false and attaches PDFs', async () => {
        const { sendVerificationEmails } = require('../src/modules/serviceOrders/verificationEmail');
        const pool = {
            query: jest.fn(async (sql) => {
                if (sql.includes('FROM contracts')) {
                    return { rows: [{ id: 'CTR-1', contract_name: 'Test', client_focal_name: null, client_focal_email: null }] };
                }
                if (sql.includes('FROM service_orders')) {
                    return { rows: [{ id: 'SO-1', site_code: 'TARUJABBA', name: 'Tarujabba', meta: {} }] };
                }
                return { rows: [] };
            }),
        };
        const prevEnabled = process.env.EMAILS_ENABLED;
        const prevKey = process.env.RESEND_API_KEY;
        process.env.EMAILS_ENABLED = 'false';
        process.env.RESEND_API_KEY = 're_test_key';
        const sendAppEmail = jest.fn(async () => ({ ok: true, result: { id: 'msg-1' } }));
        const result = await sendVerificationEmails(pool, sendAppEmail, {
            contractId: 'CTR-1',
            month: 7,
            year: 2026,
            dryRun: true,
            computeSoInvoice: jest.fn(async () => ({ siteName: 'Tarujabba', gross: 0, lineItems: [], deductions: [] })),
            renderInvoiceHtml: jest.fn(() => '<p>x</p>'),
        });
        process.env.EMAILS_ENABLED = prevEnabled;
        if (prevKey) process.env.RESEND_API_KEY = prevKey; else delete process.env.RESEND_API_KEY;
        expect(sendAppEmail).toHaveBeenCalledWith(expect.objectContaining({
            attachments: expect.arrayContaining([
                expect.objectContaining({ filename: expect.stringMatching(/^Proforma_Invoice_/) }),
                expect.objectContaining({ filename: expect.stringMatching(/^Payroll_/) }),
            ]),
        }));
        expect(result.sent).toBe(1);
        expect(result.results[0].attachments).toHaveLength(2);
    });

    test('dry run sends one email per site with contract focal excluded from CC', async () => {
        const { sendVerificationEmails } = require('../src/modules/serviceOrders/verificationEmail');
        const sites = [
            { id: 'SO-1', site_code: 'CHAKPIRANA', name: 'Chakpirana', meta: {} },
            { id: 'SO-2', site_code: 'TARUJABBA', name: 'Tarujabba', meta: {} },
            { id: 'SO-3', site_code: 'JUGLOT', name: 'Juglot', meta: {} },
        ];
        const pool = {
            query: jest.fn(async (sql) => {
                if (sql.includes('FROM contracts')) {
                    return { rows: [{ id: 'CTR-1', contract_name: 'Test', client_focal_name: 'Ms. Asmat Awan', client_focal_email: 'Asmat.K.Awan@psopk.com' }] };
                }
                if (sql.includes('FROM service_orders')) {
                    return { rows: sites };
                }
                return { rows: [] };
            }),
        };
        process.env.RESEND_API_KEY = 're_test_key';
        const sendAppEmail = jest.fn(async () => ({ ok: true, result: { id: 'msg-1' } }));
        const result = await sendVerificationEmails(pool, sendAppEmail, {
            contractId: 'CTR-1',
            month: 7,
            year: 2026,
            dryRun: true,
            computeSoInvoice: jest.fn(async () => ({ siteName: 'X', gross: 0, lineItems: [], deductions: [] })),
            renderInvoiceHtml: jest.fn(() => '<p>x</p>'),
        });
        expect(sendAppEmail).toHaveBeenCalledTimes(3);
        expect(result.sent).toBe(3);
        for (const call of sendAppEmail.mock.calls) {
            expect(call[0].cc).toEqual(['obaid.rana@asil.com.pk', 'huzaifa.rafaqat@asil.com.pk']);
            expect(call[0].cc).not.toContain('asmat.k.awan@psopk.com');
            expect(call[0].attachments).toHaveLength(2);
        }
    });
});
