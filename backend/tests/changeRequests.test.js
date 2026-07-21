'use strict';

const { mockPool, makeToken, makePortalToken } = require('./setup');

let app;
let sendJazzSMS;
beforeAll(() => {
  jest.resetModules();
  ({ sendJazzSMS } = require('../lib/sms'));
  app = require('../server');
});

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  sendJazzSMS.mockClear();
});

afterAll(async () => {
  await mockPool.end();
});

const request = () => require('supertest')(app);

describe('Employee change-request loop', () => {
  test('portal worker submits change request with old value snapshot', async () => {
    const portalToken = makePortalToken({ employeeId: 'ASIL-001' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ name: 'Ali Khan', email: null, primary_contact: '03001234567', current_val: 'Old Address' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          employee_id: 'ASIL-001',
          employee_name: 'Ali Khan',
          field_name: 'present_address',
          field_label: 'Present Address',
          old_value: 'Old Address',
          new_value: 'New Address',
          status: 'Pending',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // portal_change_request_settings → defaults

    const res = await request()
      .post('/api/portal/change-request')
      .set('Authorization', `Bearer ${portalToken}`)
      .send({ field_name: 'present_address', new_value: 'New Address' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.request.old_value).toBe('Old Address');
    expect(res.body.request.new_value).toBe('New Address');
  });

  test('rejects non-whitelisted field from portal', async () => {
    const portalToken = makePortalToken();

    const res = await request()
      .post('/api/portal/change-request')
      .set('Authorization', `Bearer ${portalToken}`)
      .send({ field_name: 'salary', new_value: '999999' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be changed via the portal/i);
  });

  test('operations role lists pending requests', async () => {
    const token = makeToken({ role: 'operations', email: 'ops@asil.com.pk' });
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        employee_id: 'ASIL-001',
        employee_name: 'Ali Khan',
        field_label: 'Present Address',
        old_value: 'Old Address',
        new_value: 'New Address',
        status: 'Pending',
        designation: 'Guard',
        client: 'WAFI',
      }],
    });

    const res = await request()
      .get('/api/change-requests?status=Pending')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
  });

  test('ar_team is blocked from change-requests queue → 403', async () => {
    const token = makeToken({ role: 'ar_team' });

    const res = await request()
      .get('/api/change-requests')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('designated HCM approver applies new value to employees table', async () => {
    const token = makeToken({ role: 'operations_supervisor', email: 'rabia.bhutto@asil.com.pk' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // settings → default Rabia
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          employee_id: 'ASIL-001',
          employee_name: 'Ali Khan',
          field_name: 'present_address',
          field_label: 'Present Address',
          old_value: 'Old Address',
          new_value: 'New Address',
          status: 'Pending',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE employees
      .mockResolvedValueOnce({ rows: [] }) // UPDATE change_requests
      .mockResolvedValueOnce({ rows: [{ primary_contact: '03001234567', email: null }] })
      .mockResolvedValueOnce({ rows: [] }); // employee_messages

    const res = await request()
      .patch('/api/change-requests/1/approve')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPool.query.mock.calls[2][0]).toMatch(/UPDATE employees SET present_address/i);
    expect(mockPool.query.mock.calls[2][1]).toEqual(['New Address', 'ASIL-001']);
  });

  test('non-approver ops email cannot approve → 403', async () => {
    const token = makeToken({ role: 'operations', email: 'ops@asil.com.pk' });
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // settings → Rabia only

    const res = await request()
      .patch('/api/change-requests/1/approve')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  test('reject stores reviewer note', async () => {
    const token = makeToken({ role: 'operations_supervisor', email: 'rabia.bhutto@asil.com.pk' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // settings
      .mockResolvedValueOnce({
        rows: [{
          id: 2,
          employee_id: 'ASIL-001',
          field_name: 'present_address',
          field_label: 'Present Address',
          status: 'Pending',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ primary_contact: '03001234567', email: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request()
      .patch('/api/change-requests/2/reject')
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Incomplete documentation' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPool.query.mock.calls[2][1]).toEqual(['rabia.bhutto@asil.com.pk', 'Incomplete documentation', 2]);
  });
});
