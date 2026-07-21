'use strict';
/**
 * HTTPS transport for Jazz CMT — routes connect.jazzcmt.com through Fixie
 * when JAZZ_HTTPS_PROXY (or alias env vars) is set.
 *
 * Only Jazz-bound GETs should use jazzHttpGet.
 */

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

/** Hostname only — safe for logs (never log credentials). */
function jazzProxyLogLabel() {
  const raw = resolveJazzProxyUrl();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.hostname || 'proxy';
  } catch {
    return 'proxy';
  }
}

function createProxyAgent(proxyUrl) {
  // Compatible with https-proxy-agent v5 (default export) and v7+ (named export).
  const mod = require('https-proxy-agent');
  const HttpsProxyAgent = mod.HttpsProxyAgent || mod;
  return new HttpsProxyAgent(proxyUrl);
}

function jazzHttpGet(url, { timeoutMs = 15000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const proxyUrl = resolveJazzProxyUrl();
    const agent = proxyUrl ? createProxyAgent(proxyUrl) : undefined;
    const req = https.get(
      url,
      {
        agent,
        timeout: timeoutMs,
        // Cloudflare occasionally challenges bare clients; match ERP UA.
        headers: {
          'User-Agent': 'ASILHCM-JazzSMS/1.0 (+https://asilhcm.onrender.com)',
          Accept: 'text/plain, text/html;q=0.8, */*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: Number(res.statusCode) || 0, body: body.trim() }));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Jazz HTTP GET timed out (${timeoutMs}ms)`));
    });
    req.on('error', reject);

    if (signal) {
      if (signal.aborted) {
        req.destroy();
        reject(new Error('Aborted'));
        return;
      }
      signal.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Aborted'));
      }, { once: true });
    }
  });
}

module.exports = {
  jazzHttpGet,
  isJazzProxyConfigured,
  resolveJazzProxyUrl,
  jazzProxyLogLabel,
};
