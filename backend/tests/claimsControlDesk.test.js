'use strict';

const {
    controlStatusFromRow,
    actionViewFromControl,
    canSelectForPayrollPush,
    usesOperatorPayrollClose,
    controlLabel,
} = require('../src/modules/claims/claimsDesk');

describe('claims control desk', () => {
    test('ready_for_payroll when approved and sheet empty', () => {
        const s = controlStatusFromRow({
            internalStatus: 'ready_import',
            submissionStatus: 'approved',
            sample: false,
            sheetHasValues: false,
            amountsMatch: false,
            portalHasValues: true,
            lmReopenCount: 0,
            payrollPushedAt: null,
        });
        expect(s).toBe('ready_for_payroll');
        expect(actionViewFromControl(s)).toBe('needs_action');
        expect(canSelectForPayrollPush(s)).toBe(true);
    });

    test('ready_for_payroll when marked sent but sheet does not match the upload', () => {
        const s = controlStatusFromRow({
            internalStatus: 'on_sheet',
            submissionStatus: 'in_payroll',
            sample: false,
            sheetHasValues: true,
            amountsMatch: false,
            portalHasValues: true,
            lmReopenCount: 0,
            payrollPushedAt: '2026-08-25T10:00:00Z',
        });
        expect(s).toBe('ready_for_payroll');
        expect(canSelectForPayrollPush(s)).toBe(true);
    });

    test('ready_for_payroll when approved upload differs from the sheet', () => {
        const s = controlStatusFromRow({
            internalStatus: 'other_data',
            submissionStatus: 'approved',
            sample: false,
            sheetHasValues: true,
            amountsMatch: false,
            portalHasValues: true,
            lmReopenCount: 0,
            payrollPushedAt: null,
        });
        expect(s).toBe('ready_for_payroll');
        expect(canSelectForPayrollPush(s)).toBe(true);
    });

    test('sent_to_payroll when already pushed', () => {
        const s = controlStatusFromRow({
            internalStatus: 'on_sheet',
            submissionStatus: 'in_payroll',
            sample: false,
            sheetHasValues: true,
            amountsMatch: true,
            portalHasValues: true,
            lmReopenCount: 0,
            payrollPushedAt: '2026-08-25T10:00:00Z',
        });
        expect(s).toBe('sent_to_payroll');
        expect(actionViewFromControl(s)).toBe('closed');
        expect(canSelectForPayrollPush(s)).toBe(false);
    });

    test('final_lm_review when reopened and submitted', () => {
        const s = controlStatusFromRow({
            internalStatus: 'waiting_lm',
            submissionStatus: 'submitted',
            sample: false,
            sheetHasValues: false,
            amountsMatch: false,
            portalHasValues: true,
            lmReopenCount: 1,
            payrollPushedAt: null,
        });
        expect(s).toBe('final_lm_review');
        expect(controlLabel(s)).toMatch(/Final LM review/);
    });

    test('no_claims_confirmed when filler confirmed', () => {
        const s = controlStatusFromRow({
            internalStatus: 'no_claims',
            submissionStatus: 'no_claims',
            sample: false,
            sheetHasValues: false,
            amountsMatch: true,
            portalHasValues: false,
            lmReopenCount: 0,
            payrollPushedAt: null,
            noClaimsKind: 'confirmed',
        });
        expect(s).toBe('no_claims_confirmed');
        expect(controlLabel(s)).toMatch(/Confirmed/);
        expect(actionViewFromControl(s)).toBe('closed');
    });

    test('no_claims_auto_closed when deadline passed with no response', () => {
        const s = controlStatusFromRow({
            internalStatus: 'no_claims',
            submissionStatus: 'no_claims',
            sample: false,
            sheetHasValues: false,
            amountsMatch: true,
            portalHasValues: false,
            lmReopenCount: 0,
            payrollPushedAt: null,
            noClaimsKind: 'auto_closed',
        });
        expect(s).toBe('no_claims_auto_closed');
        expect(controlLabel(s)).toMatch(/Auto-closed/);
        expect(actionViewFromControl(s)).toBe('closed');
    });

    test('waiting_lm_fill stays waiting, not waiting_focal', () => {
        const s = controlStatusFromRow({
            internalStatus: 'waiting_lm_fill',
            submissionStatus: 'draft',
            sample: false,
            sheetHasValues: false,
            amountsMatch: false,
            portalHasValues: false,
            lmReopenCount: 0,
            payrollPushedAt: null,
        });
        expect(s).toBe('waiting_lm_fill');
        expect(actionViewFromControl(s)).toBe('waiting');
    });

    test('waiting_employee is distinct from waiting_focal', () => {
        const s = controlStatusFromRow({
            internalStatus: 'waiting_employee',
            submissionStatus: 'draft',
            sample: false,
            sheetHasValues: false,
            amountsMatch: false,
            portalHasValues: false,
            lmReopenCount: 0,
            payrollPushedAt: null,
        });
        expect(s).toBe('waiting_employee');
        expect(actionViewFromControl(s)).toBe('waiting');
    });

    test('operator payroll close follows declared types, not employee codes', () => {
        expect(usesOperatorPayrollClose({ id: 'ASIL/PSO-040/25', contract_id: 'CTR-PSO-NORTH-ZONE' })).toBe(false);
        expect(usesOperatorPayrollClose({ collection_mode: 'machine_file' })).toBe(false);
        expect(usesOperatorPayrollClose({ enabled_types: ['OT', 'ATTENDANCE'] })).toBe(true);
        expect(usesOperatorPayrollClose({ enabled_types: ['OT', 'EXPENSE', 'MEDICAL'] })).toBe(false);
        expect(usesOperatorPayrollClose({ enabled_types: ['OT'], reviewer_required: true })).toBe(false);
    });

    test('recruiter can tick invite-sent PSO rows; already sent stays blocked', () => {
        expect(canSelectForPayrollPush('invite_sent', { operatorClose: true })).toBe(true);
        expect(canSelectForPayrollPush('not_invited', { operatorClose: true })).toBe(true);
        expect(canSelectForPayrollPush('sent_to_payroll', { operatorClose: true })).toBe(false);
        expect(canSelectForPayrollPush('invite_sent')).toBe(false);
    });
});
