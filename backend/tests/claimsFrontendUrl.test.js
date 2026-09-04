'use strict';

const { claimsFrontendUrl } = require('../src/modules/claims/portalService');

const CANONICAL = 'https://hcm.asil.com.pk';

describe('claimsFrontendUrl', () => {
    const prev = process.env.FRONTEND_URL;

    afterEach(() => {
        if (prev === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = prev;
    });

    test('uses canonical host when FRONTEND_URL is missing', () => {
        delete process.env.FRONTEND_URL;
        expect(claimsFrontendUrl()).toBe(CANONICAL);
    });

    test('coerces localhost to the canonical production host', () => {
        process.env.FRONTEND_URL = 'http://localhost:5173';
        expect(claimsFrontendUrl()).toBe(CANONICAL);
    });

    test('honors an explicit non-local FRONTEND_URL', () => {
        process.env.FRONTEND_URL = 'https://example.com/';
        expect(claimsFrontendUrl()).toBe('https://example.com');
    });
});
