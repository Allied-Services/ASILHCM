'use strict';

const {
    deskStatusFromInternal,
    deskLabel,
    formatClaimSummary,
    computeLastActivity,
    chaseRouteForPerson,
    resolveReminderMeta,
} = require('../src/modules/claims/claimsDesk');

describe('claimsDesk', () => {
    test('deskStatusFromInternal maps internal chain to desk labels', () => {
        expect(deskStatusFromInternal('invite_sent')).toBe('invite_sent');
        expect(deskStatusFromInternal('waiting_focal')).toBe('pending_focal');
        expect(deskStatusFromInternal('waiting_lm')).toBe('pending_lm');
        expect(deskStatusFromInternal('on_sheet')).toBe('verified');
    });

    test('deskLabel returns human text', () => {
        expect(deskLabel('pending_focal')).toBe('Pending at Focal');
    });

    test('formatClaimSummary joins OT and amounts', () => {
        const s = formatClaimSummary({ ot2Write: 8, ot3: 2, medical: 1200, expense: 500 });
        expect(s).toMatch(/OT2 8h/);
        expect(s).toMatch(/OT3 2h/);
        expect(s).toMatch(/Med/);
        expect(s).toMatch(/Exp/);
    });

    test('computeLastActivity picks the newest event', () => {
        const a = computeLastActivity({
            batch: { invite_opened_at: '2026-08-10T10:00:00Z' },
            sub: { submitted_at: '2026-08-12T10:00:00Z', approved_at: '2026-08-15T10:00:00Z' },
        });
        expect(a.last_activity_label).toBe('Approved');
    });

    test('chaseRouteForPerson routes filler vs approver', () => {
        expect(chaseRouteForPerson({
            status: 'waiting_focal',
            mailed_to: 'focal@wafi',
            batch_id: 1,
        })).toEqual({ target: 'filler', email: 'focal@wafi', reason: null });
        expect(chaseRouteForPerson({
            status: 'waiting_lm',
            lm: 'lm@wafi',
            period_id: 3,
        })).toEqual({ target: 'approver', email: 'lm@wafi', reason: null });
        expect(chaseRouteForPerson({ status: 'on_sheet' }).reason).toBe('already_finished');
    });

    test('resolveReminderMeta reads batch or approver pack', () => {
        const focal = resolveReminderMeta(
            { status: 'waiting_focal', mailed_to: 'focal@wafi' },
            { last_reminder_at: '2026-08-20', reminder_count: 2 },
            null
        );
        expect(focal.reminder_party).toBe('focal');
        expect(focal.reminder_count).toBe(2);

        const lm = resolveReminderMeta(
            { status: 'waiting_lm', lm: 'lm@wafi' },
            null,
            { last_reminder_at: '2026-08-21', reminder_count: 1 }
        );
        expect(lm.reminder_party).toBe('approver');
        expect(lm.reminder_count).toBe(1);
    });
});
