'use strict';

const { jazzHttpGet, isJazzProxyConfigured } = require('./jazz_http_transport');

function normalisePhone(raw = '') {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('92') && digits.length === 12) return '0' + digits.slice(2);
  if (digits.startsWith('3')  && digits.length === 10)  return '0' + digits;
  if (digits.startsWith('03') && digits.length === 11)  return digits;
  return digits;
}

function isJazzSmsDeliveryOk(response, httpStatus = 0) {
  const raw = String(response || '').trim();
  const low = raw.toLowerCase();
  const st = Number(httpStatus) || 0;
  const hardFails = [
    'not authorized', 'ip not', 'unauthorized', 'invalid mask', 'mask not allowed',
    'authentication failed', 'invalid user', 'invalid password',
    'insufficient balance', 'low balance', 'account suspended', 'user blocked',
    'cloudflare', 'attention required', '<!doctype', '<html',
  ];
  if (hardFails.some((w) => low.includes(w))) return false;
  if (['success','message sent','msg sent','sent successfully','delivered','queued','accepted','ok','1','true']
      .some((w) => low.includes(w))) return true;
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
  if (!isJazzProxyConfigured()) {
    console.warn('[SMS] JAZZ_HTTPS_PROXY not set — Jazz will likely reject with IP not authorized');
  }
  const jazzTo = normalisePhone(phone);
  const digitsOnly = jazzTo.replace(/\D/g, '');
  const endpoints = [
    () => {
      const p = new URLSearchParams({ Username: USER, Password: PASS, From: MASK, To: jazzTo, Message: message });
      return `https://connect.jazzcmt.com/sendsms_url.html?${p.toString()}&`;
    },
    () => {
      const p = new URLSearchParams({ username: USER, password: PASS, mask: MASK, to: digitsOnly, message });
      return `https://connect.jazzcmt.com/sendsms/?${p.toString()}`;
    },
  ];
  let last = { to: jazzTo, response: 'No attempt', status: 0 };
  for (const buildUrl of endpoints) {
    const url = buildUrl();
    try {
      const { status, body } = await jazzHttpGet(url);
      console.log(`[SMS] HTTP ${status} | ${body.slice(0, 120)}`);
      last = { to: jazzTo, response: body, status };
      if (isJazzSmsDeliveryOk(body, status)) return { ...last, ok: true };
      if (['not authorized','mask not','invalid user','insufficient balance','account suspended']
          .some((w) => body.toLowerCase().includes(w))) break;
    } catch (err) {
      last = { to: jazzTo, response: err.message, status: 0 };
    }
  }
  return { ...last, ok: false };
}

function sendJazzOtpSMS(phone, message) {
  return sendJazzSMS(phone, message, { otp: true });
}

module.exports = { sendJazzSMS, sendJazzOtpSMS, normalisePhone, isJazzSmsDeliveryOk };
