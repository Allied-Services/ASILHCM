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

    test('aggregates locked rows in a CTE named locked', () => {
        expect(block).toMatch(/WITH\s+locked\s+AS\s*\(/i);
        expect(block).toMatch(/FROM\s+locked\s+l/i);
    });

    test('batch_count correlates on CTE aliases, not raw pt/e columns under GROUP BY', () => {
        expect(block).toMatch(/COALESCE\(pb\.client,\s*''\)\s*=\s*COALESCE\(l\.client,\s*''\)/);
        expect(block).toMatch(/COALESCE\(pb\.contract_name,\s*''\)\s*=\s*COALESCE\(l\.contract_name,\s*''\)/);
        expect(block).not.toMatch(/COALESCE\(COALESCE\(pt\.client,\s*e\.client\)/);
    });
});
