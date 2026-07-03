'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { mockPool, makeToken, makeCmmsClientToken } = require('./setup');
const cmmsSite = require('../cmmsSiteService');

describe('CMMS Site Onboarding — LOBP', () => {
  let app;

  beforeAll(() => {
    jest.resetModules();
    app = require('../server');
  });

  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('GET /api/cmms/sites', () => {
    it('requires authentication', async () => {
      const res = await request(app).get('/api/cmms/sites');
      expect(res.status).toBe(401);
    });

    it('returns sites for authenticated user', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 1, site_name: 'LOBP', client_name: 'Wafi Energy', categories: ['Sanitation'], active: true }],
      });
      const token = makeToken({ role: 'supervisor' });
      const res = await request(app)
        .get('/api/cmms/sites')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.sites[0].site_name).toBe('LOBP');
    });
  });

  describe('POST /api/cmms/sites', () => {
    it('rejects non-admin roles', async () => {
      const token = makeToken({ role: 'supervisor' });
      const res = await request(app)
        .post('/api/cmms/sites')
        .set('Authorization', `Bearer ${token}`)
        .send({ site_name: 'Test' });
      expect(res.status).toBe(403);
    });

    it('creates site for operations role', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 2, site_name: 'NewSite', active: true }],
      });
      const token = makeToken({ role: 'operations' });
      const res = await request(app)
        .post('/api/cmms/sites')
        .set('Authorization', `Bearer ${token}`)
        .send({ site_name: 'NewSite', categories: ['Other'] });
      expect(res.status).toBe(200);
      expect(res.body.site.site_name).toBe('NewSite');
    });
  });

  describe('POST /api/cmms/client/request-otp', () => {
    it('returns 404 for unknown client email', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .post('/api/cmms/client/request-otp')
        .send({ email: 'unknown@example.com' });
      expect(res.status).toBe(404);
    });

    it('sends OTP for registered client', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ email: 'sami.abdul@wafi-energy.com', name: 'Sami Abdul', site: 'LOBP' }] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] });
      const res = await request(app)
        .post('/api/cmms/client/request-otp')
        .send({ email: 'Sami.Abdul@wafi-energy.com' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.site).toBe('LOBP');
    });
  });

  describe('POST /api/cmms/client/verify-otp', () => {
    it('rejects invalid OTP', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .post('/api/cmms/client/verify-otp')
        .send({ email: 'sami.abdul@wafi-energy.com', otp: '000000' });
      expect(res.status).toBe(401);
    });

    it('returns client JWT on valid OTP', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, email: 'sami.abdul@wafi-energy.com', otp: '123456' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ email: 'sami.abdul@wafi-energy.com', name: 'Sami Abdul', site: 'LOBP' }] });
      const res = await request(app)
        .post('/api/cmms/client/verify-otp')
        .send({ email: 'sami.abdul@wafi-energy.com', otp: '123456' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(payload.cmmsClient).toBe(true);
      expect(payload.site).toBe('LOBP');
    });
  });

  describe('GET /api/cmms/client/tickets', () => {
    it('returns site tickets for client token', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'MT-LOBP-1', site: 'LOBP', title: 'Test', status: 'open' }],
      });
      const token = makeCmmsClientToken();
      const res = await request(app)
        .get('/api/cmms/client/tickets')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(1);
    });

    it('rejects staff JWT', async () => {
      const token = makeToken({ role: 'superadmin' });
      const res = await request(app)
        .get('/api/cmms/client/tickets')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/cmms/client/tickets', () => {
    it('creates ticket without photo', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ site_name: 'LOBP', default_assignee_email: 'mukesh.solanky@asil.com.pk', cc_email: 'obaid.rana@asil.com.pk' }] })
        .mockResolvedValueOnce({
          rows: [{ id: 'MT-LOBP-999', site: 'LOBP', title: 'Client issue', assigned_to: 'mukesh.solanky@asil.com.pk', priority: 'normal' }],
        });
      const token = makeCmmsClientToken();
      const res = await request(app)
        .post('/api/cmms/client/tickets')
        .set('Authorization', `Bearer ${token}`)
        .send({ category: 'Sanitation', title: 'Client issue', priority: 'normal' });
      expect(res.status).toBe(200);
      expect(res.body.ticket.id).toMatch(/^MT-LOBP-/);
    });
  });

  describe('POST /api/maintenance/tickets (staff)', () => {
    it('still requires photo for staff', async () => {
      const token = makeToken({ role: 'supervisor' });
      const res = await request(app)
        .post('/api/maintenance/tickets')
        .set('Authorization', `Bearer ${token}`)
        .send({ site: 'LOBP', category: 'Sanitation', title: 'Staff issue' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Photo|photo/);
    });
  });

  describe('PUT /api/maintenance/escalation-rules/:id', () => {
    it('updates rule for operations role', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 1, site: 'LOBP', priority: 'any', hours_open: 48, escalate_to_email: 'rabia.bhutto@asil.com.pk', basis: 'hours_overdue', active: true }],
      });
      const token = makeToken({ role: 'operations' });
      const res = await request(app)
        .put('/api/maintenance/escalation-rules/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ site: 'LOBP', priority: 'any', hours_open: 48, escalate_to_email: 'rabia.bhutto@asil.com.pk', basis: 'hours_overdue', active: true });
      expect(res.status).toBe(200);
      expect(res.body.rule.hours_open).toBe(48);
    });

    it('rejects supervisor role', async () => {
      const token = makeToken({ role: 'supervisor' });
      const res = await request(app)
        .put('/api/maintenance/escalation-rules/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ site: 'LOBP', priority: 'any', hours_open: 0, escalate_to_email: 'obaid.rana@asil.com.pk' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/cmms/billing-report', () => {
    it('requires finance or operations role', async () => {
      const token = makeToken({ role: 'supervisor' });
      const res = await request(app)
        .get('/api/cmms/billing-report')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('returns billing summary for finance_manager', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { id: 'MT-1', site: 'LOBP', billable_to_client: 'billable', spend_total: '500', title: 'A', status: 'open', category: 'X', priority: 'high', created_at: new Date() },
          { id: 'MT-2', site: 'LOBP', billable_to_client: 'internal', spend_total: '0', title: 'B', status: 'open', category: 'X', priority: 'normal', created_at: new Date() },
        ],
      });
      const token = makeToken({ role: 'finance_manager' });
      const res = await request(app)
        .get('/api/cmms/billing-report?site=LOBP&month=7&year=2026')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.summary.billable).toBe(1);
      expect(res.body.summary.internal).toBe(1);
    });
  });

  describe('runEscalationCheckEnhanced', () => {
    it('uses hours_overdue rules when ticket has past due_date', async () => {
      const sendAppEmail = jest.fn().mockResolvedValue(undefined);
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 'MT-LOBP-1',
            site: 'LOBP',
            priority: 'critical',
            title: 'Overdue ticket',
            description: 'Test',
            due_date: '2026-01-01',
            hours_open: 100,
            hours_overdue: 10,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, site: 'LOBP', priority: 'any', hours_open: 0, escalate_to_email: 'obaid.rana@asil.com.pk', basis: 'hours_overdue' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await cmmsSite.runEscalationCheckEnhanced(mockPool, sendAppEmail, null);
      expect(sendAppEmail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringContaining('MT-LOBP-1') })
      );
    });
  });
});
