'use strict';

const {
    communicationsMode,
    isAsilEmail,
    gateEmailPayload,
    gateSms,
} = require('../src/core/communications');

describe('communications gate', () => {
    const prev = process.env.COMMUNICATIONS_ENABLED;
    afterEach(() => {
        if (prev === undefined) delete process.env.COMMUNICATIONS_ENABLED;
        else process.env.COMMUNICATIONS_ENABLED = prev;
    });

    test('unset defaults to off', () => {
        delete process.env.COMMUNICATIONS_ENABLED;
        expect(communicationsMode()).toBe('off');
        const g = gateEmailPayload({ to: 'shezad.mumtaz@asil.com.pk', subject: 'x', html: 'y' });
        expect(g.skip).toBe(true);
        expect(g.reason).toBe('communications_off');
        expect(gateSms().skip).toBe(true);
    });

    test('asil_only drops wafi-energy.com and keeps asil.com.pk', () => {
        process.env.COMMUNICATIONS_ENABLED = 'asil_only';
        expect(isAsilEmail('rabia.bhutto@asil.com.pk')).toBe(true);
        expect(isAsilEmail('focal@wafi-energy.com')).toBe(false);
        const g = gateEmailPayload({
            to: ['focal@wafi-energy.com', 'sadia.komal@asil.com.pk'],
            cc: 'lm@wafi-energy.com',
        });
        expect(g.skip).toBe(false);
        expect(g.payload.to).toEqual(['sadia.komal@asil.com.pk']);
        expect(g.payload.cc).toBeUndefined();
        expect(gateSms().skip).toBe(true);
    });

    test('asil_only skips when no asil recipient remains', () => {
        process.env.COMMUNICATIONS_ENABLED = 'asil_only';
        const g = gateEmailPayload({ to: 'focal@wafi-energy.com' });
        expect(g.skip).toBe(true);
        expect(g.reason).toBe('no_allowed_recipients');
    });

    test('on lets every address through', () => {
        process.env.COMMUNICATIONS_ENABLED = 'on';
        const g = gateEmailPayload({ to: 'focal@wafi-energy.com' });
        expect(g.skip).toBe(false);
        expect(g.payload.to).toEqual(['focal@wafi-energy.com']);
        expect(gateSms().skip).toBe(false);
    });
});
