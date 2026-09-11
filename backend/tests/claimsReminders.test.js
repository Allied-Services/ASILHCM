'use strict';

const {
    isDueForReminder,
    shouldSendApproverNotifyEmail,
    buildSubmitPendingSms,
    buildApprovalPendingSms,
    REMINDER_INTERVAL_MS,
} = require('../src/modules/claims/claimsReminders');

describe('claimsReminders', () => {
    const now = new Date('2026-08-19T12:00:00+05:00').getTime();

    it('requires 48h since invite before first reminder', () => {
        const invite = new Date(now - REMINDER_INTERVAL_MS + 1000).toISOString();
        expect(isDueForReminder(null, invite, now)).toBe(false);
    });

    it('allows reminder 48h after invite', () => {
        const invite = new Date(now - REMINDER_INTERVAL_MS - 1000).toISOString();
        expect(isDueForReminder(null, invite, now)).toBe(true);
    });

    it('blocks repeat within 48h of last reminder', () => {
        const invite = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
        const last = new Date(now - 1000).toISOString();
        expect(isDueForReminder(last, invite, now)).toBe(false);
    });

    it('SMS messages stay within 160 chars', () => {
        const period = { claim_month: 7, claim_year: 2026, settlement_month: 8, settlement_year: 2026 };
        expect(buildSubmitPendingSms(period, 21).length).toBeLessThanOrEqual(160);
        expect(buildApprovalPendingSms(period, 23, 12).length).toBeLessThanOrEqual(160);
    });

    it('mails the LM pack once unless reminder or resend', () => {
        expect(shouldSendApproverNotifyEmail({ pendingCount: 1, forceEmail: true })).toBe(false);
        expect(shouldSendApproverNotifyEmail({
            pendingCount: 1,
            reminder: true,
        })).toBe(true);
        expect(shouldSendApproverNotifyEmail({ pendingCount: 0, digest: true })).toBe(false);
    });

    it('next-day LM digest only when yesterday added claims', () => {
        const { shouldSendApproverYesterdayDigest, karachiYesterdayYmd, calendarDateInZone } = require('../src/modules/claims/claimsReminders');
        expect(shouldSendApproverYesterdayDigest({
            pendingCount: 2,
            newYesterdayCount: 1,
            mailedToday: false,
        })).toBe(true);
        expect(shouldSendApproverYesterdayDigest({
            pendingCount: 2,
            newYesterdayCount: 0,
            mailedToday: false,
        })).toBe(false);
        expect(shouldSendApproverYesterdayDigest({
            pendingCount: 2,
            newYesterdayCount: 1,
            mailedToday: true,
        })).toBe(false);
        const thuNight = new Date('2026-09-10T20:00:00+05:00');
        const friMorning = new Date('2026-09-11T09:00:00+05:00');
        expect(karachiYesterdayYmd(friMorning)).toBe('2026-09-10');
        expect(calendarDateInZone(thuNight)).toBe('2026-09-10');
    });
});
