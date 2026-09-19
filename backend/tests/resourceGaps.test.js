'use strict';

const {
    employedDaysInBillingMonth,
    vacancyDaysForRole,
    reconcileResourceGaps,
} = require('../src/modules/serviceOrders/resourceGaps');
const { absenceDeductionAmount } = require('../src/modules/serviceOrders/sitesMeta');
const { renderInvoiceHtml, shortageLabel } = require('../src/modules/serviceOrders/invoiceHtml');

describe('resource gaps — employment window', () => {
    test('Adnan last working 31 Jul is not employed in August', () => {
        expect(employedDaysInBillingMonth({
            last_working_day: '2026-07-31',
            doj: '2026-03-01',
        }, 2026, 8, 30)).toBe(0);
    });

    test('gardener employed all month covers 30 billing days', () => {
        expect(employedDaysInBillingMonth({
            doj: '2026-03-01',
        }, 2026, 8, 30)).toBe(30);
    });

    test('one of two gardener slots vacant is 30 days', () => {
        const days = vacancyDaysForRole(
            { designation: 'Gardening Services', count: 2, rate: 52183 },
            [{ doj: '2026-03-01', designation: 'Gardener' }],
            2026,
            8,
            30
        );
        expect(days).toBe(30);
    });

    test('departed supervisor plus one gardener vacancy amounts', () => {
        const supervisor = vacancyDaysForRole(
            { designation: 'Conservancy Supervisory Services', count: 1, rate: 60246 },
            [{ last_working_day: '2026-07-31', designation: 'FM Supervisor' }],
            2026,
            8,
            30
        );
        const gardener = vacancyDaysForRole(
            { designation: 'Gardening Services', count: 2, rate: 52183 },
            [{ doj: '2026-03-01', designation: 'Gardener' }],
            2026,
            8,
            30
        );
        const roles = [
            { designation: 'Conservancy Supervisory Services', count: 1, rate: 60246 },
            { designation: 'Gardening Services', count: 2, rate: 52183 },
        ];
        expect(absenceDeductionAmount(331248, roles, supervisor, 30, roles[0])).toBe(60246);
        expect(absenceDeductionAmount(331248, roles, gardener, 30, roles[1])).toBe(52183);
    });

    test('named 15-day absence uses role rate', () => {
        const role = { designation: 'Gardening Services', count: 2, rate: 52183 };
        expect(absenceDeductionAmount(331248, [role], 15, 30, role)).toBe(26091.5);
    });
});

describe('resource gaps — invoice labels', () => {
    test('vacancy label is Missing Resource', () => {
        expect(shortageLabel({
            type: 'resource_gap',
            source: 'resource_gap',
            note: 'Missing Resource / Conservancy Supervisory Services',
            days_absent: 30,
            amount: 60246,
        })).toMatch(/Missing Resource/);
        expect(shortageLabel({
            type: 'resource_gap',
            source: 'resource_gap',
            note: 'Missing Resource / Conservancy Supervisory Services',
            days_absent: 30,
            amount: 60246,
        })).toMatch(/60,246|2,008/);
    });

    test('invoice nests vacancy under the Office/Misc line', () => {
        const html = renderInvoiceHtml({
            computed: {
                siteName: 'Morgah Installation',
                siteCode: 'MORGAH',
                periodMonth: 8,
                periodYear: 2026,
                taxRate: 0.16,
                lineItems: [{
                    id: 11,
                    description: 'Office/Misc Services',
                    quantity: 1,
                    rate: 331248,
                    amount: 331248,
                    roles: [
                        { designation: 'Conservancy Supervisory Services', count: 1, rate: 60246 },
                        { designation: 'Gardening Services', count: 2, rate: 52183 },
                    ],
                }],
                deductions: [
                    { line_id: 11, type: 'resource_gap', source: 'resource_gap', note: 'Missing Resource / Conservancy Supervisory Services', days_absent: 30, amount: 60246 },
                    { line_id: 11, type: 'resource_gap', source: 'resource_gap', note: 'Missing Resource / Gardening Services', days_absent: 30, amount: 52183 },
                    { line_id: 11, type: 'absence', employee_name: 'Muhammad Saleem', employee_designation: 'Gardener', days_absent: 15, amount: 26091.5 },
                ],
            },
        });
        expect(html).toContain('Missing Resource');
        expect(html).toContain('Muhammad Saleem');
        expect(html).toContain('15 days absent');
        expect(html).toContain('@ Rs. 52,183');
        expect(html).toContain('60,246');
        expect(html).toContain('52,183');
    });
});

describe('resource gaps — reconcile idempotent', () => {
    test('rebuilds only resource_gap rows', async () => {
        const calls = [];
        const pool = {
            query: async (sql, params) => {
                const q = String(sql).replace(/\s+/g, ' ');
                calls.push({ q, params });
                if (q.includes('FROM service_orders so')) {
                    return {
                        rows: [{
                            id: 'SO-PSO-MORGAH',
                            site_code: 'MORGAH',
                            lines: [{
                                id: 11,
                                rate: 331248,
                                is_manpower_dependent: true,
                                roles: [
                                    { designation: 'Conservancy Supervisory Services', count: 1, rate: 60246 },
                                    { designation: 'Gardening Services', count: 2, rate: 52183 },
                                ],
                            }],
                        }],
                    };
                }
                if (q.includes('FROM employees')) {
                    return {
                        rows: [
                            { id: 'A', designation: 'FM Supervisor', site: 'MORGAH', last_working_day: '2026-07-31' },
                            { id: 'B', designation: 'Gardener', site: 'MORGAH', doj: '2026-03-01' },
                        ],
                    };
                }
                return { rows: [], rowCount: 1 };
            },
        };
        const first = await reconcileResourceGaps(pool, {
            contractId: 'CTR-PSO-NORTH-ZONE', month: 8, year: 2026, actor: 'test',
        });
        const second = await reconcileResourceGaps(pool, {
            contractId: 'CTR-PSO-NORTH-ZONE', month: 8, year: 2026, actor: 'test',
        });
        expect(first.gaps).toBe(2);
        expect(second.gaps).toBe(2);
        expect(calls.filter((c) => c.q.includes('DELETE FROM so_deductions')).length).toBe(2);
        const insert = calls.find((c) => c.q.includes('INSERT INTO so_deductions'));
        expect(insert.params).toContain(60246);
        expect(insert.params).toContain(52183);
    });
});
