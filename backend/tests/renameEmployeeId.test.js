'use strict';

const {
    normalizeEmployeeId,
    quoteIdent,
    renameEmployeeId,
} = require('../src/modules/employees/renameEmployeeId');
const { mockPool, makeToken } = require('./setup');

function makeClient({ found = true, taken = false, row, tables = ['payroll_transactions', 'employee_claims'] } = {}) {
    const queries = [];
    const employee = row || {
        id: 'ASIL-1787922714735',
        name: 'Test Person',
        salary: 50000,
        updated_at: new Date('2026-08-01'),
    };
    const client = {
        queries,
        release: jest.fn(),
        async query(sql, params) {
            queries.push({ sql, params: params || [] });
            const s = String(sql);
            if (/^BEGIN/i.test(s) || /^COMMIT/i.test(s) || /^ROLLBACK/i.test(s)) return { rows: [] };
            if (s.includes('FOR UPDATE')) {
                return { rows: found ? [{ id: params[0] }] : [] };
            }
            if (/SELECT id FROM employees WHERE id=\$1\s*$/.test(s.replace(/\s+/g, ' ').trim())) {
                return { rows: taken ? [{ id: params[0] }] : [] };
            }
            if (s.includes('SELECT * FROM employees')) {
                return { rows: found ? [employee] : [] };
            }
            if (s.includes('INSERT INTO employees')) return { rows: [], rowCount: 1 };
            if (s.includes('information_schema.columns')) {
                return { rows: tables.map((table_name) => ({ table_name, column_name: 'employee_id' })) };
            }
            if (s.includes('information_schema.table_constraints')) {
                return { rows: [{ table_name: 'payroll_transactions', column_name: 'employee_id' }] };
            }
            if (/^UPDATE /i.test(s)) return { rows: [], rowCount: 1 };
            if (s.includes('DELETE FROM employees')) return { rows: [], rowCount: 1 };
            return { rows: [] };
        },
    };
    return client;
}

describe('normalizeEmployeeId', () => {
    test('accepts slash staff codes', () => {
        expect(normalizeEmployeeId('  ASILFM/SPL/22/167  ')).toBe('ASILFM/SPL/22/167');
    });

    test('rejects empty and illegal characters', () => {
        expect(() => normalizeEmployeeId('')).toThrow(/required/i);
        expect(() => normalizeEmployeeId('ASIL FM')).toThrow(/letters/i);
        expect(() => normalizeEmployeeId("ASIL';DROP")).toThrow(/letters/i);
    });
});

describe('quoteIdent', () => {
    test('quotes safe names and rejects injection', () => {
        expect(quoteIdent('payroll_transactions')).toBe('"payroll_transactions"');
        expect(() => quoteIdent('payroll_transactions;drop')).toThrow();
    });
});

describe('renameEmployeeId', () => {
    test('no-ops when the code is unchanged', async () => {
        const pool = { connect: jest.fn() };
        const result = await renameEmployeeId(pool, 'ASIL-1', 'ASIL-1');
        expect(result).toEqual({ renamed: false, id: 'ASIL-1' });
        expect(pool.connect).not.toHaveBeenCalled();
    });

    test('404 when the current employee is missing', async () => {
        const client = makeClient({ found: false });
        const pool = { connect: jest.fn().mockResolvedValue(client) };
        await expect(renameEmployeeId(pool, 'ASIL-OLD', 'ASILFM/SPL/22/167'))
            .rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
        expect(client.queries.some((q) => /^ROLLBACK/i.test(q.sql))).toBe(true);
        expect(client.release).toHaveBeenCalled();
    });

    test('409 when the new code is already taken', async () => {
        const client = makeClient({ taken: true });
        const pool = { connect: jest.fn().mockResolvedValue(client) };
        await expect(renameEmployeeId(pool, 'ASIL-OLD', 'ASILFM/SPL/22/167'))
            .rejects.toMatchObject({ status: 409, code: 'ID_TAKEN' });
    });

    test('copies the row, rewrites child ids, deletes the old id', async () => {
        const client = makeClient();
        const pool = { connect: jest.fn().mockResolvedValue(client) };
        const result = await renameEmployeeId(pool, 'ASIL-1787922714735', 'ASILFM/SPL/22/167');
        expect(result.renamed).toBe(true);
        expect(result.id).toBe('ASILFM/SPL/22/167');
        expect(result.from).toBe('ASIL-1787922714735');

        const insert = client.queries.find((q) => q.sql.includes('INSERT INTO employees'));
        expect(insert.params[0]).toBe('ASILFM/SPL/22/167');
        expect(insert.params[1]).toBe('Test Person');

        const updates = client.queries.filter((q) => /^UPDATE /i.test(q.sql));
        expect(updates.length).toBeGreaterThanOrEqual(2);
        expect(updates.every((q) => q.params[0] === 'ASILFM/SPL/22/167' && q.params[1] === 'ASIL-1787922714735')).toBe(true);

        const del = client.queries.find((q) => q.sql.includes('DELETE FROM employees'));
        expect(del.params).toEqual(['ASIL-1787922714735']);
        expect(client.queries.some((q) => /^COMMIT/i.test(q.sql))).toBe(true);
        expect(client.release).toHaveBeenCalled();
    });
});

