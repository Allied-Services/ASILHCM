'use strict';

const {
    normalizeEnabledTypes,
    normalizeDeadlineMonth,
    parseOptionalDeadlineDay,
    inferCalendarApply,
    hasSubmitDeadline,
    hasApproveDeadline,
    deadlineYearMonth,
    shapePolicyRow,
    DEFAULTS,
    ALL_CLAIM_TYPES,
} = require('../src/modules/claims/claimsPolicy');

describe('claimsPolicy', () => {
    test('defaults enabled types to OT EXPENSE MEDICAL', () => {
        expect(normalizeEnabledTypes(null)).toEqual(DEFAULTS.enabled_types);
        expect(normalizeEnabledTypes([])).toEqual(DEFAULTS.enabled_types);
    });

    test('filters unknown claim types', () => {
        expect(normalizeEnabledTypes(['OT', 'FOO', 'EXPENSE'])).toEqual(['OT', 'EXPENSE']);
    });

    test('shapePolicyRow includes pack fields with defaults', () => {
        const p = shapePolicyRow({
            claims_pay_timing: 'same_month',
            submit_deadline_day: 15,
            approve_deadline_day: 20,
            enabled_types: ['OT'],
            collection_mode: 'machine_file',
            reviewer_required: true,
        });
        expect(p.claims_pay_timing).toBe('same_month');
        expect(p.enabled_types).toEqual(['OT']);
        expect(p.collection_mode).toBe('machine_file');
        expect(p.reviewer_required).toBe(true);
        expect(p.calendar_apply).toBe(false);
        expect(p.submit_deadline_month).toBe('current_month');
    });

    test('missing policy row is calendar-off with no deadlines', () => {
        const p = shapePolicyRow(null);
        expect(p.calendar_apply).toBe(false);
        expect(p.submit_deadline_day).toBeNull();
        expect(p.approve_deadline_day).toBeNull();
        expect(p).toMatchObject(DEFAULTS);
    });

    test('optional deadline helpers', () => {
        expect(parseOptionalDeadlineDay('')).toBeNull();
        expect(parseOptionalDeadlineDay(18)).toBe(18);
        expect(normalizeDeadlineMonth('current_month')).toBe('current_month');
        expect(normalizeDeadlineMonth('nope', 'current_month')).toBe('current_month');
        expect(inferCalendarApply({ calendar_apply: true })).toBe(true);
        expect(inferCalendarApply({ submit_deadline_day: 18 })).toBe(true);
        expect(inferCalendarApply({})).toBe(false);
        expect(hasSubmitDeadline({ calendar_apply: false, submit_deadline_day: 18 })).toBe(false);
        expect(hasSubmitDeadline({ calendar_apply: true, submit_deadline_day: 18 })).toBe(true);
        expect(hasApproveDeadline({ calendar_apply: true, approve_deadline_day: null })).toBe(false);
        expect(deadlineYearMonth(2026, 7, 'current_month')).toEqual({ year: 2026, month: 7 });
        expect(deadlineYearMonth(2026, 7, 'following_month')).toEqual({ year: 2026, month: 8 });
        expect(deadlineYearMonth(2026, 12, 'following_month')).toEqual({ year: 2027, month: 1 });
    });

    test('applied calendar keeps nullable deadlines', () => {
        const p = shapePolicyRow({
            calendar_apply: true,
            claims_pay_timing: 'following_month',
            submit_deadline_day: 10,
            submit_deadline_month: 'current_month',
            approve_deadline_day: null,
            approve_deadline_month: 'following_month',
        });
        expect(p.calendar_apply).toBe(true);
        expect(p.submit_deadline_day).toBe(10);
        expect(p.submit_deadline_month).toBe('current_month');
        expect(p.approve_deadline_day).toBeNull();
    });

    test('ALL_CLAIM_TYPES includes ATTENDANCE for future PSO', () => {
        expect(ALL_CLAIM_TYPES).toContain('ATTENDANCE');
        expect(ALL_CLAIM_TYPES).toContain('OT');
    });
});
