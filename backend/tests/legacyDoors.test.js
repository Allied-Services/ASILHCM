'use strict';

const fs = require('fs');
const path = require('path');
const { mockPool, makeToken } = require('./setup');

let app;
beforeAll(() => {
    jest.resetModules();
    app = require('../server');
});

afterAll(async () => {
    await mockPool.end();
});

describe('One Payroll Sheet — leftover doors', () => {
    test('App.jsx hides Payroll Run and leftover ?tab= no longer opens hidden screens', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../frontend/src/App.jsx'), 'utf8');
        expect(src).toMatch(/HIDDEN_LEGACY_NAV = new Set\(\[[^\]]*payroll_run/);
        expect(src).toMatch(/allowedTabs\.includes\(activeTab\) && !HIDDEN_LEGACY_NAV\.has\(activeTab\)/);
        expect(src).not.toMatch(/Hidden doors stay reachable/);
    });

    test('Email Claims push-to-payroll is gone (410)', async () => {
        const res = await require('supertest')(app)
            .post('/api/claims/99/push-to-payroll')
            .set('Authorization', `Bearer ${makeToken({ role: 'superadmin' })}`)
            .send({ month: 8, year: 2026 });
        expect(res.status).toBe(410);
        expect(res.body.code).toBe('EMAIL_CLAIMS_PUSH_RETIRED');
    });

    test('payroll lock rebuilds SO shortages from the locked Sheet', () => {
        const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        const start = src.indexOf("app.patch('/api/payroll/:year/:month/lock'");
        const block = src.slice(start, start + 7000);
        expect(block).toMatch(/syncSoDeductionsFromLockedSheet/);
        expect(block).toMatch(/invoice_sync/);
    });
});
