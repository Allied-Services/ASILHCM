'use strict';

const cutover = require('../src/core/cutover');
const wafiApproval = require('../src/modules/wafiClaims/approvalService');
const {
    resolveEmail,
    isWafiRow,
    mapCsvRowToDb,
    parseCsvText,
} = require('../src/modules/employees/wafiRosterRefresh');

describe('cutover helpers', () => {
    test('periodAtOrAfterCutover respects July 2026 floor', () => {
        expect(cutover.periodAtOrAfterCutover(6, 2026)).toBe(false);
        expect(cutover.periodAtOrAfterCutover(7, 2026)).toBe(true);
        expect(cutover.periodAtOrAfterCutover(1, 2027)).toBe(true);
    });

    test('employeeVisibilityClause hides inactive and pre-cutover LWD in normal mode', () => {
        const sql = cutover.employeeVisibilityClause('e', { archive: false });
        expect(sql).toContain('last_working_day');
        expect(sql).toContain('2026-07-01');
        expect(cutover.employeeVisibilityClause('e', { archive: true })).toBe('TRUE');
    });

    test('applyPeriodFloor blocks pre-July periods in normal mode', () => {
        const sql = cutover.applyPeriodFloor('m', 'y', { archive: false });
        expect(sql).toContain('y > 2026');
        expect(cutover.applyPeriodFloor('m', 'y', { archive: true })).toBe('TRUE');
    });

    test('canUseArchiveToggle allows superadmin and huzaifa only', () => {
        expect(cutover.canUseArchiveToggle({ role: 'superadmin', email: 'a@asil.com.pk' })).toBe(true);
        expect(cutover.canUseArchiveToggle({ role: 'finance_manager', email: 'huzaifa.rafaqat@asil.com.pk' })).toBe(true);
        expect(cutover.canUseArchiveToggle({ role: 'finance_manager', email: 'other@asil.com.pk' })).toBe(false);
    });
});

describe('Wafi routing matrix', () => {
    test('focal_then_lm when both named', () => {
        const r = wafiApproval.computeRoutingProfile('lm@wafi.com', 'focal@wafi.com');
        expect(r.profile).toBe('focal_then_lm');
        expect(r.initialState).toBe('pending_focal_input');
    });

    test('lm_only when LM named focal N/A', () => {
        const r = wafiApproval.computeRoutingProfile('lm@wafi.com', 'N/A');
        expect(r.profile).toBe('lm_only');
        expect(r.initialState).toBe('pending_lm_approval');
    });

    test('focal_only when focal named LM N/A', () => {
        const r = wafiApproval.computeRoutingProfile(null, 'focal@wafi.com');
        expect(r.profile).toBe('focal_only');
    });

    test('fallback huzaifa when both N/A', () => {
        const r = wafiApproval.computeRoutingProfile('N/A', '');
        expect(r.profile).toBe('fallback_huzaifa');
        expect(r.focalEmail).toBe('huzaifa.rafaqat@asil.com.pk');
    });
});

describe('portal Wafi approver resolution', () => {
    const { resolveApproverEmail } = require('../src/modules/claims/portalService');

    test('prefers line_manager when focal and LM both named', () => {
        const approver = resolveApproverEmail({
            claim_authority: 'focal@wafi.com',
            supervisor_email: 'focal@wafi.com',
            line_manager_email: 'lm@wafi.com',
        });
        expect(approver).toBe('lm@wafi.com');
    });

    test('falls back to supervisor for non-Wafi pattern', () => {
        const approver = resolveApproverEmail({
            claim_authority: 'filler@client.com',
            supervisor_email: 'sup@client.com',
            line_manager_email: '',
        });
        expect(approver).toBe('sup@client.com');
    });
});

describe('wafi roster refresh parse', () => {
    test('resolveEmail prefers personal over official', () => {
        expect(resolveEmail({
            'Official Email Address': 'work@wafi.com',
            'Personal Email Address': 'home@gmail.com',
        })).toBe('home@gmail.com');
        expect(resolveEmail({
            'Official Email Address': 'N/A',
            'Personal Email Address': 'home@gmail.com',
        })).toBe('home@gmail.com');
    });

    test('isWafiRow detects Wafi client', () => {
        expect(isWafiRow({ 'CLIENT NAME': 'Wafi Energy', 'ASIL Employee Code': 'X' })).toBe(true);
        expect(isWafiRow({ 'CLIENT NAME': 'PSO', 'Contract Name': 'Other' })).toBe(false);
    });

    test('mapCsvRowToDb maps Wafi headers', () => {
        const row = {
            'ASIL Employee Code': 'ASIL-TEST/1',
            'Employee Name': 'Test User',
            'Official Email Address': 'N/A',
            'Personal Email Address': 'test@example.com',
            'Line Manager(Wafi) Email': 'lm@wafi.com',
            'Focal/ Supervisor Email': 'focal@wafi.com',
            'Salary': '87,416',
            'CLIENT NAME': 'Wafi BPO',
        };
        const m = mapCsvRowToDb(row);
        expect(m.id).toBe('ASIL-TEST/1');
        expect(m.email).toBe('test@example.com');
        expect(m.line_manager_email).toBe('lm@wafi.com');
        expect(m.claim_authority).toBe('focal@wafi.com');
        expect(m.supervisor_email).toBe(null);
        expect(m.salary).toBe(87416);
    });

    test('parseCsvText reads header row', () => {
        const { headers, rows } = parseCsvText('ASIL Employee Code,Name\nASIL-1,Ali\n');
        expect(headers).toContain('ASIL Employee Code');
        expect(rows).toHaveLength(1);
    });
});
