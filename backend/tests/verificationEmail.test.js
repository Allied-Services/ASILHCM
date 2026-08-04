'use strict';

const {
    parseEmailList,
    parseNameFromEmail,
    buildSalutation,
    composeVerificationEmail,
    buildCcList,
} = require('../src/modules/serviceOrders/verificationEmail');

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

    test('composeVerificationEmail includes proforma disclaimer and dry-run banner', () => {
        const { subject, html, salutation } = composeVerificationEmail({
            siteName: 'Tarujabba Depot',
            siteCode: 'TARUJABBA',
            month: 7,
            year: 2026,
            invoiceHtml: '<p>INV</p>',
            focalName: 'Mr. Ali Khan',
            dryRun: true,
            intendedTo: ['ali.khan@psopk.com'],
        });
        expect(subject).toBe('Payroll & Invoice Verification for July 2026 — Tarujabba Depot');
        expect(salutation).toBe('Mr. Ali Khan');
        expect(html).toContain('DRY RUN');
        expect(html).toContain('proforma invoice');
        expect(html).toContain('Assalam-o-Alaikum');
    });

    test('buildCcList always includes allied focals and contract focal', () => {
        const cc = buildCcList({ contractFocalEmail: 'Asmat.K.Awan@psopk.com' });
        expect(cc).toEqual(expect.arrayContaining([
            'obaid.rana@asil.com.pk',
            'huzaifa.rafaqat@asil.com.pk',
            'asmat.k.awan@psopk.com',
        ]));
    });

    test('sendVerificationEmails loads service orders by status not missing active column', async () => {
        const { sendVerificationEmails } = require('../src/modules/serviceOrders/verificationEmail');
        const queries = [];
        const pool = {
            query: jest.fn(async (sql, params) => {
                queries.push(String(sql));
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
        const result = await sendVerificationEmails(pool, null, {
            contractId: 'CTR-1',
            month: 7,
            year: 2026,
            dryRun: true,
            computeSoInvoice: jest.fn(async () => ({ siteName: 'Tarujabba', gross: 0, lineItems: [], deductions: [] })),
            renderInvoiceHtml: jest.fn(() => '<p>x</p>'),
        });
        expect(result.results).toHaveLength(1);
        expect(result.results[0].skipped).toBe(true);
        expect(result.results[0].reason).toBe('no_mailer');
    });
});
