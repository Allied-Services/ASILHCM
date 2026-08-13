'use strict';

/**
 * Characterization: AP payroll-queue SQL must aggregate in a CTE before batch_count,
 * otherwise Postgres rejects non-grouped client/contract refs (empty AP UI).
 */

const fs = require('fs');
const path = require('path');

describe('GET /api/ap/payroll-queue SQL shape', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const marker = '// GET /api/ap/payroll-queue';
    const start = serverSrc.indexOf(marker);
    const end = serverSrc.indexOf('// GET /api/ap/payroll-queue/:year/:month', start);
    const block = serverSrc.slice(start, end);

    test('aggregates locked rows in CTEs before joining batch data', () => {
        expect(block).toMatch(/WITH\s+scoped\s+AS\s*\(/i);
        expect(block).toMatch(/locked\s+AS\s*\(/i);
        expect(block).toMatch(/FROM\s+locked\s+l/i);
    });

    test('reports per-group paid counts so AP can see partial payment', () => {
        expect(block).toMatch(/paid_count/);
        expect(block).toMatch(/unpaid_net_pay/);
    });

    test('batch_count correlates on CTE aliases, not raw pt/e columns under GROUP BY', () => {
        expect(block).toMatch(/COALESCE\(pb\.client,\s*''\)\s*=\s*COALESCE\(l\.client,\s*''\)/);
        expect(block).toMatch(/COALESCE\(pb\.contract_name,\s*''\)\s*=\s*COALESCE\(l\.contract_name,\s*''\)/);
        expect(block).not.toMatch(/COALESCE\(COALESCE\(pt\.client,\s*e\.client\)/);
    });
});

describe('POST /api/ap/payroll-queue confirm SQL shape', () => {
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const marker = '// POST /api/ap/payroll-queue/:year/:month/confirm';
    const start = serverSrc.indexOf(marker);
    const end = serverSrc.indexOf("app.get('/api/ap/bills-queue'", start);
    const block = serverSrc.slice(start, end);

    test('does not use expression ON CONFLICT (Postgres cannot infer the unique index)', () => {
        expect(block).not.toMatch(/ON CONFLICT \(batch_type,\s*year,\s*month/);
        expect(block).toMatch(/INSERT INTO payment_batches/);
        expect(block).toMatch(/UPDATE payment_batches/);
    });

    test('accepts employee_ids for partial payment', () => {
        expect(block).toMatch(/employee_ids/);
        expect(block).toMatch(/already_paid/);
    });
});
