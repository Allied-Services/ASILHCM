'use strict';

const {
    getClaimsMonitorCc,
    mergeClaimsMonitorCc,
    withClaimsMonitorCc,
} = require('../src/modules/claims/claimsMail');

describe('claims monitor CC', () => {
    const prevCc = process.env.CLAIMS_MONITOR_CC;
    const prevUntil = process.env.CLAIMS_MONITOR_CC_UNTIL;

    afterEach(() => {
        if (prevCc === undefined) delete process.env.CLAIMS_MONITOR_CC;
        else process.env.CLAIMS_MONITOR_CC = prevCc;
        if (prevUntil === undefined) delete process.env.CLAIMS_MONITOR_CC_UNTIL;
        else process.env.CLAIMS_MONITOR_CC_UNTIL = prevUntil;
    });

    it('defaults to claims@asil.com.pk before the until date', () => {
        delete process.env.CLAIMS_MONITOR_CC;
        delete process.env.CLAIMS_MONITOR_CC_UNTIL;
        expect(getClaimsMonitorCc(new Date('2026-08-15T10:00:00+05:00'))).toEqual(['claims@asil.com.pk']);
    });

    it('stops after CLAIMS_MONITOR_CC_UNTIL', () => {
        delete process.env.CLAIMS_MONITOR_CC;
        process.env.CLAIMS_MONITOR_CC_UNTIL = '2026-11-15';
        expect(getClaimsMonitorCc(new Date('2026-11-16T00:00:01+05:00'))).toEqual([]);
    });

    it('can be disabled with an empty CLAIMS_MONITOR_CC', () => {
        process.env.CLAIMS_MONITOR_CC = '';
        expect(getClaimsMonitorCc(new Date('2026-08-15T10:00:00+05:00'))).toEqual([]);
    });

    it('does not CC an address that is already To', () => {
        delete process.env.CLAIMS_MONITOR_CC;
        delete process.env.CLAIMS_MONITOR_CC_UNTIL;
        expect(mergeClaimsMonitorCc(
            { to: 'claims@asil.com.pk' },
            new Date('2026-08-15T10:00:00+05:00')
        )).toEqual([]);
    });

    it('wraps sendAppEmail with the monitor CC', async () => {
        delete process.env.CLAIMS_MONITOR_CC;
        delete process.env.CLAIMS_MONITOR_CC_UNTIL;
        const send = jest.fn().mockResolvedValue({ ok: true });
        const wrapped = withClaimsMonitorCc(send);
        await wrapped({ to: 'focal@wafi.example', subject: 'x', html: '<p>x</p>' });
        expect(send).toHaveBeenCalledWith({
            to: 'focal@wafi.example',
            subject: 'x',
            html: '<p>x</p>',
            cc: ['claims@asil.com.pk'],
        });
    });
});
