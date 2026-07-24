'use strict';

const path = require('path');

function configureAppEnv(testDatabaseUrl) {
  try {
    require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
  } catch (_) { /* dotenv optional */ }

  const dbUrl = testDatabaseUrl || process.env.TEST_DATABASE_URL;
  if (!dbUrl) throw new Error('TEST_DATABASE_URL is required for integration app bootstrap');

  process.env.DATABASE_URL = dbUrl;
  process.env.NODE_ENV = 'integration';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-length-ok';
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret';
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-client-secret';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  process.env.BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_placeholder_key';
  process.env.JAZZ_SMS_USER = process.env.JAZZ_SMS_USER || 'test-jazz-user';
  process.env.JAZZ_SMS_PASS = process.env.JAZZ_SMS_PASS || 'test-jazz-pass';
  process.env.EXECUTION_ENV = process.env.EXECUTION_ENV || 'local_sandbox';
}

let cachedApp;

function getApp() {
  if (!cachedApp) {
    configureAppEnv();
    cachedApp = require('../../server');
  }
  return cachedApp;
}

module.exports = { configureAppEnv, getApp };
