'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../src/core/jobs', () => ({
    enqueueJob: jest.fn().mockResolvedValue('job-abc-123'),
}));

const { enqueueJob } = require('../src/core/jobs');
const { registerXeroBillImportRoutes } = require('../src/modules/xeroBillImport/routes');

describe('xero bills sync enqueue', () => {
    let app;

    beforeEach(() => {
        enqueueJob.mockClear();
        app = express();
        app.use(express.json());
        registerXeroBillImportRoutes(app, {
            pool: {},
            requireAuth: (req, res, next) => next(),
            requireRole: () => (req, res, next) => next(),
            getXeroAccessToken: async () => ({ accessToken: 't', tenantId: 'x' }),
        });
    });

    test('POST /api/xero/bills/sync returns 202 and enqueues job', async () => {
        const res = await request(app)
            .post('/api/xero/bills/sync')
            .send({ modifiedSince: '2026-01-01T00:00:00Z' });

        expect(res.status).toBe(202);
        expect(res.body).toEqual({ queued: true, jobId: 'job-abc-123' });
        expect(enqueueJob).toHaveBeenCalledWith('xero.bills.sync', { modifiedSince: '2026-01-01T00:00:00Z' });
    });
});