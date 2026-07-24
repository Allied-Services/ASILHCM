'use strict';

const jwt = require('jsonwebtoken');
const { mockPool, makeToken, makePortalToken } = require('./setup');

let app;
let sendJazzOtpSMS;
beforeAll(() => {
  jest.resetModules();
  ({ sendJazzOtpSMS } = require('../lib/sms'));
  app = require('../server');
});

beforeEach(() => {
  mockPool.query.mockReset();
  mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  sendJazzOtpSMS.mockClear();
});

afterAll(async () => {
  await mockPool.end();
});

const request = () => require('supertest')(app);

describe('POST /api/portal/request-otp', () => {
  test('normalizes 92300… format and sends OTP → 200 (SMS when no email)', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'ASIL-001', name: 'Ali Khan', email: null, primary_contact: '03001234567' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request()
      .post('/api/portal/request-otp')
      .send({ phone: '923001234567' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.employeeName).toBe('Ali Khan');
    expect(res.body.channel).toBe('sms');
    expect(mockPool.query.mock.calls[0][1]).toEqual(['03001234567']);
    expect(sendJazzOtpSMS).toHaveBeenCalled();
  });

  test('returns 404 when no active employee matches phone', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request()
      .post('/api/portal/request-otp')
      .send({ phone: '03009999999' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No active employee/i);
  });

  test('returns 400 when phone and employeeId are missing', async () => {
    const res = await request()
      .post('/api/portal/request-otp')
      .send({});

    expect(res.status).toBe(400);
  });

  test('looks up by employee code', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'ASIL-001', name: 'Ali Khan', email: null, primary_contact: '03001234567' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request()
      .post('/api/portal/request-otp')
      .send({ employeeId: 'ASIL-001' });

    expect(res.status).toBe(200);
    expect(res.body.employeeId).toBe('ASIL-001');
  });

  test('returns 409 NO_CONTACT_CHANNEL when employee has no email or phone', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'ASIL-002', name: 'No Contact', email: null, primary_contact: null }],
    });

    const res = await request()
      .post('/api/portal/request-otp')
      .send({ employeeId: 'ASIL-002' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_CONTACT_CHANNEL');
    expect(res.body.error).toMatch(/Contact HR/i);
  });
});

describe('POST /api/portal/verify-otp', () => {
  test('issues portal JWT on valid OTP', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, phone: '03001234567', otp: '123456', used: false, employee_id: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ASIL-001', name: 'Ali Khan', designation: 'Guard', client: 'WAFI', location: 'Karachi', active: 'Yes' }] });

    const res = await request()
      .post('/api/portal/verify-otp')
      .send({ phone: '923001234567', otp: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.employee.id).toBe('ASIL-001');
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(payload.portal).toBe(true);
  });

  test('rejects invalid or expired OTP → 401', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request()
      .post('/api/portal/verify-otp')
      .send({ phone: '03001234567', otp: '000000' });

    expect(res.status).toBe(401);
  });

  test('returns 409 EMPLOYEE_INACTIVE when OTP valid but employee inactive', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 2, phone: '03001234567', otp: '123456', used: false, employee_id: 'ASIL-099' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ASIL-099', name: 'Inactive', active: 'No' }] });

    const res = await request()
      .post('/api/portal/verify-otp')
      .send({ employeeId: 'ASIL-099', otp: '123456' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMPLOYEE_INACTIVE');
  });

  test('returns 409 CONTACT_MISMATCH when phone OTP has no matching employee', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 3, phone: '03008887777', otp: '654321', used: false, employee_id: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request()
      .post('/api/portal/verify-otp')
      .send({ phone: '03008887777', otp: '654321' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONTACT_MISMATCH');
  });
});

describe('GET /api/admin/portal-readiness', () => {
  test('superadmin can read portal readiness counts', async () => {
    const token = makeToken({ role: 'superadmin' });
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ total_active: '100', missing_contact_count: '5' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ASIL-X', name: 'No Phone', contract_name: 'WAFI', has_email: false, has_phone: false }] });

    const res = await request()
      .get('/api/admin/portal-readiness')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.total_active).toBe(100);
    expect(res.body.ready).toBe(95);
    expect(res.body.missing_contact).toHaveLength(1);
  });

  test('non-superadmin is forbidden → 403', async () => {
    const token = makeToken({ role: 'operations' });
    const res = await request()
      .get('/api/admin/portal-readiness')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('Portal vs staff auth separation', () => {
  test('staff JWT is rejected by requirePortalAuth → 403', async () => {
    const staffToken = makeToken({ role: 'operations' });

    const res = await request()
      .get('/api/portal/me')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
  });

  test('portal JWT is rejected by staff requireAuth → 403', async () => {
    const portalToken = makePortalToken({ employeeId: 'ASIL-001' });

    const res = await request()
      .get('/api/employees')
      .set('Authorization', `Bearer ${portalToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Portal tokens/i);
  });
});
