'use strict';

const { mockPool, makeToken } = require('./setup');
const {
    parseDirectoryQuery,
    buildDirectorySql,
    rowToDirectoryDto,
    SLIM_KEYS,
} = require('../src/modules/employees/directory');

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

describe('parseDirectoryQuery', () => {
    test('allows search, org filters, or browse — not only client+contract', () => {
        expect(parseDirectoryQuery({}).allowed).toBe(false);
        expect(parseDirectoryQuery({ q: 'a' }).allowed).toBe(false);
        expect(parseDirectoryQuery({ q: 'Ahmad' }).allowed).toBe(true);
        expect(parseDirectoryQuery({ browse: '1' }).allowed).toBe(true);
        expect(parseDirectoryQuery({ bu: 'Outsourcing' }).allowed).toBe(true);
        expect(parseDirectoryQuery({ client: 'Wafi Energy Pakistan' }).allowed).toBe(true);
        expect(parseDirectoryQuery({ client: 'Wafi Energy Pakistan', contractId: 'CTR-1' }).allowed).toBe(true);
    });

    test('caps limit at 500 and defaults sort to name', () => {
        const parsed = parseDirectoryQuery({
            client: 'Wafi',
            contractId: 'CTR-1',
            limit: '900',
            sort: 'nope',
            page: '2',
        });
        expect(parsed.limit).toBe(500);
        expect(parsed.sort).toBe('name');
        expect(parsed.offset).toBe(500);
    });
});

describe('buildDirectorySql', () => {
    test('includes visibility, client+contract, designation, pagination', () => {
        const parsed = parseDirectoryQuery({
            client: 'Wafi Energy Pakistan',
            contractId: 'CTR-1',
            designation: 'Guard',
            page: '1',
            limit: '50',
        });
        const { sql, params } = buildDirectorySql(parsed, { archive: false });
        expect(sql).toMatch(/COUNT\(\*\) OVER\(\)/);
        expect(sql).toMatch(/e\.contract_id = \$2/);
        expect(sql).toMatch(/e\.designation/);
        expect(sql).toMatch(/last_working_day/);
        expect(params.slice(0, 3)).toEqual(['Wafi Energy Pakistan', 'CTR-1', 'Guard']);
    });

    test('Active uses last working day, not only the stored flag', () => {
        const parsed = parseDirectoryQuery({
            client: 'Wafi',
            contractId: 'CTR-1',
            active: 'yes',
        });
        const { sql } = buildDirectorySql(parsed, { archive: true });
        expect(sql).toMatch(/CURRENT_DATE/);
        expect(sql).toMatch(/last_working_day/);
    });

    test('Inactive includes past last working day even if flag is still Yes', () => {
        const parsed = parseDirectoryQuery({
            client: 'Wafi',
            contractId: 'CTR-1',
            active: 'no',
        });
        const { sql } = buildDirectorySql(parsed, { archive: true });
        expect(sql).toMatch(/last_working_day < CURRENT_DATE/);
    });
});

describe('rowToDirectoryDto', () => {
    test('exposes only slim list keys', () => {
        const dto = rowToDirectoryDto({
            id: 'ASIL/WAFI-012',
            name: 'Ahmad Hussain',
            cnic: '42101-3344556-7',
            bu: 'Outsourcing',
            client: 'Wafi',
            client_bu: 'Trading',
            dept: 'Security',
            designation: 'Guard',
            location: 'Karachi',
            province: 'Sindh',
            contract_name: 'LSC',
            contract_id: 'CTR-1',
            salary: '38000',
            active: 'Yes',
            email: 'a@x.com',
            primary_contact: '03001234567',
            claim_authority: 'focal@x.com',
            line_manager_email: 'lm@x.com',
            last_working_day: '2026-07-30',
            bank_name: 'HBL',
            father_name: 'should not appear',
        });
        expect(Object.keys(dto).sort()).toEqual([...SLIM_KEYS].sort());
        expect(dto.clientBU).toBe('Trading');
        expect(dto.lastWorkingDay).toBe('2026-07-30');
        expect(dto.bankName).toBeUndefined();
    });
});

describe('GET /api/employees/directory', () => {
    test('unauthenticated → 401', async () => {
        const res = await request().get('/api/employees/directory?client=Wafi&contractId=CTR-1');
        expect(res.status).toBe(401);
    });

    test('empty query → 400', async () => {
        const res = await request()
            .get('/api/employees/directory')
            .set('Authorization', `Bearer ${makeToken({ role: 'operations' })}`);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('DIRECTORY_QUERY_REQUIRED');
    });

    test('operations may load a contract roster', async () => {
        mockPool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({
                rows: [{
                    id: 'ASIL/WAFI-012',
                    name: 'Ahmad Hussain',
                    cnic: '42101-3344556-7',
                    bu: 'Outsourcing',
                    client: 'Wafi Energy Pakistan',
                    client_bu: 'Trading',
                    dept: 'Security',
                    designation: 'Guard',
                    location: 'Karachi',
                    province: 'Sindh',
                    contract_name: 'LSC',
                    contract_id: 'CTR-1',
                    salary: 38000,
                    active: 'Yes',
                    email: 'a@x.com',
                    primary_contact: '03001234567',
                    claim_authority: null,
                    line_manager_email: null,
                    last_working_day: null,
                    total: 1,
                    bank_name: 'HBL',
                }],
            });

        const res = await request()
            .get('/api/employees/directory?client=Wafi%20Energy%20Pakistan&contractId=CTR-1')
            .set('Authorization', `Bearer ${makeToken({ role: 'operations' })}`);

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.employees).toHaveLength(1);
        expect(res.body.employees[0].name).toBe('Ahmad Hussain');
        expect(res.body.employees[0].bank_name).toBeUndefined();
    });

    test('client without contract is allowed', async () => {
        mockPool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        const res = await request()
            .get('/api/employees/directory?client=Wafi%20Energy%20Pakistan')
            .set('Authorization', `Bearer ${makeToken({ role: 'operations' })}`);

        expect(res.status).toBe(200);
        expect(res.body.employees).toEqual([]);
    });
});
