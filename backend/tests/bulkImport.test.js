'use strict';

const { mockPool, makeToken } = require('./setup');

let app;
beforeAll(() => {
  jest.resetModules();
  app = require('../server');
});

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  global.fetch.mockClear();
});

afterAll(async () => {
  await mockPool.end();
});

const request = () => require('supertest')(app);

const baseEmployee = {
  id: 'ASIL-NEW-001',
  name: 'Import Test',
  cnic: '12345-1234567-1',
  active: 'Yes',
};

describe('POST /api/employees/bulk', () => {
  test('happy-path upsert saves employee', async () => {
    const token = makeToken({ role: 'superadmin' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // contracts
      .mockResolvedValueOnce({ rows: [] }) // batch id lookup
      .mockResolvedValueOnce({ rows: [] }) // batch cnic lookup
      .mockResolvedValueOnce({
        rows: [{ ...baseEmployee, primary_contact: '03001234567', is_new_row: true }],
      });

    const res = await request()
      .post('/api/employees/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ employees: [baseEmployee] });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(1);
    expect(res.body.errors).toHaveLength(0);
  });

  test('rejects unknown contract name', async () => {
    const token = makeToken({ role: 'superadmin' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request()
      .post('/api/employees/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ employees: [{ ...baseEmployee, contractName: 'Unknown Contract XYZ' }] });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(0);
    expect(res.body.errors[0].error).toMatch(/Contract "Unknown Contract XYZ" not found/i);
  });

  test('rejects CNIC already belonging to a different employee ID', async () => {
    const token = makeToken({ role: 'superadmin' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ASIL-OTHER', cnic: baseEmployee.cnic }] });

    const res = await request()
      .post('/api/employees/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ employees: [baseEmployee] });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(0);
    expect(res.body.errors[0].error).toMatch(/already belongs to employee ASIL-OTHER/i);
  });

  test('rejects existing ID with mismatched CNIC', async () => {
    const token = makeToken({ role: 'superadmin' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: baseEmployee.id, cnic: '99999-9999999-9' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request()
      .post('/api/employees/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ employees: [baseEmployee] });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(0);
    expect(res.body.errors[0].error).toMatch(/Employee ID\/CNIC mismatch/i);
  });

  test('notifyNew sends welcome SMS only for new rows', async () => {
    const token = makeToken({ role: 'superadmin' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: baseEmployee.id,
          name: baseEmployee.name,
          cnic: baseEmployee.cnic,
          primary_contact: '03001234567',
          active: 'Yes',
          is_new_row: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // employee_messages insert

    const res = await request()
      .post('/api/employees/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ employees: [baseEmployee], notifyNew: true });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(1);
    expect(res.body.smsSent).toEqual([baseEmployee.id]);
    expect(global.fetch).toHaveBeenCalled();
  });
});