let app;
beforeAll(() => {
    jest.resetModules();
    app = require('../server');
});

beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterAll(async () => {
    await mockPool.end();
});

const request = () => require('supertest')(app);

describe('PUT /api/employees/:id rename', () => {
    test('superadmin can change id including slashes; lookup uses the old code', async () => {
        const client = makeClient();
        mockPool.connect = jest.fn().mockResolvedValue(client);
        mockPool.query.mockImplementation(async (sql) => {
            if (String(sql).includes('UPDATE employees SET')) {
                return {
                    rows: [{
                        id: 'ASILFM/SPL/22/167',
                        name: 'Test Person',
                        salary: 50000,
                        claim_authority: null,
                        line_manager_name: null,
                        line_manager_email: null,
                    }],
                };
            }
            return { rows: [], rowCount: 0 };
        });

        const res = await request()
            .put('/api/employees/ASIL-1787922714735')
            .set('Authorization', `Bearer ${makeToken({ role: 'superadmin' })}`)
            .send({
                id: 'ASILFM/SPL/22/167',
                name: 'Test Person',
            });

        expect(res.status).toBe(200);
        expect(res.body.employee.id).toBe('ASILFM/SPL/22/167');
        const updateCall = mockPool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE employees SET'));
        expect(updateCall).toBeTruthy();
        expect(updateCall[1]).toContain('ASILFM/SPL/22/167');
        expect(client.queries.some((q) => q.sql.includes('INSERT INTO employees'))).toBe(true);
    });

    test('encoded slash in the URL still updates the existing person', async () => {
        mockPool.connect = jest.fn();
        mockPool.query.mockImplementation(async (sql) => {
            if (String(sql).includes('UPDATE employees SET')) {
                return {
                    rows: [{
                        id: 'ASILFM/SPL/22/167',
                        name: 'Test Person',
                        salary: 50000,
                        claim_authority: null,
                        line_manager_name: null,
                        line_manager_email: null,
                    }],
                };
            }
            return { rows: [], rowCount: 0 };
        });

        const encoded = encodeURIComponent('ASILFM/SPL/22/167');
        const res = await request()
            .put(`/api/employees/${encoded}`)
            .set('Authorization', `Bearer ${makeToken({ role: 'superadmin' })}`)
            .send({
                id: 'ASILFM/SPL/22/167',
                name: 'Test Person',
            });

        expect(res.status).toBe(200);
        expect(mockPool.connect).not.toHaveBeenCalled();
        const updateCall = mockPool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE employees SET'));
        expect(updateCall[1]).toContain('ASILFM/SPL/22/167');
    });

    test('operations cannot change employee code', async () => {
        mockPool.connect = jest.fn();
        const res = await request()
            .put('/api/employees/ASIL-1787922714735')
            .set('Authorization', `Bearer ${makeToken({ role: 'operations' })}`)
            .send({
                id: 'ASILFM/SPL/22/167',
                name: 'Test Person',
            });
        expect(res.status).toBe(403);
        expect(mockPool.connect).not.toHaveBeenCalled();
    });
});
