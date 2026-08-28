'use strict';

const { mockPool, makeToken } = require('./setup');
const {
    normalizeCnic,
    hiddenFromDirectory,
    cnicTakenMessage,
    idExistsMessage,
    findEmployeeConflicts,
    mapEmployeeWriteError,
} = require('../src/modules/employees/employeeWrite');

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

const slashId = 'ASILFM/SPL/22/169';

describe('employeeWrite helpers', () => {
    test('normalizeCnic strips dashes and spaces', () => {
        expect(normalizeCnic('42101-1234567-1')).toBe('4210112345671');
        expect(normalizeCnic(' 42101 1234567 1 ')).toBe('4210112345671');
        expect(normalizeCnic('')).toBe('');
    });

    test('hiddenFromDirectory is true for leavers before cutover', () => {
        expect(hiddenFromDirectory({ active: 'Yes', last_working_day: '2026-06-30' })).toBe(true);
        expect(hiddenFromDirectory({ active: 'No', last_working_day: null })).toBe(true);
        expect(hiddenFromDirectory({ active: 'Yes', last_working_day: '2026-07-01' })).toBe(false);
        expect(hiddenFromDirectory({ active: 'Yes', last_working_day: null })).toBe(false);
    });

    test('cnicTakenMessage names the existing person and archive hint', () => {
        const msg = cnicTakenMessage({
            id: 'ASILFM/SPL/22/100',
            name: 'Existing Guard',
            hiddenFromList: true,
        }, '42101-1234567-1');
        expect(msg).toMatch(/Existing Guard/);
        expect(msg).toMatch(/ASILFM\/SPL\/22\/100/);
        expect(msg).toMatch(/archive/i);
    });

    test('idExistsMessage names the existing person', () => {
        expect(idExistsMessage({ id: slashId, name: 'New Hire', hiddenFromList: false }))
            .toMatch(/ASILFM\/SPL\/22\/169 already exists as New Hire/);
    });

    test('findEmployeeConflicts matches digit-normalized CNIC on a different id', async () => {
        mockPool.query.mockResolvedValueOnce({
            rows: [{
                id: 'ASIL/SPL-001/21',
                name: 'Old Record',
                cnic: '4210112345671',
                active: 'No',
                last_working_day: '2026-05-01',
            }],
        });
        const found = await findEmployeeConflicts(mockPool, {
            id: slashId,
            cnic: '42101-1234567-1',
        });
        expect(found.byId).toBe(null);
        expect(found.byCnic.id).toBe('ASIL/SPL-001/21');
        expect(found.byCnic.hiddenFromList).toBe(true);
    });

    test('mapEmployeeWriteError maps unique CNIC to 409', () => {
        const mapped = mapEmployeeWriteError(
            { code: '23505', constraint: 'employees_cnic_key' },
            { cnic: '42101-1234567-1' }
        );
        expect(mapped.status).toBe(409);
        expect(mapped.body.code).toBe('CNIC_TAKEN');
        expect(mapped.body.error).toMatch(/42101-1234567-1/);
    });

    test('mapEmployeeWriteError maps invalid date to 400', () => {
        const mapped = mapEmployeeWriteError({ code: '22007' });
        expect(mapped.status).toBe(400);
        expect(mapped.body.code).toBe('INVALID_DATE');
    });
});

describe('POST /api/employees', () => {
    const token = () => makeToken({ role: 'operations' });
    const payload = {
        id: slashId,
        name: 'Test FM Guard',
        cnic: '42101-1234567-1',
        active: 'Yes',
        salary: 40000,
    };

    test('slash-coded FM id inserts when no conflict', async () => {
        mockPool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({
                rows: [{
                    id: slashId,
                    name: payload.name,
                    cnic: payload.cnic,
                    salary: 40000,
                    active: 'Yes',
                }],
            });

        const res = await request()
            .post('/api/employees')
            .set('Authorization', `Bearer ${token()}`)
            .send(payload);

        expect(res.status).toBe(200);
        expect(res.body.employee.id).toBe(slashId);
        const insertSql = mockPool.query.mock.calls[1][0];
        expect(insertSql).toMatch(/INSERT INTO employees/i);
        expect(mockPool.query.mock.calls[1][1][0]).toBe(slashId);
    });

    test('returns 409 when CNIC belongs to a hidden employee with a different code', async () => {
        mockPool.query.mockResolvedValueOnce({
            rows: [{
                id: 'ASIL/SPL-001/21',
                name: 'Old Record',
                cnic: '42101-1234567-1',
                active: 'No',
                last_working_day: '2026-05-01',
            }],
        });

        const res = await request()
            .post('/api/employees')
            .set('Authorization', `Bearer ${token()}`)
            .send(payload);

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('CNIC_TAKEN');
        expect(res.body.error).toMatch(/Old Record/);
        expect(res.body.error).toMatch(/ASIL\/SPL-001\/21/);
        expect(res.body.error).toMatch(/archive/i);
        expect(res.body.existing.id).toBe('ASIL/SPL-001/21');
        expect(mockPool.query.mock.calls).toHaveLength(1);
    });

    test('returns 400 when name is missing', async () => {
        const res = await request()
            .post('/api/employees')
            .set('Authorization', `Bearer ${token()}`)
            .send({ id: slashId, cnic: '42101-1234567-1' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/name/i);
        expect(mockPool.query).not.toHaveBeenCalled();
    });

    test('maps unique-violation on insert to 409', async () => {
        const dup = new Error('duplicate key');
        dup.code = '23505';
        dup.constraint = 'employees_cnic_key';
        mockPool.query
            .mockResolvedValueOnce({ rows: [] })
            .mockRejectedValueOnce(dup);

        const res = await request()
            .post('/api/employees')
            .set('Authorization', `Bearer ${token()}`)
            .send(payload);

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('CNIC_TAKEN');
    });
});

describe('GET /api/employees/lookup', () => {
    test('returns byId for a slash-coded FM employee', async () => {
        mockPool.query.mockResolvedValueOnce({
            rows: [{
                id: slashId,
                name: 'Hidden Guard',
                cnic: '42101-9999999-1',
                active: 'Yes',
                last_working_day: '2026-06-15',
            }],
        });

        const res = await request()
            .get(`/api/employees/lookup?id=${encodeURIComponent(slashId)}`)
            .set('Authorization', `Bearer ${makeToken()}`);

        expect(res.status).toBe(200);
        expect(res.body.byId.id).toBe(slashId);
        expect(res.body.byId.hiddenFromList).toBe(true);
        expect(res.body.byId.name).toBe('Hidden Guard');
    });
});
