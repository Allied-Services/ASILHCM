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
    test('refuses empty query (no q, org, or browse)', () => {
        const parsed = parseDirectoryQuery({});
        expect(parsed.allowed).toBe(false);
        expect(parsed.active).toBe('all');
        expect(parsed.limit).toBe(50);
        expect(parsed.page).toBe(1);
    });

    test('allows q of 2+ characters', () => {
        expect(parseDirectoryQuery({ q: 'a' }).allowed).toBe(false);
        expect(parseDirectoryQuery({ q: 'ah' }).allowed).toBe(true);
    });

    test('allows org filter or browse=1', () => {
        expect(parseDirectoryQuery({ client: 'Wafi Energy Pakistan' }).allowed).toBe(true);
        expect(parseDirectoryQuery({ browse: '1' }).allowed).toBe(true);
        expect(parseDirectoryQuery({ active: 'all' }).allowed).toBe(false);
        expect(parseDirectoryQuery({ active: 'yes' }).allowed).toBe(false);
    });

    test('caps limit at 100 and defaults sort to name', () => {
        const parsed = parseDirectoryQuery({ q: 'ah', limit: '500', sort: 'nope', page: '2' });
        expect(parsed.limit).toBe(100);
        expect(parsed.sort).toBe('name');
        expect(parsed.offset).toBe(100);
    });
});

describe('buildDirectorySql', () => {
    test('includes visibility, client filter, pagination, and no contract_start_date subquery', () => {
        const parsed = parseDirectoryQuery({ client: 'Wafi Energy Pakistan', page: '1', limit: '50' });
        const { sql, params } = buildDirectorySql(parsed, { archive: false });
        expect(sql).toMatch(/COUNT\(\*\) OVER\(\)/);
        expect(sql).toMatch(/LIMIT \$2 OFFSET \$3/);
        expect(sql).not.toMatch(/contract_start_date/);
        expect(sql).toMatch(/LOWER\(TRIM\(e\.client\)\)/);
        expect(params).toEqual(['Wafi Energy Pakistan', 50, 0]);
        expect(sql).toMatch(/last_working_day/);
    });

    test('q matches name, id, and digit-stripped CNIC', () => {
        const parsed = parseDirectoryQuery({ q: '42101-3344' });
        const { sql, params } = buildDirectorySql(parsed, { archive: true });
        expect(sql).toMatch(/e\.name ILIKE/);
        expect(sql).toMatch(/regexp_replace/);
        expect(params[0]).toBe('%42101-3344%');
        expect(params[1]).toBe('421013344%');
        expect(sql).not.toMatch(/last_working_day/);
    });

    test('Inactive does not require active=Yes (cutover visibility used to hide every leaver)', () => {
        const parsed = parseDirectoryQuery({ q: 'Dabeer', active: 'no' });
        const { sql } = buildDirectorySql(parsed, { archive: false });
        expect(sql).toMatch(/'no','false','0','inactive'/);
        expect(sql).not.toMatch(/IN \('yes','true','1','active',''\)/);
        expect(sql).not.toMatch(/last_working_day/);
    });

    test('All omits the active flag filter', () => {
        const parsed = parseDirectoryQuery({ q: 'Dabeer', active: 'all' });
        const { sql } = buildDirectorySql(parsed, { archive: false });
        expect(sql).not.toMatch(/'no','false','0','inactive'/);
        expect(sql).not.toMatch(/IN \('yes','true','1','active',''\)/);
    });

    test('cascade filters bind bu, contract, client BU, location, dept', () => {
        const parsed = parseDirectoryQuery({
            bu: 'Outsourcing',
            client: 'Wafi Energy Pakistan',
            contractId: 'CTR-1',
            clientBu: 'Retail',
            location: 'Karachi',
            dept: 'Security Services',
        });
        const { sql, params } = buildDirectorySql(parsed, { archive: true });
        expect(sql).toMatch(/e\.bu/);
        expect(sql).toMatch(/e\.contract_id = \$3/);
        expect(sql).toMatch(/e\.client_bu/);
        expect(sql).toMatch(/e\.location/);
        expect(sql).toMatch(/e\.dept/);
        expect(params.slice(0, 6)).toEqual([
            'Outsourcing',
            'Wafi Energy Pakistan',
            'CTR-1',
            'Retail',
            'Karachi',
            'Security Services',
        ]);
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
            bank_name: 'HBL',
            father_name: 'should not appear',
        });
        expect(Object.keys(dto).sort()).toEqual([...SLIM_KEYS].sort());
        expect(dto.clientBU).toBe('Trading');
        expect(dto.salary).toBe(38000);
        expect(dto.bankName).toBeUndefined();
        expect(dto.fatherName).toBeUndefined();
    });
});

describe('GET /api/employees/directory', () => {
    test('unauthenticated → 401', async () => {
        const res = await request().get('/api/employees/directory?browse=1');
        expect(res.status).toBe(401);
    });

    test('no filter and no browse → 400', async () => {
        const res = await request()
            .get('/api/employees/directory')
            .set('Authorization', `Bearer ${makeToken({ role: 'operations' })}`);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('DIRECTORY_QUERY_REQUIRED');
    });

    test('operations may search; returns slim rows and total', async () => {
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
                    total: 1,
                    bank_name: 'HBL',
                }],
            });

        const res = await request()
            .get('/api/employees/directory?q=Ahmad&page=1')
            .set('Authorization', `Bearer ${makeToken({ role: 'operations' })}`);

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.page).toBe(1);
        expect(res.body.employees).toHaveLength(1);
        expect(res.body.employees[0].name).toBe('Ahmad Hussain');
        expect(res.body.employees[0].bank_name).toBeUndefined();
        expect(res.body.employees[0].fatherName).toBeUndefined();
        const listSql = mockPool.query.mock.calls.find((c) => String(c[0]).includes('COUNT(*) OVER()'));
        expect(listSql).toBeTruthy();
        expect(String(listSql[0])).not.toMatch(/contract_start_date/);
    });
});
