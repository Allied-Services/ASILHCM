'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
    __dirname,
    '..',
    'migrations',
    '20260901120000_payroll_locked_net_sync.js',
);

describe('payroll locked_net stays in sync after lock', () => {
    const src = fs.readFileSync(MIGRATION, 'utf8');

    test('migration writes a BEFORE trigger on net / locked / locked_net', () => {
        expect(src).toMatch(/CREATE OR REPLACE FUNCTION sync_payroll_locked_net/i);
        expect(src).toMatch(/NEW\.locked_net := ROUND\(COALESCE\(NEW\.net, 0\)\)/);
        expect(src).toMatch(/BEFORE INSERT OR UPDATE OF net, locked, locked_net/);
        expect(src).toMatch(/EXECUTE PROCEDURE sync_payroll_locked_net/);
        expect(src).toMatch(/DROP TRIGGER IF EXISTS trg_sync_payroll_locked_net/);
        expect(src).toMatch(/DROP FUNCTION IF EXISTS sync_payroll_locked_net/);
    });
});
