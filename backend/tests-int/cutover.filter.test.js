'use strict';

const { pool, truncateAll } = require('./setup');
const cutover = require('../src/core/cutover');

describe('cutover filter integration', () => {
    beforeEach(async () => {
        await truncateAll();
        await pool.query(`INSERT INTO employees (id, name, active, last_working_day, client) VALUES
            ('CUT-ACTIVE-JUL', 'Active Jul', 'Yes', NULL, 'Test'),
            ('CUT-EXIT-JUN', 'Exit Jun', 'Yes', '2026-06-15', 'Test'),
            ('CUT-INACTIVE', 'Inactive', 'No', NULL, 'Test')`);
    });

    test('employeeVisibilityClause excludes pre-cutover exits in normal mode', async () => {
        const vis = cutover.employeeVisibilityClause('e', { archive: false });
        const { rows } = await pool.query(`SELECT id FROM employees e WHERE id LIKE 'CUT-%' AND ${vis}`);
        const ids = rows.map(r => r.id);
        expect(ids).toContain('CUT-ACTIVE-JUL');
        expect(ids).not.toContain('CUT-EXIT-JUN');
        expect(ids).not.toContain('CUT-INACTIVE');
    });

    test('archive mode includes all cutover fixture employees', async () => {
        const { rows } = await pool.query(
            `SELECT id FROM employees e WHERE id LIKE 'CUT-%' AND ${cutover.employeeVisibilityClause('e', { archive: true })}`
        );
        expect(rows.length).toBe(3);
    });
});
