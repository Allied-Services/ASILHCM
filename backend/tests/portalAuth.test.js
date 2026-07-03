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
  test('normalizes 92300… format and sends OTP → 200', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 'ASIL-001', name: 'Ali Khan' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request()
      .post('/api/portal/request-otp')
      .send({ phone: '923001234567' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.employeeName).toBe('Ali Khan');
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

  test('returns 400 when phone is missing', async () => {
    const res = await request()
      .post('/api/portal/request-otp')
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('POST /api/portal/verify-otp', () => {
  test('issues portal JWT on valid OTP', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, phone: '03001234567', otp: '123456', used: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ASIL-001', name: 'Ali Khan', designation: 'Guard', client: 'WAFI', location: 'Karachi' }] });

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
});

describe('Portal vs staff auth separation', () => {
  test('staff JWT is rejected by requirePortalAuth → 403', async () => {
    const staffToken = makeToken({ role: 'operations' });

    const res = await request()
      .get('/api/portal/me')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/portal token/i);
  });

  test('portal JWT is rejected by staff role-guarded routes → 403', async () => {
    const portalToken = makePortalToken();

    const res = await request()
      .get('/api/change-requests')
      .set('Authorization', `Bearer ${portalToken}`);

    expect(res.status).toBe(403);
  });
});
