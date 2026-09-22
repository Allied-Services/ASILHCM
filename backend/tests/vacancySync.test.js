'use strict';

const { describe, test, expect } = (() => {
    try {
        const jestExpect = global.expect;
        if (typeof jestExpect === 'function' && typeof global.describe === 'function') {
            return { describe: global.describe, test: global.test, expect: jestExpect };
        }
    } catch (_) { /* node:test fallback */ }
    const nodeTest = require('node:test');
    const assert = require('node:assert/strict');
    const expectFn = (actual) => ({
        toBe: (expected) => assert.equal(actual, expected),
        toEqual: (expected) => assert.deepEqual(actual, expected),
        toHaveLength: (n) => assert.equal(actual.length, n),
        toMatch: (re) => assert.match(String(actual), re),
        toContain: (s) => assert.ok(String(actual).includes(s)),
    });
    return { describe: nodeTest.describe, test: nodeTest.it, expect: expectFn };
})();

const { roleMonthlyRate, absenceDeductionAmount } = require('../src/modules/serviceOrders/sitesMeta');
const { planVacancies } = require('../src/modules/serviceOrders/vacancySync');
const { shortageLabel } = require('../src/modules/serviceOrders/invoiceHtml');

const officeLine = {
    id: 11,
    name: 'Office/Misc Services',
    rate: 331248,
    is_manpower_dependent: true,
    roles: [
        { designation: 'Conservancy Supervisory Services', count: 1, rate: 60246, is_manpower_dependent: true },
        { designation: 'Sweeping / Cleaning Services', count: 1, is_manpower_dependent: true },
        { designation: 'Gardening Services', count: 2, rate: 52183, is_manpower_dependent: true },
        { designation: 'Decanting/Filling Services', count: 2, is_manpower_dependent: true },
    ],
};

describe('role monthly rate — nested unit vs kitchen-sink', () => {
    test('FM Supervisor uses the stored 60,246', () => {
        const role = officeLine.roles[0];
        expect(roleMonthlyRate(officeLine, officeLine.roles, role)).toBe(60246);
        expect(absenceDeductionAmount(officeLine.rate, officeLine.roles, 30, 30, role)).toBe(60246);
    });

    test('Gardening uses the stored 52,183 per resource', () => {
        const role = officeLine.roles[2];
        expect(roleMonthlyRate(officeLine, officeLine.roles, role)).toBe(52183);
        expect(absenceDeductionAmount(officeLine.rate, officeLine.roles, 15, 30, role)).toBe(
            Math.round((52183 / 30) * 15 * 100) / 100
        );
    });

    test('unpriced kitchen-sink role is not leftover-split', () => {
        const sweeper = officeLine.roles[1];
        expect(roleMonthlyRate(officeLine, officeLine.roles, sweeper)).toBe(0);
    });
});

describe('planVacancies — Morgah supervisor + gardener', () => {
    test('leaver before the month is an unnamed missing service at 60,246', () => {
        const planned = planVacancies({
            lines: [officeLine],
            employees: [{
                id: 'ASIL/PSO-202/25',
                name: 'Muhammad Adnan',
                designation: 'FM Supervisor',
                last_working_day: '2026-07-31',
                active: 'No',
            }],
            year: 2026,
            month: 8,
        });
        const supervisor = planned.filter((d) => /supervisory|fm supervisor/i.test(d.designation));
        expect(supervisor).toHaveLength(1);
        expect(supervisor[0].employeeId).toBe(null);
        expect(supervisor[0].source).toBe('vacancy');
        expect(supervisor[0].amount).toBe(60246);
        expect(supervisor[0].note).toMatch(/Missing service/);
    });

    test('two gardeners required, one present full month → one unnamed 52,183 vacancy', () => {
        const planned = planVacancies({
            lines: [officeLine],
            employees: [{
                id: 'W-204',
                name: 'Muhammad Saleem',
                designation: 'Gardening Services',
                active: 'Yes',
            }],
            overridesByEmployeeId: new Map([['W-204', { absent_days: 0, present_days: 30 }]]),
            year: 2026,
            month: 8,
        });
        const gardens = planned.filter((d) => /garden/i.test(d.designation));
        expect(gardens).toHaveLength(1);
        expect(gardens[0].employeeId).toBe(null);
        expect(gardens[0].amount).toBe(52183);
    });

    test('named gardener with 15 days absent uses attendance_ledger and is not duplicated', () => {
        const planned = planVacancies({
            lines: [officeLine],
            employees: [{
                id: 'W-204',
                name: 'Muhammad Saleem',
                designation: 'Gardener',
                active: 'Yes',
            }],
            overridesByEmployeeId: new Map([['W-204', { absent_days: 15, present_days: 15 }]]),
            existingAbsenceEmployeeIds: new Set(['W-204']),
            year: 2026,
            month: 8,
        });
        const named = planned.filter((d) => d.employeeId === 'W-204');
        expect(named).toHaveLength(0);
        const unfilled = planned.filter((d) => /garden/i.test(d.designation) && d.source === 'vacancy');
        expect(unfilled).toHaveLength(1);
        expect(unfilled[0].amount).toBe(52183);
    });

    test('gardener who worked 15 days without a ledger row is named at 15 × daily rate', () => {
        const planned = planVacancies({
            lines: [officeLine],
            employees: [{
                id: 'W-204',
                name: 'Muhammad Saleem',
                designation: 'Gardener',
                active: 'Yes',
            }],
            overridesByEmployeeId: new Map([['W-204', { absent_days: 15, present_days: 15 }]]),
            year: 2026,
            month: 8,
        });
        const named = planned.filter((d) => d.employeeId === 'W-204');
        expect(named).toHaveLength(1);
        expect(named[0].daysAbsent).toBe(15);
        expect(named[0].amount).toBe(Math.round((52183 / 31) * 15 * 100) / 100);
        expect(planned.filter((d) => /garden/i.test(d.designation) && d.source === 'vacancy')).toHaveLength(1);
    });

    test('invoice label for vacancy does not invent a person name', () => {
        const label = shortageLabel({
            type: 'vacancy',
            source: 'vacancy',
            note: 'Missing service: FM Supervisor — 1 resource unfilled',
            amount: 60246,
            days_absent: 30,
        });
        expect(label).toContain('Missing service: FM Supervisor');
        expect(label.includes('Adnan')).toBe(false);
    });
});

