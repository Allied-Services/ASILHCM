'use strict';

const jwt = require('jsonwebtoken');

function makeToken(overrides = {}) {
  const secret = process.env.JWT_SECRET || 'test-jwt-secret-minimum-length-ok';
  const payload = {
    id: 'google-id-int-001',
    email: 'int.test@asil.com.pk',
    name: 'Integration Test User',
    role: 'superadmin',
    ...overrides,
  };
  return jwt.sign(payload, secret, { expiresIn: '8h' });
}

module.exports = { makeToken };
