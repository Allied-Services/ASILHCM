'use strict';

const {
    routingFieldsFromBody,
    routingFieldsFromRow,
    resolveFocalEmail,
} = require('../src/modules/employees/contactEmails');
const { mockPool, makeToken } = require('./setup');

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

describe('routingFieldsFromBody', () => {
    test('maps camelCase Focal + LM and blanks N/A', () => {
        expect(routingFieldsFromBody({
            claimAuthority: 'Akhtar.Ali@wafi-energy.com',
            lineManagerName: 'N/A',
            lineManagerEmail: '-',
        })).toEqual({
            claim_authority: 'Akhtar.Ali@wafi-energy.com',
            line_manager_name: null,
            line_manager_email: null,
        });
    });

    test('does not copy supervisor into Line Manager', () => {
        expect(routingFieldsFromBody({
            lineManagerEmail: '',
            supervisorEmail: 'legacy@wafi-energy.com',
        })).toEqual({
            claim_authority: null,
            line_manager_name: null,
            line_manager_email: null,
        });
    });

    test('Amjad-shaped LM only', () => {
        expect(routingFieldsFromBody({
            claimAuthority: '',
            lineManagerName: 'Muhammad Aamir',
            lineManagerEmail: 'M.Aamir@wafi-energy.com',
        })).toEqual({
            claim_authority: null,
            line_manager_name: 'Muhammad Aamir',
            line_manager_email: 'M.Aamir@wafi-energy.com',
        });
    });
});

describe('routingFieldsFromRow', () => {
    test('Ahmad-shaped Focal only — no supervisor fallback on LM', () => {
        const mapped = routingFieldsFromRow({
            claim_authority: 'akhtar.ali@wafi-energy.com',
            line_manager_name: null,
            line_manager_email: null,
            supervisor_email: 'legacy-supervisor@wafi-energy.com',
        });
        expect(mapped.claimAuthority).toBe('akhtar.ali@wafi-energy.com');
        expect(mapped.lineManagerEmail).toBe(null);
        expect(resolveFocalEmail(mapped)).toBe('akhtar.ali@wafi-energy.com');
    });
});

describe('PUT /api/employees/:id claims routing', () => {
    test('writes claim_authority and clears N/A line manager', async () => {
        const token = makeToken({ role: 'operations' });
        mockPool.query.mockResolvedValueOnce({
            rows: [{
                id: 'ASIL-TEST-FOCAL',
                name: 'Ahmad Hussain',
                claim_authority: 'akhtar.ali@wafi-energy.com',
                line_manager_name: null,
                line_manager_email: null,
                salary: 0,
            }],
        });

        const res = await request()
            .put('/api/employees/ASIL-TEST-FOCAL')
            .set('Authorization', `Bearer ${token}`)
            .send({
                name: 'Ahmad Hussain',
                claimAuthority: 'akhtar.ali@wafi-energy.com',
                lineManagerName: 'N/A',
                lineManagerEmail: 'n/a',
            });

        expect(res.status).toBe(200);
        const [sql, vals] = mockPool.query.mock.calls[0];
        expect(sql).toMatch(/claim_authority=/);
        expect(sql).toMatch(/line_manager_email=/);
        expect(sql).not.toMatch(/supervisor_email=/);
        expect(vals).toContain('akhtar.ali@wafi-energy.com');
        const claimIdx = sql.match(/claim_authority=\$(\d+)/);
        const lmEmailIdx = sql.match(/line_manager_email=\$(\d+)/);
        expect(claimIdx).toBeTruthy();
        expect(lmEmailIdx).toBeTruthy();
        expect(vals[Number(claimIdx[1]) - 1]).toBe('akhtar.ali@wafi-energy.com');
        expect(vals[Number(lmEmailIdx[1]) - 1]).toBe(null);
        expect(res.body.employee.claimAuthority).toBe('akhtar.ali@wafi-energy.com');
        expect(res.body.employee.lineManagerEmail).toBe(null);
    });

    test('omits claim_authority when the client did not send Focal', async () => {
        const token = makeToken({ role: 'operations' });
        mockPool.query.mockResolvedValueOnce({
            rows: [{
                id: 'ASIL-TEST-FOCAL',
                name: 'Ahmad Hussain',
                claim_authority: 'akhtar.ali@wafi-energy.com',
                salary: 0,
            }],
        });

        const res = await request()
            .put('/api/employees/ASIL-TEST-FOCAL')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Ahmad Hussain', email: 'ahmad@gmail.com' });

        expect(res.status).toBe(200);
        const [sql] = mockPool.query.mock.calls[0];
        expect(sql).not.toMatch(/claim_authority=/);
    });
});