describe('seed role rates overlay', () => {
    const { enrichLinesWithSeedRoleRates } = require('../src/modules/serviceOrders/seedRoleRates');

    test('Morgah Office/Misc without stored rates still bills 60,246 and 52,183', () => {
        const lines = [{
            name: 'Office/Misc Services',
            rate: 331248,
            is_manpower_dependent: true,
            roles: [
                { designation: 'Conservancy Supervisory Services', count: 1 },
                { designation: 'Sweeping / Cleaning Services', count: 1 },
                { designation: 'Gardening Services', count: 2 },
                { designation: 'Decanting/Filling Services', count: 2 },
            ],
        }];
        const enriched = enrichLinesWithSeedRoleRates('MORGAH', lines);
        const roles = enriched[0].roles;
        expect(roleMonthlyRate(enriched[0], roles, roles[0])).toBe(60246);
        expect(roleMonthlyRate(enriched[0], roles, roles[2])).toBe(52183);
        const planned = planVacancies({
            lines: enriched,
            employees: [
                { id: 'ASIL/PSO-202/25', name: 'Muhammad Adnan', designation: 'FM Supervisor', last_working_day: '2026-07-31', active: 'No' },
                { id: 'W-204', name: 'Muhammad Saleem', designation: 'Gardening Services', active: 'Yes' },
            ],
            overridesByEmployeeId: new Map([['W-204', { absent_days: 0, present_days: 30 }]]),
            year: 2026,
            month: 8,
        });
        expect(planned.find((d) => /supervisory|fm supervisor/i.test(d.designation)).amount).toBe(60246);
        expect(planned.find((d) => /garden/i.test(d.designation) && !d.employeeId).amount).toBe(52183);
    });

    test('Chakpirana Sweeping uses site unit 52,046; Forklift uses the dedicated line', () => {
        const lines = [
            {
                name: 'Office/Misc Services',
                rate: 823618,
                is_manpower_dependent: true,
                roles: [
                    { designation: 'Conservancy Supervisory Services', count: 1 },
                    { designation: 'Sweeping / Cleaning Services', count: 4 },
                    { designation: 'Additional general services', count: 2 },
                ],
            },
            {
                name: 'Services for forklifter operation/driving',
                rate: 56991,
                is_manpower_dependent: true,
                roles: [{ designation: 'Forklift Operation Services', count: 1 }],
            },
        ];
        const enriched = enrichLinesWithSeedRoleRates('CHAKPIRANA', lines);
        expect(roleMonthlyRate(enriched[0], enriched[0].roles, enriched[0].roles[1])).toBe(52046);
        expect(roleMonthlyRate(enriched[0], enriched[0].roles, enriched[0].roles[2])).toBe(52046);
        expect(roleMonthlyRate(enriched[1], enriched[1].roles, enriched[1].roles[0])).toBe(56991);
    });
});
