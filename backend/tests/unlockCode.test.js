'use strict';

const { sha256Hex, verifyUnlockCode } = require('../src/core/unlockCode');

describe('unlockCode', () => {
    const original = process.env.MONTH_CLOSE_UNLOCK_CODE_HASH;

    afterEach(() => {
        if (original === undefined) delete process.env.MONTH_CLOSE_UNLOCK_CODE_HASH;
        else process.env.MONTH_CLOSE_UNLOCK_CODE_HASH = original;
    });

    test('returns NOT_CONFIGURED when env missing', () => {
        delete process.env.MONTH_CLOSE_UNLOCK_CODE_HASH;
        expect(verifyUnlockCode('secret')).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
    });

    test('verifies matching code via SHA-256 hash', () => {
        process.env.MONTH_CLOSE_UNLOCK_CODE_HASH = sha256Hex('test-close-code');
        expect(verifyUnlockCode('test-close-code')).toEqual({ ok: true });
        expect(verifyUnlockCode('wrong')).toEqual({ ok: false, reason: 'DENIED' });
    });

    test('rejects empty code', () => {
        process.env.MONTH_CLOSE_UNLOCK_CODE_HASH = sha256Hex('x');
        expect(verifyUnlockCode('')).toEqual({ ok: false, reason: 'DENIED' });
    });
});
