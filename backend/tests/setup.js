'use strict';

/**
 * tests/setup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Jest global setup — runs once before any test file is loaded.
 *
 * PURPOSE
 *   server.js starts a DB pool and runs startup migrations the moment it is
 *   require()'d. This file stubs the 'pg' Pool before that happens, so tests
 *   never open a real Neon connection and all query results are controllable.
 *
 * HOW IT WORKS
 *   Jest's module registry is shared across a test file. We use jest.mock()
 *   inside each test file to override specific query responses. This setup
 *   provides the baseline pool mock that makes server.js bootable in CI.
 *
 * EXTENDING
 *   In individual test files, call mockPool.query.mockResolvedValueOnce(...)
 *   to override the default empty response for a specific query sequence.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const jwt = require('jsonwebtoken');

// ── Environment bootstrap ────────────────────────────────────────────────────
// Set all required env vars BEFORE server.js is require()'d.
// These are intentionally weak dev-only values — never used in production.
process.env.JWT_SECRET       = 'test-jwt-secret-minimum-length-ok';
process.env.SESSION_SECRET   = 'test-session-secret';
process.env.DATABASE_URL     = 'postgres://localhost:5432/asil_hcm_test'; // never actually connected
process.env.GOOGLE_CLIENT_ID     = 'test-google-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.NODE_ENV         = 'test';
process.env.FRONTEND_URL     = 'http://localhost:5173';
process.env.BACKEND_URL      = 'http://localhost:3000';
process.env.EXECUTION_ENV    = 'local_sandbox';
process.env.RESEND_API_KEY   = 're_test_placeholder_key_for_jest';
process.env.JAZZ_SMS_USER    = 'test-jazz-user';
process.env.JAZZ_SMS_PASS    = 'test-jazz-pass';
process.env.APP_BASE_URL     = 'http://localhost:3000';

jest.setTimeout(30000);

const smsOk = { ok: true, to: '03001234567', response: 'OK', status: 200 };
jest.mock('../lib/sms', () => {
  const actual = jest.requireActual('../lib/sms');
  return {
    ...actual,
    sendJazzSMS:    jest.fn().mockResolvedValue(smsOk),
    sendJazzOtpSMS: jest.fn().mockResolvedValue(smsOk),
  };
});

// ── Mock pool factory ────────────────────────────────────────────────────────
// Exported so individual test files can push custom query responses.
const mockPool = {
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  end:   jest.fn().mockResolvedValue(undefined),
};

// ── Stub 'pg' module ─────────────────────────────────────────────────────────
// Jest intercepts require('pg') and returns our mock instead.
jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool),
}));

// ── Stub external service modules ────────────────────────────────────────────
// Prevents emailClaimsService and wafiClaimsService from opening IMAP
// connections or firing timers during test runs.
jest.mock('../emailClaimsService', () => ({
  startEmailClaimsService: jest.fn(),
  triggerManualPoll:       jest.fn(),
}));

jest.mock('../wafiClaimsService', () => ({
  startWafiClaimsService:  jest.fn(),
  triggerWafiManualPoll:   jest.fn(),
  getLastPollAt:           jest.fn().mockReturnValue(null),
  createGmailClient:       jest.fn(),
  buildConfirmationHtml:   jest.fn().mockReturnValue('<html/>'),
  createGmailDraft:        jest.fn(),
  reprocessSession:        jest.fn(),
}));

jest.mock('../operationsScheduler', () => ({
  startOperationsScheduler: jest.fn(),
}));

jest.mock('../phase2Service', () => {
  const actual = jest.requireActual('../phase2Service');
  return {
    ...actual,
    setupPhase2Tables: jest.fn().mockResolvedValue(undefined),
    runReportDispatch: jest.fn().mockResolvedValue(undefined),
    runEscalationCheck: jest.fn().mockResolvedValue(undefined),
  };
});

// ── Stub Resend email client ──────────────────────────────────────────────────
// server.js line 35 instantiates `new Resend(apiKey)` at module load time.
// The Resend SDK throws if the key is an empty string, even in dev.
// We stub the entire module so the constructor is a no-op during tests.
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send:   jest.fn().mockResolvedValue({ id: 'mock-email-id-001' }),
      create: jest.fn().mockResolvedValue({ id: 'mock-email-id-002' }),
    },
  })),
}));

// ── JWT helper ───────────────────────────────────────────────────────────────
// Generates a signed token matching the real server.js format.
// role must be one of the 11 defined system roles.
const makeToken = (overrides = {}) => {
  const payload = {
    id:     'google-id-test-001',
    email:  'testuser@asil.com.pk',
    name:   'Test User',
    role:   'superadmin',
    ...overrides,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
};

const makePortalToken = (overrides = {}) => {
  const payload = {
    employeeId: 'ASIL-TEST-001',
    name:       'Portal Test User',
    portal:     true,
    ...overrides,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
};

const makeCmmsClientToken = (overrides = {}) => {
  const payload = {
    cmmsClient: true,
    email:      'sami.abdul@wafi-energy.com',
    site:       'LOBP',
    name:       'Sami Abdul',
    ...overrides,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
};

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = { mockPool, makeToken, makePortalToken, makeCmmsClientToken };
