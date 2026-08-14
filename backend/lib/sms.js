'use strict';

const {
  jazzHttpGet,
  isJazzProxyConfigured,
  jazzProxyLogLabel,
} = require('./jazz_http_transport');

function normalisePhone(raw = '') {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('92') && digits.length === 12) return '0' + digits.slice(2);
  if (digits.startsWith('3') && digits.length === 10) return '0' + digits;
  if (digits.startsWith('03') && digits.length === 11) return digits;
  return digits;
}

/** Jazz-deliverable Pakistani mobile: 03XXXXXXXXX after normalisation. */
function isValidPkMobile(raw = '') {
  return /^03\d{9}$/.test(normalisePhone(raw));
}

/**
 * First valid PK mobile from a contact field.
 * Accepts dual numbers like "0313-4468633/0313-5536560".
 */
function firstValidPkMobile(raw = '') {
  const parts = String(raw || '').split(/[/,;|]+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const n = normalisePhone(part);
    if (/^03\d{9}$/.test(n)) return n;
  }
  const whole = normalisePhone(raw);
  return /^03\d{9}$/.test(whole) ? whole : '';
}

function jazzResponseIndicatesHardFailure(response) {
  const s = String(response || '').toLowerCase();
  if (!s.trim()) return false;
  if (s.includes('gateway returned html response')) return true;
  if (s.includes('<!doctype') || s.includes('<html')) return true;
  if (s.includes('cloudflare') || s.includes('attention required')) return true;
  return [
    'not authorized',
    'unauthorized',
    'ip not',
    'invalid mask',
    'mask not allowed',
    'authentication failed',
    'auth failed',
    'invalid user',
    'invalid password',
    'insufficient balance',
    'low balance',
    'account suspended',
    'user blocked',
    'invalid credentials',
  ].some((w) => s.includes(w));
}

function isJazzSmsDeliveryOk(response, httpStatus = 0) {
  const raw = String(response || '').trim();
  const low = raw.toLowerCase();
  const st = Number(httpStatus) || 0;

  if (raw && jazzResponseIndicatesHardFailure(raw)) return false;

  // Exact match for short tokens — avoid false positives from includes('ok')/includes('1').
  if (
    low.includes('success') ||
    low.includes('message sent') ||
    low.includes('msg sent') ||
    low.includes('sent successfully') ||
    low.includes('delivered') ||
    low.includes('queued') ||
    low.includes('accepted') ||
    low === 'ok' ||
    low === '1' ||
    low === 'true'
  ) {
    return true;
  }

  // HTTP 200 with non-failure body (incl. empty) — Jazz often accepts this way.
  return st === 200;
}

function resolveCredentials({ otp = false } = {}) {
  if (otp) {
    return {
      user: process.env.JAZZ_OTP_USER || process.env.JAZZ_SMS_USER,
      pass: process.env.JAZZ_OTP_PASS || process.env.JAZZ_SMS_PASS,
      mask: process.env.JAZZ_OTP_MASK || process.env.JAZZ_SMS_MASK || 'ALLIED SERV',
    };
  }
  return {
    user: process.env.JAZZ_SMS_USER,
    pass: process.env.JAZZ_SMS_PASS,
    mask: process.env.JAZZ_SMS_MASK || 'ALLIED SERV',
  };
}

async function sendJazzSMS(phone, message, { otp = false } = {}) {
  const { user: USER, pass: PASS, mask: MASK } = resolveCredentials({ otp });
  if (!USER || !PASS) {
    throw new Error(otp
      ? 'Missing JAZZ_OTP_USER / JAZZ_OTP_PASS (or JAZZ_SMS_* fallback)'
      : 'Missing JAZZ_SMS_USER / JAZZ_SMS_PASS');
  }

  const viaProxy = isJazzProxyConfigured();
  if (!viaProxy) {
    console.warn('[SMS] JAZZ_HTTPS_PROXY not set — Jazz will likely reject with IP not authorized');
  } else {
    console.log(`[SMS] Jazz proxy active (${jazzProxyLogLabel()})`);
  }

  const jazzTo = normalisePhone(phone);
  const digitsOnly = jazzTo.replace(/\D/g, '');
  const endpoints = [
    {
      label: 'sendsms_url.html',
      buildUrl: () => {
        const p = new URLSearchParams({
          Username: USER,
          Password: PASS,
          From: MASK,
          To: jazzTo,
          Message: message,
        });
        return `https://connect.jazzcmt.com/sendsms_url.html?${p.toString()}&`;
      },
    },
    {
      label: 'sendsms/',
      buildUrl: () => {
        const p = new URLSearchParams({
          username: USER,
          password: PASS,
          mask: MASK,
          to: digitsOnly,
          message,
        });
        return `https://connect.jazzcmt.com/sendsms/?${p.toString()}`;
      },
    },
  ];

  let last = { to: jazzTo, response: 'No attempt', status: 0, viaProxy };
  for (const ep of endpoints) {
    const url = ep.buildUrl();
    try {
      console.log(`[SMS] Trying ${ep.label} for ${jazzTo}${viaProxy ? ` via ${jazzProxyLogLabel()}` : ''}`);
      const { status, body } = await jazzHttpGet(url);
      console.log(`[SMS] ${ep.label} → HTTP ${status} | ${body.slice(0, 160)}`);
      last = { to: jazzTo, response: body, status, endpoint: ep.label, viaProxy };
      if (isJazzSmsDeliveryOk(body, status)) return { ...last, ok: true };
      if (jazzResponseIndicatesHardFailure(body)) break;
    } catch (err) {
      console.error(`[SMS] ${ep.label} error:`, err.message);
      last = { to: jazzTo, response: err.message, status: 0, endpoint: ep.label, viaProxy };
    }
  }
  return { ...last, ok: false };
}

function sendJazzOtpSMS(phone, message) {
  return sendJazzSMS(phone, message, { otp: true });
}

module.exports = {
  sendJazzSMS,
  sendJazzOtpSMS,
  normalisePhone,
  isValidPkMobile,
  firstValidPkMobile,
  isJazzSmsDeliveryOk,
  jazzResponseIndicatesHardFailure,
};
