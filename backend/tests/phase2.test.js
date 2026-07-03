'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { mockPool, makeToken, makePortalToken } = require('./setup');
const phase2 = require('../phase2Service');

describe('Phase 2 — Operations Mandate', () => {
  let app;

  beforeAll(() => {
    jest.resetModules();
    app = require('../server');
  });

  beforeEach(() => {
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('UNEXCUSED_SMS', () => {
    it('uses Roman Urdu message text', () => {
      expect(phase2.UNEXCUSED_SMS).toContain('ghair-hazir');
      expect(phase2.UNEXCUSED_SMS).toContain('supervisor');
    });
  });

  describe('getPettyCashBalance', () => {
    it('computes allocation minus spend for current month', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ balance: '7500' }] });
      const balance = await phase2.getPettyCashBalance(mockPool, 'Site A');
      expect(balance).toBe(7500);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('petty_cash_ledger'),
        expect.arrayContaining(['Site A'])
      );
    });
  });

  describe('GET /api/report-subscriptions', () => {
    it('requires finance_manager or superadmin role', async () => {
      const token = makeToken({ role: 'operations' });
      const res = await request(app)
        .get('/api/report-subscriptions')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('returns subscriptions for finance_manager', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 1, site: 'Islamabad', recipients: ['ops@asil.com.pk'], active: true }],
      });
      const token = makeToken({ role: 'finance_manager' });
      const res = await request(app)
        .get('/api/report-subscriptions')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.subscriptions).toHaveLength(1);
    });
  });

  describe('POST /api/portal/leave-request', () => {
    it('creates pending leave from portal auth', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 1, employee_id: 'ASIL-1', leave_type: 'CL', status: 'pending' }],
      });
      const token = makePortalToken({ employeeId: 'ASIL-1' });
      const res = await request(app)
        .post('/api/portal/leave-request')
        .set('Authorization', `Bearer ${token}`)
        .send({ leave_type: 'CL', from_date: '2026-07-10', to_date: '2026-07-11', reason: 'Personal' });
      expect(res.status).toBe(200);
      expect(res.body.leave.status).toBe('pending');
    });
  });

  describe('POST /api/leave/requests/:id/internal-decision', () => {
    it('rejects pending leave for operations role', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 5, employee_id: 'ASIL-1', employee_name: 'Test', contract_id: null,
            leave_type: 'CL', from_date: '2026-07-10', to_date: '2026-07-10', days: 1,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 5, status: 'rejected_internal' }],
        });
      const token = makeToken({ role: 'operations', email: 'ops@asil.com.pk' });
      const res = await request(app)
        .post('/api/leave/requests/5/internal-decision')
        .set('Authorization', `Bearer ${token}`)
        .send({ decision: 'reject' });
      expect(res.status).toBe(200);
      expect(res.body.leave.status).toBe('rejected_internal');
    });
  });

  describe('GET /api/leave/action/:token', () => {
    it('approves leave via signed JWT action link', async () => {
      const actionToken = jwt.sign({ leaveId: 7, decision: 'approved' }, process.env.JWT_SECRET, { expiresIn: '1h' });
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 7, employee_id: 'ASIL-1', employee_name: 'Ali', status: 'internal_approved',
            from_date: '2026-07-10', to_date: '2026-07-10', days: 1, leave_type: 'CL',
            action_token_hash: null, internal_approver: 'ops@asil.com.pk',
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ dept: 'Ops', location: 'Site A', site: null }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ entitled: 10, used: 0 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ primary_contact: '03001234567' }] });

      const res = await request(app).get(`/api/leave/action/${encodeURIComponent(actionToken)}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('Leave Approved');
    });
  });
});
