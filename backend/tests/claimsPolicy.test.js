'use strict';

const {
    normalizeEnabledTypes,
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
    });

    test('ALL_CLAIM_TYPES includes ATTENDANCE for future PSO', () => {
        expect(ALL_CLAIM_TYPES).toContain('ATTENDANCE');
        expect(ALL_CLAIM_TYPES).toContain('OT');
    });
});
