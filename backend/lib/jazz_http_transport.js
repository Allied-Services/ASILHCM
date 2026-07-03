'use strict';

const https = require('https');

/** Checked in priority order; JAZZ_HTTPS_PROXY is canonical. */
const PROXY_ENV_KEYS = [
  'JAZZ_HTTPS_PROXY',
  'FIXIE_URL',
  'QUOTAGUARD_URL',
  'QUOTAGUARDA_URL',
];

function resolveJazzProxyUrl() {
  for (const key of PROXY_ENV_KEYS) {
    const v = process.env[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function isJazzProxyConfigured() {
  return Boolean(resolveJazzProxyUrl());
}

function jazzHttpGet(url, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const proxyUrl = resolveJazzProxyUrl();
    let agent;
    if (proxyUrl) {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      agent = new HttpsProxyAgent(proxyUrl);
    }
    const req = https.get(url, { agent, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: Number(res.statusCode) || 0, body: body.trim() }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`Jazz HTTP GET timed out (${timeoutMs}ms)`)); });
    req.on('error', reject);
  });
}

module.exports = { jazzHttpGet, isJazzProxyConfigured, resolveJazzProxyUrl };
