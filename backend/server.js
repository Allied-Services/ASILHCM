const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { Resend } = require('resend');

const { calculateEOBI, calculateSESSI, calculateMonthlyIncomeTax, calculateGratuity } = require('./taxEngine');
const { readPayrollSnapshot, exportRowFromSnapshot } = require('./src/payroll/snapshotView');
const { startEmailClaimsService, triggerManualPoll } = require('./emailClaimsService');
const wafiClaims = require('./wafiClaimsService');
const { startWafiClaimsService, triggerWafiManualPoll, getLastPollAt, createGmailClient, buildConfirmationHtml, createGmailDraft, reprocessSession } = wafiClaims;
const phase2 = require('./phase2Service');
const { startOperationsScheduler } = require('./operationsScheduler');
const { sendJazzSMS, sendJazzOtpSMS, normalisePhone } = require('./lib/sms');
const { isJazzProxyConfigured, jazzProxyLogLabel } = require('./lib/jazz_http_transport');
const { canApproveBill } = require('./src/modules/procurement/service');
const { getLeavePolicy } = require('./src/modules/leave/service');
const cutover = require('./src/core/cutover');
const wafiApproval = require('./src/modules/wafiClaims/approvalService');
const {
    isValidEmail,
    maskEmail,
    maskPhone,
    getPortalChangeSettings,
    ensurePortalChangeSettings,
    canApproveChangeRequest,
    CHANGE_QUEUE_ROLES,
} = require('./src/modules/portal/essHelpers');
const {
    fetchWorldBPayslipSummaries,
    fetchWorldBPayslipDetail,
    mapWorldARowToSummary,
    mergePayslipSummaries,
} = require('./src/modules/portal/payslipBridge');
const { renderPayslipHtml: renderWorldBPayslipHtml } = require('./src/modules/payrollrun/payslip');
const { buildWorldAPayslipData } = require('./src/modules/payslip/dataBuilder');
const { renderPayslipHtml: renderWorldAPayslipHtml } = require('./src/modules/payslip/template');

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Startup Guard ├óΓé¼ΓÇ¥ refuse to start if critical secrets are missing ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
const REQUIRED_ENV = ['JWT_SECRET', 'SESSION_SECRET', 'DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.error('FATAL: Missing required environment variables:', missingEnv.join(', '));
    console.error('Set these in Render ├óΓÇáΓÇÖ Environment before starting the server.');
    // In production, exit so Render marks the deploy as failed
    if (process.env.NODE_ENV === 'production') process.exit(1);
    else console.warn('Running in dev mode with missing vars ├óΓé¼ΓÇ¥ continuing anyway');
}

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const APP_BASE_URL = process.env.APP_BASE_URL || BACKEND_URL;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_' + Math.random().toString(36);
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'asil.com.pk';

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Resend Email Client ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
let resendClient;
function getResend() {
    if (!process.env.RESEND_API_KEY) return null;
    if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
    return resendClient;
}
const EMAIL_FROM = process.env.SMTP_FROM || 'ASIL HR <hr@asil.com.pk>';

async function sendAppEmail({ to, subject, html, cc, bcc, attachments }) {
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    const resend = getResend();
    if (!resend || !recipients.length) {
        return { skipped: true, reason: 'missing_key_or_recipients' };
    }
    const ccList = (Array.isArray(cc) ? cc : cc ? [cc] : []).filter(Boolean);
    const bccList = (Array.isArray(bcc) ? bcc : bcc ? [bcc] : []).filter(Boolean);
    try {
        const payload = { from: EMAIL_FROM, to: recipients, subject, html };
        if (ccList.length) payload.cc = ccList;
        if (bccList.length) payload.bcc = bccList;
        if (attachments?.length) {
            payload.attachments = attachments.map((a) => ({
                filename: a.filename,
                content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content),
            }));
        }
        const result = await resend.emails.send(payload);
        return { ok: true, result };
    } catch (err) {
        console.error('[sendAppEmail]', err);
        throw err;
    }
}

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ DB Pool ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    max: 10,                       // Neon free: stay under 100 connection limit
    idleTimeoutMillis: 30000,      // Release idle connections after 30s
    connectionTimeoutMillis: 5000, // Fail fast if pool exhausted
});

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Security Headers (helmet) ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
app.use(helmet({ contentSecurityPolicy: false })); // CSP off ├óΓé¼ΓÇ¥ frontend served separately

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ CORS ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
// Browser portals (Employee Portal, CMMS, claims) load from hcm.asil.com.pk while the API
// is on asilhcm.onrender.com — both origins must be allowed or fetch() fails with "Failed to fetch".
const CORS_ORIGINS = [
    FRONTEND_URL,
    'https://hcm.asil.com.pk',
    'https://asil-hcm-frontend.onrender.com',
    'http://localhost:5173',
    'http://localhost:5174',
    ...(process.env.EXTRA_CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
].filter(Boolean);
app.use(cors({
    origin: (origin, cb) => {
        // Non-browser / same-origin tools send no Origin
        if (!origin || CORS_ORIGINS.includes(origin)) return cb(null, true);
        return cb(null, false);
    },
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Strip HTML/script tags from incoming free-text fields (name, purpose, notes, etc.)
// before they reach any route or the database. Skipped for strings over 2000 chars —
// those are base64 images (OCR) or bulk CSV payloads, never hand-typed free text,
// and running an HTML parser over multi-MB strings on every request would be wasteful.
const striptags = require('striptags');
function stripHtmlDeep(value) {
    if (typeof value === 'string') {
        if (value.length > 2000) return value;
        return striptags(value);
    }
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = stripHtmlDeep(value[i]); return value; }
    if (value && typeof value === 'object') { for (const k of Object.keys(value)) value[k] = stripHtmlDeep(value[k]); return value; }
    return value;
}
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') stripHtmlDeep(req.body);
    next();
});

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Rate Limiters ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
const globalLimiter = rateLimit({ windowMs: 60*1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, slow down.' } });
const strictLimiter = rateLimit({ windowMs: 60*1000, max: 10, message: { error: 'Too many attempts. Try again in a minute.' } });
const portalOtpLimiter = rateLimit({
  windowMs: 15*60*1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many OTP requests. Try again in 15 minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use(globalLimiter);
// Strict limits on sensitive endpoints applied inline below

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Session + Passport ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
app.use(session({
    secret: process.env.SESSION_SECRET || JWT_SECRET,
    resave: false, saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
}));
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((u, done) => done(null, u));
passport.deserializeUser((u, done) => done(null, u));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/auth/google/callback`,
}, async (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value || '';
    const isAllowedDomain = email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
    // Also allow any email pre-registered in hcm_users (e.g. Gmail supervisors)
    let isPreRegistered = false;
    try {
        const preCheck = await pool.query('SELECT id FROM hcm_users WHERE LOWER(email)=LOWER($1)', [email]);
        isPreRegistered = preCheck.rows.length > 0;
    } catch (_) {}
    if (!isAllowedDomain && !isPreRegistered) {
        console.log(`Blocked login: ${email}`);
        return done(null, false, { message: 'unauthorized_domain' });
    }
    try {
        const googleId = profile.id;
        const name     = profile.displayName;
        const avatar   = profile.photos?.[0]?.value || null;
        // Count existing users to auto-assign superadmin to first ever login
        const count = await pool.query('SELECT COUNT(*) FROM hcm_users');
        const isFirst = parseInt(count.rows[0].count) === 0;
        const defaultRole = isFirst ? 'superadmin' : 'pending';
        // Upsert user ├óΓé¼ΓÇ¥ match on google_id (re-login) OR email (pre-registered by admin)
        // If pre-registered by email, update google_id and preserve existing role
        const result = await pool.query(`
            INSERT INTO hcm_users (google_id, email, name, avatar, role)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (email) DO UPDATE
              SET google_id  = EXCLUDED.google_id,
                  name       = EXCLUDED.name,
                  avatar     = EXCLUDED.avatar,
                  last_login = NOW()
            RETURNING *
        `, [googleId, email, name, avatar, defaultRole]);
        const user = result.rows[0];
        return done(null, { id: googleId, email, name, avatar, role: user.role });
    } catch (e) {
        console.error('OAuth DB error:', e.message);
        return done(null, { id: profile.id, email, name: profile.displayName, avatar: profile.photos?.[0]?.value || null, role: 'pending' });
    }
}));

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ JWT Middleware ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
const requireAuth = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET);
        if (payload.portal) return res.status(403).json({ error: 'Portal tokens cannot access staff APIs' });
        req.user = payload;
        next();
    } catch { res.status(401).json({ error: 'Token expired' }); }
};

// Require one of the listed roles (superadmin always passes)
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'superadmin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden: insufficient role', required: roles, got: req.user.role });
};

// Fire-and-forget audit trail write. Never blocks or fails the calling route.
function logAudit(req, actionType, entityType, entityId) {
    pool.query(
        `INSERT INTO audit_log (user_email, action_type, entity_type, entity_id, created_at) VALUES ($1, $2, $3, $4, NOW())`,
        [req.user?.email || 'unknown', actionType, entityType, String(entityId)]
    ).catch(err => console.error(`[audit_log] write failed for ${actionType} ${entityType}:${entityId}`, err));
}

const TEAM_SETUP_ROLE_FALLBACK = ['hr_manager', 'admin', 'operations', 'finance_manager', 'finance_approver'];

async function requireTeamSetup(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'superadmin') return next();
    try {
        const { rows } = await pool.query(
            'SELECT role, permissions FROM hcm_users WHERE LOWER(email)=LOWER($1)',
            [req.user.email]
        );
        const db = rows[0];
        const customPerms = db?.permissions && typeof db.permissions === 'object' && Object.keys(db.permissions).length > 0;
        if (customPerms) {
            const att = db.permissions.attendance;
            if (att?.access && att?.subPerms?.includes('team_setup')) return next();
            return res.status(403).json({ error: 'Forbidden: team_setup permission required' });
        }
        const role = req.user.role || db?.role;
        if (TEAM_SETUP_ROLE_FALLBACK.includes(role)) return next();
        return res.status(403).json({ error: 'Forbidden: insufficient role', got: role });
    } catch (err) {
        console.error('[requireTeamSetup]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Auth Routes ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}?error=unauthorized_domain`, session: true }),
    (req, res) => {
        const token = jwt.sign(req.user, JWT_SECRET, { expiresIn: '8h' });
        res.redirect(`${FRONTEND_URL}?token=${token}`);
    }
);
app.get('/auth/me', requireAuth, async (req, res) => {
    try {
        // Always look up fresh from DB ├óΓé¼ΓÇ¥ catches role changes + saved custom permissions
        // without requiring re-login. Falls back to JWT payload if user not found.
        const userId = String(req.user.id || req.user.google_id || '');
        const { rows } = await pool.query(
            `SELECT id, email, name, role, avatar, permissions
             FROM hcm_users WHERE id::text = $1 OR google_id = $1 LIMIT 1`,
            [userId]
        );
        if (rows.length) {
            const db = rows[0];
            res.json({ user: { ...req.user, role: db.role, permissions: db.permissions || null } });
        } else {
            res.json({ user: req.user });
        }
    } catch (err) {
        console.error('auth/me DB error:', err.message);
        res.json({ user: req.user }); // safe fallback
    }
});
app.post('/auth/logout', (req, res) => res.json({ ok: true }));

// ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ User Management ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
// Blueprint: superadmin, finance_approver, finance_manager can all access User Management tab
const USER_MGMT_ROLES = ['superadmin', 'finance_approver', 'finance_manager'];

app.get('/api/users', requireAuth, requireRole(...USER_MGMT_ROLES), async (req, res) => {
    try {
        // Include permissions so the frontend can restore saved custom access on panel open
        const { rows } = await pool.query(
            'SELECT id, google_id, email, name, avatar, role, permissions, created_at, last_login FROM hcm_users ORDER BY created_at ASC'
        );
        res.json({ users: rows });
    } catch (err) { console.error('[GET /api/users]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/users ├óΓé¼ΓÇ¥ pre-register a user by email
app.post('/api/users', requireAuth, requireRole(...USER_MGMT_ROLES), async (req, res) => {
    try {
        const { email, role = 'pending' } = req.body;
        // Supervisors may use Gmail; all other roles must be @asil.com.pk
        const isSupervisorRole = role === 'supervisor';
        const isValidDomain = email && (email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`) || isSupervisorRole);
        if (!email || !isValidDomain) {
            return res.status(400).json({ error: isSupervisorRole ? 'A valid email is required for supervisor role' : `Email must be @${ALLOWED_DOMAIN}` });
        }
        const VALID_ROLES = ['superadmin','operations','operations_supervisor','operations_team','procurement_proposer','procurement_approver',
            'finance_proposer','finance_approver','ap_team','ar_team','payroll_initiator','payroll',
            'procurement_manager','procurement','finance_manager','supervisor','hr_manager','admin','bizdev','pending'];
        if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
        // Non-superadmins cannot create superadmin accounts
        if (role === 'superadmin' && req.user.role !== 'superadmin') {
            return res.status(403).json({ error: 'Only Super Admin can assign the superadmin role' });
        }
        const { rows } = await pool.query(`
            INSERT INTO hcm_users (google_id, email, name, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
            RETURNING id, google_id, email, name, avatar, role, created_at, last_login
        `, [`pending_${Date.now()}`, email.toLowerCase(), email.split('@')[0], role]);
        res.json({ ok: true, user: rows[0] });
    } catch (err) { console.error('[POST /api/users]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/users/:id/role ├óΓé¼ΓÇ¥ change a user's role
app.patch('/api/users/:id/role', requireAuth, requireRole(...USER_MGMT_ROLES), async (req, res) => {
    try {
        const { role } = req.body;
        const VALID_ROLES = ['superadmin','operations','operations_supervisor','operations_team','procurement_proposer','procurement_approver',
            'finance_proposer','finance_approver','ap_team','ar_team','payroll_initiator','payroll',
            'procurement_manager','procurement','finance_manager','supervisor','hr_manager','admin','bizdev','pending'];
        if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
        // Non-superadmins cannot assign or escalate to superadmin
        if (role === 'superadmin' && req.user.role !== 'superadmin') {
            return res.status(403).json({ error: 'Only Super Admin can assign the superadmin role' });
        }
        // Match by integer id::text OR by google_id string (handles pre-registered + active users)
        const { rows } = await pool.query(
            `UPDATE hcm_users SET role = $1
             WHERE id::text = $2 OR google_id = $2
             RETURNING id, email, name, role`,
            [role, String(req.params.id)]
        );
        if (!rows.length) return res.status(404).json({ error: 'User not found' });
        logAudit(req, 'user_role_change', 'user', rows[0].id);
        res.json({ ok: true, user: rows[0] });
    } catch (err) { console.error('[PATCH /api/users/:id/role]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/users/:id/permissions ├óΓé¼ΓÇ¥ save granular sub-permissions (superadmin only)
app.patch('/api/users/:id/permissions', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { permissions } = req.body;
        if (!permissions || typeof permissions !== 'object') {
            return res.status(400).json({ error: 'permissions object is required' });
        }
        // Ensure the column exists on every call ├óΓé¼ΓÇ¥ safe no-op once it exists
        await pool.query(
            `ALTER TABLE hcm_users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL`
        ).catch(() => {});

        const { rows } = await pool.query(
            `UPDATE hcm_users SET permissions = $1
             WHERE id::text = $2 OR google_id = $2
             RETURNING id, email, name, role, permissions`,
            [JSON.stringify(permissions), String(req.params.id)]
        );
        if (!rows.length) return res.status(404).json({ error: 'User not found' });
        res.json({ ok: true, user: rows[0] });
    } catch (err) {
        console.error('permissions save error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/health', (req, res) => {
    const migrations = getMigrationStatus();
    res.json({
        status: migrations === 'ok' ? 'ok' : migrations,
        time: new Date().toISOString(),
        migrations,
        commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
    });
});
app.get('/health/ip', requireAuth, requireRole('superadmin'), (req, res) => {
    // Returns this server's outbound public IP (for Jazz CMT whitelisting) ├óΓé¼ΓÇ¥ SuperAdmin only
    const https = require('https');
    https.get('https://api.ipify.org?format=json', (r) => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => res.json({ outbound_ip: JSON.parse(d).ip, note: 'Whitelist this IP with Jazz CMT' }));
    }).on('error', e => { console.error('[GET /health/ip]', e); res.status(500).json({ error: 'Internal server error' }); });
});
app.get('/', (req, res) => res.json({ name: 'ASIL HCM API', status: 'running', app: 'https://asil-hcm-frontend.onrender.com' }));

// Temporary diagnostic ├óΓé¼ΓÇ¥ lists all contracts and their bonus_months (no auth needed, read-only)
// SuperAdmin only diagnostic
app.get('/api/debug/bonus-check', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT id, contract_name,
                costs->>'bonus_months' AS bonus_months,
                costs->>'overhead_per_employee' AS overhead,
                costs->>'eosb_type' AS eosb_type
            FROM contracts ORDER BY contract_name
        `);
        res.json({ count: rows.length, contracts: rows });
    } catch (err) { console.error('[GET /api/debug/bonus-check]', err); res.status(500).json({ error: 'Internal server error' }); }
});

const nullDate = (d) => (d && d !== '' && d !== 'undefined') ? d : null;
const toDateStr = d => !d ? '' : (d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10));
const nullNum = (n) => (n !== '' && n != null) ? parseFloat(n) || null : null;

const empToDb = (e) => ({
    id: e.id || `ASIL-${Date.now()}`,
    bu: e.bu || null, active: e.active || 'Yes',
    client: e.client || null, client_bu: e.clientBU || null,
    dept: e.dept || null, designation: e.designation || null,
    location: e.location || null, site: e.site || null, province: e.province || null,
    name: e.name,
    father_name: e.fatherName || null, mother_name: e.motherName || null,
    cnic: e.cnic || null,
    cnic_issue: nullDate(e.cnicIssue), cnic_expiry: nullDate(e.cnicExpiry),
    place_of_birth: e.placeOfBirth || null, eobi_no: e.eobiNo || null,
    religion: e.religion || null, marital_status: e.maritalStatus || null,
    dob: nullDate(e.dob), doj: nullDate(e.doj),
    last_working_day: nullDate(e.lastWorkingDay),
    primary_contact: e.primaryContact || null, emergency_contact: e.emergencyContact || null,
    email: e.email || null,
    present_address: e.presentAddress || null, permanent_address: e.permanentAddress || null,
    salary: parseFloat(e.salary) || 0,
    spouse_name: e.spouseName || null, spouse_age: e.spouseAge || null, spouse_cnic: e.spouseCnic || null,
    child1_name: e.child1Name || null, child1_age: e.child1Age || null, child1_id: e.child1Id || null,
    child2_name: e.child2Name || null, child2_age: e.child2Age || null, child2_id: e.child2Id || null,
    medical_type: e.medicalType || null, medical_maternity: e.medicalMaternity || null,
    total_medical_coverage: nullNum(e.totalMedicalCoverage),
    bank_name: e.bankName || null, bank_account: e.bankAccount || null, account_title: e.accountTitle || null,
    nok_name: e.nokName || null, nok_relation: e.nokRelation || null, nok_contact: e.nokContact || null,
    contract_date: nullDate(e.contractDate),
    contract_name: e.contractName || null,
    contract_id:   e.contractId   || null,
    region: e.region || null,
    line_manager_name:  e.lineManagerName  || null,
    line_manager_email: e.lineManagerEmail || e.supervisorEmail || null,
    supervisor_email:   e.supervisorEmail || e.lineManagerEmail || null,
    client_focal_emails: e.clientFocalEmails || e.client_focal_emails || null,
    // ── Operational fields (2026-07-02) ─────────────────────────────────────
    sessi_no:                e.sessiNo               || null,
    shirt_size:              e.shirtSize             || null,
    trouser_size:            e.trouserSize           || null,
    safety_shoe_size:        e.safetyShoeSizeVal     || null,
    last_uniform_issue_date: nullDate(e.lastUniformIssueDate),
    last_ppe_issue_date:     nullDate(e.lastPpeIssueDate),
    gate_pass_expiry:        nullDate(e.gatePassExpiry),
    payroll_cycle_type:      e.payrollCycleType      || 'Monthly',
});

const empFromDb = (r) => ({
    id: r.id, bu: r.bu, active: r.active,
    client: r.client, clientBU: r.client_bu,
    dept: r.dept, designation: r.designation,
    location: r.location, site: r.site || null, province: r.province,
    name: r.name, fatherName: r.father_name, motherName: r.mother_name,
    cnic: r.cnic,
    cnicIssue: toDateStr(r.cnic_issue),
    cnicExpiry: toDateStr(r.cnic_expiry),
    placeOfBirth: r.place_of_birth, eobiNo: r.eobi_no,
    religion: r.religion, maritalStatus: r.marital_status,
    dob: toDateStr(r.dob),
    doj: toDateStr(r.doj),
    lastWorkingDay: toDateStr(r.last_working_day),
    primaryContact: r.primary_contact, emergencyContact: r.emergency_contact,
    email: r.email, presentAddress: r.present_address, permanentAddress: r.permanent_address,
    salary: parseFloat(r.salary) || 0, lastSalary: parseFloat(r.salary) || 0,
    spouseName: r.spouse_name, spouseAge: r.spouse_age, spouseCnic: r.spouse_cnic,
    child1Name: r.child1_name, child1Age: r.child1_age, child1Id: r.child1_id,
    child2Name: r.child2_name, child2Age: r.child2_age, child2Id: r.child2_id,
    medicalType: r.medical_type, medicalMaternity: r.medical_maternity,
    totalMedicalCoverage: r.total_medical_coverage || '',
    bankName: r.bank_name, bankAccount: r.bank_account, accountTitle: r.account_title,
    nokName: r.nok_name, nokRelation: r.nok_relation, nokContact: r.nok_contact,
    contractStartDate: toDateStr(r.contract_date || r.contract_start_date),
    contractDate: toDateStr(r.contract_date),
    contractName: r.contract_name || null,
    contractId:   r.contract_id   || null,
    region: r.region || null,
    lineManagerName:  r.line_manager_name  || null,
    lineManagerEmail: r.line_manager_email || r.supervisor_email || null,
    supervisorEmail:  r.supervisor_email || r.line_manager_email || null,
    clientFocalEmails: r.client_focal_emails || null,
    // ── Operational fields (2026-07-02) ─────────────────────────────────────
    sessiNo:             r.sessi_no               || null,
    shirtSize:           r.shirt_size             || null,
    trouserSize:         r.trouser_size           || null,
    safetyShoeSizeVal:   r.safety_shoe_size       || null,
    lastUniformIssueDate:toDateStr(r.last_uniform_issue_date),
    lastPpeIssueDate:    toDateStr(r.last_ppe_issue_date),
    gatePassExpiry:      toDateStr(r.gate_pass_expiry),
    payrollCycleType:    r.payroll_cycle_type     || 'Monthly',
    salaryHistory: [],
    // Leave balances are no longer faked here — fetched per-employee from
    // GET /api/employees/:id/leave-balance/:year (contract-aware, see below).
});

// ── Employee Routes ──────────────────────────────────────────────────────────
const {
    exportMasterRosterCsv,
    importMasterRosterCsv,
    MASTER_ROSTER_COLUMNS,
} = require('./src/modules/employees/masterRoster');

app.get('/api/employees/export', requireAuth, requireRole('superadmin', 'hr_manager', 'operations', 'operations_supervisor', 'operations_team', 'finance_manager', 'finance_approver'), async (req, res) => {
    try {
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS supervisor_email VARCHAR(255)`).catch(() => {});
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS client_focal_emails TEXT`).catch(() => {});
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS claim_authority TEXT`).catch(() => {});
        const scope = req.query.scope === 'all' ? 'all' : 'active';
        const { csv, filename, rowCount, columnCount } = await exportMasterRosterCsv(pool, { scope });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Row-Count', String(rowCount));
        res.setHeader('X-Column-Count', String(columnCount));
        res.send(csv);
    } catch (err) {
        console.error('[GET /api/employees/export]', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

app.post('/api/employees/import', requireAuth, requireRole('superadmin', 'hr_manager', 'operations', 'operations_supervisor', 'finance_manager'), async (req, res) => {
    try {
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS supervisor_email VARCHAR(255)`).catch(() => {});
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS client_focal_emails TEXT`).catch(() => {});
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS claim_authority TEXT`).catch(() => {});
        const csvText = req.body?.csvText || req.body?.csv || '';
        if (!csvText.trim()) return res.status(400).json({ error: 'csvText required' });
        // MD Step 1: no automated SMS/email on roster ingest
        const result = await importMasterRosterCsv(pool, {
            csvText,
            updatedBy: req.user?.email || null,
        });
        res.json({ ...result, columns: MASTER_ROSTER_COLUMNS });
    } catch (err) {
        console.error('[POST /api/employees/import]', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

app.get('/api/employees', requireAuth, async (req, res) => {
    try {
        const { archive } = await cutover.resolveArchiveMode(req, pool);
        const vis = cutover.employeeVisibilityClause('e', { archive });
        const { rows } = await pool.query(`
            SELECT e.*,
              COALESCE(
                e.contract_date::text,
                (SELECT c.start_date::text
                 FROM contracts c
                 JOIN clients cl ON c.client_id = cl.id
                 WHERE e.client IS NOT NULL AND e.client <> ''
                   AND (
                     LOWER(TRIM(cl.name)) = LOWER(TRIM(e.client))
                     OR LOWER(TRIM(e.client)) LIKE '%' || LOWER(TRIM(cl.name)) || '%'
                     OR LOWER(TRIM(cl.name)) LIKE '%' || LOWER(TRIM(e.client)) || '%'
                   )
                   AND LOWER(TRIM(c.status)) = 'active'
                 ORDER BY c.start_date ASC
                 LIMIT 1)
              ) AS contract_start_date
            FROM employees e
            WHERE ${vis}
            ORDER BY e.name ASC
        `);
        res.json({ employees: rows.map(empFromDb), archive_mode: archive });
    } catch (err) {
        console.error('[GET /api/employees]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/employees/bulk', requireAuth, async (req, res) => {
    const { employees = [], notifyNew = false } = req.body;
    const saved = [], errors = [], newEmployees = [];

    // ── Step 1: Build contract lookup from DB ─────────────────────────────────
    const ctRows = (await pool.query(`
        SELECT c.id, c.contract_name, c.costs, c.financials, cl.name AS client_name, c.status
        FROM contracts c LEFT JOIN clients cl ON c.client_id = cl.id
    `)).rows;
    const ctByName = {}, ctById = {};
    ctRows.forEach(ct => {
        ctByName[ct.contract_name?.toLowerCase()?.trim()] = ct;
        if (ct.id) ctById[ct.id] = ct;
    });

    const COLS = ['id', 'bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'site', 'province',
        'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth',
        'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'last_working_day', 'primary_contact', 'emergency_contact',
        'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic',
        'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id',
        'medical_type', 'medical_maternity', 'total_medical_coverage',
        'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact',
        'contract_date', 'contract_name', 'contract_id', 'region', 'line_manager_name', 'line_manager_email',
        'supervisor_email', 'client_focal_emails',
        'sessi_no', 'shirt_size', 'trouser_size', 'safety_shoe_size',
        'last_uniform_issue_date', 'last_ppe_issue_date', 'gate_pass_expiry', 'payroll_cycle_type'];
    const placeholders = COLS.map((_, i) => `$${i + 1}`).join(',');
    const updates = COLS.slice(1).map(c => `${c}=EXCLUDED.${c}`).join(',');

    // ── Step 2: Batch ID + CNIC lookups (single round-trip each) ────────────
    const importIds = [...new Set(employees.map(e => e.id).filter(Boolean))];
    const importCnic = [...new Set(employees.map(e => e.cnic).filter(Boolean))];
    const idToDbCnic = {};
    const cnicToDbId = {};
    if (importIds.length) {
        const { rows } = await pool.query('SELECT id, cnic FROM employees WHERE id = ANY($1)', [importIds]);
        rows.forEach(r => { idToDbCnic[r.id] = r.cnic; });
    }
    if (importCnic.length) {
        const { rows } = await pool.query('SELECT id, cnic FROM employees WHERE cnic = ANY($1)', [importCnic]);
        rows.forEach(r => { if (r.cnic) cnicToDbId[r.cnic] = r.id; });
    }

    for (const emp of employees) {
        // ── Step 3: Resolve contract ──────────────────────────────────────────
        const rawContract = emp.contractName || emp.contractId || '';
        let resolvedCt = null;
        if (rawContract) {
            resolvedCt = ctById[rawContract]
                || ctByName[rawContract.toLowerCase().trim()]
                || null;
        }

        // ── Step 4: Hard-reject unrecognised contract names ───────────────────
        if (rawContract && !resolvedCt) {
            errors.push({
                id: emp.id, name: emp.name,
                error: `Contract "${rawContract}" not found in database. Please register this contract first or correct the name.`
            });
            continue;
        }

        // ── Step 5: Inherit contract fields if resolved ───────────────────────
        if (resolvedCt) {
            emp.contractId   = resolvedCt.id;
            emp.contractName = resolvedCt.contract_name;
            if (!emp.client) emp.client = resolvedCt.client_name || emp.client;
        }

        // ── Step 6: Strict ID + CNIC validation ─────────────────────────────
        if (emp.cnic && cnicToDbId[emp.cnic] && cnicToDbId[emp.cnic] !== emp.id) {
            errors.push({
                id: emp.id, name: emp.name,
                error: `CNIC ${emp.cnic} already belongs to employee ${cnicToDbId[emp.cnic]}. Cannot overwrite a different record. Update the existing employee directly.`
            });
            continue;
        }
        if (emp.id && emp.cnic && idToDbCnic[emp.id] && idToDbCnic[emp.id] !== emp.cnic) {
            errors.push({
                id: emp.id, name: emp.name,
                error: `Employee ID/CNIC mismatch — refusing to overwrite. ID ${emp.id} is registered to CNIC ${idToDbCnic[emp.id]}, but CSV has CNIC ${emp.cnic}.`
            });
            continue;
        }

        try {
            const d = empToDb(emp);
            const vals = COLS.map(c => d[c]);
            const { rows } = await pool.query(
                `INSERT INTO employees (${COLS.join(',')}) VALUES (${placeholders})
                 ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at=NOW()
                 RETURNING *, (xmax = 0) AS is_new_row`,
                vals
            );
            if (rows.length) {
                const empObj = empFromDb(rows[0]);
                saved.push(empObj);
                // Track new inserts (not updates) for SMS notification
                if (rows[0].is_new_row && notifyNew) newEmployees.push(empObj);
            }
        } catch (err) {
            console.error('[bulk-import]', err);
            errors.push({ id: emp.id, name: emp.name, error: 'Internal server error' });
        }
    }

    // ── Step 6: Send welcome SMS to newly added employees (opt-in) ────────────
    const smsSent = [];
    if (notifyNew && newEmployees.length) {
        for (const newEmp of newEmployees) {
            const phone = newEmp.primaryContact;
            if (!phone) continue;
            const msg = `Welcome to ASIL! Your employment has been confirmed. Employee ID: ${newEmp.id}. For queries contact HR.`;
            try {
                const result = await sendJazzSMS(phone, msg);
                if (!result.ok) continue;
                await pool.query(
                    `INSERT INTO employee_messages (employee_id, channel, direction, body, sent_by) VALUES ($1,'sms','out',$2,$3)`,
                    [newEmp.id, msg, 'system-bulk-import']
                ).catch(() => {});
                smsSent.push(newEmp.id);
            } catch (_) { /* SMS failure is non-fatal */ }
        }
    }

    res.json({ saved: saved.length, errors, employees: saved, smsSent });
});

app.post('/api/employees', requireAuth, async (req, res) => {
    try {
        const d = empToDb(req.body);
        const cols = ['id', 'bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'site', 'province', 'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth', 'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'last_working_day', 'primary_contact', 'emergency_contact', 'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic', 'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id', 'medical_type', 'medical_maternity', 'total_medical_coverage', 'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date', 'contract_name', 'contract_id', 'region', 'line_manager_name', 'line_manager_email', 'sessi_no', 'shirt_size', 'trouser_size', 'safety_shoe_size', 'last_uniform_issue_date', 'last_ppe_issue_date', 'gate_pass_expiry', 'payroll_cycle_type'];
        const vals = cols.map(c => d[c]);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
        const updates = cols.slice(1).map((c, i) => `${c}=EXCLUDED.${c}`).join(',');
        const { rows } = await pool.query(
            `INSERT INTO employees (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at=NOW() RETURNING *`,
            vals
        );
        res.json({ employee: empFromDb(rows[0]) });
    } catch (err) {
        console.error('[POST /api/employees]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/employees/:id', requireAuth, async (req, res) => {
    try {
        const d = empToDb({ ...req.body, id: req.params.id });
        const cols = ['bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'site', 'province', 'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth', 'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'last_working_day', 'primary_contact', 'emergency_contact', 'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic', 'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id', 'medical_type', 'medical_maternity', 'total_medical_coverage', 'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date', 'contract_name', 'contract_id', 'region', 'line_manager_name', 'line_manager_email', 'sessi_no', 'shirt_size', 'trouser_size', 'safety_shoe_size', 'last_uniform_issue_date', 'last_ppe_issue_date', 'gate_pass_expiry', 'payroll_cycle_type'];
        const setClauses = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
        const vals = [...cols.map(c => d[c]), req.params.id];
        const { rows } = await pool.query(
            `UPDATE employees SET ${setClauses}, updated_at=NOW() WHERE id=$${cols.length + 1} RETURNING *`,
            vals
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ employee: empFromDb(rows[0]) });
    } catch (err) {
        console.error('[PUT /api/employees/:id]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/employees/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM employees WHERE id=$1', [req.params.id]);
        logAudit(req, 'employee_delete', 'employee', req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error('[DELETE /api/employees/:id]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Admin: diagnostics + cleanup (SuperAdmin only) ──────────────────────────
// Find duplicate employees by CNIC
app.get('/api/admin/employee-duplicates', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT cnic, COUNT(*) AS cnt,
                   array_agg(id ORDER BY updated_at DESC NULLS LAST) AS ids,
                   array_agg(name ORDER BY updated_at DESC NULLS LAST) AS names,
                   array_agg(COALESCE(salary,0) ORDER BY updated_at DESC NULLS LAST) AS salaries
            FROM employees
            WHERE cnic IS NOT NULL AND cnic <> ''
            GROUP BY cnic HAVING COUNT(*) > 1
            ORDER BY cnt DESC
        `);
        const total = await pool.query('SELECT COUNT(*) FROM employees');
        res.json({ total_employees: parseInt(total.rows[0].count), duplicate_groups: rows.length, duplicates: rows });
    } catch (err) { console.error('[GET /api/admin/employee-duplicates]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Deduplicate: per CNIC, keep the row with highest salary, delete the rest
app.post('/api/admin/dedup-employees', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { rows: dups } = await pool.query(`
            SELECT cnic, array_agg(id ORDER BY
                updated_at DESC NULLS LAST,
                COALESCE(salary,0) DESC
            ) AS ids
            FROM employees
            WHERE cnic IS NOT NULL AND cnic <> ''
            GROUP BY cnic HAVING COUNT(*) > 1
        `);
        let deleted = 0;
        for (const dup of dups) {
            const [keep, ...remove] = dup.ids;
            if (remove.length) {
                await pool.query('DELETE FROM employees WHERE id = ANY($1)', [remove]);
                deleted += remove.length;
                logAudit(req, 'employee_dedup_delete', 'employee', remove.join(','));
            }
        }
        const total = await pool.query('SELECT COUNT(*) FROM employees');
        res.json({ ok: true, deleted, remaining: parseInt(total.rows[0].count) });
    } catch (err) { console.error('[POST /api/admin/dedup-employees]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// MD Mandate §2 — cascade-delete junk employee after clearing FK deps
app.post('/api/admin/purge-employee-cascade', requireAuth, requireRole('superadmin'), async (req, res) => {
    const employeeId = req.body?.employeeId || req.body?.id;
    const PROTECTED = new Set(['ASIL/PSO-298/25', 'ASIL/SPL-418/21', 'ASIL/SPL-420/21']);
    if (!employeeId) return res.status(400).json({ error: 'employeeId required' });
    if (PROTECTED.has(employeeId)) {
        return res.status(403).json({ error: `Employee ${employeeId} is CNIC-protected and cannot be deleted` });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cleared = {};
        const tables = [
            ['payroll_run_rows', 'employee_id'],
            ['payroll_transactions', 'employee_id'],
            ['attendance_records', 'employee_id'],
            ['employee_claims', 'employee_id'],
            ['claims_inbox', 'employee_id'],
            ['pf_ledger', 'employee_id'],
            ['payroll_advances', 'employee_id'],
            ['employee_documents', 'employee_id'],
            ['employee_assets', 'employee_id'],
            ['employee_change_requests', 'employee_id'],
            ['cost_allocations', 'employee_id'],
        ];
        for (const [table, col] of tables) {
            const sp = `sp_${table.replace(/[^a-z0-9_]/gi, '_')}`;
            try {
                await client.query(`SAVEPOINT ${sp}`);
                const r = await client.query(`DELETE FROM ${table} WHERE ${col} = $1`, [employeeId]);
                await client.query(`RELEASE SAVEPOINT ${sp}`);
                cleared[table] = r.rowCount;
            } catch (e) {
                await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
                // Missing table/column is fine — skip
                if (e.code === '42P01' || e.code === '42703') {
                    cleared[table] = `skip:${e.code}`;
                } else {
                    cleared[table] = `err:${e.code || 'unknown'}:${e.message}`;
                }
            }
        }
        const del = await client.query('DELETE FROM employees WHERE id = $1 RETURNING id, name', [employeeId]);
        await client.query('COMMIT');
        if (!del.rows.length) return res.status(404).json({ error: 'Employee not found' });
        res.json({ ok: true, deleted: del.rows[0], cleared });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[purge-employee-cascade]', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Delete all employees whose client name contains a substring (case-insensitive)
app.delete('/api/admin/delete-by-client', requireAuth, requireRole('superadmin'), async (req, res) => {
    const { client_contains } = req.body;
    if (!client_contains) return res.status(400).json({ error: 'client_contains is required' });
    try {
        const preview = await pool.query(
            'SELECT id, name, client FROM employees WHERE LOWER(client) LIKE $1',
            [`%${client_contains.toLowerCase()}%`]
        );
        if (req.query.confirm !== 'yes') {
            return res.json({ preview: preview.rows, count: preview.rows.length, message: 'Add ?confirm=yes to the URL to actually delete' });
        }
        const { rowCount } = await pool.query(
            'DELETE FROM employees WHERE LOWER(client) LIKE $1',
            [`%${client_contains.toLowerCase()}%`]
        );
        logAudit(req, 'employee_delete_by_client', 'employee', `${client_contains} (${rowCount} rows)`);
        res.json({ ok: true, deleted: rowCount });
    } catch (err) { console.error('[DELETE /api/admin/delete-by-client]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Purge a contract and every record tied to it (runs, invoices, claims,
// attendance, rate cards, policies, employees, optionally the client).
// Used to remove TEST/demo data. Requires ?confirm=yes to actually delete.
const { purgeContract } = require('./src/modules/admin/purgeContract');
const { purgeExcelPayrollImports } = require('./src/modules/admin/purgeExcelPayroll');
const { importHistoricRun } = require('./src/modules/payrollrun/service');
const { importHistoricInvoices } = require('./src/modules/ar/service');
const { purgeTestReceipts } = require('./src/modules/ar/receipts');

app.post('/api/admin/purge-excel-payroll-imports', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const confirm = req.body?.confirm === true || req.query?.confirm === 'yes';
        res.json(await purgeExcelPayrollImports(pool, { confirm }));
    } catch (err) {
        console.error('[POST /api/admin/purge-excel-payroll-imports]', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/import-payroll-history', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { contractId, month, year, rows } = req.body;
        const result = await importHistoricRun(pool, {
            contractId,
            month: parseInt(month, 10),
            year: parseInt(year, 10),
            rows: rows || [],
            importedBy: `excel_import:${req.user?.email || 'system'}`,
        });
        if (!result.ok) return res.status(400).json(result);
        res.json(result);
    } catch (err) {
        console.error('[POST /api/admin/import-payroll-history]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// MD Mandate §6 — live focal claim notification test
app.post('/api/admin/test-claim-notify', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
    try {
        const to = req.body?.to || 'laiba.mughal@asil.com.pk';
        const subject = req.body?.subject || '[HCM] Focal claim notification test';
        const html = req.body?.html || `<p>Focal claim notification test to ${to}</p>`;
        await sendAppEmail({ to, subject, html });
        res.json({ ok: true, to, subject });
    } catch (err) {
        console.error('[POST /api/admin/test-claim-notify]', err);
        res.status(500).json({ error: err.message });
    }
});

// Portal OTP readiness — active employees missing both email and phone (S1C)
app.get('/api/admin/portal-readiness', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { rows: counts } = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE active = 'Yes') AS total_active,
                COUNT(*) FILTER (
                    WHERE active = 'Yes'
                      AND COALESCE(NULLIF(TRIM(email), ''), '') = ''
                      AND COALESCE(NULLIF(regexp_replace(COALESCE(primary_contact,''), '\\D', '', 'g'), ''), '') = ''
                ) AS missing_contact_count
            FROM employees
        `);
        const { rows: missing_contact } = await pool.query(`
            SELECT e.id, e.name, e.contract_name,
                   (COALESCE(NULLIF(TRIM(e.email), ''), '') <> '') AS has_email,
                   (COALESCE(NULLIF(regexp_replace(COALESCE(e.primary_contact,''), '\\D', '', 'g'), ''), '') <> '') AS has_phone
            FROM employees e
            WHERE e.active = 'Yes'
              AND COALESCE(NULLIF(TRIM(e.email), ''), '') = ''
              AND COALESCE(NULLIF(regexp_replace(COALESCE(e.primary_contact,''), '\\D', '', 'g'), ''), '') = ''
            ORDER BY e.name
            LIMIT 500
        `);
        const total_active = parseInt(counts[0]?.total_active, 10) || 0;
        const missingCount = parseInt(counts[0]?.missing_contact_count, 10) || 0;
        res.json({
            total_active,
            ready: total_active - missingCount,
            missing_contact,
        });
    } catch (err) {
        console.error('[GET /api/admin/portal-readiness]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// July 2026 cutover — archive toggle (superadmin + huzaifa only)
app.get('/api/admin/cutover-settings', requireAuth, async (req, res) => {
    try {
        if (!cutover.canUseArchiveToggle(req.user)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const config = await cutover.loadCutoverConfig(pool);
        res.json({
            cutover_period: { month: config.cutoverMonth, year: config.cutoverYear },
            show_pre_cutover_archive: config.showPreCutoverArchive,
            can_toggle: true,
        });
    } catch (err) {
        console.error('[GET /api/admin/cutover-settings]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/admin/cutover-settings', requireAuth, async (req, res) => {
    try {
        if (!cutover.canUseArchiveToggle(req.user)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const { show_pre_cutover_archive } = req.body || {};
        if (typeof show_pre_cutover_archive !== 'boolean') {
            return res.status(400).json({ error: 'show_pre_cutover_archive (boolean) required' });
        }
        const old = await pool.query(`SELECT value FROM system_config WHERE key = 'show_pre_cutover_archive'`);
        await pool.query(
            `INSERT INTO system_config (key, value) VALUES ('show_pre_cutover_archive', $1::jsonb)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [JSON.stringify(show_pre_cutover_archive)]
        );
        logAudit(req, 'cutover_archive_toggle', 'system_config', show_pre_cutover_archive ? 'on' : 'off');
        if (old.rows[0]) {
            await pool.query(
                `INSERT INTO system_config_history (config_key, old_value, new_value, changed_by)
                 VALUES ('show_pre_cutover_archive', $1, $2, $3)`,
                [old.rows[0].value, JSON.stringify(show_pre_cutover_archive), req.user?.email || null]
            ).catch(() => {});
        }
        res.json({ ok: true, show_pre_cutover_archive });
    } catch (err) {
        console.error('[PUT /api/admin/cutover-settings]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/import-invoices', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        res.json(await importHistoricInvoices(pool, {
            invoices: req.body.invoices || [],
            importedBy: req.user?.email || 'excel_import',
        }));
    } catch (err) {
        console.error('[POST /api/admin/import-invoices]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/purge-test-receipts', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const result = await purgeTestReceipts(pool);
        logAudit(req, 'purge_test_receipts', 'receipt', 'bulk');
        res.json(result);
    } catch (err) {
        console.error('[DELETE /api/admin/purge-test-receipts]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/admin/purge-contract', requireAuth, requireRole('superadmin'), async (req, res) => {
    const { contract_id, client_id } = req.body || {};
    if (!contract_id) return res.status(400).json({ error: 'contract_id is required' });
    try {
        const result = await purgeContract(pool, { contract_id, client_id }, {
            confirm: req.query.confirm === 'yes',
        });
        if (req.query.confirm === 'yes') logAudit(req, 'purge_contract', 'contract', contract_id);
        res.json(result);
    } catch (err) { console.error('[DELETE /api/admin/purge-contract]', err); res.status(500).json({ error: 'Internal server error' }); }
});


// ── SMS Routes (Jazz CMT via Fixie) ─────────────────────────────────────────
app.get('/api/sms/status', requireAuth, requireRole('superadmin'), (req, res) => {
    res.json({
        proxyConfigured: isJazzProxyConfigured(),
        proxyHost: jazzProxyLogLabel(),
        mask: process.env.JAZZ_SMS_MASK || 'ALLIED SERV',
        userConfigured: Boolean(process.env.JAZZ_SMS_USER && String(process.env.JAZZ_SMS_USER).trim()),
        passConfigured: Boolean(process.env.JAZZ_SMS_PASS && String(process.env.JAZZ_SMS_PASS).trim()),
        otpUserConfigured: Boolean(process.env.JAZZ_OTP_USER && String(process.env.JAZZ_OTP_USER).trim()),
    });
});

app.post('/api/sms/diagnostic', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const to = req.body?.to || '03008275688';
        const message = req.body?.message || 'HCM SMS is live — Fixie diagnostic test';
        const result = await sendJazzSMS(to, message);
        res.status(result.ok ? 200 : 502).json({
            ...result,
            proxyConfigured: isJazzProxyConfigured(),
            proxyHost: jazzProxyLogLabel(),
            mask: process.env.JAZZ_SMS_MASK || 'ALLIED SERV',
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message, proxyConfigured: isJazzProxyConfigured(), proxyHost: jazzProxyLogLabel() });
    }
});

app.post('/api/sms/send', requireAuth, async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message are required' });
    if (message.length > 160) return res.status(400).json({ error: 'Message exceeds 160 characters' });
    try {
        const result = await sendJazzSMS(to, message);
        if (!result.ok) return res.status(502).json({ error: result.response, ...result });
        if (req.body.employee_id) {
            await pool.query(
                `INSERT INTO employee_messages (employee_id, channel, direction, body, sent_by) VALUES ($1,'sms','out',$2,$3)`,
                [req.body.employee_id, message, req.user.email]
            ).catch(() => {});
        }
        res.json(result);
    } catch (err) { console.error('[POST /api/sms/send]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/sms/bulk', requireAuth, async (req, res) => {
    const { recipients = [], message } = req.body;
    if (!message || !recipients.length) return res.status(400).json({ error: 'recipients and message required' });
    const results = [];
    const smsLogIds = [], smsLogBodies = [], smsLogSenders = [];
    for (const r of recipients) {
        if (!r.phone) { results.push({ name: r.name, ok: false, error: 'No phone' }); continue; }
        try {
            const smsMsg = message.replace('{name}', r.name || '');
            const result = await sendJazzSMS(r.phone, smsMsg);
            const empId = r.employee_id || r.id;
            if (result.ok && empId) {
                smsLogIds.push(empId);
                smsLogBodies.push(smsMsg);
                smsLogSenders.push(req.user.email);
            }
            results.push({ name: r.name, phone: r.phone, ok: result.ok, response: result.response, error: result.ok ? undefined : result.response });
        } catch (err) {
            results.push({ name: r.name, phone: r.phone, ok: false, error: err.message });
        }
    }
    if (smsLogIds.length > 0) {
        await pool.query(
            `INSERT INTO employee_messages (employee_id, channel, direction, body, sent_by)
              SELECT unnest($1::text[]),'sms','out',unnest($2::text[]),unnest($3::text[])`,
            [smsLogIds, smsLogBodies, smsLogSenders]
        ).catch(() => {});
    }
    res.json({ sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
});


// ── Bills / Procurement (persisted) ──────────────────────────────────────────

// ── OCR endpoint — GPT-4o Vision ─────────────────────────────────────────────
app.post('/api/bills/ocr', requireAuth, strictLimiter, async (req, res) => {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY || OPENAI_KEY.startsWith('sk-dummy')) {
        return res.status(503).json({ error: 'OpenAI API key not configured on server' });
    }

    const prompt = `You are an expert bill/receipt extraction assistant specializing in Pakistani bills.
This image may contain a handwritten or printed bill in Urdu, English, or both.

IMPORTANT RULES:
1. Pakistani bills often show: vendor name in Urdu at top, items listed with Urdu descriptions, amounts on the right side
2. Amounts are in Pakistani Rupees (Rs) — numbers like 2600, 5000, 2800 are PKR amounts
3. The last/largest number at the bottom is usually the GRAND TOTAL
4. Translate any Urdu item descriptions to English (best effort)
5. If unit price is not shown, calculate it from total ÷ qty
6. Do NOT invent data — if something is unclear, write "?" for text or 0 for numbers
7. The confidence score must reflect actual legibility (blurry/old receipts = 0.3-0.6)
8. CRITICAL FOR HANDWRITTEN/URDU: Even if mostly unreadable, ALWAYS extract:
   a) vendor: the largest text at the TOP of the receipt (usually shop/vendor name)
   b) grandTotal: the largest or bottom-most number (usually the total)
   Set confidence=0.2 if found vendor+total in unreadable bill; confidence=0.05 if completely blank

Return ONLY valid JSON, no markdown, no explanation:
{
  "vendor": "vendor name in English (translate from Urdu if needed)",
  "date": "YYYY-MM-DD (convert Pakistani date DD-MM-YY format)",
  "items": [
    { "desc": "item description in English", "qty": 1, "unit": 0, "total": 2600 }
  ],
  "subtotal": 10200,
  "gst": 0,
  "grandTotal": 10200,
  "confidence": 0.82,
  "raw": "all visible text from image, line by line"
}

Verify: items totals should sum to subtotal. grandTotal = subtotal + gst.`;

    try {
        const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 1200,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}`, detail: 'high' } }
                    ]
                }]
            }),
        });

        if (!oaiRes.ok) {
            const errText = await oaiRes.text();
            console.error('OpenAI error:', errText);
            return res.status(502).json({ error: 'OpenAI API error: ' + oaiRes.status });
        }

        const oaiData = await oaiRes.json();
        const rawContent = oaiData.choices?.[0]?.message?.content || '{}';

        // Strip markdown code fences if present
        const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        let extracted;
        try {
            extracted = JSON.parse(cleaned);
        } catch {
            return res.status(502).json({ error: 'Could not parse OCR response — try a clearer image' });
        }

        // Ensure items array is valid
        if (!Array.isArray(extracted.items)) extracted.items = [];
        extracted.items = extracted.items.map(it => ({
            desc: String(it.desc || ''),
            qty: parseFloat(it.qty) || 1,
            unit: parseFloat(it.unit) || 0,
            total: parseFloat(it.total) || Math.round((parseFloat(it.qty) || 1) * (parseFloat(it.unit) || 0)),
        }));
        // Recalculate subtotal from items if not provided
        if (!extracted.subtotal && extracted.items.length) {
            extracted.subtotal = extracted.items.reduce((a, it) => a + it.total, 0);
        }
        if (!extracted.grandTotal) extracted.grandTotal = (extracted.subtotal || 0) + (extracted.gst || 0);

        res.json({ ok: true, extracted });
    } catch (err) {
        console.error('OCR fetch error:', err.message);
        res.status(500).json({ error: 'OCR request failed: ' + err.message });
    }
});

// Auto-create bills table + idempotent column migrations
pool.query(`
    CREATE TABLE IF NOT EXISTS bills (
        id          TEXT PRIMARY KEY,
        type        TEXT,
        vendor      TEXT,
        date        TEXT,
        client      TEXT,
        contract    TEXT,
        contract_id TEXT,
        bu          TEXT,
        site        TEXT,
        bill_type   TEXT,
        purpose     TEXT,
        note        TEXT,
        items       JSONB DEFAULT '[]',
        amount      NUMERIC(12,2) DEFAULT 0,
        gst         NUMERIC(12,2) DEFAULT 0,
        total       NUMERIC(12,2) DEFAULT 0,
        status      TEXT DEFAULT 'Draft',
        invoice_no  TEXT,
        created_by  TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
`).catch(e => console.error('bills table init error:', e.message));

// Idempotent migrations — add columns that may not exist on older live tables
[
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS contract     TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS contract_id  TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS bu           TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS invoice_no   TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS site         TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS bill_type    TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS purpose      TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS note         TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS created_by   TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS billable     BOOLEAN DEFAULT TRUE`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS period_month INT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS period_year  INT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS bill_category   TEXT DEFAULT 'official'`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_method  TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS payment_account TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS wht_amount      NUMERIC(12,2) DEFAULT 0`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS gst_exempt       BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_at      TIMESTAMPTZ`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_by      TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS xero_invoice_id TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS xero_synced_at TIMESTAMPTZ`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS import_status TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS tracking_category TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS invoiced_in TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS vendor_bank_account TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS vendor_bank_code TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS vendor_bank_name TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS xero_contact_name TEXT`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS excluded_from_sync BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE contract_policies ADD COLUMN IF NOT EXISTS income_tax_wht_pct NUMERIC(5,2)`,
    `CREATE TABLE IF NOT EXISTS invoice_receipts (
        id SERIAL PRIMARY KEY,
        client TEXT NOT NULL,
        receipt_date DATE NOT NULL,
        bank_ref TEXT,
        total_cash NUMERIC(14,2) DEFAULT 0,
        total_income_tax_wht NUMERIC(14,2) DEFAULT 0,
        total_sales_tax_withheld NUMERIC(14,2) DEFAULT 0,
        total_sales_tax_self_paid NUMERIC(14,2) DEFAULT 0,
        posted_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS invoice_receipt_lines (
        id SERIAL PRIMARY KEY,
        receipt_id INTEGER NOT NULL REFERENCES invoice_receipts(id) ON DELETE CASCADE,
        invoice_id INTEGER NOT NULL,
        cash_received NUMERIC(14,2) DEFAULT 0,
        income_tax_wht NUMERIC(14,2) DEFAULT 0,
        sales_tax_withheld_by_client NUMERIC(14,2) DEFAULT 0,
        sales_tax_self_paid NUMERIC(14,2) DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS delivery_challans (
        id          TEXT PRIMARY KEY,
        bill_id     TEXT NOT NULL,
        challan_no  TEXT UNIQUE,
        client      TEXT,
        vendor      TEXT,
        contract    TEXT,
        site        TEXT,
        items       JSONB DEFAULT '[]',
        total       NUMERIC(12,2) DEFAULT 0,
        delivery_date DATE,
        notes       TEXT,
        printed_by  TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    )`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS site TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS sessi_no TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS shirt_size TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS trouser_size TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS safety_shoe_size TEXT`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_uniform_issue_date DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_ppe_issue_date DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS gate_pass_expiry DATE`,
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_cycle_type TEXT DEFAULT 'Monthly'`,
].forEach(sql => pool.query(sql).catch(e => console.error('bills migration:', e.message)));

// Employee table migrations
[
    `ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_working_day DATE`,
].forEach(sql => pool.query(sql).catch(e => console.error('employees migration:', e.message)));

// Clients table migrations
[
    `ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
].forEach(sql => pool.query(sql).catch(e => console.error('clients migration:', e.message)));

// MD Mandate §1 — named-user role assignments enforced on every startup
[
    ['huzaifa.rafaqat@asil.com.pk', 'finance_manager'],
    ['laiba.mughal@asil.com.pk',    'procurement_manager'],
    ['asif.awan@asil.com.pk',       'finance_approver'],
    ['obaid.rana@asil.com.pk',      'operations'],
    ['rabia.bhutto@asil.com.pk',    'operations_supervisor'],
].forEach(([email, role]) => {
    pool.query(
        `INSERT INTO hcm_users (email, name, role, google_id)
         VALUES ($2, split_part($2,'@',1), $1, 'pending:' || $2)
         ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
         WHERE hcm_users.role IS DISTINCT FROM EXCLUDED.role`,
        [role, email]
    )
        .then(r => { if (r.rowCount) console.log('Role enforced: ' + email + ' -> ' + role); })
        .catch(e => console.error('Named role error:', e.message));
});


const billFromDb = (r) => ({
    id: r.id, type: r.type, vendor: r.vendor, date: r.date,
    client: r.client, contract: r.contract, contractId: r.contract_id,
    bu: r.bu, site: r.site,
    billType: r.bill_type, purpose: r.purpose, note: r.note,
    invoiceNo: r.invoice_no,
    items: r.items || [], amount: parseFloat(r.amount) || 0,
    gst: parseFloat(r.gst) || 0, total: parseFloat(r.total) || 0,
    status: r.status || 'Draft', createdBy: r.created_by, billable: r.billable,
    billCategory: r.bill_category || 'official',
    whtAmount: parseFloat(r.wht_amount) || 0, gstExempt: r.gst_exempt || false,
    paymentMethod: r.payment_method, paymentAccount: r.payment_account,
    createdAt: r.created_at,
});

app.get('/api/bills', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM bills ORDER BY created_at DESC');
        res.json(rows.map(billFromDb));
    } catch (err) { console.error('[GET /api/bills]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/bills', requireAuth, requireRole('procurement_proposer','finance_proposer','finance_approver','superadmin'), async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO bills (id,type,vendor,date,client,contract,contract_id,bu,site,bill_type,purpose,note,invoice_no,items,amount,gst,total,status,created_by,billable,bill_category,wht_amount,gst_exempt)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
             ON CONFLICT (id) DO UPDATE SET
               vendor=EXCLUDED.vendor, date=EXCLUDED.date, client=EXCLUDED.client,
               contract=EXCLUDED.contract, contract_id=EXCLUDED.contract_id,
               bu=EXCLUDED.bu, site=EXCLUDED.site, bill_type=EXCLUDED.bill_type,
               purpose=EXCLUDED.purpose, note=EXCLUDED.note, invoice_no=EXCLUDED.invoice_no,
               items=EXCLUDED.items, amount=EXCLUDED.amount, gst=EXCLUDED.gst,
               total=EXCLUDED.total, status=EXCLUDED.status, billable=EXCLUDED.billable, bill_category=EXCLUDED.bill_category, wht_amount=EXCLUDED.wht_amount, gst_exempt=EXCLUDED.gst_exempt, updated_at=NOW()
             RETURNING *`,
            [b.id, b.type, b.vendor, b.date, b.client, b.contract, b.contractId || null,
             b.bu || null, b.site, b.billType, b.purpose, b.note, b.invoiceNo || null,
             JSON.stringify(b.items || []), b.amount || 0, b.gst || 0, b.total || 0,
             b.status || 'Draft', req.user.email, b.billable !== false,
             b.billCategory || 'official', b.whtAmount || 0, b.gstExempt || false]
        );
        const r = rows[0];
        res.json({ ok: true, bill: {
            id: r.id, type: r.type, vendor: r.vendor, date: r.date,
            client: r.client, contract: r.contract, contractId: r.contract_id,
            bu: r.bu, site: r.site, billType: r.bill_type, purpose: r.purpose,
            note: r.note, invoiceNo: r.invoice_no, items: r.items || [],
            amount: parseFloat(r.amount) || 0, gst: parseFloat(r.gst) || 0,
            total: parseFloat(r.total) || 0, status: r.status || 'Draft',
            createdBy: r.created_by, billable: r.billable,
            billCategory: r.bill_category || 'official',
            whtAmount: parseFloat(r.wht_amount) || 0, gstExempt: r.gst_exempt || false,
            paymentMethod: r.payment_method, paymentAccount: r.payment_account,
        } });
    } catch (err) { console.error('[POST /api/bills]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.patch('/api/bills/:id/status', requireAuth, requireRole('procurement_approver','finance_approver','superadmin'), async (req, res) => {
    const { status, paymentMethod, paymentAccount } = req.body;
    const VALID = ['Draft','Pending Approval','Approved','Rejected','Pushed to Xero','Posted','Paid'];
    if (!VALID.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID.join(', ')}` });
    try {
        if (status === 'Approved') {
            const gate = await canApproveBill(pool, req.params.id, req.body.overrideReason);
            if (!gate.ok) return res.status(400).json({ error: gate.message, ...gate });
        }
        const extra = status === 'Paid'
            ? `, paid_at=NOW(), paid_by=$3, payment_method=$4, payment_account=$5`
            : '';
        const params = status === 'Paid'
            ? [status, req.params.id, req.user.email, paymentMethod || null, paymentAccount || null]
            : [status, req.params.id];
        await pool.query(`UPDATE bills SET status=$1, updated_at=NOW()${extra} WHERE id=$2`, params);
        logAudit(req, `bill_status_${status.toLowerCase().replace(/\s+/g, '_')}`, 'bill', req.params.id);
        res.json({ ok: true, status });
    } catch (err) { console.error('[PATCH /api/bills/:id/status]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/bills/:id/unlock — password-protected unlock for paid bills (superadmin only)
app.post('/api/bills/:id/unlock', requireAuth, requireRole('superadmin'), async (req, res) => {
    const { password } = req.body;
    const correctPwd = process.env.BILLS_UNLOCK_PASSWORD;
    if (!correctPwd) return res.status(503).json({ error: 'BILLS_UNLOCK_PASSWORD not set in environment. Please contact your system administrator.' });
    if (password !== correctPwd) return res.status(403).json({ error: 'Incorrect password. Access denied.' });
    try {
        await pool.query(`UPDATE bills SET status='Approved', paid_at=NULL, paid_by=NULL, updated_at=NOW() WHERE id=$1`, [req.params.id]);
        pool.query(
            `INSERT INTO audit_log (user_email, action_type, entity_type, entity_id, created_at) VALUES ($1, $2, $3, $4, NOW())`,
            [req.user.email, 'bill_unlock', 'bill', req.params.id]
        ).catch(err => console.error('[POST /api/bills/:id/unlock] audit_log write failed', err));
        res.json({ ok: true, message: 'Bill unlocked and reset to Approved status.' });
    } catch (err) { console.error('[POST /api/bills/:id/unlock]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/bills/:id/challan — generate or retrieve a delivery challan
// PUT /api/bills/:id — maker can edit own bills before approval
app.put('/api/bills/:id', requireAuth, async (req, res) => {
    const b = req.body;
    try {
        const { rows: [existing] } = await pool.query('SELECT created_by, status FROM bills WHERE id=$1', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Bill not found' });
        const isMaker = existing.created_by === req.user.email;
        const isSuperAdmin = req.user.role === 'superadmin';
        const isEditable = ['Draft', 'Pending Approval', 'Pending'].includes(existing.status);
        if (!isSuperAdmin && !(isMaker && isEditable)) {
            return res.status(403).json({ error: 'Bills can only be edited by the maker before approval.' });
        }
        const { rows } = await pool.query(
            `UPDATE bills SET vendor=$1, date=$2, client=$3, contract=$4, contract_id=$5, bu=$6, site=$7,
             bill_type=$8, purpose=$9, note=$10, invoice_no=$11, items=$12,
             amount=$13, gst=$14, total=$15, billable=$16, bill_category=$17,
             wht_amount=$18, gst_exempt=$19, updated_at=NOW() WHERE id=$20 RETURNING *`,
            [b.vendor, b.date, b.client, b.contract, b.contractId || null, b.bu, b.site,
             b.billType, b.purpose, b.note, b.invoiceNo,
             JSON.stringify(b.items || []), b.amount || 0, b.gst || 0, b.total || 0,
             b.billable !== false, b.billCategory || 'official', b.whtAmount || 0, b.gstExempt || false,
             req.params.id]
        );
        res.json({ ok: true, bill: billFromDb(rows[0]) });
    } catch (err) { console.error('[PUT /bills/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/bills/:id/challan', requireAuth, async (req, res) => {
    try {
        const { delivery_date, notes } = req.body;
        const billId = req.params.id;

        // Get bill
        const { rows: billRows } = await pool.query('SELECT * FROM bills WHERE id=$1', [billId]);
        if (!billRows.length) return res.status(404).json({ error: 'Bill not found' });
        const bill = billRows[0];

        // Check if challan already exists for this bill
        const { rows: existingRows } = await pool.query(
            'SELECT * FROM delivery_challans WHERE bill_id=$1', [billId]);

        if (existingRows.length > 0) {
            // Update and return existing
            const { rows: updated } = await pool.query(
                `UPDATE delivery_challans SET delivery_date=$1, notes=$2, printed_by=$3, updated_at=NOW()
                 WHERE bill_id=$4 RETURNING *`,
                [delivery_date || existingRows[0].delivery_date,
                 notes ?? existingRows[0].notes,
                 req.user.email, billId]
            ).catch(async () => {
                // If updated_at column doesn't exist yet, do without it
                return pool.query(
                    'UPDATE delivery_challans SET delivery_date=$1, notes=$2, printed_by=$3 WHERE bill_id=$4 RETURNING *',
                    [delivery_date || existingRows[0].delivery_date, notes ?? existingRows[0].notes, req.user.email, billId]
                );
            });
            return res.json({ ok: true, challan: updated[0] || existingRows[0] });
        }

        // Create new challan with sequential number
        const { rows: countRows } = await pool.query('SELECT COUNT(*) AS cnt FROM delivery_challans');
        const seq = String(parseInt(countRows[0].cnt) + 1).padStart(3, '0');
        const now = new Date();
        const monthAbbr = now.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        const yr2 = String(now.getFullYear()).slice(-2);
        const challanNo = `DC-${monthAbbr}${yr2}-${seq}`;
        const challanId = `CHAL-${Date.now()}`;

        const { rows: newRows } = await pool.query(
            `INSERT INTO delivery_challans
                (id, bill_id, challan_no, client, vendor, contract, site, items, total, delivery_date, notes, printed_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING *`,
            [challanId, billId, challanNo,
             bill.client, bill.vendor, bill.contract, bill.site,
             JSON.stringify(bill.items || []), parseFloat(bill.total) || 0,
             delivery_date || new Date().toISOString().split('T')[0],
             notes || null, req.user.email]
        );
        res.json({ ok: true, challan: newRows[0] });
    } catch (err) { console.error('[POST /api/bills/:id/challan]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/bills/:id/challan — retrieve existing challan for a bill
app.get('/api/bills/:id/challan', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM delivery_challans WHERE bill_id=$1', [req.params.id]);
        res.json({ challan: rows[0] || null });
    } catch (err) { console.error('[GET /api/bills/:id/challan]', err); res.status(500).json({ error: 'Internal server error' }); }
});


app.delete('/api/bills/:id', requireAuth, async (req, res) => {
    // Maker can delete own Draft/Pending bills; superadmin can delete anything
    const { rows: [bill] } = await pool.query('SELECT created_by, status FROM bills WHERE id=$1', [req.params.id]).catch(() => ({ rows: [] }));
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    const isMaker = bill.created_by === req.user.email;
    const isSuperAdmin = req.user.role === 'superadmin';
    const isDeletable = ['Draft', 'Pending Approval', 'Pending'].includes(bill.status);
    if (!isSuperAdmin && !(isMaker && isDeletable)) {
        return res.status(403).json({ error: 'Only the bill maker can delete Draft/Pending bills. Approved or Paid bills require SuperAdmin.' });
    }
    try {
        const result = await pool.query('DELETE FROM bills WHERE id=$1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Bill not found' });
        logAudit(req, 'bill_delete', 'bill', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/bills/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Client Mappers ──────────────────────────────────────────────────────────

const clientFromDb = (r) => ({
    id: r.id, name: r.name, hq: r.hq, ntn: r.ntn, strn: r.strn, industry: r.industry,
    asilBu: r.asil_bu || '',
    isActive: r.is_active !== false,  // default true for old rows without the column
    contacts: r.contacts || [],
    contracts: [],  // loaded separately
});

// ── Client Routes ──────────────────────────────────────────────────────────
app.get('/api/clients', requireAuth, async (req, res) => {
    try {
        // ?all=true → return every client (used by Client Management admin page)
        // default    → active clients only (used by all dropdowns / payroll / billing)
        const showAll = req.query.all === 'true';
        const clientQuery = showAll
            ? 'SELECT * FROM clients ORDER BY name ASC'
            : 'SELECT * FROM clients WHERE is_active IS NOT FALSE ORDER BY name ASC';
        const { rows: clients } = await pool.query(clientQuery);
        const { rows: contracts } = await pool.query('SELECT * FROM contracts ORDER BY contract_name ASC');
        const result = clients.map(c => ({
            ...clientFromDb(c),
            contracts: contracts.filter(ct => ct.client_id === c.id).map(ct => ({
                id: ct.id, contractName: ct.contract_name,
                location: ct.location, serviceType: ct.service_type,
                headcount: ct.headcount, status: ct.status,
                startDate: toDateStr(ct.start_date),
                endDate: toDateStr(ct.end_date),
                costs: ct.costs || {}, financials: ct.financials || {},
                alliedFocalEmail: ct.allied_focal_email || '',
                clientFocalName: ct.client_focal_name || '',
                clientFocalEmail: ct.client_focal_email || '',
            }))
        }));
        res.json({ clients: result });
    } catch (err) { console.error('[GET /api/clients]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/clients', requireAuth, async (req, res) => {
    try {
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS asil_bu TEXT`).catch(() => {});
        const { name, hq, ntn, strn, industry, contacts = [], asilBu } = req.body;
        const id = req.body.id || `CLT-${Date.now()}`;
        const { rows } = await pool.query(
            `INSERT INTO clients (id,name,hq,ntn,strn,industry,contacts,asil_bu) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,hq=EXCLUDED.hq,ntn=EXCLUDED.ntn,strn=EXCLUDED.strn,industry=EXCLUDED.industry,contacts=EXCLUDED.contacts,asil_bu=COALESCE(EXCLUDED.asil_bu,clients.asil_bu) RETURNING *`,
            [id, name, hq || null, ntn || null, strn || null, industry || null, JSON.stringify(contacts), asilBu || null]
        );
        res.json({ client: { ...clientFromDb(rows[0]), contracts: [] } });
    } catch (err) { console.error('[POST /api/clients]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/clients/:id', requireAuth, async (req, res) => {
    try {
        await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS asil_bu TEXT`).catch(() => {});
        const { name, hq, ntn, strn, industry, contacts = [], asilBu } = req.body;
        const { rows } = await pool.query(
            `UPDATE clients SET name=$1,hq=$2,ntn=$3,strn=$4,industry=$5,contacts=$6,asil_bu=COALESCE($8,asil_bu) WHERE id=$7 RETURNING *`,
            [name, hq || null, ntn || null, strn || null, industry || null, JSON.stringify(contacts), req.params.id, asilBu || null]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });

        // Also upsert contracts passed in req.body.contracts
        const contracts = req.body.contracts || [];
        for (const ct of contracts) {
            await pool.query(
                `INSERT INTO contracts (id, client_id, contract_name, location, service_type, headcount, status, start_date, end_date, costs, financials, allied_focal_email, client_focal_name, client_focal_email)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                 ON CONFLICT (id) DO UPDATE SET contract_name=EXCLUDED.contract_name, location=EXCLUDED.location, service_type=EXCLUDED.service_type, headcount=EXCLUDED.headcount, status=EXCLUDED.status, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, costs=EXCLUDED.costs, financials=EXCLUDED.financials, allied_focal_email=EXCLUDED.allied_focal_email, client_focal_name=EXCLUDED.client_focal_name, client_focal_email=EXCLUDED.client_focal_email`,
                [ct.id || `CTR-${Date.now()}`, req.params.id, ct.contractName || null, ct.location || null, ct.serviceType || null, ct.headcount || 0, ct.status || 'Active', nullDate(ct.startDate), nullDate(ct.endDate), JSON.stringify(ct.costs || {}), JSON.stringify(ct.financials || {}), ct.alliedFocalEmail || null, ct.clientFocalName || null, ct.clientFocalEmail || null]
            );
        }
        // Return updated client with contracts
        const { rows: ctRows } = await pool.query('SELECT * FROM contracts WHERE client_id=$1', [req.params.id]);
        res.json({ client: { ...clientFromDb(rows[0]), contracts: ctRows.map(ct => ({ id: ct.id, contractName: ct.contract_name, location: ct.location, serviceType: ct.service_type, headcount: ct.headcount, status: ct.status, startDate: toDateStr(ct.start_date), endDate: toDateStr(ct.end_date), costs: ct.costs, financials: ct.financials, alliedFocalEmail: ct.allied_focal_email, clientFocalName: ct.client_focal_name, clientFocalEmail: ct.client_focal_email })) } });
    } catch (err) { console.error('[PUT /api/clients/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/clients/:id/toggle-active — soft activate / deactivate
app.patch('/api/clients/:id/toggle-active', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'UPDATE clients SET is_active = NOT COALESCE(is_active, TRUE) WHERE id=$1 RETURNING id, is_active',
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Client not found' });
        res.json({ ok: true, isActive: rows[0].is_active });
    } catch (err) { console.error('[PATCH /api/clients/:id/toggle-active]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/clients/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
        logAudit(req, 'client_delete', 'client', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/clients/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT BUSINESS UNITS (BU)
// ═══════════════════════════════════════════════════════════════════════════════
pool.query(`CREATE TABLE IF NOT EXISTS client_business_units (
    id          SERIAL PRIMARY KEY,
    client_id   TEXT NOT NULL,
    bu_code     VARCHAR(50)  NOT NULL,
    bu_name     VARCHAR(200) NOT NULL,
    description TEXT,
    is_active   BOOLEAN DEFAULT TRUE,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(client_id, bu_code)
)`).catch(e => console.warn('[BU table init]', e.message));

// Helper — prepend implicit ALL entry if not stored
const withAllBU = (clientId, rows) => {
    const hasAll = rows.some(r => r.bu_code === 'ALL');
    const allEntry = { id: null, client_id: clientId, bu_code: 'ALL', bu_name: 'General / All', description: 'No BU segregation', is_active: true, sort_order: -1 };
    return hasAll ? rows : [allEntry, ...rows];
};

// GET /api/clients/:id/bus
app.get('/api/clients/:id/bus', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM client_business_units WHERE client_id=$1 ORDER BY sort_order ASC, bu_code ASC',
            [req.params.id]);
        res.json({ bus: withAllBU(req.params.id, rows) });
    } catch (err) { console.error('[GET /api/clients/:id/bus]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/bus?client_id=X  or  ?client_name=X  — lightweight lookup
app.get('/api/bus', requireAuth, async (req, res) => {
    try {
        const { client_id, client_name } = req.query;
        let cid = client_id;
        if (!cid && client_name) {
            const r = await pool.query('SELECT id FROM clients WHERE LOWER(name)=LOWER($1) LIMIT 1', [client_name]);
            cid = r.rows[0]?.id || null;
        }
        if (!cid) return res.json({ bus: [{ id: null, bu_code: 'ALL', bu_name: 'General / All', is_active: true }] });
        const { rows } = await pool.query(
            'SELECT id, bu_code, bu_name, is_active FROM client_business_units WHERE client_id=$1 AND is_active=TRUE ORDER BY sort_order ASC, bu_code ASC',
            [cid]);
        res.json({ bus: withAllBU(cid, rows) });
    } catch (err) { console.error('[GET /api/bus]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/clients/:id/bus
app.post('/api/clients/:id/bus', requireAuth, requireRole('superadmin','finance_manager','finance_approver','operations'), async (req, res) => {
    try {
        const { bu_code, bu_name, description, sort_order = 0 } = req.body;
        if (!bu_code || !bu_name) return res.status(400).json({ error: 'bu_code and bu_name are required' });
        const { rows } = await pool.query(
            'INSERT INTO client_business_units (client_id,bu_code,bu_name,description,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [req.params.id, bu_code.toUpperCase().trim(), bu_name.trim(), description || null, sort_order]);
        res.json({ bu: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: `BU code "${req.body.bu_code}" already exists for this client` });
        console.error('[POST /api/clients/:id/bus]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/clients/:id/bus/:bu_id
app.put('/api/clients/:id/bus/:bu_id', requireAuth, requireRole('superadmin','finance_manager','finance_approver','operations'), async (req, res) => {
    try {
        const { bu_name, description, is_active, sort_order } = req.body;
        const { rows } = await pool.query(
            'UPDATE client_business_units SET bu_name=COALESCE($1,bu_name), description=COALESCE($2,description), is_active=COALESCE($3,is_active), sort_order=COALESCE($4,sort_order) WHERE id=$5 AND client_id=$6 RETURNING *',
            [bu_name || null, description || null, is_active ?? null, sort_order ?? null, req.params.bu_id, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'BU not found' });
        res.json({ bu: rows[0] });
    } catch (err) { console.error('[PUT /api/clients/:id/bus/:bu_id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/clients/:id/bus/:bu_id
app.delete('/api/clients/:id/bus/:bu_id', requireAuth, requireRole('superadmin','finance_manager'), async (req, res) => {
    try {
        const buRow = await pool.query('SELECT bu_code FROM client_business_units WHERE id=$1', [req.params.bu_id]);
        if (buRow.rows.length) {
            const buCode = buRow.rows[0].bu_code;
            const poCheck = await pool.query('SELECT COUNT(*) AS n FROM purchase_orders WHERE LOWER(bu_name)=LOWER($1)', [buCode]);
            if (parseInt(poCheck.rows[0].n) > 0)
                return res.status(409).json({ error: `Cannot delete — ${poCheck.rows[0].n} PO(s) reference this BU. Deactivate instead.` });
        }
        await pool.query('DELETE FROM client_business_units WHERE id=$1 AND client_id=$2', [req.params.bu_id, req.params.id]);
        logAudit(req, 'client_bu_delete', 'client_business_unit', req.params.bu_id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/clients/:id/bus/:bu_id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/contracts', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT c.*, cl.name AS client_name
            FROM contracts c
            LEFT JOIN clients cl ON c.client_id = cl.id
            ORDER BY cl.name ASC, c.contract_name ASC
        `);
        res.json({ contracts: rows.map(ct => ({
            id: ct.id, contractName: ct.contract_name,
            clientId: ct.client_id, clientName: ct.client_name,
            location: ct.location, serviceType: ct.service_type,
            headcount: ct.headcount, status: ct.status,
            startDate: toDateStr(ct.start_date), endDate: toDateStr(ct.end_date),
            costs: ct.costs || {}, financials: ct.financials || {},
            endOfService: ct.end_of_service || 'Gratuity',
            regionProvince: ct.region_province || null,
        })) });
    } catch (err) { console.error('[GET /api/contracts]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/contracts/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM contracts WHERE id=$1', [req.params.id]);
        logAudit(req, 'contract_delete', 'contract', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/contracts/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});


app.patch('/api/contracts/:id/reassign', requireAuth, async (req, res) => {
    try {
        const { client_id } = req.body;
        if (!client_id) return res.status(400).json({ error: 'client_id required' });
        const { rows } = await pool.query(
            'UPDATE contracts SET client_id=$1 WHERE id=$2 RETURNING *',
            [client_id, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Contract not found' });
        res.json({ ok: true, contract: rows[0] });
    } catch (err) { console.error('[PATCH /api/contracts/:id/reassign]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// VENDOR MANAGEMENT
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

app.get('/api/vendors', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT v.*,
              COALESCE(SUM(vp.amount), 0) AS total_paid,
              COALESCE(SUM(vp.wht_amount), 0) AS total_wht
            FROM vendors v
            LEFT JOIN vendor_payments vp ON vp.vendor_id = v.id
            GROUP BY v.id ORDER BY v.name ASC`);
        res.json({ vendors: rows });
    } catch (err) { console.error('[GET /api/vendors]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/vendors', requireAuth, async (req, res) => {
    try {
        const { name, category, ntn, strn, cnic, address, contact_person, phone, email,
                bank_name, bank_account, account_title, is_filer = true, is_active = true,
                payment_terms, notes } = req.body;
        // NTN duplicate check
        if (ntn && ntn.trim()) {
            const dup = await pool.query('SELECT id, name FROM vendors WHERE TRIM(ntn)=$1 LIMIT 1', [ntn.trim()]);
            if (dup.rows.length) {
                return res.status(409).json({
                    error: `A vendor with NTN "${ntn}" already exists: "${dup.rows[0].name}" (ID: ${dup.rows[0].id}). Please edit the existing vendor instead.`
                });
            }
        }
        const { rows } = await pool.query(
            `INSERT INTO vendors (name,category,ntn,strn,cnic,address,contact_person,phone,email,
             bank_name,bank_account,account_title,is_filer,is_active,payment_terms,notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [name,category,ntn,strn,cnic,address,contact_person,phone,email,
             bank_name,bank_account,account_title,is_filer,is_active,payment_terms,notes]
        );
        res.json({ vendor: rows[0] });
    } catch (err) { console.error('[POST /api/vendors]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/vendors/:id', requireAuth, async (req, res) => {
    try {
        const { name, category, ntn, strn, cnic, address, contact_person, phone, email,
                bank_name, bank_account, account_title, is_filer, is_active, payment_terms, notes } = req.body;
        const { rows } = await pool.query(
            `UPDATE vendors SET name=$1,category=$2,ntn=$3,strn=$4,cnic=$5,address=$6,
             contact_person=$7,phone=$8,email=$9,bank_name=$10,bank_account=$11,account_title=$12,
             is_filer=$13,is_active=$14,payment_terms=$15,notes=$16,updated_at=NOW()
             WHERE id=$17 RETURNING *`,
            [name,category,ntn,strn,cnic,address,contact_person,phone,email,
             bank_name,bank_account,account_title,is_filer,is_active,payment_terms,notes,req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ vendor: rows[0] });
    } catch (err) { console.error('[PUT /api/vendors/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/vendors/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM vendors WHERE id=$1', [req.params.id]);
        logAudit(req, 'vendor_delete', 'vendor', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/vendors/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/vendors/:id/payments', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM vendor_payments WHERE vendor_id=$1 ORDER BY payment_date DESC, created_at DESC',
            [req.params.id]);
        res.json({ payments: rows });
    } catch (err) { console.error('[GET /api/vendors/:id/payments]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/vendors/:id/payments', requireAuth, async (req, res) => {
    try {
        const { payment_date, amount, wht_rate, description, bill_ref, category } = req.body;
        const whtAmt = Math.round((parseFloat(amount)||0) * (parseFloat(wht_rate)||0) / 100 * 100) / 100;
        const netPay = (parseFloat(amount)||0) - whtAmt;
        const { rows } = await pool.query(
            `INSERT INTO vendor_payments (vendor_id,payment_date,amount,wht_rate,wht_amount,net_payment,description,bill_ref,category)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [req.params.id, payment_date||null, amount, wht_rate||0, whtAmt, netPay, description, bill_ref, category]
        );
        res.json({ payment: rows[0] });
    } catch (err) { console.error('[POST /api/vendors/:id/payments]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// SYSTEM CONFIGURATION (FBR Tax Tables — editable)
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

app.get('/api/config/:key', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM system_config WHERE key=$1', [req.params.key]);
        if (!rows.length) return res.status(404).json({ error: 'Config key not found' });
        res.json({ config: rows[0] });
    } catch (err) { console.error('[GET /api/config/:key]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// NOTE: PUT /api/config/:key intentionally NOT defined here — the real
// implementation (role-gated, with system_config_history logging) lives
// further down this file. A duplicate used to be defined here; since
// Express matches the first registered handler for a given method+path,
// that duplicate was silently winning and the role-gated/history version
// below was unreachable dead code. Removed 2026-07-20 — see AGENTS.md changelog.

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// EMPLOYEE DOCUMENTS (Fitness to Work, Police Clearance, CNIC etc.)
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

app.get('/api/employees/:id/documents', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_documents WHERE employee_id=$1 ORDER BY doc_type, expiry_date ASC',
            [req.params.id]);
        res.json({ documents: rows });
    } catch (err) { console.error('[GET /api/employees/:id/documents]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/employees/:id/documents', requireAuth, async (req, res) => {
    try {
        const { doc_type, doc_name, issue_date, expiry_date, issuing_authority, doc_no, notes } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO employee_documents (employee_id,doc_type,doc_name,issue_date,expiry_date,issuing_authority,doc_no,notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [req.params.id, doc_type, doc_name, issue_date||null, expiry_date||null, issuing_authority, doc_no, notes]
        );
        res.json({ document: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/documents]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/employees/:id/documents/:docId', requireAuth, async (req, res) => {
    try {
        const { doc_type, doc_name, issue_date, expiry_date, issuing_authority, doc_no, notes } = req.body;
        const { rows } = await pool.query(
            `UPDATE employee_documents SET doc_type=$1,doc_name=$2,issue_date=$3,expiry_date=$4,
             issuing_authority=$5,doc_no=$6,notes=$7,updated_at=NOW()
             WHERE id=$8 AND employee_id=$9 RETURNING *`,
            [doc_type,doc_name,issue_date||null,expiry_date||null,issuing_authority,doc_no,notes,req.params.docId,req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ document: rows[0] });
    } catch (err) { console.error('[PUT /api/employees/:id/documents/:docId]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/employees/:id/documents/:docId', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM employee_documents WHERE id=$1 AND employee_id=$2', [req.params.docId, req.params.id]);
        logAudit(req, 'employee_document_delete', 'employee_document', req.params.docId);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/employees/:id/documents/:docId]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/employees/:id/messages', requireAuth, async (req, res) => {
    try {
        const { channel, subject, body } = req.body;
        const sender = req.user?.email || 'system';
        const { rows } = await pool.query(
            `INSERT INTO employee_messages (employee_id,channel,subject,body,sender,sent_at)
             VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
            [req.params.id, channel||'email', subject||'', body||'', sender]
        );
        res.json({ message: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/messages]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/employees/:id/messages', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_messages WHERE employee_id=$1 ORDER BY sent_at DESC',
            [req.params.id]);
        res.json({ messages: rows });
    } catch (err) { console.error('[GET /api/employees/:id/messages]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// ADVANCES & LOANS
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

app.get('/api/employees/:id/advances', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_advances WHERE employee_id=$1 ORDER BY created_at DESC',
            [req.params.id]);
        res.json({ advances: rows });
    } catch (err) { console.error('[GET /api/employees/:id/advances]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/employees/:id/advances', requireAuth, async (req, res) => {
    try {
        const { type, reason, total_amount, installments } = req.body;
        const total = parseFloat(total_amount) || 0;
        const inst = parseInt(installments) || 1;
        const inst_amt = Math.ceil(total / inst);
        const { rows } = await pool.query(
            `INSERT INTO employee_advances (employee_id,type,reason,total_amount,installments,installment_amt,paid_installments,remaining,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,0,$4,$7) RETURNING *`,
            [req.params.id, type||'Advance', reason||'', total, inst, inst_amt, req.user?.email||'system']
        );
        res.json({ advance: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/advances]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Mark one installment as paid
app.post('/api/employees/:id/advances/:advId/pay-installment', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE employee_advances
             SET paid_installments = paid_installments + 1,
                 remaining = remaining - installment_amt,
                 status = CASE WHEN paid_installments + 1 >= installments THEN 'Settled' ELSE status END,
                 updated_at = NOW()
             WHERE id=$1 AND employee_id=$2 AND status='Active' RETURNING *`,
            [req.params.advId, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Advance not found or already settled' });
        res.json({ advance: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/advances/:advId/pay-installment]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/employees/:id/advances/:advId', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM employee_advances WHERE id=$1 AND employee_id=$2', [req.params.advId, req.params.id]);
        logAudit(req, 'employee_advance_delete', 'employee_advance', req.params.advId);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/employees/:id/advances/:advId]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Get active advance deduction for payroll (per employee, current month)
app.get('/api/payroll/advance-deductions', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT employee_id, SUM(installment_amt) as total_deduction,
                   json_agg(json_build_object('id',id,'type',type,'inst',paid_installments+1,'of',installments,'amount',installment_amt)) as details
            FROM employee_advances WHERE status='Active'
            GROUP BY employee_id
        `);
        const map = {};
        rows.forEach(r => { map[r.employee_id] = { totalDeduction: parseFloat(r.total_deduction), details: r.details }; });
        res.json(map);
    } catch (err) { console.error('[GET /api/payroll/advance-deductions]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// PF LEDGER — full ledger with opening balance, contributions, withdrawals
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

// Auto-migrate: add new columns if they don't exist yet
const migratePFLedger = async () => {
    await pool.query(`ALTER TABLE employee_pf_ledger ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'monthly'`).catch(() => {});
    await pool.query(`ALTER TABLE employee_pf_ledger ADD COLUMN IF NOT EXISTS narration TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE employee_pf_ledger ADD COLUMN IF NOT EXISTS reference_no TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE employee_pf_ledger ADD COLUMN IF NOT EXISTS withdrawal_amount NUMERIC(12,2) DEFAULT 0`).catch(() => {});
    await pool.query(`CREATE TABLE IF NOT EXISTS employee_change_requests (
        id SERIAL PRIMARY KEY, employee_id TEXT, employee_name TEXT, field_name TEXT,
        field_label TEXT, old_value TEXT, new_value TEXT, status TEXT DEFAULT 'Pending',
        submitted_at TIMESTAMPTZ DEFAULT NOW(), reviewed_at TIMESTAMPTZ, reviewed_by TEXT, notes TEXT
    )`).catch(() => {});
};
migratePFLedger();

// Auto-migrate: ensure all contracts have bonus_months and overhead_per_employee in their costs JSONB.
// Old contracts (created before these fields were added to EMPTY_CONTRACT) have NULL for these keys.
// bonus_months = 1  means 1 month of gross salary as annual bonus (= gross/12 per month accrual).
// overhead_per_employee = 0 means no fixed overhead charge until user explicitly sets it per contract.
const migrateContractCostDefaults = async () => {
    try {
        const r1 = await pool.query(`
            UPDATE contracts
            SET costs = jsonb_set(COALESCE(costs, '{}')::jsonb, '{bonus_months}', '1'::jsonb, true)
            WHERE (costs->>'bonus_months') IS NULL
        `);
        if (r1.rowCount > 0) console.log(`[migration] Set bonus_months=1 for ${r1.rowCount} legacy contract(s)`);

        const r2 = await pool.query(`
            UPDATE contracts
            SET costs = jsonb_set(COALESCE(costs, '{}')::jsonb, '{overhead_per_employee}', '0'::jsonb, true)
            WHERE (costs->>'overhead_per_employee') IS NULL
        `);
        if (r2.rowCount > 0) console.log(`[migration] Set overhead_per_employee=0 for ${r2.rowCount} legacy contract(s)`);

        const r3 = await pool.query(`
            UPDATE contracts
            SET costs = jsonb_set(COALESCE(costs, '{}')::jsonb, '{eosb_type}', '"None"'::jsonb, true)
            WHERE (costs->>'eosb_type') IS NULL
        `);
        if (r3.rowCount > 0) console.log(`[migration] Set eosb_type=None for ${r3.rowCount} legacy contract(s)`);
    } catch (err) {
        console.error('[migration] migrateContractCostDefaults:', err.message);
    }
};
migrateContractCostDefaults();

// GET — returns all entries sorted oldest first + computed running balance
app.get('/api/employees/:id/pf-ledger', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM employee_pf_ledger
             WHERE employee_id=$1
             ORDER BY year ASC, month ASC, entry_type ASC, id ASC`,
            [req.params.id]);
        // Compute running balance across entries
        let runningBalance = 0;
        const ledger = rows.map(r => {
            const credit = parseFloat(r.ee_contribution || 0) + parseFloat(r.er_contribution || 0);
            const debit  = parseFloat(r.withdrawal_amount || 0);
            runningBalance += credit - debit;
            return { ...r, credit, debit, running_balance: Math.round(runningBalance) };
        });
        const totalCredit = ledger.reduce((s, r) => s + r.credit, 0);
        const totalDebit  = ledger.reduce((s, r) => s + r.debit, 0);
        res.json({ ledger, balance: Math.round(runningBalance), totalCredit, totalDebit });
    } catch (err) { console.error('[GET /api/employees/:id/pf-ledger]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST monthly contribution (existing endpoint — keeps backward compat)
app.post('/api/employees/:id/pf-ledger', requireAuth, async (req, res) => {
    try {
        const { month, year, ee_contribution, er_contribution, narration } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO employee_pf_ledger
               (employee_id, month, year, ee_contribution, er_contribution, entry_type, narration)
             VALUES ($1,$2,$3,$4,$5,'monthly',$6)
             ON CONFLICT (employee_id,month,year)
             DO UPDATE SET ee_contribution=$4, er_contribution=$5, narration=COALESCE($6, employee_pf_ledger.narration)
             RETURNING *`,
            [req.params.id, month, year,
             parseFloat(ee_contribution)||0, parseFloat(er_contribution)||0,
             narration || null]
        );
        res.json({ entry: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/pf-ledger]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST opening balance — only one allowed per employee (upsert on year=0, month=0)
app.post('/api/employees/:id/pf-ledger/opening-balance', requireAuth, async (req, res) => {
    try {
        const { amount, narration } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO employee_pf_ledger
               (employee_id, month, year, ee_contribution, er_contribution, entry_type, narration)
             VALUES ($1, 0, 0, $2, 0, 'opening_balance', $3)
             ON CONFLICT (employee_id, month, year)
             DO UPDATE SET ee_contribution=$2, narration=COALESCE($3, 'Opening Balance')
             RETURNING *`,
            [req.params.id, parseFloat(amount) || 0, narration || 'Opening Balance / Balance Brought Forward']
        );
        res.json({ entry: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/pf-ledger/opening-balance]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST withdrawal — records a debit with cheque/bank ref
app.post('/api/employees/:id/pf-ledger/withdrawal', requireAuth, async (req, res) => {
    try {
        const { amount, reference_no, narration, month, year } = req.body;
        if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Withdrawal amount must be > 0' });
        const now = new Date();
        const m = month || (now.getMonth() + 1);
        const y = year || now.getFullYear();
        const { rows } = await pool.query(
            `INSERT INTO employee_pf_ledger
               (employee_id, month, year, ee_contribution, er_contribution,
                withdrawal_amount, entry_type, narration, reference_no)
             VALUES ($1, $2, $3, 0, 0, $4, 'withdrawal', $5, $6)
             RETURNING *`,
            [req.params.id, m, y, parseFloat(amount),
             narration || 'PF Withdrawal', reference_no || null]
        );
        res.json({ entry: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/pf-ledger/withdrawal]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE a ledger entry (superadmin only — irreversible)
app.delete('/api/employees/:id/pf-ledger/:entryId', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM employee_pf_ledger WHERE id=$1 AND employee_id=$2',
            [req.params.entryId, req.params.id]);
        logAudit(req, 'employee_pf_ledger_delete', 'employee_pf_ledger', req.params.entryId);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/employees/:id/pf-ledger/:entryId]', err); res.status(500).json({ error: 'Internal server error' }); }
});


// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// GRATUITY LEDGER
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

app.get('/api/employees/:id/gratuity-ledger', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_gratuity_ledger WHERE employee_id=$1 ORDER BY year DESC, month DESC',
            [req.params.id]);
        res.json({ ledger: rows });
    } catch (err) { console.error('[GET /api/employees/:id/gratuity-ledger]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/employees/:id/gratuity-ledger', requireAuth, async (req, res) => {
    try {
        const { month, year, accrual, cumulative } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO employee_gratuity_ledger (employee_id,month,year,accrual,cumulative)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (employee_id,month,year)
             DO UPDATE SET accrual=$4, cumulative=$5 RETURNING *`,
            [req.params.id, month, year, parseFloat(accrual)||0, parseFloat(cumulative)||0]
        );
        res.json({ entry: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/gratuity-ledger]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// ASSET / UNIFORM ISSUANCES
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

app.get('/api/employees/:id/assets', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM asset_issuances WHERE employee_id=$1 ORDER BY issue_date DESC',
            [req.params.id]);
        res.json({ assets: rows });
    } catch (err) { console.error('[GET /api/employees/:id/assets]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/employees/:id/assets', requireAuth, async (req, res) => {
    try {
        const { category, item_desc, issue_date, cost } = req.body;
        // Auto-calculate replacement_due: Uniform = +6 months, PPE/Equipment = +12 months
        let replacementDue = null;
        if (issue_date) {
            const d = new Date(issue_date);
            const months = category === 'Uniform' ? 6 : 12;
            d.setMonth(d.getMonth() + months);
            replacementDue = d.toISOString().split('T')[0];
        }
        const { rows } = await pool.query(
            `INSERT INTO asset_issuances (employee_id,category,item_desc,issue_date,replacement_due,cost)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [req.params.id, category||'Uniform', item_desc, issue_date||null, replacementDue, parseFloat(cost)||null]
        );
        res.json({ asset: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/assets]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.patch('/api/employees/:id/assets/:assetId/return', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'UPDATE asset_issuances SET returned=TRUE WHERE id=$1 AND employee_id=$2 RETURNING *',
            [req.params.assetId, req.params.id]);
        res.json({ asset: rows[0] });
    } catch (err) { console.error('[PATCH /api/employees/:id/assets/:assetId/return]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/employees/:id/assets/:assetId', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM asset_issuances WHERE id=$1 AND employee_id=$2', [req.params.assetId, req.params.id]);
        logAudit(req, 'employee_asset_delete', 'asset_issuance', req.params.assetId);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/employees/:id/assets/:assetId]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// INVOICES (persistent DB-backed)
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

app.get('/api/invoices', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM invoices ORDER BY created_at DESC');
        res.json({ invoices: rows.map(r => ({
            id: r.id, client: r.client, contract: r.contract, period: r.period,
            poNumber: r.po_number, dueDate: r.due_date,
            payrollIds: r.payroll_ids || [], billIds: r.bill_ids || [],
            subtotal: parseFloat(r.subtotal)||0, svcCharges: parseFloat(r.svc_charges)||0,
            salesTax: parseFloat(r.sales_tax)||0, wht: parseFloat(r.wht)||0,
            grandTotal: parseFloat(r.grand_total)||0,
            status: r.status, createdBy: r.created_by, createdAt: r.created_at
        })) });
    } catch (err) { console.error('[GET /api/invoices]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/invoices', requireAuth, requireRole('finance_proposer'), async (req, res) => {
    try {
        const { id, client, contract, period, poNumber, dueDate, payrollIds, billIds,
                subtotal, svcCharges, salesTax, wht, grandTotal } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO invoices (id,client,contract,period,po_number,due_date,payroll_ids,bill_ids,subtotal,svc_charges,sales_tax,wht,grand_total,status,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Draft',$14) RETURNING *`,
            [id, client, contract||null, period||null, poNumber||null, dueDate||null,
             JSON.stringify(payrollIds||[]), JSON.stringify(billIds||[]),
             subtotal||0, svcCharges||0, salesTax||0, wht||0, grandTotal||0,
             req.user?.email||'system']
        );
        res.json({ invoice: rows[0] });
    } catch (err) { console.error('[POST /api/invoices]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.patch('/api/invoices/:id/status', requireAuth, requireRole('finance_approver'), async (req, res) => {
    try {
        const { status } = req.body;
        const { rows } = await pool.query(
            'UPDATE invoices SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',
            [status, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
        logAudit(req, `invoice_status_${String(status).toLowerCase()}`, 'invoice', req.params.id);
        res.json({ invoice: rows[0] });
    } catch (err) { console.error('[PATCH /api/invoices/:id/status]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/invoices/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM invoices WHERE id=$1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Invoice not found' });
        logAudit(req, 'invoice_delete', 'invoice', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/invoices/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// PAYSLIP GENERATION
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

// Staff or own-portal payslip access
const requirePayslipAuth = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET);
        if (payload.portal) {
            const requested = decodeURIComponent(req.params.employeeId);
            if (String(payload.employeeId) !== String(requested)) {
                return res.status(403).json({ error: 'You can only view your own payslip' });
            }
            req.user = payload;
            return next();
        }
        req.user = payload;
        next();
    } catch { res.status(401).json({ error: 'Token expired' }); }
};

app.get('/api/payslip/:employeeId/:month/:year', requirePayslipAuth, async (req, res) => {
    try {
        const employeeId = decodeURIComponent(req.params.employeeId);
        const { month, year } = req.params;

        const [empRes, payRes] = await Promise.all([
            pool.query('SELECT * FROM employees WHERE id=$1', [employeeId]),
            pool.query('SELECT * FROM payroll_transactions WHERE employee_id=$1 AND month=$2 AND year=$3',
                [employeeId, month, year]),
        ]);
        const emp = empRes.rows[0];
        if (!emp) return res.status(404).json({ error: 'Employee not found' });

        // Payroll Sheet Generate Payslips uses source=world_a so the sheet template
        // (no duplicate OT/reimbursement panels) is always used.
        const source = String(req.query.source || '').toLowerCase();
        const forceWorldA = source === 'world_a' || source === 'sheet';
        const worldBDetail = forceWorldA ? null : await fetchWorldBPayslipDetail(pool, employeeId, month, year);
        if (worldBDetail) {
            const html = renderWorldBPayslipHtml({ emp, ...worldBDetail });
            res.setHeader('Content-Type', 'text/html');
            if (req.query.download === '1') {
                const monthName = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString('en-PK', { month: 'long' });
                const safeName = (emp.name || 'Employee').replace(/[^a-zA-Z0-9 ]/g, '_').trim();
                res.setHeader('Content-Disposition', `attachment; filename="PaySlip_${safeName}_${monthName}_${year}.html"`);
            }
            return res.send(html);
        }

        const pay = payRes.rows[0];
        const monthName = new Date(2000, parseInt(month, 10) - 1, 1).toLocaleString('en-PK', { month: 'long' });
        const empContractRes = await pool.query(
            `SELECT c.costs->>'eosb_type' AS eosb_type FROM contracts c WHERE c.contract_name=$1`,
            [emp.contract_name || '']
        );
        const empEosbType = empContractRes.rows[0]?.eosb_type || 'None';
        const slipData = buildWorldAPayslipData(emp, pay, empEosbType);
        const html = renderWorldAPayslipHtml(slipData, { year, month });

        res.setHeader('Content-Type', 'text/html');
        if (req.query.download === '1') {
            const safeName = (emp.name || 'Employee').replace(/[^a-zA-Z0-9 ]/g, '_').trim();
            res.setHeader('Content-Disposition', `attachment; filename="PaySlip_${safeName}_${monthName}_${year}.html"`);
        }
        res.send(html);
    } catch (err) { console.error('[GET /api/payslip/:employeeId/:month/:year]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// HITL FLAGS — Bills where OCR total ≠ items sum
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

app.get('/api/bills/hitl-flags', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT id, vendor, date, client, total, items, amount
            FROM bills WHERE items IS NOT NULL AND jsonb_array_length(items) > 0
        `);
        const flagged = rows.filter(r => {
            const itemsSum = (r.items || []).reduce((a, item) => a + (parseFloat(item.total||item.amount||item.price||0)), 0);
            const billTotal = parseFloat(r.total || r.amount || 0);
            return Math.abs(itemsSum - billTotal) > 1; // >Rs.1 discrepancy
        }).map(r => {
            const itemsSum = (r.items || []).reduce((a, item) => a + parseFloat(item.total||item.amount||item.price||0), 0);
            return { ...r, itemsSum: Math.round(itemsSum), discrepancy: Math.round(parseFloat(r.total||0) - itemsSum) };
        });
        res.json({ flagged, count: flagged.length });
    } catch (err) { console.error('[GET /api/bills/hitl-flags]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// BULK PAYROLL SMS
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

app.post('/api/sms/payroll-batch', requireAuth, async (req, res) => {
    try {
        const { employeeIds, month, year, messageTemplate } = req.body;
        if (!employeeIds?.length) return res.status(400).json({ error: 'No employees selected' });

        const { rows: employees } = await pool.query(
            `SELECT e.id, e.name, e.primary_contact, p.net, p.gross
             FROM employees e
             LEFT JOIN payroll_transactions p ON p.employee_id=e.id AND p.month=$1 AND p.year=$2
             WHERE e.id = ANY($3)`,
            [month||new Date().getMonth()+1, year||new Date().getFullYear(), employeeIds]
        );

        const results = [];
        for (const emp of employees) {
            if (!emp.primary_contact) { results.push({ name: emp.name, ok: false, error: 'No phone on file' }); continue; }
            const net = Math.round(parseFloat(emp.net)||0);
            const monthName = new Date(2000, parseInt(month||new Date().getMonth())-1, 1).toLocaleString('en-PK', { month: 'long' });
            const message = messageTemplate
                ? messageTemplate.replace('{name}', emp.name).replace('{net}', net.toLocaleString()).replace('{month}', monthName).replace('{year}', year||new Date().getFullYear())
                : `Dear ${emp.name}, your ${monthName} ${year||new Date().getFullYear()} salary of Rs. ${net.toLocaleString()} has been processed. Allied Services`;
            const result = await sendJazzSMS(emp.primary_contact, message);
            results.push({ name: emp.name, phone: emp.primary_contact, ok: result.ok, response: result.response, error: result.ok ? undefined : result.response });
        }
        res.json({ sent: results.filter(r=>r.ok).length, failed: results.filter(r=>!r.ok).length, results });
    } catch (err) { console.error('[POST /api/sms/payroll-batch]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖
// EMPLOYEE PORTAL — OTP LOGIN + SELF-SERVICE
// ❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖❖

async function lookupPortalEmployee({ phone, employeeId, forceEmployeeId }) {
    if (employeeId) {
        const { rows } = await pool.query(
            `SELECT id, name, email, primary_contact FROM employees WHERE id=$1 AND active='Yes'`,
            [String(employeeId).trim()]
        );
        return rows;
    }
    if (!phone) return [];
    const p = normalisePhone(phone);
    const { rows } = await pool.query(
        `SELECT id, name, email, primary_contact FROM employees
         WHERE regexp_replace(COALESCE(primary_contact,''),'\\D','','g') = $1 AND active='Yes'`,
        [p]
    );
    if (rows.length > 1 && !forceEmployeeId) {
        const err = new Error('MULTIPLE_MATCH');
        err.employees = rows.map(r => ({ id: r.id, name: r.name }));
        throw err;
    }
    return rows;
}

async function persistAndSendPortalOtp(emp, { preferSms = false } = {}) {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const phoneNorm = normalisePhone(emp.primary_contact || '');
    const email = String(emp.email || '').trim();
    const canEmail = isValidEmail(email);

    let channel = 'sms';
    let destination = phoneNorm;
    let fallbackReason = null;

    if (!preferSms && canEmail) {
        try {
            const mailResult = await sendAppEmail({
                to: email,
                subject: 'ASIL Employee Portal login code',
                html: `<p>Your ASIL Employee Portal login code is <strong>${otp}</strong>.</p>
                       <p>Valid for 10 minutes. Do not share this code.</p>
                       <p style="color:#64748b;font-size:12px;">Allied Services International (Pvt.) Ltd.</p>`,
            });
            if (mailResult?.ok) {
                channel = 'email';
                destination = email.toLowerCase();
            } else {
                fallbackReason = mailResult?.reason || 'email_skipped';
            }
        } catch (err) {
            fallbackReason = err.message || 'email_send_failed';
            console.warn('[portal OTP] email failed, falling back to SMS:', fallbackReason);
        }
    } else if (!canEmail) {
        fallbackReason = 'no_email';
    }

    if (channel !== 'email') {
        if (!phoneNorm) {
            return { error: 'No phone on file and email OTP unavailable', status: 422 };
        }
        const message = `Your ASIL HCM login code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
        const smsResult = await sendJazzOtpSMS(phoneNorm, message);
        if (!smsResult.ok) {
            return { error: 'Failed to send OTP SMS', detail: smsResult.response, status: 502 };
        }
        channel = 'sms';
        destination = phoneNorm;
    }

    await pool.query(
        `INSERT INTO portal_otps (phone, otp, expires_at, channel, destination, employee_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [phoneNorm || emp.id, otp, expiresAt, channel, destination, emp.id]
    );

    return {
        ok: true,
        channel,
        destinationMasked: channel === 'email' ? maskEmail(destination) : maskPhone(destination),
        fallbackReason: channel === 'sms' ? fallbackReason : null,
        fallbackAvailable: !!phoneNorm,
        employeeName: emp.name,
        employeeId: emp.id,
    };
}

// Request OTP — email first, SMS fallback. Lookup by employeeId or phone.
app.post('/api/portal/request-otp', portalOtpLimiter, async (req, res) => {
    try {
        const { phone, employeeId, preferSms } = req.body || {};
        if (!phone && !employeeId) {
            return res.status(400).json({ error: 'Employee code or phone number required' });
        }

        let rows;
        try {
            rows = await lookupPortalEmployee({ phone, employeeId, forceEmployeeId: !!employeeId });
        } catch (err) {
            if (err.message === 'MULTIPLE_MATCH') {
                return res.status(409).json({
                    error: 'Multiple employees share this phone. Enter your Employee Code.',
                    employees: err.employees,
                });
            }
            throw err;
        }

        if (!rows.length) {
            return res.status(404).json({ error: 'No active employee found with this phone number or employee code' });
        }

        const emp = rows[0];
        const hasEmail = isValidEmail(String(emp.email || '').trim());
        const hasPhone = !!normalisePhone(emp.primary_contact || '');
        if (!hasEmail && !hasPhone) {
            return res.status(409).json({
                code: 'NO_CONTACT_CHANNEL',
                error: 'Contact HR to update your phone/email',
            });
        }

        const result = await persistAndSendPortalOtp(emp, { preferSms: !!preferSms });
        if (result.error) return res.status(result.status || 500).json({ error: result.error, detail: result.detail });

        const msg = result.channel === 'email'
            ? `OTP sent to ${result.destinationMasked}`
            : (result.fallbackReason && result.fallbackReason !== 'no_email'
                ? `Could not email you — OTP sent by SMS to ${result.destinationMasked}`
                : `OTP sent to ${result.destinationMasked}`);

        res.json({
            ok: true,
            message: msg,
            channel: result.channel,
            destinationMasked: result.destinationMasked,
            fallbackReason: result.fallbackReason,
            fallbackAvailable: result.fallbackAvailable,
            employeeName: result.employeeName,
            employeeId: result.employeeId,
        });
    } catch (err) {
        console.error('[POST /api/portal/request-otp]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify OTP — returns portal JWT
app.post('/api/portal/verify-otp', async (req, res) => {
    try {
        const { phone, employeeId, otp } = req.body || {};
        if (!otp) return res.status(400).json({ error: 'OTP required' });

        let otpRows = [];
        if (employeeId) {
            const r = await pool.query(
                `SELECT * FROM portal_otps
                 WHERE employee_id=$1 AND otp=$2 AND used=FALSE AND expires_at > NOW()
                 ORDER BY created_at DESC LIMIT 1`,
                [String(employeeId).trim(), otp]
            );
            otpRows = r.rows;
        }
        if (!otpRows.length && phone) {
            const p = normalisePhone(phone);
            const r = await pool.query(
                `SELECT * FROM portal_otps
                 WHERE phone=$1 AND otp=$2 AND used=FALSE AND expires_at > NOW()
                 ORDER BY created_at DESC LIMIT 1`,
                [p, otp]
            );
            otpRows = r.rows;
        }
        if (!otpRows.length) return res.status(401).json({ error: 'Invalid or expired OTP' });

        await pool.query('UPDATE portal_otps SET used=TRUE WHERE id=$1', [otpRows[0].id]);

        const empId = otpRows[0].employee_id;
        let emp;
        if (empId) {
            const { rows: allRows } = await pool.query(
                `SELECT id, name, designation, client, location, active FROM employees WHERE id=$1`,
                [empId]
            );
            if (!allRows.length) {
                return res.status(409).json({ code: 'EMPLOYEE_NOT_FOUND', error: 'Employee record not found. Contact HR.' });
            }
            if (allRows[0].active !== 'Yes') {
                return res.status(409).json({ code: 'EMPLOYEE_INACTIVE', error: 'Your employee account is inactive. Contact HR.' });
            }
            emp = allRows[0];
        } else {
            const p = otpRows[0].phone;
            const { rows: allRows } = await pool.query(
                `SELECT id, name, designation, client, location, active FROM employees
                 WHERE regexp_replace(COALESCE(primary_contact,''),'\\D','','g') = $1`,
                [p]
            );
            if (!allRows.length) {
                return res.status(409).json({ code: 'CONTACT_MISMATCH', error: 'No employee matches this contact. Contact HR.' });
            }
            const activeRows = allRows.filter(r => r.active === 'Yes');
            if (!activeRows.length) {
                return res.status(409).json({ code: 'EMPLOYEE_INACTIVE', error: 'Your employee account is inactive. Contact HR.' });
            }
            emp = activeRows[0];
        }

        const token = jwt.sign(
            { employeeId: emp.id, name: emp.name, portal: true },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.json({
            ok: true,
            token,
            employee: {
                id: emp.id,
                name: emp.name,
                designation: emp.designation,
                client: emp.client,
                location: emp.location,
            },
        });
    } catch (err) {
        console.error('[POST /api/portal/verify-otp]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Portal middleware — validates portal JWT
function requirePortalAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Portal auth required' });
    try {
        const payload = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        if (!payload.portal) return res.status(403).json({ error: 'Not a portal token' });
        req.portalEmployee = payload;
        next();
    } catch { res.status(401).json({ error: 'Invalid or expired portal session' }); }
}

// Portal: get full employee self-service data
app.get('/api/portal/me', requirePortalAuth, async (req, res) => {
    try {
        const empId = req.portalEmployee.employeeId;

        const [empRes, payrollRes, worldBPayslips, advancesRes, leavesRes] = await Promise.all([
            pool.query('SELECT * FROM employees WHERE id=$1', [empId]),
            pool.query('SELECT * FROM payroll_transactions WHERE employee_id=$1 ORDER BY year DESC, month DESC LIMIT 24', [empId]),
            fetchWorldBPayslipSummaries(pool, empId).catch(() => []),
            pool.query('SELECT * FROM employee_advances WHERE employee_id=$1 ORDER BY created_at DESC', [empId]),
            pool.query('SELECT * FROM employee_leaves WHERE employee_id=$1 ORDER BY from_date DESC LIMIT 20', [empId]).catch(() => ({ rows: [] }))
        ]);

        const emp = empRes.rows[0];
        if (!emp) return res.status(404).json({ error: 'Employee not found' });

        const { bank_account, cnic, ...safeEmp } = emp;
        const photoUrl = emp.photo_file_id
            ? `${BACKEND_URL}/api/portal/me/photo`
            : null;

        res.json({
            employee: {
                ...safeEmp,
                cnicMasked: emp.cnic ? emp.cnic.replace(/(\d{5})(\d{7})(\d)/, '$1-*******-$3') : null,
                bankAccountMasked: emp.bank_account ? '****' + emp.bank_account.slice(-4) : null,
                photoUrl,
                hasPhoto: !!emp.photo_file_id,
            },
            payslips: mergePayslipSummaries(
                payrollRes.rows.map(mapWorldARowToSummary),
                worldBPayslips
            ),
            advances: advancesRes.rows.map(a => ({
                id: a.id, type: a.type, reason: a.reason,
                totalAmount: parseFloat(a.total_amount), installmentAmt: parseFloat(a.installment_amt),
                paidInstallments: a.paid_installments, totalInstallments: a.installments,
                remaining: parseFloat(a.remaining), status: a.status
            })),
            leaves: leavesRes.rows
        });
    } catch (err) {
        console.error('[portal/me]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Portal: submit a change request ──────────────────────────────────────────
const PORTAL_CHANGEABLE_FIELDS = {
    present_address:   'Present Address',
    permanent_address: 'Permanent Address',
    primary_contact:   'Primary Contact',
    emergency_contact: 'Emergency Contact',
    email:             'Email Address',
    bank_name:         'Bank Name',
    bank_account:      'Bank Account Number',
    account_title:     'Account Title',
    nok_name:          'Next of Kin Name',
    nok_relation:      'Next of Kin Relation',
    nok_contact:       'Next of Kin Contact',
};

app.post('/api/portal/change-request', requirePortalAuth, async (req, res) => {
    try {
        const empId = req.portalEmployee.employeeId;
        const { field_name, new_value } = req.body;

        if (!field_name || !new_value) {
            return res.status(400).json({ error: 'field_name and new_value are required' });
        }
        if (!PORTAL_CHANGEABLE_FIELDS[field_name]) {
            return res.status(400).json({ error: 'This field cannot be changed via the portal' });
        }

        const { rows: empRows } = await pool.query(
            `SELECT name, email, primary_contact, ${field_name} AS current_val FROM employees WHERE id=$1`, [empId]
        );
        if (!empRows.length) return res.status(404).json({ error: 'Employee not found' });
        const old_value = empRows[0].current_val;

        const { rows } = await pool.query(
            `INSERT INTO employee_change_requests
             (employee_id, employee_name, field_name, field_label, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [empId, empRows[0].name, field_name, PORTAL_CHANGEABLE_FIELDS[field_name], old_value, new_value]
        );

        const settings = await getPortalChangeSettings(pool);
        if (settings.notify_on_submit && settings.approver_emails?.length) {
            const cr = rows[0];
            const link = `${FRONTEND_URL}/?tab=employees&cr=${cr.id}`;
            const html = `<p>A new employee data change request needs review.</p>
                <ul>
                  <li><strong>Employee:</strong> ${empRows[0].name} (${empId})</li>
                  <li><strong>Field:</strong> ${PORTAL_CHANGEABLE_FIELDS[field_name]}</li>
                  <li><strong>Old:</strong> ${old_value || '—'}</li>
                  <li><strong>New:</strong> ${new_value}</li>
                </ul>
                <p><a href="${link}">Open Pending Requests in ASIL HCM</a></p>`;
            try {
                await sendAppEmail({
                    to: settings.approver_emails,
                    subject: `[HCM] Change request: ${empRows[0].name} — ${PORTAL_CHANGEABLE_FIELDS[field_name]}`,
                    html,
                });
            } catch (mailErr) {
                console.warn('[portal/change-request] approver notify failed', mailErr.message);
            }
        }

        res.json({ ok: true, request: rows[0] });
    } catch (err) {
        console.error('[portal/change-request]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Portal: get own change requests (history)
app.get('/api/portal/my-requests', requirePortalAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, field_name, field_label, old_value, new_value, status, submitted_at, reviewed_at, notes
             FROM employee_change_requests
             WHERE employee_id=$1
             ORDER BY submitted_at DESC LIMIT 50`,
            [req.portalEmployee.employeeId]
        );
        res.json({ requests: rows });
    } catch (err) {
        console.error('[portal/my-requests]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Office: list pending change requests ─────────────────────────────────────
app.get('/api/change-requests', requireAuth, requireRole(...CHANGE_QUEUE_ROLES), async (req, res) => {
    try {
        const { status = 'Pending' } = req.query;
        const { rows } = await pool.query(
            `SELECT cr.*, e.designation, e.client, e.location
             FROM employee_change_requests cr
             LEFT JOIN employees e ON e.id = cr.employee_id
             WHERE ($1 = 'All' OR cr.status = $1)
             ORDER BY cr.submitted_at DESC`,
            [status]
        );
        res.json({ requests: rows });
    } catch (err) {
        console.error('[GET /api/change-requests]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

async function assertCanReviewChangeRequest(req, res) {
    const settings = await getPortalChangeSettings(pool);
    if (!canApproveChangeRequest(req.user, settings)) {
        res.status(403).json({
            error: 'Only designated HCM approvers can approve or reject change requests',
            approvers: settings.approver_emails,
        });
        return null;
    }
    return settings;
}

// ── Office: approve a change request → apply to employees table ───────────────
app.patch('/api/change-requests/:id/approve', requireAuth, requireRole(...CHANGE_QUEUE_ROLES), async (req, res) => {
    try {
        const settings = await assertCanReviewChangeRequest(req, res);
        if (!settings) return;

        const reqId = parseInt(req.params.id);

        const { rows: crRows } = await pool.query(
            'SELECT * FROM employee_change_requests WHERE id=$1', [reqId]
        );
        if (!crRows.length) return res.status(404).json({ error: 'Change request not found' });
        const cr = crRows[0];
        if (cr.status !== 'Pending') {
            return res.status(400).json({ error: `Request is already ${cr.status}` });
        }
        if (!PORTAL_CHANGEABLE_FIELDS[cr.field_name]) {
            return res.status(400).json({ error: 'Field not in allowed list — cannot apply' });
        }

        await pool.query(
            `UPDATE employees SET ${cr.field_name}=$1, updated_at=NOW() WHERE id=$2`,
            [cr.new_value, cr.employee_id]
        );

        await pool.query(
            `UPDATE employee_change_requests SET status='Approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2`,
            [req.user.email, reqId]
        );
        logAudit(req, 'change_request_approve', 'employee_change_request', reqId);

        try {
            const { rows: empRows } = await pool.query(
                'SELECT primary_contact, email FROM employees WHERE id=$1', [cr.employee_id]
            );
            if (empRows.length) {
                const smsMsg = `ASIL HR: Your request to update '${cr.field_label}' has been APPROVED. The change is now in effect.`;
                if (empRows[0].primary_contact) {
                    await sendJazzSMS(empRows[0].primary_contact, smsMsg);
                    await pool.query(
                        `INSERT INTO employee_messages (employee_id, channel, direction, body, sent_by) VALUES ($1,'sms','out',$2,$3)`,
                        [cr.employee_id, smsMsg, req.user.email]
                    ).catch(() => {});
                }
                if (settings.notify_employee_on_decision && isValidEmail(empRows[0].email)) {
                    await sendAppEmail({
                        to: empRows[0].email,
                        subject: `Change request approved: ${cr.field_label}`,
                        html: `<p>${smsMsg}</p>`,
                    }).catch(() => {});
                }
            }
        } catch (_) { /* notify failure is non-fatal */ }

        res.json({ ok: true, message: 'Change request approved and applied' });
    } catch (err) {
        console.error('[PATCH /api/change-requests/:id/approve]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Office: reject a change request ──────────────────────────────────────────
app.patch('/api/change-requests/:id/reject', requireAuth, requireRole(...CHANGE_QUEUE_ROLES), async (req, res) => {
    try {
        const settings = await assertCanReviewChangeRequest(req, res);
        if (!settings) return;

        const reqId = parseInt(req.params.id);
        const { note } = req.body;

        const { rows: crRows } = await pool.query(
            'SELECT * FROM employee_change_requests WHERE id=$1', [reqId]
        );
        if (!crRows.length) return res.status(404).json({ error: 'Change request not found' });
        const cr = crRows[0];
        if (cr.status !== 'Pending') {
            return res.status(400).json({ error: `Request is already ${cr.status}` });
        }

        await pool.query(
            `UPDATE employee_change_requests SET status='Rejected', reviewed_by=$1, reviewed_at=NOW(), notes=$2 WHERE id=$3`,
            [req.user.email, note || null, reqId]
        );

        try {
            const { rows: empRows } = await pool.query(
                'SELECT primary_contact, email FROM employees WHERE id=$1', [cr.employee_id]
            );
            if (empRows.length) {
                const reason = note ? ` Reason: ${note}` : '';
                const smsMsg = `ASIL HR: Your request to update '${cr.field_label}' has been REJECTED.${reason} Contact HR for assistance.`;
                if (empRows[0].primary_contact) {
                    await sendJazzSMS(empRows[0].primary_contact, smsMsg);
                    await pool.query(
                        `INSERT INTO employee_messages (employee_id, channel, direction, body, sent_by) VALUES ($1,'sms','out',$2,$3)`,
                        [cr.employee_id, smsMsg, req.user.email]
                    ).catch(() => {});
                }
                if (settings.notify_employee_on_decision && isValidEmail(empRows[0].email)) {
                    await sendAppEmail({
                        to: empRows[0].email,
                        subject: `Change request rejected: ${cr.field_label}`,
                        html: `<p>${smsMsg}</p>`,
                    }).catch(() => {});
                }
            }
        } catch (_) { /* notify failure is non-fatal */ }

        res.json({ ok: true, message: 'Change request rejected' });
    } catch (err) {
        console.error('[PATCH /api/change-requests/:id/reject]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Portal profile photo ─────────────────────────────────────────────────────
const portalMulter = require('multer')({
    storage: require('multer').memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
        cb(ok ? null : new Error('Only JPEG, PNG, or WebP images allowed'), ok);
    },
});

app.get('/api/portal/me/photo', requirePortalAuth, async (req, res) => {
    try {
        const empId = req.portalEmployee.employeeId;
        const { rows } = await pool.query(
            `SELECT f.mime, f.filename, f.data
             FROM employees e
             JOIN uploaded_files f ON f.id = e.photo_file_id
             WHERE e.id=$1`,
            [empId]
        );
        if (!rows.length) return res.status(404).json({ error: 'No photo on file' });
        res.setHeader('Content-Type', rows[0].mime || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(rows[0].data);
    } catch (err) {
        console.error('[GET /api/portal/me/photo]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/portal/me/photo', requirePortalAuth, (req, res) => {
    portalMulter.single('photo')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
        try {
            if (!req.file) return res.status(400).json({ error: 'photo file required' });
            const empId = req.portalEmployee.employeeId;
            const { rows: fileRows } = await pool.query(`
                INSERT INTO uploaded_files (kind, ref_id, filename, mime, size_bytes, data, uploaded_by)
                VALUES ('employee_photo',$1,$2,$3,$4,$5,$6) RETURNING id
            `, [empId, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, empId]);
            const fileId = fileRows[0].id;
            await pool.query(
                `UPDATE employees SET photo_file_id=$1, updated_at=NOW() WHERE id=$2`,
                [fileId, empId]
            );

            const settings = await getPortalChangeSettings(pool);
            if (settings.notify_on_submit && settings.approver_emails?.length) {
                const { rows: empRows } = await pool.query('SELECT name FROM employees WHERE id=$1', [empId]);
                const name = empRows[0]?.name || empId;
                sendAppEmail({
                    to: settings.approver_emails,
                    subject: `[HCM] Profile photo updated: ${name}`,
                    html: `<p>${name} (${empId}) uploaded a new profile photo in the Employee Portal.</p>`,
                }).catch(() => {});
            }

            res.json({ ok: true, photo_file_id: fileId, photoUrl: `${BACKEND_URL}/api/portal/me/photo` });
        } catch (e) {
            console.error('[POST /api/portal/me/photo]', e);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
});

app.delete('/api/portal/me/photo', requirePortalAuth, async (req, res) => {
    try {
        const empId = req.portalEmployee.employeeId;
        await pool.query(`UPDATE employees SET photo_file_id=NULL, updated_at=NOW() WHERE id=$1`, [empId]);
        res.json({ ok: true });
    } catch (err) {
        console.error('[DELETE /api/portal/me/photo]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

﻿app.post('/api/calculate', (req, res) => {
    const { grossSalary, joiningDate, calcDate } = req.body;
    if (!grossSalary) return res.status(400).json({ error: 'Gross salary required' });
    const gross = parseFloat(grossSalary);
    const join = joiningDate || '2020-01-01';
    const calc = calcDate || new Date().toISOString().split('T')[0];
    const eobi = calculateEOBI(gross);
    const sessi = calculateSESSI(gross);
    const incomeTax = calculateMonthlyIncomeTax(gross);
    const gratuity = calculateGratuity(gross, join, calc);
    res.json({ parameters: { gross, join, calc }, results: { eobi, sessi, incomeTax, gratuity, netSalary: gross - eobi.employeeShare - incomeTax, totalCostToCompany: gross + eobi.employerShare + sessi } });
});

// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë
// INVENTORY MANAGEMENT
// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë

// Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ Inventory Items (catalog) Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
app.get('/api/inventory/items', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT i.*,
                COALESCE(SUM(s.quantity), 0) AS total_stocked,
                COALESCE(SUM(CASE WHEN iss.status = 'Issued' THEN iss.quantity ELSE 0 END), 0) AS total_issued,
                COALESCE(SUM(s.quantity), 0) - COALESCE(SUM(CASE WHEN iss.status = 'Issued' THEN iss.quantity ELSE 0 END), 0) AS available_stock,
                COALESCE(AVG(s.unit_cost), 0) AS avg_unit_cost,
                COALESCE(SUM(s.quantity * s.unit_cost), 0) AS total_procurement_value
            FROM inventory_items i
            LEFT JOIN inventory_stock s ON s.item_id = i.id
            LEFT JOIN inventory_issuance iss ON iss.item_id = i.id
            GROUP BY i.id
            ORDER BY i.category, i.name`);
        res.json({ items: rows });
    } catch (err) { console.error('[GET /api/inventory/items]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/inventory/items', requireAuth, async (req, res) => {
    try {
        const { name, category, description, unit = 'piece', has_expiry = false, expiry_months, min_stock = 0 } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO inventory_items (name, category, description, unit, has_expiry, expiry_months, min_stock)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [name, category, description, unit, has_expiry, expiry_months || null, min_stock]
        );
        res.json({ item: rows[0] });
    } catch (err) { console.error('[POST /api/inventory/items]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/inventory/items/:id', requireAuth, async (req, res) => {
    try {
        const { name, category, description, unit, has_expiry, expiry_months, min_stock } = req.body;
        const { rows } = await pool.query(
            `UPDATE inventory_items SET name=$1, category=$2, description=$3, unit=$4, has_expiry=$5, expiry_months=$6, min_stock=$7, updated_at=NOW()
             WHERE id=$8 RETURNING *`,
            [name, category, description, unit, has_expiry, expiry_months || null, min_stock, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ item: rows[0] });
    } catch (err) { console.error('[PUT /api/inventory/items/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/inventory/items/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM inventory_items WHERE id=$1', [req.params.id]);
        logAudit(req, 'inventory_item_delete', 'inventory_item', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/inventory/items/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ Stock In (procurement) Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
app.get('/api/inventory/stock', requireAuth, async (req, res) => {
    try {
        const { item_id } = req.query;
        const where = item_id ? 'WHERE s.item_id = $1' : '';
        const params = item_id ? [item_id] : [];
        const { rows } = await pool.query(`
            SELECT s.*, i.name AS item_name, i.unit, i.category
            FROM inventory_stock s
            JOIN inventory_items i ON i.id = s.item_id
            ${where}
            ORDER BY s.received_date DESC, s.created_at DESC`, params);
        res.json({ stock: rows });
    } catch (err) { console.error('[GET /api/inventory/stock]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/inventory/stock', requireAuth, async (req, res) => {
    try {
        const { item_id, quantity, unit_cost, supplier, receipt_no, po_number, received_date, notes } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO inventory_stock (item_id, quantity, unit_cost, supplier, receipt_no, po_number, received_date, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [item_id, quantity, unit_cost || null, supplier, receipt_no, po_number, received_date || null, notes]
        );
        res.json({ stock: rows[0] });
    } catch (err) { console.error('[POST /api/inventory/stock]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/inventory/stock/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM inventory_stock WHERE id=$1', [req.params.id]);
        logAudit(req, 'inventory_stock_delete', 'inventory_stock', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/inventory/stock/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ Issuances Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
app.get('/api/inventory/issuances', requireAuth, async (req, res) => {
    try {
        const { employee_id, item_id, status } = req.query;
        const conds = []; const params = [];
        if (employee_id) { conds.push(`iss.employee_id = $${params.length + 1}`); params.push(employee_id); }
        if (item_id)     { conds.push(`iss.item_id = $${params.length + 1}`); params.push(item_id); }
        if (status)      { conds.push(`iss.status = $${params.length + 1}`); params.push(status); }
        const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT iss.*, i.name AS item_name, i.unit, i.has_expiry, i.category
            FROM inventory_issuance iss
            JOIN inventory_items i ON i.id = iss.item_id
            ${where}
            ORDER BY iss.issue_date DESC, iss.created_at DESC`, params);
        res.json({ issuances: rows });
    } catch (err) { console.error('[GET /api/inventory/issuances]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/inventory/issuances', requireAuth, async (req, res) => {
    try {
        const { item_id, employee_id, employee_name, quantity, issue_date, expiry_date, notes, condition_out } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO inventory_issuance (item_id, employee_id, employee_name, quantity, issue_date, expiry_date, notes, condition_out, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Issued') RETURNING *`,
            [item_id, employee_id, employee_name, quantity || 1, issue_date || null, expiry_date || null, notes, condition_out || 'New']
        );
        res.json({ issuance: rows[0] });
    } catch (err) { console.error('[POST /api/inventory/issuances]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/inventory/issuances/:id', requireAuth, async (req, res) => {
    try {
        const { status, return_date, condition_in, notes } = req.body;
        const { rows } = await pool.query(
            `UPDATE inventory_issuance SET status=$1, return_date=$2, condition_in=$3, notes=$4, updated_at=NOW()
             WHERE id=$5 RETURNING *`,
            [status, return_date || null, condition_in, notes, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ issuance: rows[0] });
    } catch (err) { console.error('[PUT /api/inventory/issuances/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/inventory/issuances/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM inventory_issuance WHERE id=$1', [req.params.id]);
        logAudit(req, 'inventory_issuance_delete', 'inventory_issuance', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/inventory/issuances/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});




// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë
// PAYROLL TRANSACTIONS Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ persistent storage for monthly payroll data
// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë

// GET /api/payroll/:year/:month Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ load saved overrides for a given month
app.get('/api/payroll/:year/:month', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
        const y = parseInt(year, 10);
        const m = parseInt(month, 10);
        const { archive, config } = await cutover.resolveArchiveMode(req, pool);
        if (!archive && !cutover.periodAtOrAfterCutover(m, y, config.cutoverMonth, config.cutoverYear)) {
            return res.json({ rows: [], locked: false, archived: false, cutover_blocked: true });
        }
        const { rows } = await pool.query(
            'SELECT * FROM payroll_transactions WHERE year=$1 AND month=$2',
            [parseInt(year), parseInt(month)]
        );
        // Month is locked if ANY row for this month has been locked.
        // (rows.every would require ALL employees to be locked, which breaks per-filter locking)
        const locked = rows.some(r => r.locked);
        res.json({
            rows: rows.map(r => ({
                employee_id:       r.employee_id,
                paid_days:         parseFloat(r.paid_days)         || null,
                ot2_hrs:           parseFloat(r.ot2_hrs)           || 0,
                ot3_hrs:           parseFloat(r.ot3_hrs)           || 0,
                opd_claim:         parseFloat(r.opd_claim)         || 0,
                reimbursement:     parseFloat(r.reimbursement)     || 0,
                arrears:           parseFloat(r.arrears)           || 0,
                bonus_amount:      parseFloat(r.bonus_amount)      || 0,
                special_allowance: parseFloat(r.special_allowance) || 0,
                fuel_mobile:       parseFloat(r.fuel_mobile)       || 0,
                other_deduction:   parseFloat(r.other_deduction)   || 0,
                advance_deduction: parseFloat(r.advance_deduction) || 0,
                loan_deduction:    parseFloat(r.loan_deduction)    || 0,
                medical_ee:        r.medical_ee != null ? parseFloat(r.medical_ee) : null,
                medical_sp:        r.medical_sp != null ? parseFloat(r.medical_sp) : null,
                medical_ch1:       r.medical_ch1 != null ? parseFloat(r.medical_ch1) : null,
                medical_ch2:       r.medical_ch2 != null ? parseFloat(r.medical_ch2) : null,
                gross:             parseFloat(r.gross)             || 0,
                net:               parseFloat(r.net)               || 0,
                wht:               parseFloat(r.wht)               || 0,
                eobi_ee:           parseFloat(r.eobi_ee)           || 0,
                service_charges:   parseFloat(r.service_charges)   || 0,
                sales_tax:         parseFloat(r.sales_tax)         || 0,
                total_invoice:     parseFloat(r.total_invoice)     || 0,
                locked:            r.locked || false,
                remarks:           r.remarks || '',
                computed_json:     r.computed_json || null,
            })),
            locked,
            lockedBy:  rows[0]?.locked_by  || null,
            lockedAt:  rows[0]?.locked_at  || null,
            compute_source: 'server',
        });
    } catch (err) { console.error('[GET /api/payroll/:year/:month]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/payroll/:year/:month — bulk UPSERT inputs (and optional browser-legacy calc).
// Prefer POST .../calculate for money columns (server engine). inputsOnly skips overwriting net/tax.
app.post('/api/payroll/:year/:month', requireAuth, requireRole('finance_proposer'), async (req, res) => {
    try {
        const { year, month } = req.params;
        const { rows: incoming = [], inputsOnly = false } = req.body;

        // Check if month is locked
        const lockCheck = await pool.query(
            'SELECT locked FROM payroll_transactions WHERE year=$1 AND month=$2 AND locked=TRUE LIMIT 1',
            [parseInt(year), parseInt(month)]
        );
        if (lockCheck.rows.length > 0) {
            return res.status(403).json({ error: 'Payroll for this month is locked. Unlock it first.' });
        }

        const saved = [];
        for (const row of incoming) {
            const { employee_id, ov = {}, calc = {} } = row;
            if (!employee_id) continue;
            const moneySql = inputsOnly
                ? `gross = payroll_transactions.gross,
                    net = payroll_transactions.net,
                    wht = payroll_transactions.wht,
                    eobi_ee = payroll_transactions.eobi_ee,
                    service_charges = payroll_transactions.service_charges,
                    sales_tax = payroll_transactions.sales_tax,
                    total_invoice = payroll_transactions.total_invoice`
                : `gross=$20, net=$21, wht=$22, eobi_ee=$23, service_charges=$24,
                    sales_tax=$25, total_invoice=$26`;
            const { rows: upserted } = await pool.query(`
                INSERT INTO payroll_transactions
                    (month, year, employee_id, paid_days, ot2_hrs, ot3_hrs, opd_claim,
                     reimbursement, arrears, bonus_amount, special_allowance, fuel_mobile,
                     other_deduction, advance_deduction, loan_deduction,
                     medical_ee, medical_sp, medical_ch1, medical_ch2,
                     gross, net, wht, eobi_ee, service_charges, sales_tax, total_invoice,
                     remarks, created_by, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,NOW())
                ON CONFLICT (employee_id, month, year) DO UPDATE SET
                    paid_days=$4, ot2_hrs=$5, ot3_hrs=$6, opd_claim=$7,
                    reimbursement=$8, arrears=$9, bonus_amount=$10, special_allowance=$11,
                    fuel_mobile=$12, other_deduction=$13, advance_deduction=$14, loan_deduction=$15,
                    medical_ee=$16, medical_sp=$17, medical_ch1=$18, medical_ch2=$19,
                    ${moneySql}, remarks=$27, updated_at=NOW()
                RETURNING employee_id`,
                [
                    parseInt(month), parseInt(year), employee_id,
                    ov.paid_days != null ? parseFloat(ov.paid_days) : null,
                    parseFloat(ov.ot2_hrs)           || 0,
                    parseFloat(ov.ot3_hrs)           || 0,
                    parseFloat(ov.opd_claim)         || 0,
                    parseFloat(ov.reimbursement)     || 0,
                    parseFloat(ov.arrears)           || 0,
                    parseFloat(ov.bonus_amount)      || 0,
                    parseFloat(ov.special_allowance) || 0,
                    parseFloat(ov.fuel_mobile)       || 0,
                    parseFloat(ov.other_deduction)   || 0,
                    parseFloat(ov.advance_deduction) || 0,
                    parseFloat(ov.loan_deduction)    || 0,
                    ov.medical_ee  != null ? parseFloat(ov.medical_ee)  : null,
                    ov.medical_sp  != null ? parseFloat(ov.medical_sp)  : null,
                    ov.medical_ch1 != null ? parseFloat(ov.medical_ch1) : null,
                    ov.medical_ch2 != null ? parseFloat(ov.medical_ch2) : null,
                    parseFloat(calc.grossMonthly)    || 0,
                    parseFloat(calc.netPay)          || 0,
                    parseFloat(calc.incomeTax)       || 0,
                    parseFloat(calc.eobi_ee)         || 0,
                    parseFloat(calc.serviceCharges)  || 0,
                    parseFloat(calc.salesTax)        || 0,
                    parseFloat(calc.totalInvoice)    || 0,
                    ov.remarks != null ? String(ov.remarks).slice(0, 2000) : null,
                    req.user?.email || 'system',
                ]
            );
            if (upserted.length) saved.push(upserted[0].employee_id);
        }
        res.json({ ok: true, saved: saved.length, inputsOnly: !!inputsOnly });
    } catch (err) { console.error('[POST /api/payroll/:year/:month]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/payroll/:year/:month/lock Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ lock a payroll month + auto-post PF/Gratuity
app.patch('/api/payroll/:year/:month/lock', requireAuth, requireRole('finance_approver'), async (req, res) => {
    try {
        const { year, month } = req.params;
        const { employee_ids } = req.body || {};
        const yr = parseInt(year), mo = parseInt(month);

        let lockedEmpIds;
        if (employee_ids && employee_ids.length > 0) {
            await pool.query(
                `UPDATE payroll_transactions SET locked=TRUE, locked_by=$1, locked_at=NOW()
                 WHERE year=$2 AND month=$3 AND employee_id = ANY($4)`,
                [req.user.email, yr, mo, employee_ids]
            );
            lockedEmpIds = employee_ids;
        } else {
            await pool.query(
                `UPDATE payroll_transactions SET locked=TRUE, locked_by=$1, locked_at=NOW()
                 WHERE year=$2 AND month=$3`,
                [req.user.email, yr, mo]
            );
            // Fetch all locked employee IDs for auto-accrual
            const { rows: lockedRows } = await pool.query(
                `SELECT employee_id FROM payroll_transactions WHERE year=$1 AND month=$2 AND locked=TRUE`,
                [yr, mo]
            );
            lockedEmpIds = lockedRows.map(r => r.employee_id);
        }

        // Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ Auto-post PF and Gratuity accrual for each newly locked employee Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
        let accruals = { ok: true, pf_rows: 0, gratuity_rows: 0 };
        if (lockedEmpIds && lockedEmpIds.length > 0) {
            try {
            // Join contracts to get eosb_type from costs JSON
            // pf_enrolled does NOT exist as a column Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ eosb_type lives in contracts.costs
            const { rows: emps } = await pool.query(
                `SELECT e.id, e.salary, e.contract_name,
                        c.costs->>'eosb_type' AS eosb_type
                 FROM employees e
                 LEFT JOIN contracts c ON c.contract_name = e.contract_name
                 WHERE e.id = ANY($1)`,
                [lockedEmpIds]
            );
            for (const emp of emps) {
                const gross      = parseFloat(emp.salary) || 0;
                const eosbType   = emp.eosb_type || 'None';
                const isPF       = eosbType === 'Provident Fund';
                const isGratuity = eosbType === 'Gratuity';

                // PF: gross/24 per month Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ ONLY when Provident Fund scheme
                const pfContrib = isPF ? Math.round(gross / 24) : 0;

                // Gratuity: gross/12 per month Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ ONLY when Gratuity scheme (mutually exclusive with PF)
                const gratuityAccrual = isGratuity ? Math.round(gross / 12) : 0;

                if (pfContrib > 0) {
                    await pool.query(`
                        INSERT INTO employee_pf_ledger (employee_id, month, year, ee_contribution, er_contribution)
                        VALUES ($1,$2,$3,$4,$4)
                        ON CONFLICT (employee_id, month, year)
                        DO UPDATE SET ee_contribution=$4, er_contribution=$4
                    `, [emp.id, mo, yr, pfContrib]);
                    accruals.pf_rows++;
                }
                if (gratuityAccrual > 0) {
                    const prev = await pool.query(
                        `SELECT COALESCE(MAX(cumulative),0) AS cum FROM employee_gratuity_ledger WHERE employee_id=$1 AND (year < $2 OR (year=$2 AND month < $3))`,
                        [emp.id, yr, mo]
                    );
                    const prevCum = parseFloat(prev.rows[0].cum) || 0;
                    await pool.query(`
                        INSERT INTO employee_gratuity_ledger (employee_id, month, year, accrual, cumulative)
                        VALUES ($1,$2,$3,$4,$5)
                        ON CONFLICT (employee_id, month, year)
                        DO UPDATE SET accrual=$4, cumulative=$5
                    `, [emp.id, mo, yr, gratuityAccrual, prevCum + gratuityAccrual]);
                    accruals.gratuity_rows++;
                }
            }
            } catch (accrualErr) {
                console.error('[payroll-lock accruals]', accrualErr);
                accruals = { ok: false, error_logged: true };
            }
        }

        logAudit(req, 'payroll_lock', 'payroll_period', `${yr}-${mo}${lockedEmpIds?.length ? ` (${lockedEmpIds.length} employees)` : ''} accruals:${accruals.ok ? 'ok' : 'failed'}`);
        res.json({ ok: true, locked: true, lockedBy: req.user.email, accruals_posted: lockedEmpIds?.length || 0, accruals });
    } catch (err) { console.error('[PATCH /api/payroll/:year/:month/lock]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/payroll/:year/:month/unlock Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ unlock a payroll month (scoped to employee_ids if provided)
app.patch('/api/payroll/:year/:month/unlock', requireAuth, requireRole('finance_approver'), async (req, res) => {
    try {
        const { year, month } = req.params;
        const { employee_ids } = req.body || {};
        const yr = parseInt(year), mo = parseInt(month);
        if (employee_ids && employee_ids.length > 0) {
            // Scoped unlock Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ only the specified employees
            await pool.query(
                `UPDATE payroll_transactions SET locked=FALSE, locked_by=NULL, locked_at=NULL
                 WHERE year=$1 AND month=$2 AND employee_id = ANY($3)`,
                [yr, mo, employee_ids]
            );
        } else {
            // Full unlock (backward compat / superadmin use)
            await pool.query(
                `UPDATE payroll_transactions SET locked=FALSE, locked_by=NULL, locked_at=NULL
                 WHERE year=$1 AND month=$2`,
                [yr, mo]
            );
        }
        logAudit(req, 'payroll_unlock', 'payroll_period', `${yr}-${mo}${employee_ids?.length ? ` (${employee_ids.length} employees)` : ''}`);
        res.json({ ok: true, locked: false });
    } catch (err) { console.error('[PATCH /api/payroll/:year/:month/unlock]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/payroll/:year/:month/:employeeId ΓÇö delete one employee's payroll row (superadmin only)
app.delete('/api/payroll/:year/:month/:employeeId', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { year, month, employeeId } = req.params;
        const result = await pool.query(
            'DELETE FROM payroll_transactions WHERE employee_id=$1 AND year=$2 AND month=$3 RETURNING employee_id',
            [employeeId, parseInt(year), parseInt(month)]
        );
        // If 0 rows deleted the employee simply never had a saved override ΓÇö treat as success
        if (result.rows.length) logAudit(req, 'payroll_row_delete', 'payroll_transaction', `${employeeId} ${year}-${month}`);
        res.json({ ok: true, deleted: result.rows.length });
    } catch (err) { console.error('[DELETE /api/payroll/:year/:month/:employeeId]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/payroll/:year/:month ΓÇö bulk-reset (erase all entered data) for a payroll month
// Requires a password stored in the PAYROLL_RESET_PASSWORD env variable.
// Refuses if any rows are locked (locked payroll cannot be erased without unlocking first).
app.delete('/api/payroll/:year/:month', requireAuth, requireRole('superadmin', 'finance_approver'), async (req, res) => {
    try {
        const { year, month } = req.params;
        const { password } = req.body || {};
        const yr = parseInt(year), mo = parseInt(month);

        // 1. Verify password
        const RESET_PWD = process.env.PAYROLL_RESET_PASSWORD;
        if (!RESET_PWD) {
            return res.status(503).json({ error: 'PAYROLL_RESET_PASSWORD is not configured on the server. Set it in Render ΓåÆ Environment.' });
        }
        if (!password || password !== RESET_PWD) {
            return res.status(403).json({ error: 'Incorrect reset password.' });
        }

        // 2. Refuse if any rows are locked
        const lockCheck = await pool.query(
            'SELECT COUNT(*) AS cnt FROM payroll_transactions WHERE year=$1 AND month=$2 AND locked=TRUE',
            [yr, mo]
        );
        const lockedCount = parseInt(lockCheck.rows[0].cnt || '0');
        if (lockedCount > 0) {
            return res.status(409).json({
                error: `Cannot reset: ${lockedCount} employee row(s) are locked. Please unlock the payroll first, then retry.`,
            });
        }

        // 3. Delete all unlocked rows for this month
        const result = await pool.query(
            'DELETE FROM payroll_transactions WHERE year=$1 AND month=$2 AND (locked IS NULL OR locked=FALSE) RETURNING employee_id',
            [yr, mo]
        );

        console.log(`[Payroll Reset] ${req.user?.email} erased ${result.rows.length} rows for ${yr}-${mo}`);
        logAudit(req, 'payroll_bulk_reset', 'payroll_period', `${yr}-${mo} (${result.rows.length} rows)`);
        res.json({ ok: true, deleted: result.rows.length });
    } catch (err) { console.error('[DELETE /api/payroll/:year/:month]', err); res.status(500).json({ error: 'Internal server error' }); }
});



// Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ Payroll CSV Export (server-side, avoids CSP/blob issues) Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
app.get('/api/payroll/:year/:month/export', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
        const { type = 'payroll', client: filterClient, contract: filterContract, location: filterLoc } = req.query;
        const yrInt = parseInt(year), moInt = parseInt(month);

        const [empRes, payRes, contractRes, regionTaxRes] = await Promise.all([
            pool.query('SELECT * FROM employees ORDER BY name'),
            pool.query('SELECT * FROM payroll_transactions WHERE year=$1 AND month=$2', [yrInt, moInt]),
            pool.query('SELECT id, contract_name, financials, costs FROM contracts'),
            pool.query("SELECT value FROM system_config WHERE key='region_tax'").catch(() => ({ rows: [] })),
        ]);
        // Province tax rates from System Config (Tax by Region), falls back to statutory defaults
        const _dbRates = regionTaxRes.rows[0]?.value || [];

        // Build contract lookup by name (lowercase) Γö£├│╬ô├ç├í╬ô├ç├û enrich employees with financials
        const ctByName = {};
        contractRes.rows.forEach(c => { if (c.contract_name) ctByName[c.contract_name.toLowerCase().trim()] = c; });

        empRes.rows.forEach(emp => {
            const key = (emp.contract_name || emp.client_bu || '').toLowerCase().trim();
            const ct = ctByName[key] || null;
            // ALL per-head cost data is in costs column (NOT financials)
            const costs = ct?.costs || {};
            const fin   = ct?.financials || {};
            // These _prefixed properties are used by calcRow below
            emp._isPF         = emp.pf_enrolled
                || costs.eosb_type === 'Provident Fund';
            emp._eosb_type    = costs.eosb_type || null;
            emp._medical_ee   = parseFloat(costs.medical_ee   || 0);
            emp._medical_sp   = parseFloat(costs.medical_sp   || 0);
            emp._medical_ch   = parseFloat(costs.medical_child || 0);
            emp._life_ins     = parseFloat(costs.life_insurance || 0);
            // bonus_months Γö£├ó╬ô├ç├╢ gross gives ANNUAL bonus; /12 = monthly accrual
            // We store bonus_months in costs Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ gross comes from emp.salary in calcRow
            emp._bonus_months = parseFloat(costs.bonus_months || 0);
            emp._overhead_per_employee = parseFloat(costs.overhead_per_employee || 0);
            emp._svc_pct      = parseFloat(fin.service_charges_pct || 0);
            emp._sales_tax_pct= parseFloat(fin.wht_pct || 0);
        });

        const payMap = {};
        payRes.rows.forEach(p => { payMap[p.employee_id] = p; });

        // Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ Apply active UI filters to restrict export scope Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
        let filteredEmps = empRes.rows;
        if (filterClient && filterClient !== 'All') {
            filteredEmps = filteredEmps.filter(e =>
                e.client === filterClient ||
                e.client_bu === filterClient
            );
        }
        if (filterContract && filterContract !== 'All') {
            // EXACT match Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ do NOT use .includes() which matches 'Facility Management'
            // against 'Facility Management (Trading & Supply)' incorrectly
            filteredEmps = filteredEmps.filter(e =>
                e.contract_name === filterContract ||
                e.client_bu === filterContract ||
                e.clientbu === filterContract
            );
        }
        if (filterLoc && filterLoc !== 'All') {
            filteredEmps = filteredEmps.filter(e => e.location === filterLoc);
        }

        const monthLabel = new Date(2000, moInt-1, 1).toLocaleString('en-PK', { month: 'long' }) + ' ' + year;
        const WD = 26;

        const whtCalc = (a) => {
            // FBR 2025-26 Salaried Individual ΓÇö Finance Act 2024 (matches frontend calcWHT)
            if (a <= 600000) return 0;
            if (a <= 1200000) return Math.round(((a - 600000) * 0.01) / 12);
            if (a <= 2200000) return Math.round((6000 + (a - 1200000) * 0.11) / 12);
            if (a <= 3200000) return Math.round((116000 + (a - 2200000) * 0.23) / 12);
            if (a <= 4100000) return Math.round((346000 + (a - 3200000) * 0.30) / 12);
            return Math.round((616000 + (a - 4100000) * 0.35) / 12);
        };

        // Province Γö£├│╬ô├ç├í╬ô├ç├û provincial service tax rate (DB-driven from System Config Tax by Region)
        const provinceTaxRate = (province) => {
            const p = (province || '').toLowerCase();
            if (_dbRates && _dbRates.length > 0) {
                const match = _dbRates.find(r => p.includes((r.province || '').toLowerCase().split('/')[0].trim()));
                if (match) return (parseFloat(match.salesTaxPct) || 0) / 100;
            }
            if (p.includes('sindh') || p.includes('karachi') || p.includes('hyderabad')) return 0.15;
            if (p.includes('punjab') || p.includes('lahore') || p.includes('faisalabad') || p.includes('rawalpindi') || p.includes('islamabad')) return 0.16;
            if (p.includes('kpk') || p.includes('khyber') || p.includes('peshawar') || p.includes('abbottabad')) return 0.15;
            if (p.includes('balochistan') || p.includes('quetta')) return 0.15;
            return 0.15;
        };

        const calcRow = (emp, pay) => {
            // The Payroll Sheet snapshot is authoritative — render it, never re-derive it.
            const snap = readPayrollSnapshot(pay);
            if (snap) return exportRowFromSnapshot(emp, pay, snap);
            // Legacy path: months calculated before computed_json existed (pre 2026-08-10)
            // have no snapshot. Kept so historical exports stay byte-identical.
            const gross  = parseFloat(emp.salary) || parseFloat(emp.gross) || 0;
            const pd     = Math.max(0, parseFloat(pay?.paid_days ?? WD) || WD);
            // Universal formula: gross = salary x paid_days / workDays
            const grossPay = WD > 0 ? Math.round(gross * pd / WD) : 0;
            const hrly   = gross / (26 * 8); // OT rate: always full salary / 208hrs
            const ot2hrs = parseFloat(pay?.ot2_hrs || 0);
            const ot3hrs = parseFloat(pay?.ot3_hrs || 0);
            const otAmt  = Math.round(hrly * (ot2hrs * 2 + ot3hrs * 3));
            const opd    = Math.round(parseFloat(pay?.opd_claim    || 0));
            const reimb  = Math.round(parseFloat(pay?.reimbursement || 0));
            const arr    = Math.round(parseFloat(pay?.arrears       || 0));
            const spl    = Math.round(parseFloat(pay?.special_allowance || 0));
            const fuel   = Math.round(parseFloat(pay?.fuel_mobile   || 0));
            const bonus  = Math.round(parseFloat(pay?.bonus_amount  || 0));
            // grossM: use stored gross if available (already prorated from CSV import),
            // else compute from the universal formula including bonus disbursement.
            // Bonus is taxable income and must be included before WHT calculation.
            const grossM = pay?.gross && parseFloat(pay.gross) > 0
                ? Math.round(parseFloat(pay.gross))
                : grossPay + otAmt + opd + reimb + arr + spl + fuel + bonus;

            // grossForTPC: base gross WITHOUT bonus lump-sum (client provisioned via monthly accrual)
            const grossForTPC = pay?.gross && parseFloat(pay.gross) > 0
                ? Math.round(parseFloat(pay.gross)) - bonus
                : grossPay + otAmt + opd + reimb + arr + spl + fuel;

            // WHT: stored sheet value is authoritative — including explicit 0.
            // Do NOT treat wht=0 as "missing" (that reinvented tax on bonus-excluded July rows).
            const wht = (pay != null && pay.wht != null && pay.wht !== '')
                ? Math.round(parseFloat(pay.wht) || 0)
                : whtCalc(grossM * 12);
            const eobi_ee  = 400, eobi_er = 2000;
            // Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ EOSB: PF and Gratuity are MUTUALLY EXCLUSIVE Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ mirrors frontend exactly Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
            // Source of truth: contract costs.eosb_type ('Provident Fund' | 'Gratuity' | 'None')
            const eosbType       = emp._eosb_type || (emp.pf_enrolled ? 'Provident Fund' : 'None');
            const isPF_scheme      = eosbType === 'Provident Fund';
            const isGratuity_scheme = eosbType === 'Gratuity';
            const pfDed    = isPF_scheme      ? Math.round(gross / 24) : 0;  // employee deduction
            const pfER     = pfDed;                                            // employer: 1-for-1 match
            const gratuity = isGratuity_scheme ? Math.round(gross / 12) : 0; // employer only
            const advDed   = Math.round(parseFloat(pay?.advance_deduction||0));
            const loanDed  = Math.round(parseFloat(pay?.loan_deduction||0));
            const otherDed = Math.round(parseFloat(pay?.other_deduction||0));
            const totalDed = wht + eobi_ee + pfDed + advDed + loanDed + otherDed;
            // Prefer stored net (sheet Calculate truth) so bank/payroll CSV match the UI.
            const netPay = (pay != null && pay.net != null && pay.net !== '')
                ? Math.round(parseFloat(pay.net) || 0)
                : (grossM - totalDed);
            // costBase uses grossForTPC (without bonus) to avoid double-billing via bonusAccrual
            const sessi    = calculateSESSI(grossForTPC);
            // BUG FIX: If medical_sp/ch1/ch2 are stored as 0 (from CSV import without Spouse/Children
            // Count columns), fall back to the employee master's family data to determine family premiums.
            const savedMedSP  = pay?.medical_sp  != null ? parseFloat(pay.medical_sp)  : null;
            const savedMedCh1 = pay?.medical_ch1 != null ? parseFloat(pay.medical_ch1) : null;
            const savedMedCh2 = pay?.medical_ch2 != null ? parseFloat(pay.medical_ch2) : null;
            const empHasSpouse   = !!(emp.spouse_name && String(emp.spouse_name).trim() && String(emp.spouse_name).trim() !== '0');
            const empNumChildren = [emp.child1_name, emp.child2_name].filter(n => n && String(n).trim() && String(n).trim() !== '0').length;

            const medEE  = Math.round(parseFloat(pay?.medical_ee != null ? pay.medical_ee : emp._medical_ee || 0));
            // UNCONDITIONAL family gate ΓÇö no spouse = medSP always 0, even if DB has stale value.
            // Mirrors payrollUtils.js logic exactly so export matches the UI.
            const medSP  = !empHasSpouse    ? 0
                         : (savedMedSP  != null && savedMedSP  > 0) ? savedMedSP  : Math.round(emp._medical_sp || 0);
            const medCh1 = empNumChildren < 1 ? 0
                         : (savedMedCh1 != null && savedMedCh1 > 0) ? savedMedCh1 : Math.round(emp._medical_ch || 0);
            const medCh2 = empNumChildren < 2 ? 0
                         : (savedMedCh2 != null && savedMedCh2 > 0) ? savedMedCh2 : Math.round(emp._medical_ch || 0);
            const medTotal = medEE + medSP + medCh1 + medCh2;
            // Life Insurance: from contract costs
            const lifeIns = Math.round(parseFloat(emp._life_ins || emp.life_insurance || 0));
            // Bonus accrual: bonus_months Γö£├ó╬ô├ç├╢ gross / 12 per month
            const bonusMonths  = parseFloat(emp._bonus_months || emp.bonus_months || 0);
            const bonusAccrual = Math.round(bonusMonths * gross / 12);
            // Overhead: fixed per-employee charge from contract
            const overhead = Math.round(parseFloat(emp._overhead_per_employee || 0));
            // Total employer cost = gross + all employer obligations
            // other_deduction reduces the invoice (mirrors frontend payrollUtils.js fix)
            const costBase = grossForTPC + eobi_er + sessi + pfER + gratuity + lifeIns + medTotal + bonusAccrual + overhead - otherDed;
            const sc       = pay?.service_charges ? Math.round(parseFloat(pay.service_charges)) : 0;
            const stRate   = provinceTaxRate(emp.province);
            // Sales tax base: Total Payroll Cost + Service Charges (per MD instruction)
            const st       = pay?.sales_tax ? Math.round(parseFloat(pay.sales_tax)) : Math.round((costBase + sc) * stRate);
            const inv      = pay?.total_invoice ? Math.round(parseFloat(pay.total_invoice)) : costBase+sc+st;
            return { grossM, wht, eobi_ee, eobi_er, sessi, pfDed, pfER, advDed, loanDed, otherDed, totalDed, netPay,
                     gratuity, eosbType, costBase, sc, st, inv, otAmt, opd, reimb, arr, spl, fuel, bonus, overhead,
                     pd, ot2hrs, ot3hrs, medEE, medSP, medCh1, medCh2, medTotal, bonusAccrual, lifeIns };
        };

        let rows = [], filename = 'export.csv';
        const bu  = e => e.client_bu || e.clientbu || e.clientBU || '';
        const cnic = e => e.cnic || '';
        const isHBL = e => (e.bank_name || '').toLowerCase().replace(/\s/g,'').includes('hbl') ||
                           (e.bank_name || '').toLowerCase().includes('habib');
        const monthAbbr = new Date(2000, moInt-1, 1).toLocaleString('en-US', { month: 'short' }); // 'Mar'
        const yr2 = String(yrInt).slice(-2); // '26'

        // Build locked ID set Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ always from the full month's payroll_transactions
        const lockedIds = new Set(payRes.rows.filter(p => p.locked).map(p => p.employee_id));
        // ALWAYS export locked-only rows scoped to the current filter.
        // bankEmps = employees who (a) match current filter AND (b) are locked in this month.
        // This is the only correct source for ALL export types.
        const bankEmps = filteredEmps.filter(e => lockedIds.has(e.id));

        if (type === 'payroll') {
            // Payroll CSV always locked+filtered Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ never all 514
            rows = bankEmps.map(emp => {
                const c = calcRow(emp, payMap[emp.id]);
                return {
                    'Month':             monthLabel,
                    'Employee ID':       emp.id,
                    'Name':             emp.name,
                    'CNIC':             cnic(emp),
                    'Contract':         emp.contract_name || bu(emp),
                    'Location':         emp.location || '',
                    'Province':         emp.province || '',
                    // Column H -- per MD instruction
                    'EOSB Scheme':      c.eosbType || 'None',
                    // Salary & Earnings
                    'Gross Salary':     parseFloat(emp.salary) || 0,
                    'Paid Days':        c.pd,
                    'OT @2X Hrs':       c.ot2hrs,
                    'OT @3X Hrs':       c.ot3hrs,
                    'OT Amount':        c.otAmt,
                    'OPD Claim':        c.opd,
                    'Reimbursement':    c.reimb,
                    'Arrears':          c.arr,
                    'Other Allowances': 0,
                    'Spl Allowance':    c.spl,
                    'Fuel/Mobile':      c.fuel,
                    'Bonus Disbursement': c.bonus,
                    'Gross Monthly':    c.grossM,
                    // Employee Deductions
                    'Income Tax (WHT)':         c.wht,
                    'EOBI Employee (Rs.400)':   c.eobi_ee,
                    'PF Employee Deduction':    c.pfDed,
                    'Advance Deduction':        c.advDed,
                    'Loan Deduction':           c.loanDed,
                    'Other Deduction':          c.otherDed,
                    'Total Deductions':         c.totalDed,
                    'Net Pay to Employee':      c.netPay,
                    // Employer Costs
                    'EOBI Employer (Rs.2000)':  c.eobi_er,
                    'PF Employer Contribution': c.pfER,
                    'Gratuity Accrual':         c.gratuity,
                    'SESSI':                    c.sessi,
                    'Life Insurance':           c.lifeIns,
                    'Medical (Employee)':       c.medEE,
                    'Medical (Spouse)':         c.medSP,
                    'Medical (Child 1)':        c.medCh1,
                    'Medical (Child 2)':        c.medCh2,
                    'Bonus Accrual (Monthly)':  c.bonusAccrual,
                    'Overhead (Fixed per Contract)': c.overhead,
                    'Total Employer Cost':      c.costBase,
                    // Invoice
                    'Service Charges':          c.sc,
                    'Sales Tax':                c.st,
                    'Total Invoice Amount':     c.inv,
                };
            });
            if (!rows.length) return res.status(200).json({ msg: 'No locked payroll records found for the selected filter. Lock a payroll batch in the Payroll Sheet first.' });
            filename = `Payroll_${year}-${String(month).padStart(2,'0')}${filterClient && filterClient !== 'All' ? '_' + filterClient.replace(/\s+/g,'_').slice(0,20) : ''}.csv`;

        } else if (type === 'hbl_same') {
            // HBL to HBL transfers Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ only employees with HBL accounts, locked rows only
            rows = bankEmps.filter(isHBL).map((emp, i) => {
                const c = calcRow(emp, payMap[emp.id]);
                const ref1 = `PR${monthAbbr}${yr2}-${emp.id}`;
                return {
                    'Beneficiary\u00a0Name': emp.name,
                    'Beneficiary Account Number': emp.bank_account || '',
                    'Transaction Amount': c.netPay,
                    'Reference # 1': ref1,
                    'Reference # 2': '',
                    'Reference # 3': '',
                    'Inovice Number': '',
                    'Account Title': emp.account_title || emp.name,
                };
            });
            if (!rows.length) return res.status(200).json({ msg: 'No HBL account holders in locked payroll.' });
            filename = `HBL_to_HBL_${monthAbbr}${yr2}.csv`;

        } else if (type === 'hbl_other') {
            // HBL to Other Banks (IBFT) Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ non-HBL bank accounts, locked rows only
            rows = bankEmps.filter(e => !isHBL(e)).map((emp, i) => {
                const c = calcRow(emp, payMap[emp.id]);
                const ref1 = `PR${monthAbbr}${yr2}-${emp.id}`;
                return {
                    'Beneficiary Name': emp.name,
                    'Beneficiary Account Number': emp.bank_account || '',
                    'Transaction Amount': c.netPay,
                    'Reference # 1': ref1,
                    'Reference # 2': '',
                    'Reference # 3': '',
                    'Inovice Number': '',
                    'Account Title': emp.account_title || emp.name,
                };
            });
            if (!rows.length) return res.status(200).json({ msg: 'No other-bank account holders in locked payroll.' });
            filename = `HBL_to_Others_${monthAbbr}${yr2}.csv`;

        } else if (type === 'hbl') {
            // Legacy single HBL file Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ redirect to split files message
            rows = bankEmps.map((emp, i) => {
                const c = calcRow(emp, payMap[emp.id]);
                return { 'Beneficiary Name': emp.name,
                    'Beneficiary Account Number': emp.bank_account || '',
                    'Transaction Amount': c.netPay,
                    'Bank': emp.bank_name || '',
                    'Reference # 1': `PR${monthAbbr}${yr2}-${emp.id}`,
                    'Account Title': emp.account_title || emp.name };
            });
            filename = `Bank_Transfers_${monthAbbr}${yr2}.csv`;

        } else if (type === 'wht') {
            rows = empRes.rows.map(emp => ({ emp, c: calcRow(emp, payMap[emp.id]) }))
                .filter(({ c }) => c.wht > 0)
                .map(({ emp, c }) => ({
                    'Section': 'Salary', 'CNIC': cnic(emp), 'Name': emp.name,
                    'City': 'Karachi', 'Status': 'Individual - Salaried',
                    'Employer': 'Allied Services (Pvt.) Ltd.',
                    'Taxable Amount': c.grossM, 'Tax Amount': c.wht }));
            if (!rows.length) return res.json({ msg: 'No employees with WHT this month.' });
            filename = `WHT_Returns_${year}-${String(month).padStart(2,'0')}.csv`;

        } else if (type === 'eobi') {
            rows = empRes.rows.map(emp => ({
                'Month': monthLabel, 'Employee ID': emp.id, 'Name': emp.name,
                'CNIC': cnic(emp), 'EOBI No': emp.eobi_no || emp.eobino || '',
                'EOBI Employee (Rs.400)': 400, 'EOBI Employer (Rs.2000)': 2000,
                'Total EOBI': 2400 }));
            filename = `EOBI_${year}-${String(month).padStart(2,'0')}.csv`;

        } else if (type === 'sessi') {
            rows = empRes.rows.map(emp => {
                const c = calcRow(emp, payMap[emp.id]);
                return { 'Month': monthLabel, 'Employee ID': emp.id, 'Name': emp.name,
                    'CNIC': cnic(emp), 'EOBI No': emp.eobi_no || emp.eobino || '',
                    'Gross Monthly': c.grossM, 'SESSI Amount': c.sessi };
            });
            filename = `SESSI_${year}-${String(month).padStart(2,'0')}.csv`;
        } else if (type === 'xero') {
            // Xero-importable Sales Invoice CSV grouped by Client + Province
            const groups = {};
            bankEmps.forEach(emp => {
                const c          = calcRow(emp, payMap[emp.id]);
                const clientName = emp.client || 'Unknown';
                const buName     = emp.contract_name || emp.client_bu || emp.contract || '';
                const province   = emp.province || emp.location || 'Sindh';
                const tracking   = (emp.id || '').toUpperCase().includes('ASILFM') ? 'FM' : 'BPO';
                const key        = `${clientName}||${buName}||${province}`;
                if (!groups[key]) groups[key] = { clientName, buName, province, tracking, totalPayrollCost: 0, serviceCharges: 0, salesTax: 0, count: 0 };
                groups[key].totalPayrollCost += c.costBase;
                groups[key].serviceCharges   += c.sc;
                groups[key].salesTax         += c.st;
                groups[key].count++;
            });
            const invDay   = parseInt(req.query.invoiceDay || 27);
            const startInv = parseInt(req.query.startInv || 5000);
            const invDateD = new Date(yrInt, moInt - 1, invDay);
            const dueDateD = new Date(yrInt, moInt - 1, invDay + 60);
            const fmt2 = n => String(n).padStart(2, '0');
            const invDateStr = `${fmt2(invDateD.getDate())}-${fmt2(invDateD.getMonth()+1)}-${String(invDateD.getFullYear()).slice(-2)}`;
            const dueDateStr = `${fmt2(dueDateD.getDate())}-${fmt2(dueDateD.getMonth()+1)}-${String(dueDateD.getFullYear()).slice(-2)}`;
            const monthLbl = new Date(yrInt, moInt-1, 1).toLocaleString('en-US', { month: 'long' });
            let invNum = startInv;
            const sortedXero = Object.values(groups).sort((a, b) =>
                a.clientName.localeCompare(b.clientName) || a.buName.localeCompare(b.buName) || a.province.localeCompare(b.province)
            );
            sortedXero.forEach(grp => {
                const inv     = String(invNum++);
                const taxType = xeroTaxType(grp.province);
                const isFM    = grp.tracking === 'FM';
                const descMain = `${isFM ? 'FM Services' : 'Services'} in ${grp.province} for the month of ${monthLbl} ${yrInt}`;
                const makeRow = (desc, amount, taxAmt) => ({
                    '*ContactName': `${grp.buName} - ${grp.clientName}`,
                    'EmailAddress': '', 'POAddressLine1': '', 'POAddressLine2': '', 'POAddressLine3': '', 'POAddressLine4': '',
                    'POCity': '', 'PORegion': '', 'POPostalCode': '', 'POCountry': '',
                    '*InvoiceNumber': inv, 'Reference': '',
                    '*InvoiceDate': invDateStr, '*DueDate': dueDateStr,
                    'Total': '', 'InventoryItemCode': '',
                    '*Description': desc, '*Quantity': '1', '*UnitAmount': Math.round(amount),
                    'Discount': '', '*AccountCode': '208',
                    '*TaxType': taxType, 'TaxAmount': taxAmt !== '' ? Math.round(taxAmt) : '',
                    'TrackingName1': 'Tracking Category', 'TrackingOption1': grp.tracking,
                    'TrackingName2': 'Type', 'TrackingOption2': 'Official',
                    'Currency': 'PKR', 'BrandingTheme': 'Letterhead',
                });
                rows.push(makeRow(descMain, grp.totalPayrollCost, grp.salesTax));
                if (grp.serviceCharges > 0) rows.push(makeRow('Service Charges', grp.serviceCharges, ''));
            });
            if (!rows.length) return res.status(200).json({ msg: 'No locked payroll records found for Xero export.' });
            filename = `Invoice_File_Upload_on_Xero_${monthLbl.substring(0,3)}-${String(yrInt).slice(-2)}.csv`;

        } else if (type === 'invoice_summary') {
            // Invoice summary grouped by Client ΓåÆ Contract ΓåÆ Province (mirrors AT:AW columns)
            const sumGroups = {};
            bankEmps.forEach(emp => {
                const c        = calcRow(emp, payMap[emp.id]);
                const client   = emp.client   || 'Unknown';
                const contract = emp.contract_name || bu(emp) || '';
                const province = emp.province  || emp.location || 'Other';
                const key = `${client}||${contract}||${province}`;
                if (!sumGroups[key]) sumGroups[key] = {
                    'Month': monthLabel, 'Client': client, 'Contract': contract, 'Province': province,
                    'Employees': 0, 'Net Pay': 0, 'Gross Monthly': 0,
                    'Total Payroll Cost (AT)': 0, 'Service Charges (AU)': 0,
                    'Sales Tax (AV)': 0, 'Total Invoice (AW)': 0,
                };
                sumGroups[key]['Employees']++;
                sumGroups[key]['Net Pay']                  += c.netPay;
                sumGroups[key]['Gross Monthly']            += c.grossM;
                sumGroups[key]['Total Payroll Cost (AT)']  += c.costBase;
                sumGroups[key]['Service Charges (AU)']     += c.sc;
                sumGroups[key]['Sales Tax (AV)']           += c.st;
                sumGroups[key]['Total Invoice (AW)']       += c.inv;
            });
            rows = Object.values(sumGroups).sort((a, b) =>
                a.Client.localeCompare(b.Client) || a.Contract.localeCompare(b.Contract) || a.Province.localeCompare(b.Province)
            );
            // Add grand total row
            if (rows.length > 1) {
                const grand = rows.reduce((acc, r) => {
                    acc['Employees'] += r['Employees'];
                    acc['Net Pay'] += r['Net Pay'];
                    acc['Gross Monthly'] += r['Gross Monthly'];
                    acc['Total Payroll Cost (AT)'] += r['Total Payroll Cost (AT)'];
                    acc['Service Charges (AU)'] += r['Service Charges (AU)'];
                    acc['Sales Tax (AV)'] += r['Sales Tax (AV)'];
                    acc['Total Invoice (AW)'] += r['Total Invoice (AW)'];
                    return acc;
                }, { Month: monthLabel, Client: 'GRAND TOTAL', Contract: '', Province: '', Employees: 0, 'Net Pay': 0, 'Gross Monthly': 0, 'Total Payroll Cost (AT)': 0, 'Service Charges (AU)': 0, 'Sales Tax (AV)': 0, 'Total Invoice (AW)': 0 });
                rows.push(grand);
            }
            if (!rows.length) return res.status(200).json({ msg: 'No locked payroll records found for invoice summary.' });
            filename = `Invoice_Summary_${year}-${String(month).padStart(2,'0')}${filterClient !== 'All' ? '_' + filterClient.replace(/\s+/g,'_').slice(0,20) : ''}.csv`;

        } else {
            return res.status(400).json({ error: 'Invalid type. Use payroll|hbl_same|hbl_other|hbl|wht|eobi|sessi|xero|invoice_summary' });
        }

        if (!rows.length) return res.status(200).send('No data to export.');
        const hdrs = Object.keys(rows[0]);
        const esc  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv  = [hdrs.map(esc).join(','), ...rows.map(r => hdrs.map(h => esc(r[h])).join(','))].join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\uFEFF' + csv);
    } catch (err) { console.error('[GET /api/payroll/:year/:month/export]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/payroll/:year/:month/send-payslips — moved to src/modules/payslip/routes.js (gated PDF delivery)

// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë
// XERO INTEGRATION
// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë
// Env vars required:
//   XERO_CLIENT_ID     Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ OAuth2 Client ID from Xero Developer Portal
//   XERO_CLIENT_SECRET Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ OAuth2 Client Secret
//   XERO_REDIRECT_URI  Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ e.g. https://asilhcm.onrender.com/api/xero/callback
//
// Flow: Admin visits /api/xero/connect Γö£├│╬ô├ç├í╬ô├ç├û Xero login Γö£├│╬ô├ç├í╬ô├ç├û /api/xero/callback
//       Γö£├│╬ô├ç├í╬ô├ç├û stores refresh_token + expires_at in system_config Γö£├│╬ô├ç├í╬ô├ç├û all future POSTs
//       use refresh_token only when access_token is near expiry (< 5 min).

const XERO_CLIENT_ID     = process.env.XERO_CLIENT_ID     || '';
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET || '';
const XERO_REDIRECT_URI  = process.env.XERO_REDIRECT_URI  || 'https://asilhcm.onrender.com/api/xero/callback';
// Granular scopes (required for Xero apps created on/after 2 March 2026):
// the old broad 'accounting.transactions' scope is rejected with invalid_scope on new apps.
// accounting.invoices covers Invoices/LinkedTransactions; accounting.payments covers Payments/BatchPayments.
const XERO_SCOPES = 'offline_access openid profile email accounting.contacts accounting.invoices accounting.settings accounting.payments';

// system_config.value is JSONB — pg returns it as an object, but older rows may be text
const { parseConfigValue } = require('./src/core/jsonConfig');

// Helper: exchange code or refresh token for access token
async function xeroGetToken(params) {
    const body = new URLSearchParams(params);
    const r = await fetch('https://identity.xero.com/connect/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString('base64'),
        },
        body: body.toString(),
    });
    if (!r.ok) throw new Error(`Xero token error ${r.status}: ${await r.text()}`);
    return r.json();
}

// Helper: get a valid access token (refresh ONLY if stale) + tenantId
// Stores expires_at so we avoid burning refresh token rotations on every call.
async function xeroGetAccessToken() {
    const cfg = await pool.query(`SELECT value FROM system_config WHERE key = 'xero_tokens'`);
    if (!cfg.rows.length) throw new Error('Xero is not connected. Please visit /api/xero/connect first.');
    let tokens = parseConfigValue(cfg.rows[0].value);

    const now = Date.now();
    const expiresAt = tokens.expires_at || 0; // unix ms
    const FIVE_MINUTES = 5 * 60 * 1000;

    let accessToken = tokens.access_token;

    // Only refresh if token is missing or within 5 minutes of expiry
    if (!accessToken || now >= expiresAt - FIVE_MINUTES) {
        if (!tokens.refresh_token) throw new Error('Xero refresh token missing. Please reconnect.');
        const resp = await xeroGetToken({
            grant_type:    'refresh_token',
            refresh_token: tokens.refresh_token,
        });
        // Merge and persist new tokens with expires_at
        tokens = {
            ...tokens,
            ...resp,
            access_token:  resp.access_token,
            refresh_token: resp.refresh_token || tokens.refresh_token, // some flows don't rotate
            expires_at:    now + ((resp.expires_in || 1800) * 1000),   // store absolute unix ms
        };
        await pool.query(
            `INSERT INTO system_config (key, value) VALUES ('xero_tokens', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [JSON.stringify(tokens)]
        );
        accessToken = tokens.access_token;
    }

    // Get tenantId Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ use cached value if stored, otherwise fetch once
    let tenantId = tokens.tenant_id;
    if (!tenantId) {
        const tenantsResp = await fetch('https://api.xero.com/connections', {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        });
        if (!tenantsResp.ok) throw new Error(`Failed to fetch Xero tenants: ${tenantsResp.status}`);
        const tenants = await tenantsResp.json();
        if (!tenants.length) throw new Error('No Xero organisations connected.');
        tenantId = tenants[0].tenantId;
        tokens.tenant_id = tenantId;
        await pool.query(
            `INSERT INTO system_config (key, value) VALUES ('xero_tokens', $1)
             ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
            [JSON.stringify(tokens)]
        );
    }

    return { accessToken, tenantId, expiresAt: tokens.expires_at };
}

// Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ 0. Xero Status Check Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
app.get('/api/xero/status', requireAuth, async (req, res) => {
    try {
        const cfg = await pool.query(`SELECT value FROM system_config WHERE key = 'xero_tokens'`);
        if (!cfg.rows.length) return res.json({ connected: false, message: 'Not connected. Visit /api/xero/connect to authorise.' });
        const tokens = parseConfigValue(cfg.rows[0].value);
        const now = Date.now();
        const expiresAt = tokens.expires_at || 0;
        const expiresIn = Math.max(0, Math.round((expiresAt - now) / 1000 / 60)); // minutes
        // If we have a recent access_token (not expired) report connected without doing a refresh
        if (tokens.access_token && expiresAt > now + 60_000) {
            return res.json({
                connected: true,
                tenant_id: tokens.tenant_id || null,
                expires_in_minutes: expiresIn,
                message: `Connected Γö£├│Γö╝├┤╬ô├ç┬ú Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ token valid for ~${expiresIn} more minutes`,
            });
        }
        // Otherwise attempt a refresh to test validity
        try {
            const resp = await xeroGetToken({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
            const newTokens = {
                ...tokens, ...resp,
                expires_at: now + ((resp.expires_in || 1800) * 1000),
            };
            await pool.query(`INSERT INTO system_config(key,value) VALUES('xero_tokens',$1) ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()`, [JSON.stringify(newTokens)]);
            res.json({
                connected: true,
                tenant_id: newTokens.tenant_id || null,
                expires_in_minutes: Math.round((resp.expires_in || 1800) / 60),
                message: 'Connected Γö£├│Γö╝├┤╬ô├ç┬ú Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ token refreshed',
            });
        } catch(e) {
            res.json({ connected: false, message: 'Token expired or revoked. Please reconnect at /api/xero/connect. Reason: ' + e.message });
        }
    } catch (err) { console.error('[GET /api/xero/status]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ 1. Initiate Xero OAuth Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
app.get('/api/xero/connect', (req, res) => {
    if (!XERO_CLIENT_ID) return res.status(500).send('<h2>XERO_CLIENT_ID is not configured in Render environment variables.</h2>');
    const state = Buffer.from(JSON.stringify({ ts: Date.now() })).toString('base64');
    const url = `https://login.xero.com/identity/connect/authorize?` + new URLSearchParams({
        response_type: 'code',
        client_id:     XERO_CLIENT_ID,
        redirect_uri:  XERO_REDIRECT_URI,
        scope:         XERO_SCOPES,
        state,
    }).toString();
    res.redirect(url);
});

// Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ 2. Xero OAuth Callback Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
app.get('/api/xero/callback', async (req, res) => {
    try {
        const { code, error } = req.query;
        if (error) return res.send(`<h2>Xero connection failed: ${error}</h2>`);
        const tokens = await xeroGetToken({
            grant_type:   'authorization_code',
            code,
            redirect_uri: XERO_REDIRECT_URI,
        });
        const tokensToStore = {
            ...tokens,
            expires_at: Date.now() + ((tokens.expires_in || 1800) * 1000), // store absolute expiry ms
        };
        await pool.query(
            `INSERT INTO system_config(key, value) VALUES('xero_tokens', $1) ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()`,
            [JSON.stringify(tokensToStore)]
        );
        res.send(`<h2 style="font-family:sans-serif;color:#00B5C8">Γö£├│Γö╝├┤╬ô├ç┬ú Xero Connected Successfully!</h2>
            <p>Your Xero account is now linked to ASIL HCM. You can close this window.</p>
            <script>setTimeout(() => window.close(), 3000);</script>`);
    } catch (err) {
        res.status(500).send(`<h2>Error: ${err.message}</h2>`);
    }
});

app.get('/api/xero/check', requireAuth, async (req, res) => {
    try {
        const cfg = await pool.query(`SELECT value FROM system_config WHERE key = 'xero_tokens'`);
        if (!cfg.rows.length) return res.json({ connected: false });
        const tokens = parseConfigValue(cfg.rows[0].value);
        const now = Date.now();
        const expiresAt = tokens.expires_at || 0;
        res.json({ connected: !!tokens.access_token, tenantId: tokens.tenant_id || null, expires_in_minutes: Math.max(0, Math.round((expiresAt - now) / 60_000)) });
    } catch (err) { console.error('[GET /api/xero/check]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/xero/chart-of-accounts', requireAuth, async (req, res) => {
    try {
        const { accessToken, tenantId } = await xeroGetAccessToken();
        const xeroResp = await fetch('https://api.xero.com/api.xro/2.0/Accounts', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Xero-Tenant-Id': tenantId,
                'Accept': 'application/json',
            },
        });
        if (!xeroResp.ok) return res.status(502).json({ error: 'Xero API error: ' + xeroResp.status });
        const data = await xeroResp.json();
        const accounts = (data.Accounts || []).map(a => ({
            code: a.Code, name: a.Name,
            type: a.Type, status: a.Status,
            description: a.Description || '',
        })).filter(a => a.status === 'ACTIVE');
        await pool.query(
            `INSERT INTO system_config (key, value) VALUES ('xero_chart_of_accounts', $1)
             ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
            [JSON.stringify(accounts)]
        ).catch(() => {});
        res.json({ ok: true, count: accounts.length, accounts });
    } catch (err) { console.error('[GET /api/xero/chart-of-accounts]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ 3c. Get cached Chart of Accounts (no Xero call needed) Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
app.get('/api/xero/chart-of-accounts/cached', requireAuth, async (req, res) => {
    try {
        const cfg = await pool.query(`SELECT value, updated_at FROM system_config WHERE key = 'xero_chart_of_accounts'`);
        if (!cfg.rows.length) return res.json({ accounts: [], cached: false, message: 'No cache yet. Call /api/xero/chart-of-accounts to sync.' });
        res.json({ accounts: cfg.rows[0].value, cached: true, last_synced: cfg.rows[0].updated_at });
    } catch (err) { console.error('[GET /api/xero/chart-of-accounts/cached]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝ 4. Push invoice to Xero Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝Γö£├│╬ô├ç┬Ñ╬ô├⌐┬╝
app.post('/api/xero/invoices', requireAuth, async (req, res) => {
    try {
        const { invoice } = req.body;
        if (!invoice) return res.status(400).json({ error: 'invoice payload required' });

        const { accessToken, tenantId } = await xeroGetAccessToken();

        // Build Xero line items from payrolls + debit notes
        const lineItems = [
            ...(invoice.payrolls || []).map(p => ({
                Description:  `Manpower Services Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ ${p.contract?.split('Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ')[1]?.trim() || p.contract} (${p.period}, ${p.employees} employees)`,
                Quantity:     1,
                UnitAmount:   p.totalPayrollCost,
                AccountCode:  '200', // default sales account Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ customise as needed
            })),
            ...(invoice.debitNotes || []).map(d => ({
                Description:  `${d.description} [Debit Note ${d.id}]`,
                Quantity:     1,
                UnitAmount:   d.total,
                AccountCode:  '200',
            })),
        ];

        // Parse due date
        let dueDateXero = null;
        if (invoice.dueDate) {
            const dp = new Date(invoice.dueDate);
            if (!isNaN(dp)) dueDateXero = `/Date(${dp.getTime()}+0000)/`;
        }

        const xeroPayload = {
            Type:          'ACCREC',
            InvoiceNumber: invoice.number,
            Reference:     invoice.poNumber || '',
            CurrencyCode:  'PKR',
            Status:        invoice.status === 'Draft' ? 'DRAFT' : 'AUTHORISED',
            Contact:       { Name: invoice.client },
            LineAmountTypes: 'Exclusive',
            LineItems:     lineItems,
            ...(dueDateXero ? { DueDate: dueDateXero } : {}),
        };

        const xeroResp = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
            method:  'POST',
            headers: {
                'Authorization':  `Bearer ${accessToken}`,
                'Xero-Tenant-Id': tenantId,
                'Content-Type':   'application/json',
                'Accept':         'application/json',
            },
            body: JSON.stringify({ Invoices: [xeroPayload] }),
        });

        const data = await xeroResp.json();
        if (!xeroResp.ok) return res.status(502).json({ error: 'Xero API error', detail: data });

        const created = data.Invoices?.[0];
        const xeroInvoiceId = created?.InvoiceID;
        const xeroUrl = xeroInvoiceId
            ? `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${xeroInvoiceId}`
            : 'https://go.xero.com/AccountsReceivable/Search.aspx';

        // Log to DB (fire and forget)
        pool.query(
            `INSERT INTO system_config(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value=$2`,
            [`xero_inv_${invoice.number}`, JSON.stringify({ xeroId: xeroInvoiceId, pushedAt: new Date().toISOString() })]
        ).catch(() => {});

        res.json({ ok: true, xeroInvoiceId, xeroUrl });
    } catch (err) {
        console.error('[Xero] push error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë
// BANKS MASTER
// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë

app.get('/api/banks', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM banks ORDER BY is_hbl DESC, name ASC');
        res.json({ banks: rows });
    } catch (err) { console.error('[GET /api/banks]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/banks', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { name, short_name, swift_code, is_hbl = false } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO banks (name, short_name, swift_code, is_hbl)
             VALUES ($1,$2,$3,$4) ON CONFLICT (name) DO UPDATE SET short_name=$2, swift_code=$3, is_hbl=$4 RETURNING *`,
            [name, short_name || null, swift_code || null, is_hbl]
        );
        res.json({ bank: rows[0] });
    } catch (err) { console.error('[POST /api/banks]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë
// AP PAYMENT QUEUE Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ Accounts Payable
// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë

// GET /api/ap/payroll-queue Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ locked payroll batches grouped by client+contract+month
app.get('/api/ap/payroll-queue', requireAuth, requireRole('ap_team','finance_manager','superadmin'), async (req, res) => {
    try {
        const { archive, config } = await cutover.resolveArchiveMode(req, pool);
        const periodFloor = cutover.applyPeriodFloor('pt.month', 'pt.year', { archive, cutoverMonth: config.cutoverMonth, cutoverYear: config.cutoverYear });
        const { rows } = await pool.query(`
            SELECT
                pt.year, pt.month,
                e.client, e.contract_name,
                COUNT(*) AS employee_count,
                SUM(pt.net) AS total_net_pay,
                SUM(pt.gross) AS total_gross,
                SUM(pt.total_invoice) AS total_invoice,
                MAX(pt.locked_at) AS locked_at,
                MAX(pt.locked_by) AS locked_by,
                (SELECT COUNT(*) FROM payment_batches pb
                 WHERE pb.year=pt.year AND pb.month=pt.month AND pb.batch_type='PAYROLL'
                 AND COALESCE(pb.client,'') = COALESCE(e.client,'') 
                 AND COALESCE(pb.contract_name,'') = COALESCE(e.contract_name,'')) AS batch_count
            FROM payroll_transactions pt
            JOIN employees e ON e.id = pt.employee_id
            WHERE pt.locked=TRUE AND ${periodFloor}
            GROUP BY pt.year, pt.month, e.client, e.contract_name
            ORDER BY pt.year DESC, pt.month DESC, e.client ASC, e.contract_name ASC
        `);
        res.json({ queue: rows });
    } catch (err) { console.error('[GET /api/ap/payroll-queue]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/ap/payroll-queue/:year/:month Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ employee details scoped by client+contract
app.get('/api/ap/payroll-queue/:year/:month', requireAuth, requireRole('ap_team','finance_manager','superadmin'), async (req, res) => {
    try {
        const { year, month } = req.params;
        const { client: filterClient, contract: filterContract } = req.query;
        let where = 'WHERE pt.year=$1 AND pt.month=$2 AND pt.locked=TRUE';
        const params = [parseInt(year), parseInt(month)];
        if (filterClient) { params.push(filterClient); where += ` AND e.client=$${params.length}`; }
        if (filterContract) { params.push(filterContract); where += ` AND e.contract_name=$${params.length}`; }
        const { rows } = await pool.query(`
            SELECT pt.*, e.name, e.bank_name, e.bank_account, e.account_title,
                   e.client, e.contract_name, e.location
            FROM payroll_transactions pt
            JOIN employees e ON e.id = pt.employee_id
            ${where}
            ORDER BY e.name ASC
        `, params);
        // Also get existing payment batch if any
        let batchQuery = 'SELECT * FROM payment_batches WHERE year=$1 AND month=$2 AND batch_type=$3';
        const batchParams = [parseInt(year), parseInt(month), 'PAYROLL'];
        if (filterClient) { batchParams.push(filterClient); batchQuery += ` AND COALESCE(client,'')=$${batchParams.length}`; }
        if (filterContract) { batchParams.push(filterContract); batchQuery += ` AND COALESCE(contract_name,'')=$${batchParams.length}`; }
        const batch = await pool.query(batchQuery, batchParams);
        res.json({ employees: rows, batch: batch.rows[0] || null });
    } catch (err) { console.error('[GET /api/ap/payroll-queue/:year/:month]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/ap/payroll-queue/:year/:month/confirm Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ AP team confirms payment + selects bank
app.post('/api/ap/payroll-queue/:year/:month/confirm', requireAuth, requireRole('ap_team','finance_manager','superadmin'), async (req, res) => {
    try {
        const { year, month } = req.params;
        const { bank_id, bank_name, payment_date, reference_no, notes, push_to_xero = false,
                client_filter, contract_filter } = req.body;
        const yr = parseInt(year), mo = parseInt(month);

        // Build locked employee scope (filtered by client+contract if provided)
        let lockedWhere = 'WHERE year=$1 AND month=$2 AND locked=TRUE';
        const lockedParams = [yr, mo];

        // Total amounts
        const totals = await pool.query(`
            SELECT SUM(pt.net) AS total_net, SUM(pt.gross) AS total_gross,
                   SUM(pt.total_invoice) AS total_invoice, COUNT(*) AS employee_count
            FROM payroll_transactions pt
            JOIN employees e ON e.id = pt.employee_id
            WHERE pt.year=$1 AND pt.month=$2 AND pt.locked=TRUE
            ${client_filter ? `AND e.client=$3` : ''}
            ${contract_filter ? `AND e.contract_name=$${client_filter ? 4 : 3}` : ''}
        `, client_filter && contract_filter ? [yr, mo, client_filter, contract_filter]
           : client_filter ? [yr, mo, client_filter]
           : contract_filter ? [yr, mo, contract_filter]
           : [yr, mo]);
        const t = totals.rows[0];

        // Create payment batch Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ scoped to client+contract if provided
        const batchId = `PB-${yr}-${String(mo).padStart(2,'0')}-${(bank_name||'').replace(/\s+/g,'').slice(0,8)}-${Date.now()}`;
        const { rows: batchRows } = await pool.query(`
            INSERT INTO payment_batches
                (id, batch_type, year, month, bank_id, bank_name, payment_date, reference_no,
                 total_amount, employee_count, notes, status, created_by, client, contract_name)
            VALUES ($1,'PAYROLL',$2,$3,$4,$5,$6,$7,$8,$9,$10,'Confirmed',$11,$12,$13)
            ON CONFLICT (batch_type, year, month, client, contract_name) DO UPDATE SET
                bank_id=$4, bank_name=$5, payment_date=$6, reference_no=$7,
                total_amount=$8, employee_count=$9, notes=$10, status='Confirmed',
                updated_at=NOW()
            RETURNING *
        `, [batchId, yr, mo, bank_id||null, bank_name||null, payment_date||null, reference_no||null,
            parseFloat(t.total_net)||0, parseInt(t.employee_count)||0, notes||null, req.user.email,
            client_filter||null, contract_filter||null]);

        // Create payment ledger entries Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ scoped to client+contract filter
        const empRows = await pool.query(`
            SELECT pt.*, e.name, e.client, e.contract_name, e.location, e.bank_name, e.bank_account
            FROM payroll_transactions pt
            JOIN employees e ON e.id=pt.employee_id
            WHERE pt.year=$1 AND pt.month=$2 AND pt.locked=TRUE
            ${client_filter ? `AND e.client=$3` : ''}
            ${contract_filter ? `AND e.contract_name=$${client_filter ? 4 : 3}` : ''}
        `, client_filter && contract_filter ? [yr, mo, client_filter, contract_filter]
           : client_filter ? [yr, mo, client_filter]
           : contract_filter ? [yr, mo, contract_filter]
           : [yr, mo]);

        const monthName = new Date(2000, mo-1, 1).toLocaleString('en-US', { month: 'short' });
        const yr2 = String(yr).slice(-2);

        // ΓöÇΓöÇ Bulk payment_ledger INSERT (replaces N+1 per-employee loop) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
        if (empRows.rows.length > 0) {
            const plBatch    = empRows.rows.map(() => batchRows[0].id);
            const plEmpIds   = empRows.rows.map(e => e.employee_id);
            const plNames    = empRows.rows.map(e => e.name);
            const plAmounts  = empRows.rows.map(e => parseFloat(e.net) || 0);
            const plRefs     = empRows.rows.map(e => `PR${monthName}${yr2}-${e.employee_id}`);
            const plBanks    = empRows.rows.map(e => e.bank_name || bank_name || '');
            const plAccts    = empRows.rows.map(e => e.bank_account || '');
            await pool.query(`
                INSERT INTO payment_ledger
                    (batch_id, employee_id, employee_name, payment_type, amount, reference,
                     bank_name, bank_account, billable, xero_account_code, status)
                SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]),
                       'SALARY', unnest($4::numeric[]), unnest($5::text[]),
                       unnest($6::text[]), unnest($7::text[]), TRUE, '200', 'Paid'
                ON CONFLICT (batch_id, employee_id) DO NOTHING
            `, [plBatch, plEmpIds, plNames, plAmounts, plRefs, plBanks, plAccts]);
        }

        await pool.query(
            `UPDATE payroll_transactions SET paid_on = COALESCE(paid_on, $3::date), status = 'Paid'
             WHERE year = $1 AND month = $2 AND locked = TRUE`,
            [yr, mo, payment_date || new Date().toISOString().slice(0, 10)]
        );

        // Optional Xero push
        let xeroResult = null;
        if (push_to_xero) {
            try {
                const { accessToken, tenantId } = await xeroGetAccessToken();
                const mLabel = new Date(2000, mo-1, 1).toLocaleString('en-PK', { month: 'long' }) + ' ' + yr;
                // Group by client for Xero invoice lines
                const byClient = {};
                empRows.rows.forEach(emp => {
                    const key = emp.client || 'Internal';
                    if (!byClient[key]) byClient[key] = { total: 0, count: 0, contract: emp.contract_name };
                    byClient[key].total += parseFloat(emp.total_invoice)||0;
                    byClient[key].count++;
                });
                // Push one Xero bill per client group
                for (const [client, data] of Object.entries(byClient)) {
                    const xeroPayload = {
                        Type: 'ACCREC',
                        InvoiceNumber: `PR-${yr}-${String(mo).padStart(2,'0')}-${client.slice(0,6).replace(/\s/g,'')}`,
                        CurrencyCode: 'PKR',
                        Status: 'AUTHORISED',
                        Contact: { Name: client },
                        LineAmountTypes: 'Exclusive',
                        LineItems: [{
                            Description: `Manpower Services \u2014 ${data.contract||client} (${mLabel}, ${data.count} employees)`,
                            Quantity: 1, UnitAmount: data.total, AccountCode: '200',
                        }],
                    };
                    await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                        body: JSON.stringify({ Invoices: [xeroPayload] }),
                    });
                }
                xeroResult = { pushed: true };
            } catch (xe) { xeroResult = { pushed: false, error: xe.message }; }
        }

        res.json({ ok: true, batch: batchRows[0], xero: xeroResult });
    } catch (err) { console.error('[POST /api/ap/payroll-queue/:year/:month/confirm]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/ap/bills-queue Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ bills pending AP confirmation
app.get('/api/ap/bills-queue', requireAuth, requireRole('ap_team','finance_manager','superadmin'), async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT b.*, pb.id AS batch_id
            FROM bills b
            LEFT JOIN payment_batches pb ON pb.source_bill_id=b.id
            WHERE b.status IN ('Approved','Pending Approval')
            ORDER BY b.created_at DESC
        `);
        res.json({ bills: rows });
    } catch (err) { console.error('[GET /api/ap/bills-queue]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/ap/bills/:id/confirm Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ AP team confirms bill payment
app.post('/api/ap/bills/:id/confirm', requireAuth, requireRole('ap_team','finance_manager','superadmin'), async (req, res) => {
    try {
        const { bank_id, bank_name, payment_date, reference_no, billable, notes, push_to_xero = false } = req.body;
        const bill = await pool.query('SELECT * FROM bills WHERE id=$1', [req.params.id]);
        if (!bill.rows.length) return res.status(404).json({ error: 'Bill not found' });
        const b = bill.rows[0];

        const batchId = `BB-${b.id}-${Date.now()}`;
        const { rows: batchRows } = await pool.query(`
            INSERT INTO payment_batches
                (id, batch_type, source_bill_id, bank_id, bank_name, payment_date, reference_no,
                 total_amount, notes, status, created_by)
            VALUES ($1,'BILL',$2,$3,$4,$5,$6,$7,$8,'Confirmed',$9)
            RETURNING *
        `, [batchId, b.id, bank_id||null, bank_name||null, payment_date||null, reference_no||null,
            parseFloat(b.total)||0, notes||null, req.user.email]);

        // Add to payment ledger
        await pool.query(`
            INSERT INTO payment_ledger
                (batch_id, employee_id, employee_name, payment_type, amount, reference,
                 bank_name, bank_account, billable, xero_account_code, status)
            VALUES ($1,NULL,$2,'BILL',$3,$4,$5,'',$6,'623','Paid')
        `, [batchId, b.vendor, parseFloat(b.total)||0, reference_no||b.id,
            bank_name||'', billable !== false]);

        // Mark bill as Posted
        await pool.query(`UPDATE bills SET status='Posted', updated_at=NOW() WHERE id=$1`, [b.id]);

        let xeroResult = null;
        if (push_to_xero) {
            try {
                const { pushXeroBillPayment } = require('./src/modules/xeroBillImport/service');
                if (b.xero_invoice_id) {
                    xeroResult = await pushXeroBillPayment(xeroGetAccessToken, b, {
                        amount: parseFloat(b.total) || 0,
                        date: payment_date || new Date().toISOString().slice(0, 10),
                        reference: reference_no || b.id,
                    });
                } else {
                    const { accessToken, tenantId } = await xeroGetAccessToken();
                    const xeroPayload = {
                        Type: 'ACCPAY',
                        Reference: reference_no || b.id,
                        CurrencyCode: 'PKR',
                        Status: 'AUTHORISED',
                        Contact: { Name: b.vendor },
                        LineAmountTypes: 'Exclusive',
                        LineItems: (b.items||[]).length > 0
                            ? b.items.map(it => ({ Description: it.desc||it.description, Quantity: it.qty||1, UnitAmount: it.unit||it.total, AccountCode: '623' }))
                            : [{ Description: b.purpose||b.bill_type||'Bill', Quantity: 1, UnitAmount: parseFloat(b.amount)||parseFloat(b.total)||0, AccountCode: '623' }],
                    };
                    const xeroResp = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                        body: JSON.stringify({ Invoices: [xeroPayload] }),
                    });
                    const xd = await xeroResp.json();
                    xeroResult = { pushed: xeroResp.ok, xeroId: xd.Invoices?.[0]?.InvoiceID };
                }
            } catch (xe) { xeroResult = { pushed: false, error: xe.message }; }
        }

        res.json({ ok: true, batch: batchRows[0], xero: xeroResult });
    } catch (err) { console.error('[POST /api/ap/bills/:id/confirm]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/payment-ledger Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ full payment ledger view
app.get('/api/payment-ledger', requireAuth, requireRole('ap_team','ar_team','finance_manager','finance_approver','superadmin'), async (req, res) => {
    try {
        const { batch_id, billable, payment_type } = req.query;
        const conds = []; const params = [];
        if (batch_id) { conds.push(`pl.batch_id=$${params.length+1}`); params.push(batch_id); }
        if (billable !== undefined) { conds.push(`pl.billable=$${params.length+1}`); params.push(billable==='true'); }
        if (payment_type) { conds.push(`pl.payment_type=$${params.length+1}`); params.push(payment_type); }
        const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT pl.*, pb.year, pb.month, pb.payment_date, pb.bank_name AS batch_bank,
                   pb.reference_no AS batch_ref, pb.batch_type
            FROM payment_ledger pl
            JOIN payment_batches pb ON pb.id=pl.batch_id
            ${where}
            ORDER BY pb.payment_date DESC, pl.created_at DESC
        `, params);
        res.json({ ledger: rows });
    } catch (err) { console.error('[GET /api/payment-ledger]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë
// AR / CLIENT INVOICES
// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë

// Helper: generate next invoice number for a given month+year
async function generateInvoiceNumber(year, month) {
    const monthAbbr = new Date(2000, parseInt(month)-1, 1).toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const yr2 = String(year).slice(-2);
    const prefix = `INV-${monthAbbr}${yr2}`;
    // Count how many invoices already exist with this prefix
    const { rows } = await pool.query(
        `SELECT COUNT(*) AS cnt FROM client_invoices WHERE invoice_number LIKE $1`,
        [`${prefix}-%`]
    );
    const seq = parseInt(rows[0].cnt) + 1;
    return `${prefix}-${String(seq).padStart(3,'0')}`;
}

// GET /api/client-invoices ΓÇö all client invoices (AR queue), enriched with client address/NTN
app.get('/api/client-invoices', requireAuth, requireRole('ar_team','finance_manager','finance_approver','finance_proposer','superadmin'), async (req, res) => {
    try {
        const { status, client } = req.query;
        const { archive, config } = await cutover.resolveArchiveMode(req, pool);
        const periodFloor = cutover.applyPeriodFloor('ci.period_month', 'ci.period_year', { archive, cutoverMonth: config.cutoverMonth, cutoverYear: config.cutoverYear });
        const conds = ['1=1', periodFloor]; const params = [];
        if (status) { params.push(status); conds.push(`ci.status=$${params.length}`); }
        if (client) { params.push(client); conds.push(`ci.client=$${params.length}`); }
        const where = 'WHERE ' + conds.join(' AND ');
        const { rows } = await pool.query(`
            SELECT ci.*,
                   cl.ntn   AS client_ntn,
                   cl.strn  AS client_strn,
                   cl.hq    AS client_hq
            FROM   client_invoices ci
            LEFT JOIN clients cl ON LOWER(cl.name) = LOWER(ci.client)
            ${where}
            ORDER BY ci.created_at DESC
        `, params);
        res.json({ invoices: rows });
    } catch (err) { console.error('[GET /api/client-invoices]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/client-invoices ΓÇö AR team raises an invoice
app.post('/api/client-invoices', requireAuth, requireRole('ar_team','finance_manager','finance_approver','finance_proposer','superadmin'), async (req, res) => {
    try {
        const { client, contract, contract_id, period_month, period_year, po_number, due_date,
                line_items, subtotal, service_charges, sales_tax, wht, grand_total,
                invoice_number, notes, region, bu } = req.body;
        const invNo = invoice_number || await generateInvoiceNumber(period_year, period_month);
        const { rows } = await pool.query(`
            INSERT INTO client_invoices
                (invoice_number, client, contract, contract_id, period_month, period_year,
                 po_number, due_date, line_items, subtotal, service_charges, sales_tax,
                 wht, grand_total, notes, region, bu, status, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'Draft',$18)
            RETURNING *
        `, [invNo, client, contract||null, contract_id ? parseInt(contract_id) : null,
            parseInt(period_month)||null, parseInt(period_year)||null,
            po_number||null, due_date||null, JSON.stringify(line_items||[]),
            parseFloat(subtotal)||0, parseFloat(service_charges)||0, parseFloat(sales_tax)||0,
            parseFloat(wht)||0, parseFloat(grand_total)||0, notes||null,
            region||null, bu||null, req.user.email]);
        res.json({ ok: true, invoice: rows[0] });
    } catch (err) { console.error('[POST /api/client-invoices]', err); res.status(500).json({ error: 'Internal server error' }); }
});


// POST /api/bills/:id/create-invoice Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ auto-create a draft client invoice from a billable bill
app.post('/api/bills/:id/create-invoice', requireAuth, requireRole('ar_team','finance_manager','finance_approver','finance_proposer','superadmin'), async (req, res) => {
    try {
        const { id } = req.params;
        const billRes = await pool.query('SELECT * FROM bills WHERE id=$1', [id]);
        if (!billRes.rows.length) return res.status(404).json({ error: 'Bill not found' });
        const b = billRes.rows[0];

        const BILLABLE_TYPES = ['Debit Note / Imprest', 'Client Procurement', 'Contractual Purchasing'];
        if (!BILLABLE_TYPES.includes(b.bill_type) || b.billable === false) {
            return res.status(400).json({ error: 'Only billable bills can generate invoices (Debit Note/Imprest, Client Procurement, Contractual Purchasing)' });
        }
        if (!b.client) {
            return res.status(400).json({ error: 'Bill must have a client assigned before creating an invoice' });
        }

        const now = new Date();
        const periodMonth = b.period_month || (now.getMonth() + 1);
        const periodYear  = b.period_year  || now.getFullYear();
        const invNo = await generateInvoiceNumber(periodYear, periodMonth);

        const items = (b.items && b.items.length > 0)
            ? b.items.map(it => ({ description: (it.desc || 'Item'), amount: parseFloat(it.total) || 0 }))
            : [{ description: (b.bill_type + ' Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ ' + (b.vendor || 'Vendor') + (b.purpose ? ' | ' + b.purpose : '')), amount: parseFloat(b.total) || 0 }];

        const subtotal = parseFloat(b.total) || 0;
        const { rows } = await pool.query(
            'INSERT INTO client_invoices (invoice_number, client, contract, period_month, period_year, line_items, subtotal, service_charges, sales_tax, wht, grand_total, notes, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,0,$8,$9,' + "'Draft'" + ',$10) RETURNING *',
            [invNo, b.client, b.contract || null, periodMonth, periodYear,
             JSON.stringify(items), subtotal, subtotal,
             'Auto-created from Bill ' + b.id + ' | Vendor: ' + (b.vendor || 'Unknown') + ' | Type: ' + (b.bill_type || 'Unknown'),
             req.user.email]
        );
        res.json({ ok: true, invoice: rows[0], invoice_number: invNo });
    } catch (err) {
        console.error('create-invoice-from-bill error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/client-invoices/:id Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ update invoice (AR can override number; Paid status = MD/FM only)
app.patch('/api/client-invoices/:id', requireAuth, requireRole('ar_team','finance_manager','finance_approver','superadmin'), async (req, res) => {
    try {
        const { invoice_number, status, po_number, due_date, notes, xero_invoice_id, xero_url } = req.body;
        const VALID_STATUSES = ['Draft','Raised','Sent','Paid','Voided'];
        if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

        const { canManuallySetPaymentStatus, recordPaymentStatusChange } = require('./src/modules/ar/paymentStatusGuard');
        if (status === 'Paid') {
            const actor = req.user?.email || '';
            const isSuper = req.user?.role === 'superadmin';
            if (!isSuper && !canManuallySetPaymentStatus(actor)) {
                return res.status(403).json({
                    error: 'Manual payment status changes are restricted to MD (shezad.mumtaz) or Finance Manager (asif.awan).',
                });
            }
        }

        const prev = await pool.query('SELECT id, invoice_number, status FROM client_invoices WHERE id=$1', [req.params.id]);
        if (!prev.rows.length) return res.status(404).json({ error: 'Invoice not found' });

        const { rows } = await pool.query(`
            UPDATE client_invoices SET
                invoice_number = COALESCE($1, invoice_number),
                status = COALESCE($2, status),
                po_number = COALESCE($3, po_number),
                due_date = COALESCE($4, due_date),
                notes = COALESCE($5, notes),
                xero_invoice_id = COALESCE($6, xero_invoice_id),
                xero_url = COALESCE($7, xero_url),
                updated_at = NOW()
            WHERE id=$8 RETURNING *
        `, [invoice_number||null, status||null, po_number||null, due_date||null,
            notes||null, xero_invoice_id||null, xero_url||null, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });

        if (status && status !== prev.rows[0].status) {
            await recordPaymentStatusChange(pool, {
                invoiceId: rows[0].id,
                invoiceNumber: rows[0].invoice_number,
                fromStatus: prev.rows[0].status,
                toStatus: status,
                changedBy: req.user?.email,
            });
        }
        res.json({ ok: true, invoice: rows[0] });
    } catch (err) { console.error('[PATCH /api/client-invoices/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/client-invoices/:id/push-xero Γö£├│╬ô├⌐┬╝╬ô├ç┬Ñ push to Xero as AR invoice
app.post('/api/client-invoices/:id/push-xero', requireAuth, requireRole('ar_team','finance_manager','superadmin'), async (req, res) => {
    try {
        const inv = await pool.query('SELECT * FROM client_invoices WHERE id=$1', [req.params.id]);
        if (!inv.rows.length) return res.status(404).json({ error: 'Invoice not found' });
        const ci = inv.rows[0];
        const { accessToken, tenantId } = await xeroGetAccessToken();
        const lineItems = (ci.line_items||[]).length > 0
            ? ci.line_items.map(li => ({ Description: li.description||li.desc, Quantity: li.qty||1, UnitAmount: li.amount||li.unit_amount||0, AccountCode: li.account_code||'200' }))
            : [{ Description: `Services \u2014 ${ci.contract||ci.client}`, Quantity: 1, UnitAmount: parseFloat(ci.grand_total)||0, AccountCode: '200' }];
        const toXeroDate = (d) => {
            const dt = d ? new Date(d) : new Date();
            return `/Date(${dt.getTime()}+0000)/`;
        };
        const invoiceDate = ci.invoice_date || ci.created_at || new Date();
        const dueDate = ci.due_date || new Date(new Date(invoiceDate).getTime() + 30 * 86400000);
        const xeroPayload = {
            Type: 'ACCREC',
            InvoiceNumber: ci.invoice_number,
            Reference: ci.po_number||'',
            CurrencyCode: 'PKR',
            Status: 'DRAFT',
            Contact: { Name: ci.client },
            LineAmountTypes: 'Exclusive',
            LineItems: lineItems,
            Date: toXeroDate(invoiceDate),
            DueDate: toXeroDate(dueDate),
        };
        const xeroResp = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ Invoices: [xeroPayload] }),
        });
        const xd = await xeroResp.json();
        if (!xeroResp.ok) return res.status(502).json({ error: 'Xero error', detail: xd });
        const xeroId = xd.Invoices?.[0]?.InvoiceID;
        const xeroUrl = xeroId ? `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${xeroId}` : null;
        // Update invoice with Xero refs
        await pool.query(`UPDATE client_invoices SET xero_invoice_id=$1, xero_url=$2, status='Raised', updated_at=NOW() WHERE id=$3`,
            [xeroId, xeroUrl, req.params.id]);
        let linked = { linked: 0 };
        try {
            const { linkBillableExpensesToXero } = require('./src/modules/xeroBillImport/billableInvoice');
            const billIds = (ci.line_items || []).map(li => li.bill_id).filter(Boolean);
            if (billIds.length && xeroId) {
                const { rows: xb } = await pool.query(
                    `SELECT xero_invoice_id FROM bills WHERE id = ANY($1::text[]) AND xero_invoice_id IS NOT NULL`,
                    [billIds]
                );
                const sourceIds = xb.map(r => r.xero_invoice_id);
                if (sourceIds.length) linked = await linkBillableExpensesToXero(xeroGetAccessToken, xeroId, sourceIds);
            }
        } catch (linkErr) {
            linked = { linked: 0, error: linkErr.message };
        }
        res.json({ ok: true, xeroId, xeroUrl, linked });
    } catch (err) { console.error('[POST /api/client-invoices/:id/push-xero]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/client-invoices/:id/void-xero', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const inv = await pool.query('SELECT * FROM client_invoices WHERE id=$1', [req.params.id]);
        if (!inv.rows.length) return res.status(404).json({ error: 'Invoice not found' });
        const ci = inv.rows[0];
        if (!ci.xero_invoice_id) return res.status(400).json({ error: 'Invoice has not been pushed to Xero' });
        const { accessToken, tenantId } = await xeroGetAccessToken();
        const xeroResp = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ Invoices: [{ InvoiceID: ci.xero_invoice_id, Status: 'VOIDED' }] }),
        });
        const xd = await xeroResp.json();
        if (!xeroResp.ok) return res.status(502).json({ error: 'Xero void error', detail: xd });
        await pool.query(`UPDATE client_invoices SET status='Void', updated_at=NOW() WHERE id=$1`, [req.params.id]);
        res.json({ ok: true, xeroId: ci.xero_invoice_id, status: xd.Invoices?.[0]?.Status || 'VOIDED' });
    } catch (err) { console.error('[POST /api/client-invoices/:id/void-xero]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Γö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ëΓö£├│╬ô├ç├│Γö¼├ë

// ╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë
// PAYROLL INV-STATUS
// ╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë╬ô├▓├ë
app.get('/api/payroll/:year/:month/invoice-status', requireAuth, async (req, res) => {
    try {
        const yr = parseInt(req.params.year), mo = parseInt(req.params.month);
        const { rows } = await pool.query(
            `SELECT LOWER(client) AS client, LOWER(contract) AS contract
             FROM client_invoices
             WHERE period_year=$1 AND period_month=$2 AND status != 'Cancelled'`,
            [yr, mo]
        );
        res.json({
            invoicedClients:   [...new Set(rows.map(r => r.client).filter(Boolean))],
            invoicedContracts: [...new Set(rows.map(r => r.contract).filter(Boolean))],
        });
    } catch (err) { console.error('[GET /api/payroll/:year/:month/invoice-status]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/payroll/:year/:month/preview-invoice
// Query params: client, contract_id, segregate_region, segregate_bu, segregate_payroll, segregate_overtime, segregate_overheads
app.get('/api/payroll/:year/:month/preview-invoice', requireAuth, async (req, res) => {
    try {
        const yr = parseInt(req.params.year), mo = parseInt(req.params.month);
        const { client, contract_id,
                segregate_region    = 'false',
                segregate_bu        = 'false',
                segregate_payroll   = 'false',
                segregate_overtime  = 'false',
                segregate_overheads = 'false' } = req.query;
        if (!client) return res.status(400).json({ error: 'client is required' });

        const byRegion    = segregate_region    === 'true';
        const byBU        = segregate_bu        === 'true';
        const byPayroll   = segregate_payroll   === 'true';
        const byOvertime  = segregate_overtime  === 'true';
        const byOverheads = segregate_overheads === 'true';

        // Pull contract for credit cycle
        let contractRow = null;
        if (contract_id) {
            const ctRes = await pool.query(
                'SELECT c.*, cl.name AS client_name FROM contracts c LEFT JOIN clients cl ON c.client_id = cl.id WHERE c.id = $1',
                [contract_id]);
            contractRow = ctRes.rows[0] || null;
        }
        const creditDays = contractRow?.financials?.credit_cycle_days || 30;

        // Fetch locked payroll with employee region + BU
        let qSql, qParams;
        if (contract_id && contractRow) {
            qSql = 'SELECT pt.*, e.name AS emp_name, e.designation AS emp_designation,' +
                   ' COALESCE(e.region, e.province, \'\') AS emp_region,' +
                   ' COALESCE(e.client_bu, \'\') AS emp_bu' +
                   ' FROM payroll_transactions pt JOIN employees e ON e.id = pt.employee_id' +
                   ' WHERE pt.year=$1 AND pt.month=$2 AND pt.locked=TRUE' +
                   ' AND LOWER(e.client)=LOWER($3) AND COALESCE(LOWER(e.contract_name),\'\')=COALESCE(LOWER($4),\'\')';
            qParams = [yr, mo, client, contractRow.contract_name];
        } else {
            qSql = 'SELECT pt.*, e.name AS emp_name, e.designation AS emp_designation,' +
                   ' COALESCE(e.region, e.province, \'\') AS emp_region,' +
                   ' COALESCE(e.client_bu, \'\') AS emp_bu' +
                   ' FROM payroll_transactions pt JOIN employees e ON e.id = pt.employee_id' +
                   ' WHERE pt.year=$1 AND pt.month=$2 AND pt.locked=TRUE' +
                   ' AND LOWER(e.client)=LOWER($3)';
            qParams = [yr, mo, client];
        }
        const { rows } = await pool.query(qSql, qParams);

        if (rows.length === 0) {
            return res.json({ found: false, message: 'No locked payroll found. Lock payroll for this period first.' });
        }

        // Helper: sum payroll row into a totals object
        const sumRow = (acc, r) => ({
            gross:           acc.gross           + (parseFloat(r.gross)           || 0),
            net:             acc.net             + (parseFloat(r.net)             || 0),
            wht:             acc.wht             + (parseFloat(r.wht)             || 0),
            eobi_ee:         acc.eobi_ee         + (parseFloat(r.eobi_ee)         || 0),
            service_charges: acc.service_charges + (parseFloat(r.service_charges) || 0),
            sales_tax:       acc.sales_tax       + (parseFloat(r.sales_tax)       || 0),
            total_invoice:   acc.total_invoice   + (parseFloat(r.total_invoice)   || 0),
            overtime:        acc.overtime        + (parseFloat(r.overtime)        || parseFloat(r.ot_amount) || 0),
            overhead:        acc.overhead        + (parseFloat(r.overhead)        || 0),
            opd_claim:       acc.opd_claim       + (parseFloat(r.opd_claim)       || 0),
            reimbursement:   acc.reimbursement   + (parseFloat(r.reimbursement)   || 0),
            arrears:         acc.arrears         + (parseFloat(r.arrears)         || 0),
        });
        const ZERO = { gross:0,net:0,wht:0,eobi_ee:0,service_charges:0,sales_tax:0,total_invoice:0,overtime:0,overhead:0,opd_claim:0,reimbursement:0,arrears:0 };

        // Build invoice groups
        // Key = region|bu ΓÇö component splits happen within the same region/bu group
        const groupMap = {};
        for (const r of rows) {
            const regionKey = byRegion ? (r.emp_region || 'No Region') : 'ALL';
            const buKey     = byBU     ? (r.emp_bu     || 'No BU')     : 'ALL';
            const dimKey    = regionKey + '||' + buKey;
            if (!groupMap[dimKey]) {
                groupMap[dimKey] = { region: regionKey, bu: buKey, rows: [] };
            }
            groupMap[dimKey].rows.push(r);
        }

        // Build final invoice_groups array
        const due = new Date(); due.setDate(due.getDate() + creditDays);
        const dueDateStr = due.toISOString().split('T')[0];
        const invoice_groups = [];

        for (const [dimKey, dim] of Object.entries(groupMap)) {
            const dimRows = dim.rows;
            const allTotals = dimRows.reduce(sumRow, { ...ZERO });

            // Component segregation splits within this dim group
            const anyComponentSplit = byPayroll || byOvertime || byOverheads;

            if (!anyComponentSplit) {
                // One invoice for the whole group
                invoice_groups.push({
                    group_key:      dimKey + '||combined',
                    label:          buildLabel(dim.region, dim.bu, 'Combined', byRegion, byBU, false),
                    region:         dim.region === 'ALL' ? null : dim.region,
                    bu:             dim.bu     === 'ALL' ? null : dim.bu,
                    component:      'combined',
                    employee_count: dimRows.length,
                    totals:         allTotals,
                    due_date:       dueDateStr,
                    credit_cycle_days: creditDays,
                });
            } else {
                // Payroll component (gross - overtime - overhead)
                if (byPayroll || !anyComponentSplit) {
                    const payT = { ...ZERO };
                    for (const r of dimRows) {
                        const g   = parseFloat(r.gross) || 0;
                        const ot  = parseFloat(r.overtime || r.ot_amount) || 0;
                        const ovh = parseFloat(r.overhead) || 0;
                        payT.gross           += Math.max(0, g - ot - ovh);
                        payT.net             += (parseFloat(r.net) || 0);
                        payT.wht             += (parseFloat(r.wht) || 0);
                        payT.eobi_ee         += (parseFloat(r.eobi_ee) || 0);
                        payT.service_charges += (parseFloat(r.service_charges) || 0) * (Math.max(0, g - ot - ovh) / (g || 1));
                        payT.sales_tax       += (parseFloat(r.sales_tax) || 0) * (Math.max(0, g - ot - ovh) / (g || 1));
                        payT.total_invoice   += (parseFloat(r.total_invoice) || 0) * (Math.max(0, g - ot - ovh) / (g || 1));
                        payT.opd_claim       += (parseFloat(r.opd_claim) || 0);
                        payT.reimbursement   += (parseFloat(r.reimbursement) || 0);
                        payT.arrears         += (parseFloat(r.arrears) || 0);
                    }
                    if (payT.gross > 0 || payT.total_invoice > 0) {
                        invoice_groups.push({
                            group_key: dimKey + '||payroll', label: buildLabel(dim.region, dim.bu, 'Payroll', byRegion, byBU, true),
                            region: dim.region === 'ALL' ? null : dim.region, bu: dim.bu === 'ALL' ? null : dim.bu,
                            component: 'payroll', employee_count: dimRows.length,
                            totals: payT, due_date: dueDateStr, credit_cycle_days: creditDays,
                        });
                    }
                }
                // Overtime component
                if (byOvertime) {
                    const otT = { ...ZERO };
                    for (const r of dimRows) {
                        otT.overtime += parseFloat(r.overtime || r.ot_amount) || 0;
                    }
                    if (otT.overtime > 0) {
                        otT.total_invoice = otT.overtime;
                        invoice_groups.push({
                            group_key: dimKey + '||overtime', label: buildLabel(dim.region, dim.bu, 'Overtime', byRegion, byBU, true),
                            region: dim.region === 'ALL' ? null : dim.region, bu: dim.bu === 'ALL' ? null : dim.bu,
                            component: 'overtime', employee_count: dimRows.filter(r => (parseFloat(r.overtime||r.ot_amount)||0)>0).length,
                            totals: otT, due_date: dueDateStr, credit_cycle_days: creditDays,
                        });
                    }
                }
                // Overheads component
                if (byOverheads) {
                    const ovhT = { ...ZERO };
                    for (const r of dimRows) {
                        ovhT.overhead += parseFloat(r.overhead) || 0;
                    }
                    if (ovhT.overhead > 0) {
                        ovhT.total_invoice = ovhT.overhead;
                        invoice_groups.push({
                            group_key: dimKey + '||overheads', label: buildLabel(dim.region, dim.bu, 'Overheads', byRegion, byBU, true),
                            region: dim.region === 'ALL' ? null : dim.region, bu: dim.bu === 'ALL' ? null : dim.bu,
                            component: 'overheads', employee_count: dimRows.length,
                            totals: ovhT, due_date: dueDateStr, credit_cycle_days: creditDays,
                        });
                    }
                }
            }
        }

        // Grand totals across all groups (no double-counting: use allTotals from rows)
        const grandTotals = rows.reduce(sumRow, { ...ZERO });

        // ΓöÇΓöÇ Auto-match active POs for this client ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
        // Load once, then match per group by BU and contract (best-fit logic)
        let clientPOs = [];
        try {
            const poQ = await pool.query(
                'SELECT id, po_number, bu_name, contract_name, po_value, po_expiry, status' +
                ' FROM purchase_orders' +
                ' WHERE LOWER(client_name)=LOWER($1) AND status=\'active\'' +
                ' ORDER BY priority ASC, created_at ASC',
                [client]
            );
            clientPOs = poQ.rows;
        } catch (_) { /* purchase_orders table may not exist yet */ }

        // Match a PO for a given bu and contract_name using cascading fallback:
        // 1. Exact BU + exact contract  2. Exact BU only  3. No BU (client-level PO)
        const matchPO = (bu, contractName) => {
            if (!clientPOs.length) return null;
            const buL  = (bu || '').toLowerCase().trim();
            const ctL  = (contractName || '').toLowerCase().trim();
            // Exact BU + contract
            let po = clientPOs.find(p =>
                p.bu_name && p.bu_name.toLowerCase().trim() === buL &&
                p.contract_name && p.contract_name.toLowerCase().trim() === ctL
            );
            // Exact BU only
            if (!po && buL) po = clientPOs.find(p =>
                p.bu_name && p.bu_name.toLowerCase().trim() === buL && !p.contract_name
            );
            // Partial BU match
if (!po && buL) po = clientPOs.find(p =>
                p.bu_name && (p.bu_name.toLowerCase().includes(buL) || buL.includes(p.bu_name.toLowerCase()))
            );
            // Client-level PO (no BU set on PO)
            if (!po) po = clientPOs.find(p => !p.bu_name || p.bu_name.trim() === '');
            return po ? { id: po.id, po_number: po.po_number, po_value: po.po_value, po_expiry: po.po_expiry } : null;
        };

        // Attach matched PO to each group
        const contractName = contractRow?.contract_name || null;
        for (const grp of invoice_groups) {
            const matched = matchPO(grp.bu, contractName);
            grp.po_number = matched?.po_number || null;
            grp.po_id     = matched?.id        || null;
            grp.po_value  = matched?.po_value  || null;
            grp.po_expiry = matched?.po_expiry || null;
        }

        // ── Already-invoiced check ─────────────────────────────────────────────
        // Only warn if there is a LIVE invoice (Raised / Sent / Paid).
        // Voided invoices do NOT block re-generation — treat as clean slate.
        // Draft invoices are also shown as a soft warning only.
        let alreadyInvoiced = null;
        try {
            const existQ = await pool.query(
                'SELECT id, invoice_number, status FROM client_invoices' +
                ' WHERE LOWER(client)=LOWER($1) AND period_year=$2 AND period_month=$3' +
                ' AND status IN (\'Raised\',\'Sent\',\'Paid\') LIMIT 1',
                [client, yr, mo]
            );
            alreadyInvoiced = existQ.rows[0] || null;
        } catch (_) {}

        res.json({
            found:            true,
            employee_count:   rows.length,
            invoice_groups,
            totals:           grandTotals,
            credit_cycle_days: creditDays,
            due_date:         dueDateStr,
            contract: contractRow ? {
                id: contractRow.id, name: contractRow.contract_name,
                location: contractRow.location, region_province: contractRow.region_province,
                credit_cycle_days: creditDays,
            } : null,
            already_invoiced: alreadyInvoiced,
            po_summary: {
                total_pos: clientPOs.length,
                matched:   invoice_groups.filter(g => g.po_number).length,
                unmatched: invoice_groups.filter(g => !g.po_number).length,
            },
        });
    } catch (err) { console.error('[GET /api/payroll/:year/:month/preview-invoice]', err); res.status(500).json({ error: 'Internal server error' }); }
});

function buildLabel(region, bu, component, showRegion, showBU, showComponent) {
    const parts = [];
    if (showRegion && region && region !== 'ALL') parts.push(region);
    if (showBU     && bu     && bu     !== 'ALL') parts.push(bu);
    if (showComponent) parts.push(component);
    return parts.length > 0 ? parts.join(' — ') : 'Combined Invoice';
}


// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// PURCHASE ORDER (PO) TRACKING
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
pool.query(`CREATE TABLE IF NOT EXISTS purchase_orders (
    id               SERIAL PRIMARY KEY,
    po_number        VARCHAR(120) NOT NULL,
    client_name      VARCHAR(200) NOT NULL,
    contract_id      INT REFERENCES contracts(id) ON DELETE SET NULL,
    contract_name    VARCHAR(200),
    bu_name          VARCHAR(200),
    po_value         NUMERIC(18,2) NOT NULL DEFAULT 0,
    po_date          DATE,
    po_expiry        DATE,
    allocation_method VARCHAR(20) DEFAULT 'fifo',
    priority         INT DEFAULT 100,
    notes            TEXT,
    status           VARCHAR(30) DEFAULT 'active',
    created_by       VARCHAR(120),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
)`).catch(e => console.warn('PO table init:', e.message));

pool.query(`ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS po_id      INT REFERENCES purchase_orders(id) ON DELETE SET NULL`)
    .catch(e => console.warn('po_id col init:', e.message));
pool.query(`ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS contract_id TEXT`)
    .catch(e => console.warn('ci_contract_id col init:', e.message));
pool.query(`
    DO $$ BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'client_invoices' AND column_name = 'contract_id'
              AND data_type IN ('integer', 'bigint', 'smallint')
        ) THEN
            ALTER TABLE client_invoices ALTER COLUMN contract_id TYPE TEXT USING contract_id::text;
        END IF;
    END $$;
`).catch(e => console.warn('ci_contract_id type fix:', e.message));
pool.query(`ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS region      TEXT`)
    .catch(e => console.warn('ci_region col init:', e.message));
pool.query(`ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS bu          TEXT`)
    .catch(e => console.warn('ci_bu col init:', e.message));


async function getPOUtilization(poIds) {
    if (!poIds || !poIds.length) return {};
    const { rows } = await pool.query(
        `SELECT po_id, COALESCE(SUM(grand_total),0) AS utilized FROM client_invoices
         WHERE po_id = ANY($1::int[]) AND status != 'Cancelled' GROUP BY po_id`, [poIds]);
    const map = {};
    rows.forEach(r => { map[r.po_id] = parseFloat(r.utilized) || 0; });
    return map;
}

app.get('/api/purchase-orders', requireAuth, async (req, res) => {
    try {
        // Self-healing: create table on first call if startup migration missed it
        await pool.query(`CREATE TABLE IF NOT EXISTS purchase_orders (
            id SERIAL PRIMARY KEY, po_number VARCHAR(120) NOT NULL,
            client_name VARCHAR(200) NOT NULL,
            contract_id INT REFERENCES contracts(id) ON DELETE SET NULL,
            contract_name VARCHAR(200), bu_name VARCHAR(200),
            po_value NUMERIC(18,2) NOT NULL DEFAULT 0,
            po_date DATE, po_expiry DATE,
            allocation_method VARCHAR(20) DEFAULT 'fifo',
            priority INT DEFAULT 100, notes TEXT,
            status VARCHAR(30) DEFAULT 'active', created_by VARCHAR(120),
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        )`).catch(() => {});
        await pool.query(`ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS po_id INT REFERENCES purchase_orders(id) ON DELETE SET NULL`).catch(() => {});
        await pool.query(`ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL`).catch(() => {});
        const { client, contract_id, status } = req.query;
        let where = 'WHERE 1=1', params = [];
        if (client)      { params.push(client);      where += ` AND LOWER(po.client_name) = LOWER($${params.length})`; }
        if (contract_id) { params.push(contract_id); where += ` AND po.contract_id = $${params.length}`; }
        if (status)      { params.push(status);      where += ` AND po.status = $${params.length}`; }
        const { rows } = await pool.query(
            `SELECT po.* FROM purchase_orders po ${where}
             ORDER BY po.client_name, po.priority ASC, po.po_date ASC NULLS LAST, po.id ASC`, params);
        const utilMap = await getPOUtilization(rows.map(r => r.id));
        const pos = rows.map(r => {
            const utilized = utilMap[r.id] || 0;
            const balance  = parseFloat(r.po_value) - utilized;
            return { ...r, utilized, balance, utilization_pct: parseFloat(r.po_value) > 0 ? Math.round(utilized/parseFloat(r.po_value)*100) : 0 };
        });
        res.json({ purchase_orders: pos, summary: {
            total_pos: pos.length,
            total_value: pos.reduce((s,p) => s + parseFloat(p.po_value), 0),
            total_utilized: pos.reduce((s,p) => s + p.utilized, 0),
            total_balance: pos.reduce((s,p) => s + p.balance, 0),
        }});
    } catch (err) { console.error('[GET /api/purchase-orders]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/purchase-orders/suggest', requireAuth, async (req, res) => {
    try {
        const { client_name, contract_id } = req.query;
        if (!client_name) return res.status(400).json({ error: 'client_name required' });
        const params = [client_name];
        let extra = '';
        if (contract_id) { params.push(contract_id); extra = ` AND contract_id = $${params.length}`; }
        const { rows } = await pool.query(
            `SELECT * FROM purchase_orders WHERE LOWER(client_name)=LOWER($1)${extra} AND status='active'
             ORDER BY priority ASC, po_date ASC NULLS LAST, id ASC`, params);
        if (!rows.length) return res.json({ suggested: null, warning: 'No active POs found.' });
        const utilMap = await getPOUtilization(rows.map(r => r.id));
        for (const po of rows) {
            const utilized = utilMap[po.id] || 0;
            const balance  = parseFloat(po.po_value) - utilized;
            if (balance > 0) return res.json({ suggested: { ...po, utilized, balance, utilization_pct: Math.round(utilized/parseFloat(po.po_value)*100) } });
        }
        res.json({ suggested: null, warning: 'All active POs for this client/contract are exhausted.' });
    } catch (err) { console.error('[GET /api/purchase-orders/suggest]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/purchase-orders', requireAuth, requireRole('ar_team','finance_manager','finance_approver','finance_proposer','superadmin'), async (req, res) => {
    try {
        const { po_number, client_name, contract_id, contract_name, bu_name, po_value, po_date, po_expiry, allocation_method, priority, notes, status } = req.body;
        if (!po_number || !client_name || !po_value) return res.status(400).json({ error: 'po_number, client_name, po_value are required' });
        const { rows } = await pool.query(
            `INSERT INTO purchase_orders (po_number,client_name,contract_id,contract_name,bu_name,po_value,po_date,po_expiry,allocation_method,priority,notes,status,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [po_number, client_name, contract_id||null, contract_name||null, bu_name||null,
             parseFloat(po_value)||0, po_date||null, po_expiry||null,
             allocation_method||'fifo', parseInt(priority)||100, notes||null, status||'active', req.user.email]);
        res.json({ ok: true, purchase_order: rows[0] });
    } catch (err) { console.error('[POST /api/purchase-orders]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/purchase-orders/:id', requireAuth, requireRole('ar_team','finance_manager','finance_approver','finance_proposer','superadmin'), async (req, res) => {
    try {
        const { po_number, client_name, contract_id, contract_name, bu_name, po_value, po_date, po_expiry, allocation_method, priority, notes, status } = req.body;
        const { rows } = await pool.query(
            `UPDATE purchase_orders SET po_number=$1,client_name=$2,contract_id=$3,contract_name=$4,bu_name=$5,
             po_value=$6,po_date=$7,po_expiry=$8,allocation_method=$9,priority=$10,notes=$11,status=$12,updated_at=NOW()
             WHERE id=$13 RETURNING *`,
            [po_number, client_name, contract_id||null, contract_name||null, bu_name||null,
             parseFloat(po_value)||0, po_date||null, po_expiry||null,
             allocation_method||'fifo', parseInt(priority)||100, notes||null, status||'active', req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'PO not found' });
        res.json({ ok: true, purchase_order: rows[0] });
    } catch (err) { console.error('[PUT /api/purchase-orders/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/purchase-orders/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM purchase_orders WHERE id=$1', [req.params.id]);
        logAudit(req, 'purchase_order_delete', 'purchase_order', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/purchase-orders/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.patch('/api/purchase-orders/:id/link-invoice', requireAuth, requireRole('ar_team','finance_manager','finance_approver','finance_proposer','superadmin'), async (req, res) => {
    try {
        const { invoice_id } = req.body;
        await pool.query('UPDATE client_invoices SET po_id=$1, updated_at=NOW() WHERE id=$2', [req.params.id, invoice_id]);
        res.json({ ok: true });
    } catch (err) { console.error('[PATCH /api/purchase-orders/:id/link-invoice]', err); res.status(500).json({ error: 'Internal server error' }); }
});
// CONTRACT BID TRACKING
// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É

app.get('/api/contracts/:id/bid-items', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM contract_bid_items WHERE contract_id=$1 ORDER BY category, name',
            [req.params.id]
        );
        res.json({ items: rows });
    } catch (err) { console.error('[GET /api/contracts/:id/bid-items]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/contracts/:id/bid-items', requireAuth, async (req, res) => {
    try {
        const { name, category, unit, bid_qty, bid_unit_price, frequency } = req.body;
        const { rows } = await pool.query(`
            INSERT INTO contract_bid_items (contract_id, name, category, unit, bid_qty, bid_unit_price, bid_total, frequency)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
        `, [req.params.id, name, category||'Consumable', unit||'unit',
            parseFloat(bid_qty)||0, parseFloat(bid_unit_price)||0,
            (parseFloat(bid_qty)||0)*(parseFloat(bid_unit_price)||0),
            frequency||'Monthly']);
        res.json({ item: rows[0] });
    } catch (err) { console.error('[POST /api/contracts/:id/bid-items]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/contracts/:id/bid-items/:itemId', requireAuth, async (req, res) => {
    try {
        const { name, category, unit, bid_qty, bid_unit_price, frequency } = req.body;
        const { rows } = await pool.query(`
            UPDATE contract_bid_items SET
                name=$1, category=$2, unit=$3, bid_qty=$4, bid_unit_price=$5,
                bid_total=$6, frequency=$7, updated_at=NOW()
            WHERE id=$8 AND contract_id=$9 RETURNING *
        `, [name, category||'Consumable', unit||'unit',
            parseFloat(bid_qty)||0, parseFloat(bid_unit_price)||0,
            (parseFloat(bid_qty)||0)*(parseFloat(bid_unit_price)||0),
            frequency||'Monthly', req.params.itemId, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ item: rows[0] });
    } catch (err) { console.error('[PUT /api/contracts/:id/bid-items/:itemId]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/contracts/:id/bid-items/:itemId', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM contract_bid_items WHERE id=$1 AND contract_id=$2', [req.params.itemId, req.params.id]);
        logAudit(req, 'bid_item_delete', 'contract_bid_item', req.params.itemId);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/contracts/:id/bid-items/:itemId]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Bid Actuals ├óΓé¼ΓÇ¥ record actual monthly spend vs budget
app.get('/api/contracts/:id/bid-actuals', requireAuth, async (req, res) => {
    try {
        const { month, year } = req.query;
        const conds = ['ba.contract_id=$1']; const params = [req.params.id];
        if (month) { conds.push(`ba.month=$${params.length+1}`); params.push(parseInt(month)); }
        if (year)  { conds.push(`ba.year=$${params.length+1}`);  params.push(parseInt(year)); }
        const { rows } = await pool.query(`
            SELECT ba.*, bi.name AS item_name, bi.category, bi.bid_unit_price, bi.bid_qty, bi.bid_total, bi.frequency
            FROM contract_bid_actuals ba
            JOIN contract_bid_items bi ON bi.id=ba.bid_item_id
            WHERE ${conds.join(' AND ')}
            ORDER BY ba.year DESC, ba.month DESC, bi.category, bi.name
        `, params);
        res.json({ actuals: rows });
    } catch (err) { console.error('[GET /api/contracts/:id/bid-actuals]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/contracts/:id/bid-actuals', requireAuth, async (req, res) => {
    try {
        const { bid_item_id, month, year, actual_qty, actual_unit_price, notes } = req.body;
        const actual_total = (parseFloat(actual_qty)||0) * (parseFloat(actual_unit_price)||0);
        const { rows } = await pool.query(`
            INSERT INTO contract_bid_actuals
                (contract_id, bid_item_id, month, year, actual_qty, actual_unit_price, actual_total, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (contract_id, bid_item_id, month, year)
            DO UPDATE SET actual_qty=$5, actual_unit_price=$6, actual_total=$7, notes=$8, updated_at=NOW()
            RETURNING *
        `, [req.params.id, bid_item_id, parseInt(month), parseInt(year),
            parseFloat(actual_qty)||0, parseFloat(actual_unit_price)||0, actual_total, notes||null]);
        res.json({ actual: rows[0] });
    } catch (err) { console.error('[POST /api/contracts/:id/bid-actuals]', err); res.status(500).json({ error: 'Internal server error' }); }
});


// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
// AUDIT LOG
// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
app.get('/api/audit-log', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { limit = 200, action, user_email } = req.query;
        let sql = 'SELECT * FROM audit_log';
        const conds = [], params = [];
        if (action) { params.push(action); conds.push(`action_type=$${params.length}`); }
        if (user_email) { params.push(user_email); conds.push(`user_email=$${params.length}`); }
        if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
        sql += ` ORDER BY created_at DESC LIMIT $${params.length+1}`;
        params.push(parseInt(limit));
        const { rows } = await pool.query(sql, params);
        res.json({ logs: rows });
    } catch (err) { console.error('[GET /api/audit-log]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
// DASHBOARD ├óΓé¼ΓÇ¥ Live KPIs (MD View)
// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
app.get('/api/dashboard/summary', requireAuth, async (req, res) => {
    try {
        const { archive, config } = await cutover.resolveArchiveMode(req, pool);
        const empVis = cutover.employeeVisibilityClause('employees', { archive });
        const invoicePeriodFloor = cutover.applyPeriodFloor('period_month', 'period_year', { archive, cutoverMonth: config.cutoverMonth, cutoverYear: config.cutoverYear });
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const curYear  = now.getFullYear();

        const [empCount, contractData, invoiceData, billData, payrollData, expiring30, expiring60, recentLogs] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS total, COUNT(DISTINCT client) AS clients, COUNT(DISTINCT contract_name) AS contracts FROM employees WHERE ${empVis}`),
            // Contracts by status
            pool.query(`SELECT status, COUNT(*) AS cnt FROM contracts GROUP BY status`),
            // Outstanding invoices
            pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total),0) AS value FROM client_invoices WHERE status NOT IN ('Paid','Void','Voided') AND ${invoicePeriodFloor}`),
            // Pending bills
            pool.query(`SELECT COUNT(*) AS pending, COALESCE(SUM(CASE WHEN status='Paid' THEN total ELSE 0 END),0) AS paid_this_month FROM bills WHERE (status NOT IN ('Paid','Rejected') OR (status='Paid' AND EXTRACT(MONTH FROM paid_at)=$1 AND EXTRACT(YEAR FROM paid_at)=$2))`, [curMonth, curYear]),
            // Payroll allocations placeholder
            Promise.resolve({ rows: [{ monthly_cost: 0, locked_count: 0 }] }),
            // Contracts expiring in 30 days
            pool.query(`SELECT contract_name, client_id, end_date FROM contracts WHERE end_date BETWEEN NOW() AND NOW() + INTERVAL '30 days' ORDER BY end_date ASC`),
            // Contracts expiring in 31-60 days
            pool.query(`SELECT contract_name, client_id, end_date FROM contracts WHERE end_date BETWEEN NOW() + INTERVAL '31 days' AND NOW() + INTERVAL '60 days' ORDER BY end_date ASC`),
            // Recent audit activity
            pool.query(`SELECT user_email, action_type, entity_type, entity_id, created_at FROM audit_log ORDER BY created_at DESC LIMIT 10`).catch(() => ({ rows: [] })),
        ]);

        let dataMonth = curMonth;
        let dataYear = curYear;
        let allocRow = await pool.query(
            `SELECT COALESCE(SUM(amount),0) AS monthly_cost, COUNT(*) AS alloc_count FROM cost_allocations WHERE period_month=$1 AND period_year=$2`,
            [dataMonth, dataYear]
        );
        let monthlyCost = parseFloat(allocRow.rows[0].monthly_cost || 0);
        let lockedCount = parseInt(allocRow.rows[0].alloc_count || 0, 10);
        if (monthlyCost === 0) {
            const latest = await pool.query(
                `SELECT period_month, period_year FROM payroll_runs ORDER BY period_year DESC, period_month DESC LIMIT 1`
            );
            if (latest.rows.length) {
                dataMonth = latest.rows[0].period_month;
                dataYear = latest.rows[0].period_year;
                allocRow = await pool.query(
                    `SELECT COALESCE(SUM(amount),0) AS monthly_cost, COUNT(*) AS alloc_count FROM cost_allocations WHERE period_month=$1 AND period_year=$2`,
                    [dataMonth, dataYear]
                );
                monthlyCost = parseFloat(allocRow.rows[0].monthly_cost || 0);
                lockedCount = parseInt(allocRow.rows[0].alloc_count || 0, 10);
            }
        }

        const { rows: byClient } = await pool.query(
            `SELECT client, COUNT(*) AS cnt FROM employees WHERE ${empVis} GROUP BY client ORDER BY cnt DESC LIMIT 8`
        );

        res.json({
            headcount: { total: parseInt(empCount.rows[0].total), clients: parseInt(empCount.rows[0].clients), contracts: parseInt(empCount.rows[0].contracts) },
            contracts: contractData.rows,
            invoices: { pending_count: parseInt(invoiceData.rows[0].cnt), pending_value: parseFloat(invoiceData.rows[0].value) },
            bills: { pending_count: parseInt(billData.rows[0].pending), paid_this_month: parseFloat(billData.rows[0].paid_this_month) },
            payroll: { monthly_cost: monthlyCost, locked_count: lockedCount, month: dataMonth, year: dataYear },
            data_period: { month: dataMonth, year: dataYear },
            archive_mode: archive,
            cutover: { month: cutover.CUTOVER_MONTH, year: cutover.CUTOVER_YEAR },
            alerts: {
                expiring_30: expiring30.rows,
                expiring_60: expiring60.rows,
            },
            top_clients: byClient,
            recent_activity: recentLogs.rows,
        });
    } catch (err) { console.error('[GET /api/dashboard/summary]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
// LEAVE MANAGEMENT
// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É

// Get leave history for an employee
app.get('/api/employees/:id/leaves', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_leaves WHERE employee_id=$1 ORDER BY from_date DESC', [req.params.id]);
        res.json({ leaves: rows });
    } catch (err) { console.error('[GET /api/employees/:id/leaves]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Apply for leave (HR applies on behalf of employee)
// Resolve the CL/ML/EL entitlement for one leave_type on an employee's contract
// (contract override from contract_leave_policies, else the Pakistan government
// default — see backend/src/modules/leave/service.js).
async function entitlementForEmployeeLeave(employeeId, leaveType) {
    const { rows } = await pool.query('SELECT contract_id FROM employees WHERE id = $1', [employeeId]);
    const policy = await getLeavePolicy(pool, rows[0]?.contract_id || null);
    const key = String(leaveType || '').toLowerCase();
    return policy[key] != null ? policy[key] : 5;
}

app.post('/api/employees/:id/leaves', requireAuth, async (req, res) => {
    try {
        const { leave_type, from_date, to_date, reason, status = 'Pending' } = req.body;
        if (!leave_type || !from_date || !to_date) return res.status(400).json({ error: 'leave_type, from_date, to_date required' });
        const from = new Date(from_date), to = new Date(to_date);
        const days = Math.max(1, Math.ceil((to - from) / (1000*60*60*24)) + 1);
        const { rows } = await pool.query(
            `INSERT INTO employee_leaves (employee_id, leave_type, from_date, to_date, days, reason, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [req.params.id, leave_type, from_date, to_date, days, reason||null, status, req.user.email]
        );
        // Auto-update balance if approved
        if (status === 'Approved') {
            const yr = from.getFullYear();
            const entitled = await entitlementForEmployeeLeave(req.params.id, leave_type);
            await pool.query(`
                INSERT INTO employee_leave_balances (employee_id, year, leave_type, entitled, used)
                VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (employee_id, year, leave_type)
                DO UPDATE SET used = employee_leave_balances.used + $5
            `, [req.params.id, yr, leave_type, entitled, days]);
        }
        res.json({ leave: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/leaves]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Approve / Reject leave
app.patch('/api/employees/:id/leaves/:leaveId', requireAuth, requireRole('operations','superadmin','finance_manager'), async (req, res) => {
    try {
        const { status, reason } = req.body; // status: Approved | Rejected
        if (!['Approved','Rejected'].includes(status)) return res.status(400).json({ error: 'status must be Approved or Rejected' });
        const { rows } = await pool.query(
            `UPDATE employee_leaves SET status=$1, approved_by=$2, approved_at=NOW(), reason=COALESCE($3,reason)
             WHERE id=$4 AND employee_id=$5 RETURNING *`,
            [status, req.user.email, reason||null, req.params.leaveId, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Leave record not found' });
        const lv = rows[0];
        if (status === 'Approved') {
            const yr = new Date(lv.from_date).getFullYear();
            const entitled = await entitlementForEmployeeLeave(req.params.id, lv.leave_type);
            await pool.query(`
                INSERT INTO employee_leave_balances (employee_id, year, leave_type, entitled, used)
                VALUES ($1,$2,$3,$4,$5)
                ON CONFLICT (employee_id, year, leave_type)
                DO UPDATE SET used = employee_leave_balances.used + EXCLUDED.used
            `, [req.params.id, yr, lv.leave_type, entitled, parseFloat(lv.days)||1]);
        }
        res.json({ leave: lv });
    } catch (err) { console.error('[PATCH /api/employees/:id/leaves/:leaveId]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Get leave balance for employee for a year
// Entitlement = contract_leave_policies override for the employee's contract,
// else the CL=10/ML=8/EL=14 Pakistan government default (see leave module service).
app.get('/api/employees/:id/leave-balance/:year', requireAuth, async (req, res) => {
    try {
        const yr = parseInt(req.params.year);
        const { rows: empRows } = await pool.query('SELECT contract_id FROM employees WHERE id = $1', [req.params.id]);
        const policy = await getLeavePolicy(pool, empRows[0]?.contract_id || null);
        const leaveTypes = ['CL', 'EL', 'ML'];
        const entitlements = { CL: policy.cl, EL: policy.el, ML: policy.ml };
        const results = {};
        for (const lt of leaveTypes) {
            const { rows } = await pool.query(
                `INSERT INTO employee_leave_balances (employee_id, year, leave_type, entitled, used)
                 VALUES ($1,$2,$3,$4,0)
                 ON CONFLICT (employee_id, year, leave_type) DO UPDATE SET entitled=EXCLUDED.entitled
                 RETURNING *`,
                [req.params.id, yr, lt, entitlements[lt]]
            );
            results[lt] = rows[0];
        }
        res.json({ balances: results, year: yr });
    } catch (err) { console.error('[GET /api/employees/:id/leave-balance/:year]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
// BILLS EXPORT (CSV + GST Summary)
// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
app.get('/api/bills/export', requireAuth, requireRole('finance_manager','finance_approver','superadmin'), async (req, res) => {
    try {
        const { month, year, client, status, type = 'csv' } = req.query;
        let sql = 'SELECT * FROM bills WHERE 1=1';
        const params = [];
        if (month && year) {
            params.push(parseInt(month)); sql += ` AND period_month=$${params.length}`;
            params.push(parseInt(year));  sql += ` AND period_year=$${params.length}`;
        }
        if (client) { params.push(client); sql += ` AND client=$${params.length}`; }
        if (status) { params.push(status); sql += ` AND status=$${params.length}`; }
        sql += ' ORDER BY created_at DESC';
        const { rows } = await pool.query(sql, params);

        if (type === 'gst') {
            // GST Summary by client
            const summary = {};
            rows.forEach(b => {
                const k = b.client || 'Internal';
                if (!summary[k]) summary[k] = { client: k, bills_count: 0, subtotal: 0, gst: 0, total: 0 };
                summary[k].bills_count++;
                summary[k].subtotal += parseFloat(b.amount)||0;
                summary[k].gst += parseFloat(b.gst)||0;
                summary[k].total += parseFloat(b.total)||0;
            });
            const gstRows = Object.values(summary);
            const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const hdrs = ['Client','Bills Count','Subtotal','GST Amount','Total'];
            const csv = [hdrs.map(esc).join(','), ...gstRows.map(r =>
                [esc(r.client), esc(r.bills_count), esc(r.subtotal.toFixed(2)), esc(r.gst.toFixed(2)), esc(r.total.toFixed(2))].join(',')
            )].join('\r\n');
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="GST_Summary_${year||'all'}_${month||'all'}.csv"`);
            return res.send('\uFEFF' + csv);
        }

        // Full bills CSV
        const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csvRows = rows.map(b => ({
            'Bill ID': b.id, 'Type': b.bill_type || b.type, 'Date': b.date, 'Vendor': b.vendor,
            'Client': b.client||'', 'Contract': b.contract||'', 'Purpose': b.purpose||'',
            'Amount': parseFloat(b.amount)||0, 'GST': parseFloat(b.gst)||0, 'Total': parseFloat(b.total)||0,
            'Billable': b.billable ? 'Yes' : 'No', 'Status': b.status,
            'Invoice No': b.invoice_no||'', 'Period': b.period_month ? `${b.period_month}/${b.period_year}` : '',
            'Created By': b.created_by||'', 'Created At': b.created_at ? new Date(b.created_at).toISOString().slice(0,10) : '',
        }));
        const hdrs = Object.keys(csvRows[0] || {});
        const csv = [hdrs.map(esc).join(','), ...csvRows.map(r => hdrs.map(h => esc(r[h])).join(','))].join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="Bills_${year||'all'}_${month||'all'}.csv"`);
        res.send('\uFEFF' + csv);
    } catch (err) { console.error('[GET /api/bills/export]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
// FINANCE MANAGER TWO-STEP AP APPROVAL
// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
// FM approves a payment batch AFTER AP team confirms it
app.patch('/api/ap/batches/:batchId/fm-approve', requireAuth, requireRole('finance_manager','superadmin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE payment_batches SET status='FM Approved', fm_approved_by=$1, fm_approved_at=NOW(), updated_at=NOW()
             WHERE id=$2 AND status='Confirmed' RETURNING *`,
            [req.user.email, req.params.batchId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Batch not found or not in Confirmed state' });
        logAudit(req, 'ap_batch_fm_approve', 'payment_batch', req.params.batchId);
        res.json({ ok: true, batch: rows[0] });
    } catch (err) { console.error('[PATCH /api/ap/batches/:batchId/fm-approve]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Get all batches pending FM approval
app.get('/api/ap/pending-fm-approval', requireAuth, requireRole('finance_manager','superadmin'), async (req, res) => {
    try {
        const { archive, config } = await cutover.resolveArchiveMode(req, pool);
        const periodFloor = cutover.applyPeriodFloor('month', 'year', { archive, cutoverMonth: config.cutoverMonth, cutoverYear: config.cutoverYear });
        const { rows } = await pool.query(
            `SELECT * FROM payment_batches WHERE status='Confirmed' AND ${periodFloor} ORDER BY created_at DESC`);
        res.json({ batches: rows });
    } catch (err) { console.error('[GET /api/ap/pending-fm-approval]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
// INVENTORY ├óΓÇáΓÇ¥ BILLS LINKAGE
// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
app.post('/api/bills/:id/add-to-inventory', requireAuth, requireRole('procurement_manager','procurement_approver','superadmin'), async (req, res) => {
    try {
        const { rows: billRows } = await pool.query('SELECT * FROM bills WHERE id=$1', [req.params.id]);
        if (!billRows.length) return res.status(404).json({ error: 'Bill not found' });
        const bill = billRows[0];
        const items = bill.items || [];
        const created = [];
        for (const item of items) {
            const desc = item.description || item.desc || item.item || 'Item';
            const qty = parseInt(item.qty || item.quantity || 1);
            const cost = parseFloat(item.unit_price || item.price || (item.total / (item.qty||1)) || 0);
            const { rows } = await pool.query(
                `INSERT INTO inventory (name, category, location, supplier, cost, quantity, status, bill_id, notes, added_by)
                 VALUES ($1,'Procurement',$2,$3,$4,$5,'Active',$6,$7,$8) RETURNING id`,
                [desc, bill.site||bill.contract||'', bill.vendor||'', cost, qty, bill.id,
                 `From Bill ${bill.id} ├óΓé¼ΓÇ¥ ${bill.purpose||''}`.trim(), req.user.email]
            ).catch(async () => {
                // If inventory table doesn't have bill_id, add it
                await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS bill_id TEXT`).catch(()=>{});
                await pool.query(`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS added_by TEXT`).catch(()=>{});
                return pool.query(
                    `INSERT INTO inventory (name, category, quantity, status, notes, added_by)
                     VALUES ($1,'Procurement',$2,'Active',$3,$4) RETURNING id`,
                    [desc, qty, `Bill ${bill.id}: ${desc}`, req.user.email]
                );
            });
            created.push({ desc, qty, id: rows[0]?.id });
        }
        res.json({ ok: true, added: created.length, items: created });
    } catch (err) { console.error('[POST /api/bills/:id/add-to-inventory]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
// DOCUMENT VERSION HISTORY
// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
app.post('/api/employees/:id/document-history', requireAuth, async (req, res) => {
    try {
        const { doc_type, action = 'Generated', notes } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO document_history (employee_id, doc_type, action, generated_by, notes)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [req.params.id, doc_type, action, req.user.email, notes||null]
        );
        res.json({ entry: rows[0] });
    } catch (err) { console.error('[POST /api/employees/:id/document-history]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/employees/:id/document-history', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM document_history WHERE employee_id=$1 ORDER BY generated_at DESC',
            [req.params.id]);
        res.json({ history: rows });
    } catch (err) { console.error('[GET /api/employees/:id/document-history]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
// SYSTEM CONFIG HISTORY (Tax Slab Versioning)
// ├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É├óΓÇó┬É
app.get('/api/config/:key/history', requireAuth, requireRole('superadmin','finance_manager'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM system_config_history WHERE config_key=$1 ORDER BY changed_at DESC LIMIT 50`,
            [req.params.key]);
        res.json({ history: rows });
    } catch (err) { console.error('[GET /api/config/:key/history]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// Override PUT /api/config/:key to also log history
app.put('/api/config/:key', requireAuth, requireRole('superadmin','finance_manager','finance_approver'), async (req, res) => {
    try {
        const { value } = req.body;
        // Get old value first
        const old = await pool.query('SELECT value FROM system_config WHERE key=$1', [req.params.key]);
        const oldVal = old.rows[0]?.value;
        // Update
        const { rows } = await pool.query(
            `INSERT INTO system_config (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW() RETURNING *`,
            [req.params.key, JSON.stringify(value)]
        );
        // Log history if value changed
        if (oldVal && JSON.stringify(oldVal) !== JSON.stringify(value)) {
            await pool.query(
                `INSERT INTO system_config_history (config_key, old_value, new_value, changed_by) VALUES ($1,$2,$3,$4)`,
                [req.params.key, oldVal, JSON.stringify(value), req.user.email]
            ).catch(() => {});
        }
        res.json({ config: rows[0] });
    } catch (err) { console.error('[PUT /api/config/:key]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ─── Force-run migrations (superadmin only) ─────────────────────────────────
app.post('/api/run-migrations', requireAuth, async (req, res) => {
    if (!['superadmin','admin'].includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    const done = []; const errs = [];
    const run = async (label, sql) => { try { await pool.query(sql); done.push(label); } catch (e) { errs.push(label + ': ' + e.message); } };
    // No FK constraints in standalone migration — avoids ordering issues
    await run('purchase_orders', `CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY, po_number VARCHAR(120) NOT NULL, client_name VARCHAR(200) NOT NULL,
        contract_id INT, contract_name VARCHAR(200),
        bu_name VARCHAR(200), po_value NUMERIC(18,2) NOT NULL DEFAULT 0, po_date DATE, po_expiry DATE,
        allocation_method VARCHAR(20) DEFAULT 'fifo', priority INT DEFAULT 100, notes TEXT,
        status VARCHAR(30) DEFAULT 'active', created_by VARCHAR(120),
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await run('ci_po_id', `ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS po_id INT`);
    await run('ci_contract_id', `ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS contract_id TEXT`);
    res.json({ done, errs });
});

// ─── Fix stale medical premiums directly in DB (superadmin) ─────────────────
// Zeroes out medical_sp/ch1/ch2 in payroll_transactions for any employee
// who has no spouse_name / child1_name / child2_name in the employee master.
app.all('/api/fix-medical-premiums', async (req, res) => {
    // Secret key protects this — no session needed
    const key = req.query.key || req.body?.key;
    if (key !== 'asil-med-fix-2026') return res.status(403).json({ error: 'Invalid key' });
    try {
        // NOTE: treat '0' (string zero from bad CSV import) same as NULL/empty
        const NO_FAMILY = `IS NULL OR TRIM(x) = '' OR TRIM(x) = '0'`;
        const noFamily = col => `(${col} IS NULL OR TRIM(${col}) = '' OR TRIM(${col}) = '0')`;
        const staleRes = await pool.query(`
            SELECT e.id, e.name, e.cnic, pt.year, pt.month,
                   pt.medical_sp, pt.medical_ch1, pt.medical_ch2,
                   e.spouse_name, e.child1_name, e.child2_name
            FROM payroll_transactions pt
            JOIN employees e ON e.id = pt.employee_id
            WHERE (
                (pt.medical_sp  > 0 AND ${noFamily('e.spouse_name')} )
             OR (pt.medical_ch1 > 0 AND ${noFamily('e.child1_name')} )
             OR (pt.medical_ch2 > 0 AND ${noFamily('e.child2_name')} )
            )
            ORDER BY e.name, pt.year, pt.month
        `);
        const affected = staleRes.rows;
        const fixRes = await pool.query(`
            UPDATE payroll_transactions pt
            SET
                medical_sp  = CASE WHEN ${noFamily('e.spouse_name')}  THEN 0 ELSE pt.medical_sp  END,
                medical_ch1 = CASE WHEN ${noFamily('e.child1_name')}  THEN 0 ELSE pt.medical_ch1 END,
                medical_ch2 = CASE WHEN ${noFamily('e.child2_name')}  THEN 0 ELSE pt.medical_ch2 END
            FROM employees e
            WHERE pt.employee_id = e.id
              AND (
                  (pt.medical_sp  > 0 AND ${noFamily('e.spouse_name')} )
               OR (pt.medical_ch1 > 0 AND ${noFamily('e.child1_name')} )
               OR (pt.medical_ch2 > 0 AND ${noFamily('e.child2_name')} )
              )
        `);
        console.log(`fix-medical-premiums: fixed ${fixRes.rowCount} rows`);
        res.json({ fixed: fixRes.rowCount, stale_before_fix: affected });
    } catch (e) {
        console.error('[POST /api/run-migrations]', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ─── Diagnostic: check employee family + medical DB values ──────────────────
app.get('/api/diag-employee-medical', async (req, res) => {
    const key = req.query.key;
    if (key !== 'asil-med-fix-2026') return res.status(403).json({ error: 'Invalid key' });
    const name = req.query.name || 'mehrim';
    try {
        const empRes = await pool.query(`
            SELECT *
            FROM employees
            WHERE LOWER(name) LIKE LOWER($1)
            LIMIT 10
        `, [`%${name}%`]);

        const results = [];
        for (const emp of empRes.rows) {
            const ptRes = await pool.query(`
                SELECT year, month, paid_days, gross, net,
                       medical_ee, medical_sp, medical_ch1, medical_ch2, locked
                FROM payroll_transactions
                WHERE employee_id = $1
                ORDER BY year DESC, month DESC LIMIT 6
            `, [emp.id]);

            const components = {
                salary: emp.salary,
                basic: emp.basic,
                hra: emp.hra,
                conveyance: emp.conveyance,
                medical_allowance: emp.medical_allowance,
                other_allowances: emp.other_allowances,
                components_sum: [emp.basic, emp.hra, emp.conveyance, emp.medical_allowance, emp.other_allowances]
                    .reduce((a, b) => a + (parseFloat(b) || 0), 0)
            };
            results.push({
                id: emp.id, name: emp.name,
                employee_master: emp,   // full row — shows all actual columns
                payroll_rows: ptRes.rows
            });
        }
        res.json(results);
    } catch (e) {
        console.error('[GET /api/diag-employee-medical]', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// One-time migration endpoint — SuperAdmin only, requires POST
app.post('/api/migrate/asil-migrate-2026-x9k7', requireAuth, requireRole('superadmin'), async (req, res) => {
    const done = [], errs = [];
    const run = async (label, sql, params=[]) => {
        try { await pool.query(sql, params); done.push(label); }
        catch (e) { errs.push(label + ': ' + e.message); }
    };
    // No FK constraints — avoids ordering/type issues in standalone migration
    await run('purchase_orders', `CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY, po_number VARCHAR(120) NOT NULL, client_name VARCHAR(200) NOT NULL,
        contract_id INT, contract_name VARCHAR(200),
        bu_name VARCHAR(200), po_value NUMERIC(18,2) NOT NULL DEFAULT 0, po_date DATE, po_expiry DATE,
        allocation_method VARCHAR(20) DEFAULT 'fifo', priority INT DEFAULT 100, notes TEXT,
        status VARCHAR(30) DEFAULT 'active', created_by VARCHAR(120),
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await run('ci_po_id', `ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS po_id INT`);
    await run('ci_contract_id', `ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS contract_id TEXT`);

    // Seed DUMMY1 PO using first client in DB
    try {
        const existing = await pool.query(`SELECT id FROM purchase_orders WHERE po_number='DUMMY1' LIMIT 1`);
        if (existing.rows.length === 0) {
            const firstClient = await pool.query(`SELECT name FROM clients ORDER BY id ASC LIMIT 1`);
            const clientName = firstClient.rows[0]?.name || 'ASIL Test Client';
            await pool.query(
                `INSERT INTO purchase_orders (po_number, client_name, po_value, notes, status, created_by)
                 VALUES ('DUMMY1', $1, 9999999, 'DUMMY PO – delete or edit with real PO details', 'active', 'system.seed')`,
                [clientName]
            );
            done.push(`dummy_po_DUMMY1 seeded (client: ${clientName})`);
        } else {
            done.push('dummy_po_DUMMY1: already exists');
        }
    } catch (e) { errs.push('dummy_po: ' + e.message); }

    // Seed DUMMY1 invoice
    try {
        const existInv = await pool.query('SELECT id FROM client_invoices WHERE invoice_number=$1 LIMIT 1', ['DUMMY1']);
        if (existInv.rows.length === 0) {
            const firstClient = await pool.query('SELECT name FROM clients ORDER BY id ASC LIMIT 1');
            const clientName = firstClient.rows[0] ? firstClient.rows[0].name : 'ASIL Test Client';
            const payrollQ = await pool.query(
                'SELECT COALESCE(SUM(total_invoice),0) AS total, MAX(year) AS yr, MAX(month) AS mo' +
                ' FROM payroll_transactions WHERE locked=TRUE AND employee_id IN' +
                ' (SELECT id FROM employees WHERE LOWER(client)=LOWER($1))',
                [clientName]
            );
            const pt = payrollQ.rows[0] || {};
            const total = parseFloat(pt.total) || 0;
            const yr = parseInt(pt.yr) || new Date().getFullYear();
            const mo = parseInt(pt.mo) || (new Date().getMonth() + 1);
            const due = new Date(); due.setDate(due.getDate() + 30);
            const dueStr = due.toISOString().split('T')[0];
            await pool.query(
                'INSERT INTO client_invoices' +
                ' (invoice_number, client, period_year, period_month, total_amount, status, due_date, notes, created_by)' +
                " VALUES ('DUMMY1', \, \, \, \, 'Draft', \, 'DUMMY INVOICE - delete or replace', 'system.seed')",
                [clientName, yr, mo, total, dueStr]
            );
            done.push('dummy_invoice_DUMMY1 seeded (client: ' + clientName + ')');
        } else { done.push('dummy_invoice_DUMMY1: already exists'); }
    } catch (e) { errs.push('dummy_invoice: ' + e.message); }

    res.json({ done, errs, timestamp: new Date().toISOString() });
});

// Graceful shutdown — drain DB pool cleanly on Render deploy/restart


// ──────────────────────────────────────────────────────────────────────────────
// ATTENDANCE MANAGEMENT ROUTES
// ──────────────────────────────────────────────────────────────────────────────
// ─── ATTENDANCE ROUTES ─────────────────────────────────────────────────────────
// Append this file to server.js via the loader pattern OR inline it directly.
// Tables needed (auto-created on first run):
//   supervisor_teams   — supervisor_email → list of employee_ids at a site
//   attendance_records — one row per employee per date

// ── Table setup (idempotent) ──────────────────────────────────────────────────
async function setupAttendanceTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS supervisor_teams (
            id              SERIAL PRIMARY KEY,
            supervisor_email TEXT NOT NULL,
            employee_id      TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            site             TEXT,
            client           TEXT,
            contract_id      TEXT,
            active           BOOLEAN DEFAULT TRUE,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(supervisor_email, employee_id)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS attendance_records (
            id          SERIAL PRIMARY KEY,
            employee_id TEXT NOT NULL,
            date        DATE NOT NULL,
            status      TEXT NOT NULL CHECK (status IN ('present','absent','unexcused','half_day','leave','ot')),
            marked_by   TEXT NOT NULL,
            remarks     TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(employee_id, date)
        )
    `);
    // Indexes for fast lookups
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_att_emp_date ON attendance_records(employee_id, date)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_att_marked_by ON attendance_records(marked_by, date)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_att_date ON attendance_records(date)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sup_team_email ON supervisor_teams(supervisor_email) WHERE active=true`).catch(() => {});
    console.log('Attendance tables: OK');
}
setupAttendanceTables().catch(e => console.warn('Attendance table setup warning:', e.message));

// ── GET /api/attendance/my-team — supervisor's assigned team ─────────────────
app.get('/api/attendance/my-team', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT st.employee_id, st.site, st.client, st.contract_id,
                   e.name, e.designation, e.location, e.client AS emp_client
            FROM supervisor_teams st
            JOIN employees e ON e.id = st.employee_id
            WHERE st.supervisor_email = $1 AND st.active = true
            ORDER BY e.name
        `, [req.user.email]);
        res.json({ team: rows });
    } catch (err) { console.error('[GET /api/attendance/my-team]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── GET /api/attendance/today — today's records for supervisor's team ─────────
app.get('/api/attendance/today', requireAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const { rows } = await pool.query(`
            SELECT ar.employee_id, ar.status, ar.remarks, ar.updated_at
            FROM attendance_records ar
            JOIN supervisor_teams st ON st.employee_id = ar.employee_id
            WHERE st.supervisor_email = $1 AND ar.date = $2 AND st.active = true
        `, [req.user.email, today]);
        const map = {};
        rows.forEach(r => { map[r.employee_id] = { status: r.status, remarks: r.remarks }; });
        res.json({ date: today, attendance: map });
    } catch (err) { console.error('[GET /api/attendance/today]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── POST /api/attendance/mark — submit/update daily attendance (bulk) ─────────
app.post('/api/attendance/mark', requireAuth, async (req, res) => {
    const { date, records } = req.body; // records: [{ employee_id, status, remarks }]
    if (!date || !records?.length) return res.status(400).json({ error: 'date and records are required' });

    // Only allow today or yesterday (prevent retroactive falsification)
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (date !== today && date !== yesterday) {
        return res.status(403).json({ error: 'Attendance can only be marked for today or yesterday.' });
    }

    // Verify supervisor owns these employees
    const { rows: teamRows } = await pool.query(
        `SELECT employee_id FROM supervisor_teams WHERE supervisor_email=$1 AND active=true`,
        [req.user.email]
    );
    const teamIds = new Set(teamRows.map(r => r.employee_id));
    const invalid = records.filter(r => !teamIds.has(r.employee_id));
    if (invalid.length) return res.status(403).json({ error: 'One or more employees not in your team.' });

    try {
        const { rows: teamMeta } = await pool.query(`
            SELECT st.employee_id, st.site, e.dept, e.location, e.primary_contact
            FROM supervisor_teams st
            JOIN employees e ON e.id = st.employee_id
            WHERE st.supervisor_email=$1 AND st.active=true
        `, [req.user.email]);
        const metaMap = Object.fromEntries(teamMeta.map(r => [r.employee_id, r]));

        const empIds   = records.map(r => r.employee_id);
        const statuses = records.map(r => r.status);
        const remarks  = records.map(r => r.remarks || null);
        const dates    = records.map(() => date);
        const markers  = records.map(() => req.user.email);
        const sites    = records.map(r => metaMap[r.employee_id]?.site || metaMap[r.employee_id]?.location || null);
        const depts    = records.map(r => metaMap[r.employee_id]?.dept || null);

        await pool.query(`
            INSERT INTO attendance_records (employee_id, date, status, marked_by, remarks, site, dept, updated_at)
            SELECT unnest($1::text[]), unnest($2::date[]), unnest($3::text[]),
                   unnest($4::text[]), unnest($5::text[]), unnest($6::text[]), unnest($7::text[]), NOW()
            ON CONFLICT (employee_id, date)
            DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks,
                          marked_by=EXCLUDED.marked_by, site=EXCLUDED.site, dept=EXCLUDED.dept, updated_at=NOW()
        `, [empIds, dates, statuses, markers, remarks, sites, depts]);

        for (const r of records) {
            if (r.status === 'unexcused') {
                const phone = metaMap[r.employee_id]?.primary_contact;
                if (phone) {
                    sendJazzSMS(phone, phase2.UNEXCUSED_SMS).catch(err => console.error('[unexcused-sms]', err));
                    try {
                        await pool.query(
                            `INSERT INTO employee_messages (employee_id, channel, direction, body, sent_by) VALUES ($1,'sms','out',$2,$3)`,
                            [r.employee_id, phase2.UNEXCUSED_SMS, req.user.email]
                        );
                    } catch (_) {}
                }
            }
        }

        res.json({ ok: true, saved: records.length, date });
    } catch (err) {
        console.error('[POST /api/attendance/mark]', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// ── GET /api/attendance/report/monthly — monthly summary for HR/Finance ───────
app.get('/api/attendance/report/monthly', requireAuth, requireRole('hr_manager','finance_manager','finance_approver','superadmin','admin'), async (req, res) => {
    const { month, year, client, site } = req.query;
    const mo = parseInt(month) || new Date().getMonth() + 1;
    const yr = parseInt(year)  || new Date().getFullYear();

    try {
        // Working days in the month (Mon-Fri, simplified — future: exclude public holidays)
        const daysInMonth = new Date(yr, mo, 0).getDate();
        const workingDays = Array.from({ length: daysInMonth }, (_, i) => {
            const d = new Date(yr, mo - 1, i + 1);
            return d.getDay() !== 0 && d.getDay() !== 6; // Exclude Sun/Sat
        }).filter(Boolean).length;

        let q = `
            SELECT
                e.id AS employee_id, e.name, e.location AS site, e.client,
                e.designation, e.salary,
                COUNT(*) FILTER (WHERE ar.status = 'present') AS present,
                COUNT(*) FILTER (WHERE ar.status = 'absent')  AS absent,
                COUNT(*) FILTER (WHERE ar.status = 'unexcused') AS unexcused,
                COUNT(*) FILTER (WHERE ar.status = 'half_day') AS half_day,
                COUNT(*) FILTER (WHERE ar.status = 'leave')   AS on_leave,
                COUNT(*) FILTER (WHERE ar.status = 'ot')      AS overtime,
                COUNT(ar.id)                                   AS total_marked
            FROM employees e
            LEFT JOIN attendance_records ar
                ON ar.employee_id = e.id
                AND EXTRACT(MONTH FROM ar.date) = $1
                AND EXTRACT(YEAR  FROM ar.date) = $2
            WHERE e.active = 'Yes'
        `;
        const params = [mo, yr];
        if (client && client !== 'All') { params.push(client); q += ` AND e.client = $${params.length}`; }
        if (site   && site   !== 'All') { params.push(site);   q += ` AND e.location = $${params.length}`; }
        q += ' GROUP BY e.id, e.name, e.location, e.client, e.designation, e.salary ORDER BY e.name';

        const { rows } = await pool.query(q, params);

        // Compute attendance % and salary deduction
        const summary = rows.map(r => {
            const pres     = parseInt(r.present)   || 0;
            const abs      = parseInt(r.absent)    || 0;
            const unexc    = parseInt(r.unexcused) || 0;
            const half     = parseInt(r.half_day)  || 0;
            const leave    = parseInt(r.on_leave)  || 0;
            const effPres  = pres + (half * 0.5); // half-day counts as 0.5
            const pct      = workingDays > 0 ? Math.round((effPres / workingDays) * 100) : null;
            const dailyRate = parseFloat(r.salary || 0) / workingDays;
            const deduction = Math.round((abs + unexc) * dailyRate + half * dailyRate * 0.5);
            return { ...r, working_days: workingDays, attendance_pct: pct, salary_deduction: deduction };
        });

        res.json({ month: mo, year: yr, working_days: workingDays, employees: summary });
    } catch (err) { console.error('[GET /api/attendance/report/monthly]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── GET /api/attendance/report/weekly — day-by-day for a specific week ────────
app.get('/api/attendance/report/weekly', requireAuth, requireRole('hr_manager','finance_manager','finance_approver','superadmin','admin','supervisor'), async (req, res) => {
    const { week_start } = req.query; // ISO date string YYYY-MM-DD (Monday)
    if (!week_start) return res.status(400).json({ error: 'week_start required (YYYY-MM-DD)' });

    try {
        const weekDates = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(week_start);
            d.setDate(d.getDate() + i);
            return d.toISOString().slice(0, 10);
        });

        const { rows } = await pool.query(`
            SELECT ar.employee_id, e.name, e.designation, e.location, ar.date, ar.status, ar.remarks
            FROM attendance_records ar
            JOIN employees e ON e.id = ar.employee_id
            WHERE ar.date >= $1 AND ar.date <= $2
            ORDER BY e.name, ar.date
        `, [weekDates[0], weekDates[6]]);

        // Pivot: { employee_id: { name, dates: { YYYY-MM-DD: status } } }
        const pivot = {};
        rows.forEach(r => {
            if (!pivot[r.employee_id]) {
                pivot[r.employee_id] = { employee_id: r.employee_id, name: r.name, designation: r.designation, site: r.location, dates: {} };
            }
            pivot[r.employee_id].dates[r.date] = { status: r.status, remarks: r.remarks };
        });

        res.json({ week_start, week_dates: weekDates, employees: Object.values(pivot) });
    } catch (err) { console.error('[GET /api/attendance/report/weekly]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── GET /api/attendance/export — CSV download ─────────────────────────────────
app.get('/api/attendance/export', requireAuth, requireRole('hr_manager','finance_manager','superadmin','admin'), async (req, res) => {
    const { month, year, client } = req.query;
    const mo = parseInt(month) || new Date().getMonth() + 1;
    const yr = parseInt(year)  || new Date().getFullYear();

    try {
        let q = `
            SELECT e.id, e.name, e.client, e.location, e.designation, e.salary,
                   ar.date, ar.status, ar.remarks, ar.marked_by
            FROM attendance_records ar
            JOIN employees e ON e.id = ar.employee_id
            WHERE EXTRACT(MONTH FROM ar.date) = $1 AND EXTRACT(YEAR FROM ar.date) = $2
        `;
        const params = [mo, yr];
        if (client && client !== 'All') { params.push(client); q += ` AND e.client = $${params.length}`; }
        q += ' ORDER BY e.name, ar.date';

        const { rows } = await pool.query(q, params);
        const headers = ['Employee ID','Name','Client','Site','Designation','Salary','Date','Status','Remarks','Marked By'];
        const csv = [
            headers.join(','),
            ...rows.map(r => [
                r.id, `"${r.name}"`, `"${r.client||''}"`, `"${r.location||''}"`,
                `"${r.designation||''}"`, r.salary, r.date, r.status,
                `"${(r.remarks||'').replace(/"/g,'""')}"`, r.marked_by
            ].join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="attendance_${yr}_${String(mo).padStart(2,'0')}.csv"`);
        res.send(csv);
    } catch (err) { console.error('[GET /api/attendance/export]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── GET /api/attendance/teams — list all supervisor teams (admin) ─────────────
app.get('/api/attendance/teams', requireAuth, requireTeamSetup, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT st.supervisor_email, st.employee_id, st.site, st.client,
                   st.active, st.id AS assignment_id,
                   e.name AS employee_name, e.designation
            FROM supervisor_teams st
            JOIN employees e ON e.id = st.employee_id
            ORDER BY st.supervisor_email, e.name
        `);
        // Group by supervisor
        const grouped = {};
        rows.forEach(r => {
            if (!grouped[r.supervisor_email]) {
                grouped[r.supervisor_email] = { supervisor_email: r.supervisor_email, site: r.site, client: r.client, active: r.active, team: [] };
            }
            grouped[r.supervisor_email].team.push({ id: r.assignment_id, employee_id: r.employee_id, name: r.employee_name, designation: r.designation });
        });
        res.json({ teams: Object.values(grouped) });
    } catch (err) { console.error('[GET /api/attendance/teams]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── POST /api/attendance/teams/assign — assign employees to a supervisor ───────
app.post('/api/attendance/teams/assign', requireAuth, requireTeamSetup, async (req, res) => {
    const { supervisor_email, employee_ids, site, client, contract_id, focal_emails } = req.body;
    if (!supervisor_email || !employee_ids?.length) return res.status(400).json({ error: 'supervisor_email and employee_ids required' });

    try {
        const emails  = employee_ids.map(() => supervisor_email);
        const ids     = employee_ids;
        const sites   = employee_ids.map(() => site || null);
        const clients = employee_ids.map(() => client || null);
        const ctIds   = employee_ids.map(() => contract_id || null);

        await pool.query(`
            INSERT INTO supervisor_teams (supervisor_email, employee_id, site, client, contract_id)
            SELECT unnest($1::text[]), unnest($2::text[]), unnest($3::text[]), unnest($4::text[]), unnest($5::text[])
            ON CONFLICT (supervisor_email, employee_id)
            DO UPDATE SET site=$3[1], client=$4[1], contract_id=$5[1], active=true
        `, [emails, ids, sites, clients, ctIds]);

        let focal = null;
        if (Array.isArray(focal_emails) || typeof focal_emails === 'string') {
            const { upsertProjectClientFocals } = require('./src/modules/attendance/clientFocals');
            const list = Array.isArray(focal_emails)
                ? focal_emails
                : String(focal_emails).split(',').map(s => s.trim()).filter(Boolean);
            focal = await upsertProjectClientFocals(pool, {
                supervisor_email,
                site,
                client,
                contract_id,
                focal_emails: list,
            });
        }

        res.json({ ok: true, assigned: employee_ids.length, focal });
    } catch (err) { console.error('[POST /api/attendance/teams/assign]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── DELETE /api/attendance/teams/:id — remove assignment ─────────────────────
app.delete('/api/attendance/teams/:id', requireAuth, requireTeamSetup, async (req, res) => {
    try {
        await pool.query('DELETE FROM supervisor_teams WHERE id=$1', [req.params.id]);
        logAudit(req, 'attendance_team_delete', 'supervisor_team', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/attendance/teams/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});


// ── Performance Indexes (idempotent — run once at startup) ─────────────────
Promise.all([
    pool.query('CREATE INDEX IF NOT EXISTS idx_employees_client ON employees(client)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(active)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_employees_contract_id ON employees(contract_id)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_employees_location ON employees(location)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_payroll_emp_month ON payroll_transactions(employee_id, month, year)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_payroll_month_year ON payroll_transactions(month, year)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_bills_client ON bills(client)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_bills_created_by ON bills(created_by)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_contracts_client_id ON contracts(client_id)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_pf_emp_month ON employee_pf_ledger(employee_id, month, year)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_gratuity_emp ON employee_gratuity_ledger(employee_id)'),
    pool.query('CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(employee_id, date)').catch(() => {}),
    pool.query('CREATE INDEX IF NOT EXISTS idx_obligations_due ON obligation_instances(due_date, status)').catch(() => {}),
]).then(() => console.log('Performance indexes: OK'))
  .catch(e => console.warn('Index creation warning (non-fatal):', e.message));

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL CLAIMS MODULE — Routes
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/claims/inbox — list all claim emails with employee join
app.get('/api/claims/inbox', requireAuth, async (req, res) => {
    try {
        const { month, client, status } = req.query;
        let where = 'WHERE 1=1';
        const vals = [];
        if (month) { vals.push(month); where += ` AND ci.claim_month = $${vals.length}::DATE`; }
        if (status && status !== 'ALL') { vals.push(status); where += ` AND ci.status = $${vals.length}`; }
        const { rows } = await pool.query(`
            SELECT
                ci.id, ci.received_at, ci.sender_email, ci.subject,
                ci.claim_month, ci.claim_type, ci.status,
                ci.ot_hours_1x, ci.ot_hours_2x, ci.ot_hours_3x,
                ci.claim_amount, ci.attachment_filename,
                ci.line_manager_name AS lm_name_claim, ci.line_manager_email AS lm_email_claim,
                ci.synopsis, ci.body_parsed, ci.match_remark,
                ci.payroll_month, ci.payroll_year, ci.pushed_at,
                ci.raw_body,
                COALESCE(ci.employee_name, e.name) AS employee_name,
                ci.employee_id,
                e.designation, e.dept, e.client AS employee_client,
                COALESCE(ci.line_manager_name, e.line_manager_name) AS line_manager_name,
                COALESCE(ci.line_manager_email, e.line_manager_email) AS line_manager_email
            FROM claims_inbox ci
            LEFT JOIN employees e ON e.id = ci.employee_id
            ${where}
            ORDER BY ci.received_at DESC
        `, vals);
        // Stats
        const stats = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE status NOT IN ('DUPLICATE')) AS total,
                COUNT(*) FILTER (WHERE status IN ('PENDING','BODY_PARSED')) AS pending,
                COUNT(*) FILTER (WHERE status = 'UNMATCHED') AS unmatched,
                COUNT(*) FILTER (WHERE status = 'DUPLICATE') AS duplicates,
                COUNT(*) FILTER (WHERE status IN ('APPROVED','PROCESSED')) AS approved
            FROM claims_inbox
        `);
        res.json({ claims: rows, stats: stats.rows[0] });
    } catch (err) { console.error('[GET /api/claims/inbox]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/claims/consolidation — claims grouped per employee for a given month
app.get('/api/claims/consolidation', requireAuth, async (req, res) => {
    try {
        const { month, client } = req.query;
        if (!month) return res.status(400).json({ error: 'month is required (YYYY-MM-DD)' });

        let clientFilter = '';
        const vals = [month];
        if (client) { vals.push(client); clientFilter = `AND LOWER(e.client) LIKE LOWER($${vals.length})`; }

        const { rows } = await pool.query(`
            SELECT
                ci.employee_id,
                COALESCE(ci.employee_name, e.name) AS employee_name,
                e.designation, e.dept, e.client AS employee_client,
                COALESCE(ci.line_manager_name, e.line_manager_name) AS line_manager_name,
                COALESCE(ci.line_manager_email, e.line_manager_email) AS line_manager_email,
                SUM(ci.ot_hours_2x) AS ot2_hours,
                SUM(ci.ot_hours_3x) AS ot3_hours,
                SUM(ci.claim_amount) FILTER (WHERE ci.claim_type IN ('OPD','IPD')) AS opd_amount,
                SUM(ci.claim_amount) FILTER (WHERE ci.claim_type IN ('EXPENSE','ALLOWANCE')) AS expense_amount,
                MIN(ci.status) AS claim_status,
                ARRAY_AGG(ci.id) AS claim_ids,
                COUNT(*) AS claim_count
            FROM claims_inbox ci
            LEFT JOIN employees e ON e.id = ci.employee_id
            WHERE ci.claim_month = $1::DATE
              AND ci.status IN ('PENDING','BODY_PARSED','UNMATCHED')
              ${clientFilter}
            GROUP BY ci.employee_id, ci.employee_name, e.name, e.designation, e.dept, e.client,
                     ci.line_manager_name, ci.line_manager_email, e.line_manager_name, e.line_manager_email
            ORDER BY COALESCE(ci.employee_name, e.name) ASC
        `, vals);

        // Summary totals
        const totals = rows.reduce((acc, r) => ({
            employees: acc.employees + 1,
            ot2Hours:  acc.ot2Hours  + (parseFloat(r.ot2_hours)   || 0),
            ot3Hours:  acc.ot3Hours  + (parseFloat(r.ot3_hours)   || 0),
            opd:       acc.opd       + (parseFloat(r.opd_amount)  || 0),
            expense:   acc.expense   + (parseFloat(r.expense_amount)  || 0),
        }), { employees: 0, ot2Hours: 0, ot3Hours: 0, opd: 0, expense: 0 });

        res.json({ rows, totals });
    } catch (err) { console.error('[GET /api/claims/consolidation]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// PATCH /api/claims/:id/status — manually update a single claim status / corrections
app.patch('/api/claims/:id/status', requireAuth, async (req, res) => {
    try {
        const { status, employee_id, claim_type, ot_hours_2x, ot_hours_3x, claim_amount, claim_month, match_remark } = req.body;
        const VALID = ['PENDING', 'BODY_PARSED', 'APPROVED', 'REJECTED', 'UNMATCHED', 'PROCESSED'];
        if (status && !VALID.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        const { rows } = await pool.query(`
            UPDATE claims_inbox
            SET status        = COALESCE($1, status),
                employee_id   = COALESCE($2, employee_id),
                claim_type    = COALESCE($3, claim_type),
                ot_hours_2x   = COALESCE($4, ot_hours_2x),
                ot_hours_3x   = COALESCE($5, ot_hours_3x),
                claim_amount  = COALESCE($6, claim_amount),
                claim_month   = COALESCE($7::DATE, claim_month),
                match_remark  = COALESCE($8, match_remark)
            WHERE id=$9 RETURNING *
        `, [status||null, employee_id||null, claim_type||null,
            ot_hours_2x!=null?parseFloat(ot_hours_2x):null,
            ot_hours_3x!=null?parseFloat(ot_hours_3x):null,
            claim_amount!=null?parseFloat(claim_amount):null,
            claim_month||null, match_remark||null, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Claim not found' });
        if (status) logAudit(req, `claim_status_${status.toLowerCase()}`, 'claim', req.params.id);
        res.json({ ok: true, claim: rows[0] });
    } catch (err) { console.error('[PATCH /api/claims/:id/status]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/claims/:id/push-to-payroll — write claim data into payroll_transactions for a month
app.post('/api/claims/:id/push-to-payroll', requireAuth, async (req, res) => {
    try {
        const { month, year } = req.body;
        if (!month || !year) return res.status(400).json({ error: 'month and year are required' });

        const { rows: [claim] } = await pool.query(
            'SELECT * FROM claims_inbox WHERE id=$1', [req.params.id]
        );
        if (!claim) return res.status(404).json({ error: 'Claim not found' });
        if (!claim.employee_id) return res.status(400).json({ error: 'Claim has no matched employee. Please match employee first.' });

        const m = parseInt(month);
        const y = parseInt(year);
        const ot2 = parseFloat(claim.ot_hours_2x) || 0;
        const ot3 = parseFloat(claim.ot_hours_3x) || 0;
        const amt = parseFloat(claim.claim_amount) || 0;
        const claimType = (claim.claim_type || '').toUpperCase();

        // Determine which payroll column to write
        const isOT      = claimType === 'OT';
        const isOPD     = claimType === 'OPD' || claimType === 'IPD';
        const isExpense = claimType === 'EXPENSE' || claimType === 'ALLOWANCE' || (!isOT && !isOPD);

        // Upsert payroll_transactions — overwrite the specific columns for this claim type
        await pool.query(`
            INSERT INTO payroll_transactions (employee_id, month, year, ot2_hrs, ot3_hrs, opd_claim, reimbursement)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (employee_id, month, year) DO UPDATE SET
                ot2_hrs       = CASE WHEN $8 THEN EXCLUDED.ot2_hrs       ELSE payroll_transactions.ot2_hrs END,
                ot3_hrs       = CASE WHEN $8 THEN EXCLUDED.ot3_hrs       ELSE payroll_transactions.ot3_hrs END,
                opd_claim     = CASE WHEN $9 THEN EXCLUDED.opd_claim     ELSE payroll_transactions.opd_claim END,
                reimbursement = CASE WHEN $10 THEN EXCLUDED.reimbursement ELSE payroll_transactions.reimbursement END,
                updated_at    = NOW()
        `, [
            claim.employee_id, m, y,
            isOT ? ot2 : 0,
            isOT ? ot3 : 0,
            isOPD ? amt : 0,
            isExpense ? amt : 0,
            isOT, isOPD, isExpense
        ]);

        // Mark claim as PROCESSED
        await pool.query(`
            UPDATE claims_inbox
            SET status='PROCESSED', payroll_month=$1, payroll_year=$2, pushed_at=NOW()
            WHERE id=$3
        `, [m, y, req.params.id]);

        res.json({ ok: true, message: `Pushed to payroll ${y}-${m} for employee ${claim.employee_id}` });
    } catch (err) { console.error('[POST /api/claims/:id/push-to-payroll]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/claims/send-approval-emails — dispatch approval emails to line managers
app.post('/api/claims/send-approval-emails', requireAuth, async (req, res) => {
    try {
        const { month, client, claimIds } = req.body;
        if (!month) return res.status(400).json({ error: 'month required' });

        // Get consolidation data
        let clientFilter = '';
        const vals = [month];
        if (client) { vals.push(client); clientFilter = `AND LOWER(e.client) LIKE LOWER($${vals.length})`; }

        const { rows: consolidation } = await pool.query(`
            SELECT
                e.line_manager_name, e.line_manager_email,
                e.name AS employee_name, e.id AS employee_id, e.designation, e.client AS employee_client,
                SUM(ci.ot_hours) FILTER (WHERE ci.claim_type = 'OT_2X') AS ot2_hours,
                SUM(ci.ot_hours) FILTER (WHERE ci.claim_type = 'OT_3X') AS ot3_hours,
                SUM(ci.claim_amount) FILTER (WHERE ci.claim_type = 'OPD') AS opd_amount,
                SUM(ci.claim_amount) FILTER (WHERE ci.claim_type = 'EXPENSE') AS expense_amount,
                ARRAY_AGG(ci.id) AS claim_ids
            FROM claims_inbox ci
            JOIN employees e ON e.id = ci.employee_id
            WHERE ci.claim_month = $1::DATE
              AND ci.status = 'PENDING'
              ${clientFilter}
            GROUP BY e.line_manager_name, e.line_manager_email, e.name, e.id, e.designation, e.client
        `, vals);

        if (!consolidation.length) return res.json({ ok: true, sent: 0, message: 'No pending claims found' });

        // Group by manager
        const byManager = {};
        for (const row of consolidation) {
            const key = (row.line_manager_email || 'UNKNOWN').toLowerCase();
            if (!byManager[key]) byManager[key] = { name: row.line_manager_name || 'Manager', email: row.line_manager_email, employees: [] };
            byManager[key].employees.push(row);
        }

        const monthLabel = new Date(month).toLocaleString('en-PK', { month: 'long', year: 'numeric' });
        const sentTo = [];
        const errors = [];

        for (const mgr of Object.values(byManager)) {
            if (!mgr.email) { errors.push({ manager: mgr.name, error: 'No email on record' }); continue; }

            // Build HTML table rows
            const tableRows = mgr.employees.map(e => `
                <tr style="border-bottom:1px solid #e2e8f0;">
                    <td style="padding:8px 12px;">${e.employee_name}</td>
                    <td style="padding:8px 12px;">${e.employee_id}</td>
                    <td style="padding:8px 12px;text-align:center;">${e.ot2_hours || '—'}</td>
                    <td style="padding:8px 12px;text-align:center;">${e.ot3_hours || '—'}</td>
                    <td style="padding:8px 12px;text-align:right;">${e.opd_amount ? 'PKR ' + parseFloat(e.opd_amount).toLocaleString() : '—'}</td>
                    <td style="padding:8px 12px;text-align:right;">${e.expense_amount ? 'PKR ' + parseFloat(e.expense_amount).toLocaleString() : '—'}</td>
                </tr>
            `).join('');

            const html = `
<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:680px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#1e3a5f,#2d5f8a);padding:28px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.3rem;">ASIL HCM System</h1>
    <p style="color:#94c5f5;margin:6px 0 0;font-size:0.9rem;">Automated HR Notification</p>
  </div>
  <div style="padding:28px 32px;">
    <h2 style="color:#1e3a5f;margin:0 0 8px;">Action Required: Claims Approval</h2>
    <p style="color:#64748b;margin:0 0 20px;">Month of <strong>${monthLabel}</strong></p>
    <p style="color:#334155;">Dear <strong>${mgr.name}</strong>,</p>
    <p style="color:#334155;">Please review and approve the following overtime, OPD and expense claims for your team members for <strong>${monthLabel}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:0.88rem;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="padding:10px 12px;text-align:left;color:#475569;">Employee</th>
          <th style="padding:10px 12px;text-align:left;color:#475569;">ID</th>
          <th style="padding:10px 12px;text-align:center;color:#475569;">OT 2X (hrs)</th>
          <th style="padding:10px 12px;text-align:center;color:#475569;">OT 3X (hrs)</th>
          <th style="padding:10px 12px;text-align:right;color:#475569;">OPD</th>
          <th style="padding:10px 12px;text-align:right;color:#475569;">Expenses</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <div style="margin:24px 0;padding:16px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:6px;">
      <p style="margin:0;color:#15803d;font-weight:600;">To approve, reply to this email with the word: APPROVED</p>
      <p style="margin:6px 0 0;color:#166534;font-size:0.85rem;">To reject, reply with: REJECTED (and optionally state the reason)</p>
    </div>
    <p style="color:#94a3b8;font-size:0.8rem;margin:20px 0 0;">This is an automated notification from ASIL HCM System. Do not forward this email. If you did not expect this, contact HR.</p>
  </div>
  <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.78rem;margin:0;">Allied Services International (Pvt.) Ltd. · ASIL HCM · ${new Date().getFullYear()}</p>
  </div>
</div>
</body></html>`;

            try {
                const resend = getResend();
                if (!resend) throw new Error('RESEND_API_KEY not configured');
                await resend.emails.send({
                    from: EMAIL_FROM,
                    to: mgr.email,
                    subject: `Action Required: Approval for ${monthLabel} — ${mgr.employees.length} Claim(s)`,
                    html,
                });

                // Create approval cycle record
                const totalVal = mgr.employees.reduce((s, e) =>
                    s + (parseFloat(e.opd_amount)||0) + (parseFloat(e.expense_amount)||0), 0);
                const cycle = await pool.query(`
                    INSERT INTO claims_approval_cycles
                        (cycle_month, manager_email, manager_name, sent_at, claims_count, total_value)
                    VALUES ($1::DATE, $2, $3, NOW(), $4, $5)
                    RETURNING id
                `, [month, mgr.email, mgr.name, mgr.employees.length, totalVal]);

                // Tag the claims with cycle ID
                const allClaimIds = mgr.employees.flatMap(e => e.claim_ids).filter(Boolean);
                if (allClaimIds.length && cycle.rows[0]) {
                    await pool.query(
                        `UPDATE claims_inbox SET status='AWAITING_APPROVAL', approval_cycle_id=$1 WHERE id = ANY($2::int[])`,
                        [cycle.rows[0].id, allClaimIds]
                    );
                }

                sentTo.push({ manager: mgr.name, email: mgr.email, employees: mgr.employees.length });
            } catch (emailErr) {
                errors.push({ manager: mgr.name, email: mgr.email, error: emailErr.message });
            }
        }

        res.json({ ok: true, sent: sentTo.length, sentTo, errors });
    } catch (err) { console.error('[POST /api/claims/send-approval-emails]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/claims/approval-cycles — list approval cycles and their status
app.get('/api/claims/approval-cycles', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT * FROM claims_approval_cycles
            ORDER BY sent_at DESC LIMIT 100
        `);
        res.json({ cycles: rows });
    } catch (err) { console.error('[GET /api/claims/approval-cycles]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/claims/listener-status — returns listener config (no secrets)
app.get('/api/claims/listener-status', requireAuth, async (req, res) => {
    const user = process.env.CLAIMS_EMAIL_USER || '';
    const host = process.env.CLAIMS_EMAIL_HOST || 'imap.gmail.com';
    const interval = parseInt(process.env.CLAIMS_POLL_INTERVAL_MS) || 300000;
    const { rows } = await pool.query(
        `SELECT COUNT(*) AS total, MAX(received_at) AS last_received FROM claims_inbox`
    ).catch(() => ({ rows: [{ total: 0, last_received: null }] }));
    res.json({
        configured: !!process.env.CLAIMS_EMAIL_USER,
        inbox: user ? `${user.split('@')[0].slice(0,3)}***@${user.split('@')[1] || ''}` : '(not set)',
        host,
        pollIntervalSeconds: interval / 1000,
        totalProcessed: parseInt(rows[0]?.total) || 0,
        lastReceived: rows[0]?.last_received || null,
    });
});

// POST /api/claims/trigger-poll — manual "Run Now" from HCM UI (requires email_monitoring permission)
app.post('/api/claims/trigger-poll', requireAuth, async (req, res) => {
    try {
        const result = await triggerManualPoll(pool);
        res.json({ ok: true, result });
    } catch (err) { console.error('[POST /api/claims/trigger-poll]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/claims/approve/:token — secure one-click web approval (JWT link sent in approval email)
app.get('/api/claims/approve/:token', async (req, res) => {
    try {
        let payload;
        try { payload = jwt.verify(req.params.token, JWT_SECRET); }
        catch { return res.status(400).send('<h2 style="color:#ef4444">Link expired or invalid. Please reply APPROVED via email instead.</h2>'); }
        const { cycleId, decision } = payload;
        if (!['APPROVED','REJECTED'].includes(decision)) return res.status(400).send('Invalid.');
        await pool.query('UPDATE claims_approval_cycles SET response=$1, responded_at=NOW() WHERE id=$2 AND response IS NULL', [decision, cycleId]);
        await pool.query("UPDATE claims_inbox SET status=$1 WHERE approval_cycle_id=$2 AND status='AWAITING_APPROVAL'", [decision, cycleId]);
        const color = decision === 'APPROVED' ? '#22c55e' : '#ef4444';
        res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f172a;color:#e2e8f0"><div style="max-width:400px;margin:auto;background:#1e293b;border-radius:16px;padding:40px;border:1px solid #334155"><div style="font-size:3rem">${decision==='APPROVED'?'✅':'❌'}</div><h2 style="color:${color}">${decision}</h2><p style="color:#94a3b8">Response recorded. ASIL HCM system updated.</p></div></body></html>`);
    } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// ══════════════════════════════════════════════════════════════════════════════
// WAFI CLAIMS MODULE — Routes
// ══════════════════════════════════════════════════════════════════════════════

const XLSX_wafi = require('xlsx');

// One-time data fix: sessions marked PROCESSED_SUCCESSFULLY with 0 rows are IRRELEVANT
// (e.g. Mustafa's blank Excel that had correct tabs but no data rows)
pool.query(`
    UPDATE wafi_claims_sessions
    SET processing_status = 'IRRELEVANT',
        email_summary = COALESCE(email_summary, 'No claim rows found in the submitted file. Email classified as not relevant.')
    WHERE processing_status = 'PROCESSED_SUCCESSFULLY'
      AND total_ot_rows = 0 AND total_expense_rows = 0 AND total_medical_rows = 0
`).then(r => {
    if (r.rowCount > 0) console.log(`[Wafi Claims] Data fix: reclassified ${r.rowCount} empty PROCESSED_SUCCESSFULLY session(s) as IRRELEVANT`);
}).catch(e => console.warn('[Wafi Claims] Data fix warning:', e.message));

// GET /api/wafi-claims/sessions
app.get('/api/wafi-claims/sessions', requireAuth, async (req, res) => {
    try {
        const { archive, config } = await cutover.resolveArchiveMode(req, pool);
        const periodClause = wafiApproval.wafiSessionPeriodClause('wcs', { archive });
        const { status, dateFrom, dateTo, location, search, claimMonth } = req.query;
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(200, parseInt(req.query.limit) || 50);
        const offset = (page - 1) * limit;

        const vals = [];
        let where = `WHERE ${periodClause}`;
        if (status)   { 
            vals.push(status);   
            where += ` AND wcs.processing_status = $${vals.length}`; 
        } else {
            where += ` AND wcs.processing_status NOT IN ('IRRELEVANT', 'SUPERSEDED')`;
        }
        if (dateFrom) { vals.push(dateFrom); where += ` AND wcs.received_at >= $${vals.length}::timestamptz`; }
        if (dateTo)   { vals.push(dateTo);   where += ` AND wcs.received_at <= $${vals.length}::timestamptz`; }
        if (claimMonth) { vals.push(claimMonth + '-01'); where += ` AND wcs.claim_month = $${vals.length}::date`; }
        if (location) { vals.push(`%${location}%`); where += ` AND wcs.location_name ILIKE $${vals.length}`; }
        if (search)   { vals.push(`%${search}%`); where += ` AND (wcs.sender_email ILIKE $${vals.length} OR wcs.attachment_filename ILIKE $${vals.length} OR wcs.subject ILIKE $${vals.length})`; }

        const countVals = [...vals];
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM wafi_claims_sessions wcs ${where}`, countVals
        );
        const total = parseInt(countRows[0].count);

        vals.push(limit); vals.push(offset);
        const { rows: sessions } = await pool.query(
            `SELECT wcs.*,
                COALESCE(ot_counts.single_rows, 0)  AS ot_single_count,
                COALESCE(ot_counts.double_rows, 0)  AS ot_double_count,
                COALESCE(ot_counts.triple_rows, 0)  AS ot_triple_count,
                COALESCE(exp_counts.exp_total, 0)   AS expense_total_amount,
                COALESCE(med_counts.med_total, 0)   AS medical_total_amount
             FROM wafi_claims_sessions wcs
             LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) FILTER (WHERE LOWER(ot_multiplier) = 'single') AS single_rows,
                    COUNT(*) FILTER (WHERE LOWER(ot_multiplier) = 'double') AS double_rows,
                    COUNT(*) FILTER (WHERE LOWER(ot_multiplier) = 'triple') AS triple_rows
                FROM wafi_claims_items
                WHERE session_id = wcs.id AND claim_type = 'OT' AND active = TRUE
             ) ot_counts ON TRUE
             LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(raw_amount), 0) AS exp_total
                FROM wafi_claims_items
                WHERE session_id = wcs.id AND claim_type = 'EXPENSE' AND active = TRUE
             ) exp_counts ON TRUE
             LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(raw_amount), 0) AS med_total
                FROM wafi_claims_items
                WHERE session_id = wcs.id AND claim_type = 'MEDICAL' AND active = TRUE
             ) med_counts ON TRUE
             ${where}
             ORDER BY wcs.received_at DESC
             LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
            vals
        );

        const { rows: statsRows } = await pool.query(`
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE processing_status IN ('PROCESSED_SUCCESSFULLY','VERIFIED')) AS passed,
                COUNT(*) FILTER (WHERE processing_status = 'VALIDATION_FAILED') AS failed,
                COUNT(*) FILTER (WHERE processing_status = 'REVISED') AS revised,
                COUNT(*) FILTER (WHERE processing_status = 'PENDING_REVIEW') AS pending_review,
                COUNT(*) FILTER (WHERE processing_status IN ('PROCESSED_SUCCESSFULLY','VERIFIED') AND pushed_to_payroll = FALSE) AS pending_payroll
            FROM wafi_claims_sessions wcs
            WHERE ${periodClause}
        `);

        res.json({ sessions, total, page, limit, stats: statsRows[0], archive_mode: archive });
    } catch (err) { console.error('[GET /api/wafi-claims/sessions]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/wafi-claims/sessions/:id
app.get('/api/wafi-claims/sessions/:id', requireAuth, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { rows: sessionRows } = await pool.query(`
            SELECT wcs.*,
                COALESCE(ot_counts.single_rows, 0)  AS ot_single_count,
                COALESCE(ot_counts.double_rows, 0)  AS ot_double_count,
                COALESCE(ot_counts.triple_rows, 0)  AS ot_triple_count,
                COALESCE(exp_counts.exp_total, 0)   AS expense_total_amount,
                COALESCE(med_counts.med_total, 0)   AS medical_total_amount
            FROM wafi_claims_sessions wcs
            LEFT JOIN LATERAL (
                SELECT
                    COUNT(*) FILTER (WHERE LOWER(ot_multiplier) = 'single') AS single_rows,
                    COUNT(*) FILTER (WHERE LOWER(ot_multiplier) = 'double') AS double_rows,
                    COUNT(*) FILTER (WHERE LOWER(ot_multiplier) = 'triple') AS triple_rows
                FROM wafi_claims_items
                WHERE session_id = wcs.id AND claim_type = 'OT' AND active = TRUE
            ) ot_counts ON TRUE
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(raw_amount), 0) AS exp_total
                FROM wafi_claims_items
                WHERE session_id = wcs.id AND claim_type = 'EXPENSE' AND active = TRUE
            ) exp_counts ON TRUE
            LEFT JOIN LATERAL (
                SELECT COALESCE(SUM(raw_amount), 0) AS med_total
                FROM wafi_claims_items
                WHERE session_id = wcs.id AND claim_type = 'MEDICAL' AND active = TRUE
            ) med_counts ON TRUE
            WHERE wcs.id = $1
        `, [id]);
        if (!sessionRows.length) return res.status(404).json({ error: 'Session not found' });

        const { rows: items } = await pool.query(
            'SELECT * FROM wafi_claims_items WHERE session_id = $1 ORDER BY tab_name, row_number', [id]
        );
        res.json({ session: sessionRows[0], items });
    } catch (err) { console.error('[GET /api/wafi-claims/sessions/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/wafi-claims/items
app.get('/api/wafi-claims/items', requireAuth, async (req, res) => {
    try {
        const { dateFrom, dateTo, location, claimType, employeeCode } = req.query;
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(500, parseInt(req.query.limit) || 50);
        const offset = (page - 1) * limit;

        const vals = [];
        let where = 'WHERE wci.active = TRUE';
        if (dateFrom)     { vals.push(dateFrom);       where += ` AND wci.claim_date >= $${vals.length}::date`; }
        if (dateTo)       { vals.push(dateTo);         where += ` AND wci.claim_date <= $${vals.length}::date`; }
        if (location)     { vals.push(`%${location}%`); where += ` AND wci.location ILIKE $${vals.length}`; }
        if (claimType && claimType !== 'ALL') { vals.push(claimType); where += ` AND wci.claim_type = $${vals.length}`; }
        if (employeeCode) { vals.push(`%${employeeCode}%`); where += ` AND (wci.employee_id ILIKE $${vals.length} OR wci.employee_code_raw ILIKE $${vals.length})`; }

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*) FROM wafi_claims_items wci ${where}`, vals
        );
        const total = parseInt(countRows[0].count);

        vals.push(limit); vals.push(offset);
        const { rows: items } = await pool.query(
            `SELECT wci.*, wcs.sender_email, wcs.attachment_filename
             FROM wafi_claims_items wci
             JOIN wafi_claims_sessions wcs ON wcs.id = wci.session_id
             ${where}
             ORDER BY wci.claim_date DESC, wci.employee_name_db ASC
             LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
            vals
        );
        res.json({ items, total, page, limit });
    } catch (err) { console.error('[GET /api/wafi-claims/items]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/wafi-claims/export
app.get('/api/wafi-claims/export', requireAuth, async (req, res) => {
    try {
        const { dateFrom, dateTo, location, claimType, employeeCode } = req.query;
        const vals = [];
        let where = 'WHERE wci.active = TRUE';
        if (dateFrom)     { vals.push(dateFrom);       where += ` AND wci.claim_date >= $${vals.length}::date`; }
        if (dateTo)       { vals.push(dateTo);         where += ` AND wci.claim_date <= $${vals.length}::date`; }
        if (location)     { vals.push(`%${location}%`); where += ` AND wci.location ILIKE $${vals.length}`; }
        if (claimType && claimType !== 'ALL') { vals.push(claimType); where += ` AND wci.claim_type = $${vals.length}`; }
        if (employeeCode) { vals.push(`%${employeeCode}%`); where += ` AND (wci.employee_id ILIKE $${vals.length} OR wci.employee_code_raw ILIKE $${vals.length})`; }

        const { rows } = await pool.query(
            `SELECT wci.id, wci.claim_type, wci.claim_date, wci.employee_id, wci.employee_name_db,
                    wci.location, wci.department, wci.line_manager, wci.description,
                    wci.ot_hours, wci.ot_multiplier, wci.raw_amount, wci.ot_payout
             FROM wafi_claims_items wci
             JOIN wafi_claims_sessions wcs ON wcs.id = wci.session_id
             ${where}
             ORDER BY wci.claim_date DESC, wci.claim_type, wci.employee_name_db`,
            vals
        );

        const wb = XLSX_wafi.utils.book_new();
        const ws = XLSX_wafi.utils.json_to_sheet(rows.map(r => ({
            ID: r.id,
            'Claim Type': r.claim_type,
            'Claim Date': r.claim_date ? String(r.claim_date).slice(0,10) : '',
            'Employee Code': r.employee_id,
            'Employee Name': r.employee_name_db,
            Location: r.location,
            Department: r.department,
            'Line Manager': r.line_manager,
            Description: r.description,
            'OT Hours': r.ot_hours,
            'OT Multiplier': r.ot_multiplier,
            'Amount (PKR)': r.raw_amount,
            'OT Payout (PKR)': r.ot_payout,
        })));
        XLSX_wafi.utils.book_append_sheet(wb, ws, 'Wafi Claims');
        const buf = XLSX_wafi.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const dateStr = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Disposition', `attachment; filename="wafi_claims_export_${dateStr}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (err) { console.error('[GET /api/wafi-claims/export]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/wafi-claims/sessions-export
app.get('/api/wafi-claims/sessions-export', requireAuth, async (req, res) => {
    try {
        const { status, dateFrom, dateTo, claimMonth, search } = req.query;
        const vals = [];
        let where = 'WHERE 1=1';
        if (status) { 
            vals.push(status);   
            where += ` AND wcs.processing_status = $${vals.length}`; 
        } else {
            where += ` AND wcs.processing_status != 'IRRELEVANT'`;
        }
        if (dateFrom) { vals.push(dateFrom); where += ` AND wcs.received_at >= $${vals.length}::timestamptz`; }
        if (dateTo)   { vals.push(dateTo);   where += ` AND wcs.received_at <= $${vals.length}::timestamptz`; }
        if (claimMonth) { vals.push(claimMonth + '-01'); where += ` AND wcs.claim_month = $${vals.length}::date`; }
        if (search)   { vals.push(`%${search}%`); where += ` AND (wcs.sender_email ILIKE $${vals.length} OR wcs.attachment_filename ILIKE $${vals.length} OR wcs.subject ILIKE $${vals.length})`; }

        const { rows } = await pool.query(
            `SELECT wcs.id, wcs.received_at, wcs.sender_email, wcs.attachment_filename, wcs.claim_month, wcs.processing_status,
                    COALESCE(ot_counts.single_rows, 0) + COALESCE(ot_counts.double_rows, 0) + COALESCE(ot_counts.triple_rows, 0) AS ot_rows,
                    wcs.total_expense_rows, wcs.total_medical_rows
             FROM wafi_claims_sessions wcs
             LEFT JOIN (
                 SELECT session_id,
                        COUNT(CASE WHEN ot_multiplier = 1 THEN 1 END) AS single_rows,
                        COUNT(CASE WHEN ot_multiplier = 2 THEN 1 END) AS double_rows,
                        COUNT(CASE WHEN ot_multiplier = 3 THEN 1 END) AS triple_rows
                 FROM wafi_claims_items WHERE active = TRUE AND claim_type = 'OT' GROUP BY session_id
             ) ot_counts ON ot_counts.session_id = wcs.id
             ${where}
             ORDER BY wcs.received_at DESC`,
            vals
        );

        const wb = XLSX_wafi.utils.book_new();
        const ws = XLSX_wafi.utils.json_to_sheet(rows.map(r => ({
            ID: r.id,
            'Received At': r.received_at ? new Date(r.received_at).toLocaleString() : '',
            'Sender Email': r.sender_email,
            'Filename': r.attachment_filename,
            'Claim Month': r.claim_month ? String(r.claim_month).slice(0, 7) : '',
            'Status': r.processing_status,
            'OT Rows': parseInt(r.ot_rows),
            'Expense Rows': r.total_expense_rows,
            'Medical Rows': r.total_medical_rows
        })));
        XLSX_wafi.utils.book_append_sheet(wb, ws, 'Sessions');
        const buf = XLSX_wafi.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const dateStr = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Disposition', `attachment; filename="wafi_claims_sessions_${dateStr}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buf);
    } catch (err) { console.error('[GET /api/wafi-claims/sessions-export]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Wafi → employee_claims staging (S1B) ─────────────────────────────────────
function wafiOtTierFields(factor, hrs) {
    const f = parseFloat(factor) || 1;
    const h = parseFloat(hrs) || 0;
    if (f >= 3) return { ot1: 0, ot2: 0, ot3: h };
    if (f >= 2) return { ot1: 0, ot2: h, ot3: 0 };
    return { ot1: h, ot2: 0, ot3: 0 };
}

function buildWafiClaimGroups(items) {
    const groups = new Map();
    const add = (empId, claimType, claimItem) => {
        const key = `${empId}|${claimType}`;
        if (!groups.has(key)) groups.set(key, { employeeId: empId, claimType, claimedItems: [] });
        groups.get(key).claimedItems.push(claimItem);
    };

    for (const item of items || []) {
        const empId = item.employee_id;
        if (!empId) continue;
        const prov = {
            wafi_item_id: item.id,
            date: item.claim_date || item.date || null,
            description: item.description || item.notes || item.tab_name || null,
        };

        if (item.claim_type === 'OT') {
            const hrs = parseFloat(item.ot_hours) || 0;
            if (hrs <= 0) continue;
            add(empId, 'overtime', { ...wafiOtTierFields(item.ot_multiplier_factor, hrs), ...prov });
        } else if (item.claim_type === 'EXPENSE') {
            const amount = parseFloat(item.raw_amount) || 0;
            if (amount <= 0) continue;
            add(empId, 'expense', { amount, ...prov });
        } else if (item.claim_type === 'MEDICAL') {
            const amount = parseFloat(item.raw_amount) || 0;
            if (amount <= 0) continue;
            add(empId, 'medical', { amount, ...prov });
        }
    }
    return [...groups.values()];
}

async function stageWafiSessionToEmployeeClaims(db, { sessionId, sessionRef, month, year, items }) {
    const groups = buildWafiClaimGroups(items);
    let upserted = 0;
    const skipped_locked = [];
    const typeCounts = { overtime: 0, expense: 0, medical: 0 };

    for (const group of groups) {
        const { rows: existing } = await db.query(
            `SELECT id, status FROM employee_claims
             WHERE source_kind = 'wafi' AND source_session_id = $1 AND employee_id = $2 AND claim_type = $3`,
            [sessionId, group.employeeId, group.claimType]
        );
        if (existing.length && existing[0].status === 'in_payroll_run') {
            skipped_locked.push({ employee_id: group.employeeId, claim_type: group.claimType });
            continue;
        }

        await db.query(
            `INSERT INTO employee_claims (
                employee_id, claim_type, period_month, period_year, claimed_items,
                status, focal_approved_at, source_kind, source_session_id, source_ref, updated_at
            ) VALUES ($1, $2, $3, $4, $5::jsonb, 'focal_approved', NOW(), 'wafi', $6, $7, NOW())
            ON CONFLICT (source_kind, source_session_id, employee_id, claim_type)
            WHERE source_kind IS NOT NULL
            DO UPDATE SET
                claimed_items = EXCLUDED.claimed_items,
                period_month = EXCLUDED.period_month,
                period_year = EXCLUDED.period_year,
                updated_at = NOW()
            WHERE employee_claims.status <> 'in_payroll_run'`,
            [
                group.employeeId,
                group.claimType,
                parseInt(month, 10),
                parseInt(year, 10),
                JSON.stringify(group.claimedItems),
                sessionId,
                sessionRef || null,
            ]
        );
        upserted++;
        typeCounts[group.claimType] = (typeCounts[group.claimType] || 0) + 1;
    }

    const affectedEmployees = new Set(groups.map(g => g.employeeId)).size;
    return {
        upserted,
        affectedEmployees,
        skipped_locked,
        breakdown: {
            ot: typeCounts.overtime || 0,
            expense: typeCounts.expense || 0,
            medical: typeCounts.medical || 0,
        },
    };
}

// POST /api/wafi-claims/sessions/:id/stage-payroll
app.post('/api/wafi-claims/sessions/:id/stage-payroll', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { month, year } = req.body;
        if (!month || !year) return res.status(400).json({ error: 'month and year are required' });

        const { rows: sessionRows } = await pool.query(
            'SELECT * FROM wafi_claims_sessions WHERE id = $1', [sessionId]
        );
        if (!sessionRows.length) return res.status(404).json({ error: 'Session not found' });
        const session = sessionRows[0];
        const STAGEABLE = ['PROCESSED_SUCCESSFULLY', 'VERIFIED', 'PENDING_REVIEW'];
        if (!STAGEABLE.includes(session.processing_status)) {
            return res.status(400).json({ error: `Session status is '${session.processing_status}' — only ${STAGEABLE.join(', ')} sessions can be staged to payroll.` });
        }

        const approvalGate = await wafiApproval.assertReadyForHcm(pool, sessionId);
        if (!approvalGate.ok) {
            return res.status(approvalGate.status || 409).json({
                error: approvalGate.message || 'Approval chain incomplete',
                code: approvalGate.code,
                approval_state: approvalGate.approval_state,
            });
        }

        const { rows: items } = await pool.query(
            `SELECT wci.*, e.salary
             FROM wafi_claims_items wci
             LEFT JOIN employees e ON e.id = wci.employee_id
             WHERE wci.session_id = $1 AND wci.active = TRUE`,
            [sessionId]
        );

        const sessionRef = session.attachment_filename || session.subject || String(sessionId);
        const stageResult = await stageWafiSessionToEmployeeClaims(pool, {
            sessionId,
            sessionRef,
            month,
            year,
            items,
        });
        const { upserted, affectedEmployees, skipped_locked, breakdown } = stageResult;

        const payrollMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
        await pool.query(
            `UPDATE wafi_claims_sessions
             SET pushed_to_payroll = TRUE, payroll_month = $1
             WHERE id = $2`,
            [payrollMonth.toISOString().slice(0, 10), sessionId]
        );

        // Create Gmail confirmation draft in the original thread
        let draftId = null;
        try {
            const gmail = createGmailClient();
            // If thread ID was not stored (e.g. older sessions), try to recover it via Gmail API
            let threadId = session.gmail_thread_id;
            if (!threadId && session.gmail_message_id) {
                try {
                    const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: session.gmail_message_id, format: 'minimal' });
                    threadId = msg.threadId;
                    if (threadId) {
                        await pool.query('UPDATE wafi_claims_sessions SET gmail_thread_id = $1 WHERE id = $2', [threadId, sessionId]);
                        console.log(`[Wafi Claims] Stage: recovered thread_id ${threadId} for session ${sessionId}`);
                    }
                } catch (tErr) { console.warn('[Wafi Claims] Stage: thread_id recovery failed:', tErr.message); }
            }
            if (gmail && threadId) {
                const otCount  = items.filter(i => i.claim_type === 'OT').length;
                const expCount = items.filter(i => i.claim_type === 'EXPENSE').length;
                const medCount = items.filter(i => i.claim_type === 'MEDICAL').length;
                const html = buildConfirmationHtml({
                    sessionId,
                    filename: session.attachment_filename,
                    claimMonth: session.claim_month,
                    settlementMonth: payrollMonth.toISOString(),
                    items,
                });
                draftId = await createGmailDraft(
                    gmail,
                    threadId,
                    session.sender_email,
                    session.subject || 'Re: Claims Submission',
                    html
                );
                if (draftId) {
                    await pool.query('UPDATE wafi_claims_sessions SET confirm_email_sent = TRUE WHERE id = $1', [sessionId]);
                }
                console.log(`[Wafi Claims] Stage draft ${draftId ? 'created' : 'failed'} for session ${sessionId}`);
            }
        } catch (draftErr) {
            console.warn('[Wafi Claims] Stage: draft creation failed:', draftErr.message);
        }

        res.json({
            ok: true,
            message: `Staged ${affectedEmployees} employees (${upserted} claim rows) to payroll ${year}-${String(month).padStart(2,'0')}`,
            upserted,
            affectedEmployees,
            skipped_locked,
            draftCreated: !!draftId,
            breakdown,
        });
    } catch (err) { console.error('[POST /api/wafi-claims/sessions/:id/stage-payroll]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/wafi-claims/sessions/:id/resend-draft
// Recreates the Gmail confirmation draft for a staged session where the draft was not created originally.
// Fetches the real threadId directly from Gmail API using the stored gmail_message_id.
app.post('/api/wafi-claims/sessions/:id/resend-draft', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);

        const { rows: sessionRows } = await pool.query(
            'SELECT * FROM wafi_claims_sessions WHERE id = $1', [sessionId]
        );
        if (!sessionRows.length) return res.status(404).json({ error: 'Session not found' });
        const session = sessionRows[0];
        if (!session.pushed_to_payroll) return res.status(400).json({ error: 'Session is not yet staged — stage it first' });

        const { rows: items } = await pool.query(
            `SELECT * FROM wafi_claims_items WHERE session_id = $1 AND active = TRUE`, [sessionId]
        );

        const gmail = createGmailClient();
        if (!gmail) return res.status(503).json({ error: 'Gmail not configured' });

        // Get real threadId from Gmail API using the stored message ID
        let threadId = session.gmail_thread_id;
        if (!threadId && session.gmail_message_id) {
            try {
                const { data } = await gmail.users.messages.get({
                    userId: 'me', id: session.gmail_message_id, format: 'metadata', metadataHeaders: ['Subject'],
                });
                threadId = data.threadId;
                // Save it for future use
                if (threadId) {
                    await pool.query('UPDATE wafi_claims_sessions SET gmail_thread_id = $1 WHERE id = $2', [threadId, sessionId]);
                }
            } catch (e) {
                console.warn('[Wafi Claims] resend-draft: could not fetch threadId from Gmail:', e.message);
            }
        }

        if (!threadId) return res.status(400).json({ error: 'Could not determine Gmail thread ID for this session' });

        const html = buildConfirmationHtml({
            sessionId,
            filename: session.attachment_filename,
            claimMonth: session.claim_month,
            settlementMonth: session.payroll_month,
            items,
        });

        const draftId = await createGmailDraft(
            gmail, threadId, session.sender_email,
            session.subject || 'Re: Claims Submission', html
        );

        if (draftId) {
            await pool.query('UPDATE wafi_claims_sessions SET confirm_email_sent = TRUE WHERE id = $1', [sessionId]);
            console.log(`[Wafi Claims] Resend draft: draft ${draftId} created for session ${sessionId}`);
            res.json({ ok: true, draftId, message: 'Confirmation draft created in Gmail. Open Gmail Drafts to review and send.' });
        } else {
            res.status(500).json({ error: 'Draft creation failed — check Gmail credentials' });
        }
    } catch (err) {
        console.error('[Wafi Claims] resend-draft error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/wafi-claims/sessions/:id/reprocess
// Resets an IRRELEVANT/WRONG_FORMAT/VALIDATION_FAILED/SKIPPED session so the next poll re-ingests it.
app.post('/api/wafi-claims/sessions/:id/reprocess', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const result = await reprocessSession(pool, sessionId);
        res.json({ ok: true, ...result, message: `Session ${sessionId} queued for reprocessing. Run Poll Now to process it.` });
    } catch (e) {
        console.error('[Wafi Claims] Reprocess error:', e.message);
        res.status(400).json({ error: 'Internal server error' });
    }
});

// POST /api/wafi-claims/sessions/:id/send-verification-draft
// Manually triggers a verification email to the original sender + CC matched line managers.
// Re-fetches the Gmail message to extract the CC list, then creates a draft in the thread.
app.post('/api/wafi-claims/sessions/:id/send-verification-draft', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);

        // Load session
        const { rows } = await pool.query(
            `SELECT id, sender_email, subject, gmail_message_id, gmail_thread_id,
                    attachment_filename AS filename, name_warnings, validation_errors, qc_email_sent, location_name
             FROM wafi_claims_sessions WHERE id = $1`, [sessionId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Session not found' });
        const sess = rows[0];

        // Build warning list from stored warnings + validation_errors (time/OT related)
        const allWarnings = [...(sess.name_warnings || []), ...(sess.validation_errors || [])];
        const verifyWarnings = allWarnings.filter(w => {
            const text = (w.warning || w.note || w.error || '').toLowerCase();
            return text.includes('time mismatch') || text.includes('high ot') ||
                   text.includes('customarily reserved') || text.includes('3x is customarily');
        });

        if (verifyWarnings.length === 0) {
            return res.status(400).json({ error: 'No time mismatch or OT warnings found on this session' });
        }

        // Re-fetch the original email to get CC addresses
        let ccWafiEmails = [];
        try {
            const gmail = wafiClaims.createGmailClientExported();
            if (gmail && sess.gmail_message_id) {
                const { data: msg } = await gmail.users.messages.get({
                    userId: 'me', id: sess.gmail_message_id, format: 'metadata',
                    metadataHeaders: ['Cc', 'cc'],
                });
                const ccHeader = (msg.payload?.headers || []).find(h => h.name.toLowerCase() === 'cc');
                if (ccHeader?.value) {
                    const matches = [...ccHeader.value.matchAll(/([a-zA-Z0-9._%+-]+@wafi-energy\.com)/gi)];
                    ccWafiEmails = matches.map(m => m[1].toLowerCase());
                }
            }
        } catch (gmailErr) {
            console.warn('[Send Verification] Could not fetch CC from Gmail:', gmailErr.message);
        }

        // Also check req.body for manually entered line manager email
        if (req.body?.lineManagerEmail) {
            const manual = String(req.body.lineManagerEmail).toLowerCase().trim();
            if (manual && !ccWafiEmails.includes(manual)) ccWafiEmails.push(manual);
        }

        // Match line managers from warning rows against CC emails
        const { rows: items } = await pool.query(
            `SELECT line_manager FROM wafi_claims_items WHERE session_id = $1 AND active = TRUE`, [sessionId]
        );
        const lineManagerEmails = wafiClaims.matchLineManagerEmailsExported(items, ccWafiEmails);

        // Add Focal Points
        try {
            const focalQuery = sess.location_name 
                ? `SELECT email FROM wafi_focal_points WHERE active = TRUE AND location = $1` 
                : `SELECT email FROM wafi_focal_points WHERE active = TRUE`;
            const focalParams = sess.location_name ? [sess.location_name] : [];
            const { rows: focalRows } = await pool.query(focalQuery, focalParams);
            focalRows.forEach(f => {
                const fe = f.email.toLowerCase().trim();
                if (fe && !lineManagerEmails.includes(fe)) {
                    lineManagerEmails.push(fe);
                }
            });
        } catch (fErr) {
            console.warn('[Send Verification] Could not fetch focal points:', fErr.message);
        }

        // Build and send the draft
        const gmail = wafiClaims.createGmailClientExported();
        if (!gmail) return res.status(500).json({ error: 'Gmail not configured' });

        const draftId = await wafiClaims.createVerificationDraftExported(
            gmail,
            sess.gmail_thread_id,
            sess.sender_email,
            lineManagerEmails,
            sess.subject || 'Claims Verification Required',
            sessionId,
            sess.filename,
            verifyWarnings
        );

        if (!draftId) return res.status(500).json({ error: 'Failed to create Gmail draft — check Gmail credentials' });

        await pool.query('UPDATE wafi_claims_sessions SET qc_email_sent = TRUE WHERE id = $1', [sessionId]);

        res.json({
            ok: true,
            message: `Verification draft created in Gmail. ${lineManagerEmails.length > 0 ? `CC: ${lineManagerEmails.join(', ')}` : 'No line managers matched from CC list — draft sent to submitter only.'}`,
            draftId,
            ccEmails: lineManagerEmails,
        });
    } catch (e) {
        console.error('[Send Verification Draft] Error:', e.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/wafi-claims/sessions/:id/download-excel
// Fetches the original Excel attachment directly from Gmail and downloads it.
app.get('/api/wafi-claims/sessions/:id/download-excel', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { rows } = await pool.query(
            `SELECT gmail_message_id, attachment_filename 
             FROM wafi_claims_sessions WHERE id = $1`, [sessionId]
        );
        if (!rows.length || !rows[0].gmail_message_id || !rows[0].attachment_filename) {
            return res.status(404).send('Session or attachment not found');
        }

        const gmail = wafiClaims.createGmailClientExported();
        if (!gmail) return res.status(500).send('Gmail not configured');

        // Handle composite IDs used when an email has multiple attachments (e.g. "msgId::filename")
        const actualMsgId = rows[0].gmail_message_id.split('::')[0];

        const buffer = await wafiClaims.downloadAttachmentFromGmailExported(
            gmail, actualMsgId, rows[0].attachment_filename
        );
        if (!buffer) return res.status(404).send('Attachment could not be downloaded from Gmail');

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${rows[0].attachment_filename}"`);
        res.send(buffer);
    } catch (e) {
        console.error('[Download Excel] Error:', e.message);
        res.status(500).send(e.message);
    }
});

// POST /api/wafi-claims/sessions/:id/upload-excel
// Upload a corrected Excel file to overwrite the session items
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/wafi-claims/sessions/:id/upload-excel', requireAuth, upload.single('file'), async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });

        // Verify session exists
        const { rows } = await pool.query(
            `SELECT id, sender_email, attachment_filename FROM wafi_claims_sessions WHERE id = $1`, 
            [sessionId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Session not found' });
        const sess = rows[0];

        console.log(`[Wafi Claims] Reprocessing session ${sessionId} with uploaded file: ${file.originalname}`);

        // Re-process the excel using wafiClaimsService logic
        const result = await wafiClaims.processUploadedFixExported(
            pool,
            file.buffer, 
            sessionId, 
            sess.sender_email, 
            file.originalname
        );

        if (!result.success) {
            return res.status(400).json({ error: 'Failed to process uploaded file: ' + result.error });
        }

        res.json({ ok: true, message: 'Fix uploaded and processed successfully' });
    } catch (e) {
        console.error('[Upload Excel Fix] Error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/wafi-claims/sessions/:id/override-multiplier

// Admin overrides OT multiplier for a specific row (e.g. Triple → Double for Sunday violations)
app.post('/api/wafi-claims/sessions/:id/override-multiplier', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { rowNumber, newMultiplier } = req.body;
        if (!rowNumber || !newMultiplier) return res.status(400).json({ error: 'rowNumber and newMultiplier are required' });

        const multMap = { single: 1, double: 2, triple: 3 };
        const factor = multMap[String(newMultiplier).toLowerCase()];
        if (!factor) return res.status(400).json({ error: 'newMultiplier must be single, double, or triple' });

        // Load the item
        const { rows: items } = await pool.query(
            `SELECT wci.*, e.salary FROM wafi_claims_items wci
             LEFT JOIN employees e ON e.id::text = wci.employee_id
             WHERE wci.session_id = $1 AND wci.row_number = $2 AND wci.active = TRUE`,
            [sessionId, rowNumber]
        );
        if (!items.length) return res.status(404).json({ error: 'Item not found' });
        const item = items[0];

        // Recalculate payout
        const salary = parseFloat(item.salary) || 0;
        const hours  = parseFloat(item.ot_hours) || 0;
        const hourlyRate = salary > 0 ? salary / 26 / 8 : 0;
        const newPayout = hourlyRate > 0 ? parseFloat((hours * factor * hourlyRate).toFixed(2)) : null;

        // Update item
        await pool.query(
            `UPDATE wafi_claims_items SET ot_multiplier = $1, ot_multiplier_factor = $2, ot_payout = $3,
             updated_at = NOW() WHERE session_id = $4 AND row_number = $5 AND active = TRUE`,
            [newMultiplier, factor, newPayout, sessionId, rowNumber]
        );

        // Remove the labour law error for this row from session's validation_errors
        const { rows: sessRows } = await pool.query(
            'SELECT validation_errors, processing_status FROM wafi_claims_sessions WHERE id = $1', [sessionId]
        );
        if (sessRows.length) {
            let errors = sessRows[0].validation_errors || [];
            const originalCount = errors.length;
            errors = errors.filter(e =>
                !(parseInt(e.row) === parseInt(rowNumber) && e.error?.toLowerCase().includes('labour law'))
            );
            const removed = originalCount - errors.length;
            // Determine new status
            const remainingHard = errors.filter(e => !e.error?.toLowerCase().includes('time mismatch') && !e.error?.toLowerCase().includes('high ot'));
            const newStatus = remainingHard.length === 0 ? 'PENDING_REVIEW' : sessRows[0].processing_status;
            await pool.query(
                `UPDATE wafi_claims_sessions SET validation_errors = $1::jsonb, processing_status = $2 WHERE id = $3`,
                [JSON.stringify(errors), newStatus, sessionId]
            );
            console.log(`[Override] Session ${sessionId} row ${rowNumber}: Triple→${newMultiplier}, removed ${removed} error(s), new status: ${newStatus}`);
        }

        res.json({ ok: true, message: `Row ${rowNumber} OT multiplier overridden to ${newMultiplier}`, newPayout });
    } catch (e) {
        console.error('[Override Multiplier] Error:', e.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/wafi-claims/sessions/:id/undo-stage

// SUPERADMIN ONLY — reverses a staged payroll push for a session.
// Subtracts the exact OT/expense/medical amounts that were added, resets session flags.
app.post('/api/wafi-claims/sessions/:id/undo-stage', requireAuth, requireRole('superadmin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const sessionId = parseInt(req.params.id);
        await client.query('BEGIN');

        // Load session
        const { rows: sessionRows } = await client.query(
            'SELECT * FROM wafi_claims_sessions WHERE id = $1', [sessionId]
        );
        if (!sessionRows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Session not found' });
        }
        const session = sessionRows[0];
        if (!session.pushed_to_payroll || !session.payroll_month) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Session has not been staged — nothing to undo' });
        }

        const payrollMonth = new Date(session.payroll_month);
        const month = payrollMonth.getMonth() + 1;
        const year  = payrollMonth.getFullYear();

        // Load items (same logic as stage-payroll)
        const { rows: items } = await client.query(
            `SELECT wci.*, e.salary
             FROM wafi_claims_items wci
             LEFT JOIN employees e ON e.id = wci.employee_id
             WHERE wci.session_id = $1 AND wci.active = TRUE`,
            [sessionId]
        );

        const otPushMap = {}, expPushMap = {}, medPushMap = {};
        for (const item of items) {
            const empId = item.employee_id;
            if (!empId) continue;
            const salary     = parseFloat(item.salary) || 0;
            const hourlyRate = salary / 26 / 8;
            if (item.claim_type === 'OT') {
                const hrs    = parseFloat(item.ot_hours)             || 0;
                const factor = parseFloat(item.ot_multiplier_factor) || 1;
                otPushMap[empId] = (otPushMap[empId] || 0) + hrs * factor * hourlyRate;
            } else if (item.claim_type === 'EXPENSE') {
                expPushMap[empId] = (expPushMap[empId] || 0) + (parseFloat(item.raw_amount) || 0);
            } else if (item.claim_type === 'MEDICAL') {
                medPushMap[empId] = (medPushMap[empId] || 0) + (parseFloat(item.raw_amount) || 0);
            }
        }

        // Subtract from payroll_transactions
        const affectedEmps = new Set([
            ...Object.keys(otPushMap),
            ...Object.keys(expPushMap),
            ...Object.keys(medPushMap),
        ]);

        let reversed = 0;
        for (const empId of affectedEmps) {
            const otAmt  = parseFloat((otPushMap[empId]  || 0).toFixed(2));
            const expAmt = parseFloat((expPushMap[empId] || 0).toFixed(2));
            const medAmt = parseFloat((medPushMap[empId] || 0).toFixed(2));

            // Subtract what was added; clamp to 0 to avoid negatives
            await client.query(`
                UPDATE payroll_transactions
                SET ot    = GREATEST(0, ot    - $4),
                    reimb = GREATEST(0, reimb - $5),
                    opd   = GREATEST(0, opd   - $6)
                WHERE employee_id = $1 AND month = $2 AND year = $3
            `, [empId, month, year, otAmt, expAmt, medAmt]);
            reversed++;
        }

        // Reset session flags
        await client.query(`
            UPDATE wafi_claims_sessions
            SET pushed_to_payroll = FALSE,
                payroll_month     = NULL,
                processing_status = CASE
                    WHEN processing_status = 'VERIFIED' THEN 'PENDING_REVIEW'
                    ELSE 'PROCESSED_SUCCESSFULLY'
                END
            WHERE id = $1
        `, [sessionId]);

        await client.query('COMMIT');
        console.log(`[Wafi Claims] SUPERADMIN undo-stage: session ${sessionId} reversed for ${year}-${month} (${reversed} employees)`);

        res.json({
            ok: true,
            message: `Undo complete — reversed payroll entries for ${reversed} employee(s) in ${year}-${String(month).padStart(2,'0')}`,
            reversed,
            sessionId,
            undoneBy: req.user?.email || req.user?.name || 'superadmin',
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[POST /api/wafi-claims/sessions/:id/undo-stage]', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/wafi-claims/sessions/:id/override-employee
// Admin manually maps a wrong employee code to the correct employee.
// If all validation errors are resolved the session flips to PROCESSED_SUCCESSFULLY.
app.post('/api/wafi-claims/sessions/:id/override-employee', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        const sessionId   = parseInt(req.params.id);
        const { rawCode, correctEmployeeId } = req.body;
        if (!rawCode || !correctEmployeeId) {
            return res.status(400).json({ error: 'rawCode and correctEmployeeId are required' });
        }

        await client.query('BEGIN');

        // Verify session exists and is VALIDATION_FAILED
        const { rows: sessRows } = await client.query(
            `SELECT id, processing_status, validation_errors FROM wafi_claims_sessions WHERE id = $1`,
            [sessionId]
        );
        if (!sessRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Session not found' }); }
        const sess = sessRows[0];
        if (sess.processing_status !== 'VALIDATION_FAILED') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Session is ${sess.processing_status} — only VALIDATION_FAILED sessions can be overridden` });
        }

        // Verify the correct employee exists
        const { rows: empRows } = await client.query(
            `SELECT id, name, salary FROM employees WHERE id = $1 LIMIT 1`,
            [correctEmployeeId]
        );
        if (!empRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: `Employee ${correctEmployeeId} not found in DB` }); }
        const emp = empRows[0];

        // Normalize the raw code to match what was stored
        const normalize = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const rawNorm = normalize(rawCode);

        // Update all items in this session that have this raw code
        const { rowCount } = await client.query(`
            UPDATE wafi_claims_items
            SET employee_id       = $1,
                employee_name_db  = $2,
                name_similarity   = 1.000
            WHERE session_id = $3
              AND LOWER(REGEXP_REPLACE(employee_code_raw, '[^a-zA-Z0-9]', '', 'g')) = $4
        `, [correctEmployeeId, emp.name, sessionId, rawNorm]);

        if (rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: `No items found in session ${sessionId} with raw code "${rawCode}" (normalized: ${rawNorm})` });
        }

        // Remove validation errors that mention this raw code
        const currentErrors = sess.validation_errors || [];
        const remaining = currentErrors.filter(e =>
            !(e.error && e.error.toLowerCase().includes('employee code not found') &&
              normalize(String(e.value || '')) === rawNorm)
        );

        // If no errors remain → flip session to PROCESSED_SUCCESSFULLY
        const newStatus = remaining.length === 0 ? 'PROCESSED_SUCCESSFULLY' : 'VALIDATION_FAILED';
        await client.query(
            `UPDATE wafi_claims_sessions SET validation_errors = $1::jsonb, processing_status = $2 WHERE id = $3`,
            [JSON.stringify(remaining), newStatus, sessionId]
        );

        await client.query('COMMIT');

        res.json({
            ok: true,
            itemsUpdated: rowCount,
            errorsRemaining: remaining.length,
            newStatus,
            message: `Mapped "${rawCode}" → ${correctEmployeeId} (${emp.name}). ${rowCount} item(s) updated. Session is now ${newStatus}.`,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[POST /api/wafi-claims/sessions/:id/override-employee]', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /api/wafi-claims/employee-search?q=...
// Searchable employee dropdown for the override modal
app.get('/api/wafi-claims/employee-search', requireAuth, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json({ employees: [] });
        const { rows } = await pool.query(`
            SELECT id, name, dept, location
            FROM employees
            WHERE name ILIKE $1 OR id ILIKE $1
            ORDER BY name
            LIMIT 20
        `, [`%${q}%`]);
        res.json({ employees: rows });
    } catch (err) { console.error('[GET /api/wafi-claims/employee-search]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/wafi-claims/stats
app.get('/api/wafi-claims/stats', requireAuth, async (req, res) => {
    try {
        const { archive } = await cutover.resolveArchiveMode(req, pool);
        const periodClause = wafiApproval.wafiSessionPeriodClause('wafi_claims_sessions', { archive });
        const { rows } = await pool.query(`
            SELECT
                COUNT(*) AS total_sessions,
                COUNT(*) FILTER (WHERE processing_status IN ('PROCESSED_SUCCESSFULLY','VERIFIED')) AS passed,
                COUNT(*) FILTER (WHERE processing_status = 'VALIDATION_FAILED') AS failed,
                COUNT(*) FILTER (WHERE processing_status = 'PENDING_REVIEW') AS pending_review,
                COUNT(*) FILTER (WHERE processing_status = 'IRRELEVANT') AS irrelevant,
                COUNT(*) FILTER (WHERE processing_status = 'SKIPPED') AS skipped,
                COUNT(*) FILTER (WHERE processing_status IN ('PROCESSED_SUCCESSFULLY','VERIFIED') AND pushed_to_payroll = FALSE) AS pending_payroll,
                COUNT(*) FILTER (WHERE approval_state = 'pending_focal_input') AS pending_focal,
                COUNT(*) FILTER (WHERE approval_state = 'pending_lm_approval') AS pending_lm,
                COUNT(*) FILTER (WHERE approval_state = 'ready_for_hcm') AS ready_for_hcm,
                SUM(total_ot_rows) AS total_ot_rows,
                SUM(total_expense_rows) AS total_expense_rows,
                SUM(total_medical_rows) AS total_medical_rows,
                MAX(received_at) AS last_received_at
            FROM wafi_claims_sessions
            WHERE ${periodClause}
        `);
        res.json({ ...rows[0], archive_mode: archive });
    } catch (err) { console.error('[GET /api/wafi-claims/stats]', err); res.status(500).json({ error: 'Internal server error' }); }
});

const wafiFocalActionHtml = (sessionId, token, step) => `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;padding:24px;">
<h2>Wafi Claims — ${step === 'lm' ? 'Manager' : 'Focal'} Action</h2>
<p>Session #${sessionId}</p>
<form method="POST" action="/api/wafi-claims/${step}-action" style="margin-top:1.5rem">
  <input type="hidden" name="token" value="${token}" />
  <input type="hidden" name="id" value="${sessionId}" />
  <label>Comment (optional)<br/><textarea name="comment" rows="3" style="width:100%;max-width:480px"></textarea></label><br/><br/>
  <button type="submit" name="decision" value="approve" style="padding:10px 20px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer">Approve</button>
  <button type="submit" name="decision" value="reject" style="padding:10px 20px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-left:8px">Reject</button>
</form></body></html>`;

app.get('/api/wafi-claims/focal-action', async (req, res) => {
    try {
        const { token, id } = req.query;
        if (!token || !id) return res.status(400).send('Missing token or id');
        res.send(wafiFocalActionHtml(id, token, 'focal'));
    } catch (err) {
        console.error('[GET /api/wafi-claims/focal-action]', err);
        res.status(500).send('Internal server error');
    }
});

app.post('/api/wafi-claims/focal-action', async (req, res) => {
    try {
        const token = req.body?.token || req.query?.token;
        const sessionId = parseInt(req.body?.id || req.query?.id, 10);
        const decision = (req.body?.decision || 'approve').toLowerCase() === 'reject' ? 'reject' : 'approve';
        const result = await wafiApproval.handleFocalAction(pool, {
            sessionId, token, decision, comment: req.body?.comment,
            actorEmail: req.body?.actor_email || null,
        });
        if (!result.ok) return res.status(result.status || 400).send(result.error || 'Action failed');
        if (result.lmToken && result.lmEmail) {
            try {
                const url = wafiApproval.buildActionLink(
                    process.env.APP_BASE_URL || process.env.BACKEND_URL || '',
                    '/api/wafi-claims/lm-action', result.lmToken, sessionId
                );
                await sendAppEmail({
                    to: result.lmEmail,
                    subject: `[ASIL HCM] Wafi claims — manager approval required (#${sessionId})`,
                    html: wafiApproval.buildApprovalEmailHtml({
                        title: 'Wafi Claims — Manager Approval',
                        sessionId,
                        actionUrl: url,
                        instructions: 'Focal has approved. Please complete manager approval.',
                    }),
                });
            } catch (_) {}
        }
        res.send(`<p>Decision recorded: ${result.state}. You may close this window.</p>`);
    } catch (err) {
        console.error('[POST /api/wafi-claims/focal-action]', err);
        res.status(500).send('Internal server error');
    }
});

app.get('/api/wafi-claims/lm-action', async (req, res) => {
    try {
        const { token, id } = req.query;
        if (!token || !id) return res.status(400).send('Missing token or id');
        res.send(wafiFocalActionHtml(id, token, 'lm'));
    } catch (err) {
        console.error('[GET /api/wafi-claims/lm-action]', err);
        res.status(500).send('Internal server error');
    }
});

app.post('/api/wafi-claims/lm-action', async (req, res) => {
    try {
        const token = req.body?.token || req.query?.token;
        const sessionId = parseInt(req.body?.id || req.query?.id, 10);
        const decision = (req.body?.decision || 'approve').toLowerCase() === 'reject' ? 'reject' : 'approve';
        const result = await wafiApproval.handleLmAction(pool, {
            sessionId, token, decision, comment: req.body?.comment,
            actorEmail: req.body?.actor_email || null,
        });
        if (!result.ok) return res.status(result.status || 400).send(result.error || 'Action failed');
        res.send(`<p>Decision recorded: ${result.state}. You may close this window.</p>`);
    } catch (err) {
        console.error('[POST /api/wafi-claims/lm-action]', err);
        res.status(500).send('Internal server error');
    }
});

// POST /api/wafi-claims/sessions/:id/verify
// Verify + push to payroll + create Gmail draft confirmation in the original thread
app.post('/api/wafi-claims/sessions/:id/verify', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        const sessionId = parseInt(req.params.id);
        const { month, year } = req.body; // settlement month selected by admin
        if (!month || !year) return res.status(400).json({ error: 'month and year required for settlement' });

        await client.query('BEGIN');

        const { rows: sessRows } = await client.query(
            `SELECT * FROM wafi_claims_sessions WHERE id = $1`, [sessionId]
        );
        if (!sessRows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Session not found' }); }
        const sess = sessRows[0];
        if (!['PENDING_REVIEW', 'PROCESSED_SUCCESSFULLY'].includes(sess.processing_status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Cannot verify session with status ${sess.processing_status}` });
        }

        const approvalGate = await wafiApproval.assertReadyForHcm(client, sessionId);
        if (!approvalGate.ok) {
            await client.query('ROLLBACK');
            return res.status(approvalGate.status || 409).json({
                error: approvalGate.message || 'Approval chain incomplete',
                code: approvalGate.code,
                approval_state: approvalGate.approval_state,
            });
        }

        // Push items to employee_claims (World B intake)
        const { rows: items } = await client.query(
            `SELECT * FROM wafi_claims_items WHERE session_id = $1 AND active = TRUE`, [sessionId]
        );
        const sessionRef = sess.attachment_filename || sess.subject || String(sessionId);
        const stageResult = await stageWafiSessionToEmployeeClaims(client, {
            sessionId,
            sessionRef,
            month,
            year,
            items,
        });
        const { upserted, affectedEmployees, skipped_locked } = stageResult;

        // Determine claim month label (for email)
        const claimMonthLabel = sess.claim_month
            ? new Date(sess.claim_month).toLocaleString('en-US', { month: 'long', year: 'numeric' })
            : 'the submitted period';
        const settlementDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        const settlementMonthLabel = settlementDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

        // Update session
        const verifiedBy = req.user?.email || req.user?.username || 'admin';
        await client.query(`
            UPDATE wafi_claims_sessions
            SET processing_status = 'VERIFIED',
                pushed_to_payroll = TRUE,
                payroll_month     = $1,
                settlement_month  = $1,
                verified_at       = NOW(),
                verified_by       = $2
            WHERE id = $3
        `, [settlementDate.toISOString().slice(0, 10), verifiedBy, sessionId]);

        await client.query('COMMIT');

        // Create Gmail draft (thread-aware reply) — outside transaction
        let draftId = null;
        try {
            const gmail = createGmailClient();
            if (gmail && sess.gmail_thread_id) {
                // Load items for per-employee table
                const { rows: verifyItems } = await pool.query(
                    'SELECT * FROM wafi_claims_items WHERE session_id = $1 AND active = TRUE ORDER BY tab_name, row_number',
                    [sessionId]
                ).catch(() => ({ rows: [] }));
                const html = buildConfirmationHtml({
                    sessionId,
                    filename: sess.attachment_filename,
                    claimMonth: sess.claim_month,
                    settlementMonth: settlementDate,
                    items: verifyItems,
                });
                draftId = await createGmailDraft(gmail, sess.gmail_thread_id, sess.sender_email, sess.subject || 'Claims Submission', html);
                if (draftId) {
                    await pool.query(`UPDATE wafi_claims_sessions SET gmail_draft_id = $1 WHERE id = $2`, [draftId, sessionId]);
                }
            }
        } catch (e) { console.warn('[Wafi Verify] Draft creation warning:', e.message); }

        // Apply verified label
        try {
            const gmail = createGmailClient();
            if (gmail && sess.gmail_message_id) {
                await gmail.users.messages.modify({
                    userId: 'me', id: sess.gmail_message_id,
                    requestBody: { addLabelIds: [], removeLabelIds: [] }, // label applied via applyLabel in service
                });
            }
        } catch (_) {}

        res.json({
            ok: true,
            message: `Session ${sessionId} verified. ${affectedEmployees} employees staged (${upserted} claim rows) to ${settlementMonthLabel} payroll.${draftId ? ' Confirmation draft created in Gmail.' : ''}`,
            upserted,
            affectedEmployees,
            skipped_locked,
            settlementMonth: settlementMonthLabel,
            draftId,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[POST /api/wafi-claims/sessions/:id/verify]', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// POST /api/wafi-claims/sessions/:id/skip
// Mark irrelevant/unwanted sessions as SKIPPED and apply Not-Relevant label
app.post('/api/wafi-claims/sessions/:id/skip', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { rows } = await pool.query(
            `UPDATE wafi_claims_sessions SET processing_status = 'SKIPPED' WHERE id = $1 RETURNING gmail_message_id, processing_status`,
            [sessionId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Session not found' });
        res.json({ ok: true, message: `Session ${sessionId} skipped` });
    } catch (err) { console.error('[POST /api/wafi-claims/sessions/:id/skip]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/wafi-claims/sessions/:id/reject
// Admin permanently rejects a VALIDATION_FAILED session (removes from pending queue)
app.post('/api/wafi-claims/sessions/:id/reject', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { rows } = await pool.query(
            `UPDATE wafi_claims_sessions SET processing_status = 'REJECTED'
             WHERE id = $1 AND processing_status IN ('VALIDATION_FAILED','PENDING_REVIEW','WRONG_FORMAT')
             RETURNING id`,
            [sessionId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Session not found or cannot be rejected in its current state' });
        res.json({ ok: true, message: `Session ${sessionId} marked REJECTED` });
    } catch (err) { console.error('[POST /api/wafi-claims/sessions/:id/reject]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// DELETE /api/wafi-claims/sessions/:id — hard delete a session and its items (superadmin only)
app.delete('/api/wafi-claims/sessions/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        await pool.query('DELETE FROM wafi_claims_items WHERE session_id = $1', [sessionId]);
        const { rows } = await pool.query('DELETE FROM wafi_claims_sessions WHERE id = $1 RETURNING id, attachment_filename', [sessionId]);
        if (!rows.length) return res.status(404).json({ error: 'Session not found' });
        logAudit(req, 'wafi_session_delete', 'wafi_claims_session', sessionId);
        res.json({ ok: true, message: `Session ${sessionId} (${rows[0].attachment_filename}) permanently deleted` });
    } catch (err) { console.error('[DELETE /api/wafi-claims/sessions/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/wafi-claims/admin/purge-bad-sessions
// One-time cleanup: deletes sessions with composite IDs from the broken auto-segregation code.
app.post('/api/wafi-claims/admin/purge-bad-sessions', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { rows: bad } = await pool.query(`
            SELECT id, gmail_message_id, attachment_filename, processing_status, sender_email
            FROM wafi_claims_sessions
            WHERE gmail_message_id ~ '_[0-9]{4}-[0-9]{2}$'
            ORDER BY id
        `);
        if (bad.length === 0) return res.json({ ok: true, purged: 0, message: 'No bad sessions found' });
        const ids = bad.map(r => r.id);
        await pool.query('DELETE FROM wafi_claims_items WHERE session_id = ANY($1)', [ids]);
        await pool.query('DELETE FROM wafi_claims_sessions WHERE id = ANY($1)', [ids]);
        console.log('[Admin] Purged bad auto-segregated sessions:', ids);
        res.json({ ok: true, purged: bad.length, sessions: bad.map(r => ({ id: r.id, file: r.attachment_filename, status: r.processing_status })) });
    } catch (err) { console.error('[POST /api/wafi-claims/admin/purge-bad-sessions]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/wafi-claims/sessions/:id/admin-override
// Admin-verified override: promotes VALIDATION_FAILED → PROCESSED_SUCCESSFULLY.
// Use when errors (e.g. duplicate rows) have been reviewed and the data is confirmed correct.
// Stores an audit note with who overrode and the provided reason.
app.post('/api/wafi-claims/sessions/:id/admin-override', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const overriddenBy = req.user?.email || req.user?.name || 'admin';
        const reason = (req.body?.reason || 'Admin verified — errors acknowledged').trim();
        const note = `Overridden by ${overriddenBy} at ${new Date().toISOString()}: ${reason}`;

        // Safely add override_note column if it doesn't exist yet
        await pool.query(`ALTER TABLE wafi_claims_sessions ADD COLUMN IF NOT EXISTS override_note TEXT`);

        const { rows } = await pool.query(
            `UPDATE wafi_claims_sessions
             SET processing_status = 'PROCESSED_SUCCESSFULLY',
                 override_note     = $2
             WHERE id = $1
               AND processing_status IN ('VALIDATION_FAILED', 'PENDING_REVIEW', 'WRONG_FORMAT')
             RETURNING id, sender_email, payroll_month`,
            [sessionId, note]
        );
        if (!rows.length) {
            return res.status(404).json({ error: 'Session not found or cannot be overridden in its current state' });
        }
        console.log(`[Wafi Claims] Admin override: session ${sessionId} → PROCESSED_SUCCESSFULLY by ${overriddenBy}`);
        res.json({ ok: true, sessionId, message: `Session marked as Passed. You can now Stage it to payroll.` });
    } catch (err) {
        console.error('[Wafi Claims] Admin override error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/wafi-claims/sessions/:id/qc-draft
// Creates a Gmail draft in the original email thread with human-readable error list
// Based on the user-provided rejection email template
app.post('/api/wafi-claims/sessions/:id/qc-draft', requireAuth, async (req, res) => {
    try {
        const sessionId = parseInt(req.params.id);
        const { rows: sessionRows } = await pool.query(
            'SELECT * FROM wafi_claims_sessions WHERE id = $1', [sessionId]
        );
        if (!sessionRows.length) return res.status(404).json({ error: 'Session not found' });
        const sess = sessionRows[0];
        if (!sess.processing_status.includes('FAILED') && sess.processing_status !== 'VALIDATION_FAILED') {
            return res.status(400).json({ error: 'Only VALIDATION_FAILED sessions can get a QC draft' });
        }

        // Load items to split into accepted vs errored
        const { rows: items } = await pool.query(
            'SELECT * FROM wafi_claims_items WHERE session_id = $1 AND active = TRUE ORDER BY tab_name, row_number',
            [sessionId]
        );
        const errors = Array.isArray(sess.validation_errors) ? sess.validation_errors : [];

        // Group errors by sheet for human-readable summary
        const errorsBySheet = {};
        for (const e of errors) {
            const sheet = e.sheet || 'Unknown';
            if (!errorsBySheet[sheet]) errorsBySheet[sheet] = [];
            errorsBySheet[sheet].push(e);
        }

        // Accepted items by type
        const otItems  = items.filter(i => i.claim_type === 'OT');
        const expItems = items.filter(i => i.claim_type === 'EXPENSE');
        const medItems = items.filter(i => i.claim_type === 'MEDICAL');

        // Build employee name from first item
        const empName = items[0]?.employee_name_db || items[0]?.employee_name_raw || 'Team Member';
        const firstName = empName.split(' ')[0];

        // Build error bullets grouped by sheet
        const errorSheetsHtml = Object.entries(errorsBySheet).map(([sheet, errs]) => `
            <div style="margin-bottom:12px;">
              <strong style="color:#b91c1c;">${sheet} (${errs.length} issue${errs.length > 1 ? 's' : ''}):</strong>
              <ul style="margin:4px 0 0 0;padding-left:18px;color:#374151;font-size:0.88rem;line-height:1.8;">
                ${errs.map(e => `<li>Row ${e.row}, Col ${e.column}: ${e.error}${e.value ? ` — <em>"${String(e.value).slice(0,60)}"</em>` : ''}</li>`).join('')}
              </ul>
            </div>
        `).join('');

        // Accepted claims summary
        const otAccepted  = otItems.length  > 0 ? `<li>${otItems.length} Overtime claim row(s) were accepted.</li>` : '';
        const expAccepted = expItems.length > 0 ? `<li>${expItems.length} Expense claim row(s) were accepted (PKR ${expItems.reduce((s,i) => s + parseFloat(i.raw_amount||0), 0).toLocaleString('en-PK')}).</li>` : '';
        const medAccepted = medItems.filter(i => i.raw_amount > 0).length > 0
            ? `<li>${medItems.filter(i=>i.raw_amount>0).length} Medical claim row(s) were accepted.</li>` : '';
        const acceptedHtml = (otAccepted || expAccepted || medAccepted)
            ? `<ul style="color:#166534;margin:6px 0;padding-left:18px;font-size:0.88rem;line-height:1.8;">${otAccepted}${expAccepted}${medAccepted}</ul>`
            : '<p style="color:#6b7280;font-size:0.88rem;">No items could be accepted due to the issues above.</p>';

        const claimMonthLabel = sess.claim_month
            ? new Date(sess.claim_month).toLocaleString('en-US', { month: 'long', year: 'numeric' })
            : 'the submitted period';

        const html = `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:20px;">
<div style="max-width:680px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:linear-gradient(135deg,#7c2d12,#c2410c);padding:24px 32px;">
    <h1 style="color:#fff;margin:0;font-size:1.1rem;">ASIL HCM — Claims Submission: Action Required</h1>
    <p style="color:#fed7aa;margin:6px 0 0;font-size:0.85rem;">Ref: #${sessionId} · ${claimMonthLabel}</p>
  </div>
  <div style="padding:28px 32px;">
    <p style="color:#374151;margin:0 0 16px;">Dear ${firstName},</p>
    <p style="color:#374151;margin:0 0 16px;font-size:0.92rem;">We have reviewed your claims submission (${sess.attachment_filename || 'attachment'}). While some claims were accepted, we found the following issues that require your attention:</p>
    
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#b91c1c;margin:0 0 12px;font-size:0.9rem;text-transform:uppercase;letter-spacing:0.04em;">Issues Found</h3>
      ${errorSheetsHtml}
    </div>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:20px;">
      <h3 style="color:#166534;margin:0 0 8px;font-size:0.9rem;text-transform:uppercase;letter-spacing:0.04em;">Claims Accepted ✓</h3>
      ${acceptedHtml}
    </div>

    <p style="color:#374151;font-size:0.9rem;margin:0 0 16px;">Please reply with the corrected sheet attached. The earlier submission will be disregarded for the errored entries. We look forward to receiving the complete and corrected submission.</p>
    
    <div style="background:#fef9ec;border-left:4px solid #f59e0b;border-radius:6px;padding:12px 16px;margin-bottom:8px;">
      <p style="margin:0;color:#92400e;font-size:0.84rem;"><strong>Next Steps:</strong> Correct the highlighted issues and reply to this email with the updated file. Ensure all amounts are numeric and all ASIL employee codes are correct.</p>
    </div>

    <p style="color:#374151;margin:16px 0 4px;font-size:0.9rem;">Regards,<br><strong>ASIL HR Team</strong></p>
  </div>
  <div style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:0.75rem;margin:0;">Allied Services International (Pvt.) Ltd. · ASIL HCM · ${new Date().getFullYear()}</p>
  </div>
</div></body></html>`;

        // Create Gmail draft in the original thread
        const { createGmailClient, createGmailDraft } = require('./wafiClaimsService');
        const gmail = createGmailClient();
        let draftId = null;
        if (gmail && sess.gmail_thread_id) {
            draftId = await createGmailDraft(gmail, sess.gmail_thread_id, sess.sender_email,
                sess.subject || 'Re: Claims Submission',
                html);
        } else {
            console.log(`[Wafi Claims] QC Draft: No Gmail client or thread ID for session ${sessionId}`);
        }

        // Mark qc_email_sent
        await pool.query('UPDATE wafi_claims_sessions SET qc_email_sent = TRUE WHERE id = $1', [sessionId]);

        res.json({
            ok: true,
            draftId,
            message: draftId ? 'QC rejection draft created in Gmail' : 'Draft would be created (Gmail not configured or no thread ID)',
            errorsFound: errors.length,
            acceptedOt: otItems.length,
            acceptedExpense: expItems.length,
            acceptedMedical: medItems.filter(i=>i.raw_amount>0).length,
        });
    } catch (err) { console.error('[POST /api/wafi-claims/sessions/:id/qc-draft]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/wafi-claims/sessions/batch-verify
// Verify multiple PENDING_REVIEW sessions at once with the same settlement month
app.post('/api/wafi-claims/sessions/batch-verify', requireAuth, async (req, res) => {
    const { sessionIds, month, year } = req.body;
    if (!Array.isArray(sessionIds) || !month || !year) {
        return res.status(400).json({ error: 'sessionIds[], month, year required' });
    }
    const results = { verified: [], skipped: [], errors: [] };
    for (const id of sessionIds) {
        try {
            const r = await fetch(`http://localhost:${process.env.PORT || 3001}/api/wafi-claims/sessions/${id}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Cookie': req.headers.cookie || '' },
                body: JSON.stringify({ month, year }),
            });
            const d = await r.json();
            if (d.ok) results.verified.push(id);
            else results.skipped.push({ id, reason: d.error });
        } catch (e) {
            results.errors.push({ id, error: e.message });
        }
    }
    res.json({ ok: true, ...results });
});

// ── Focal Points CRUD ─────────────────────────────────────────────────────────
app.get('/api/wafi-claims/focal-points', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`SELECT * FROM wafi_focal_points ORDER BY location, name`);
        res.json({ focalPoints: rows });
    } catch (err) { console.error('[GET /api/wafi-claims/focal-points]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/wafi-claims/focal-points', requireAuth, async (req, res) => {
    try {
        const { email, name, location, role } = req.body;
        if (!email) return res.status(400).json({ error: 'email is required' });
        const { rows } = await pool.query(
            `INSERT INTO wafi_focal_points (email, name, location, role)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (email) DO UPDATE SET name=$2, location=$3, role=$4, active=TRUE
             RETURNING *`,
            [email.toLowerCase().trim(), name || null, location || null, role || 'claimed_by']
        );
        res.json({ ok: true, focalPoint: rows[0] });
    } catch (err) { console.error('[POST /api/wafi-claims/focal-points]', err); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/wafi-claims/focal-points/:id', requireAuth, async (req, res) => {
    try {
        await pool.query(`UPDATE wafi_focal_points SET active = FALSE WHERE id = $1`, [parseInt(req.params.id)]);
        logAudit(req, 'wafi_focal_point_deactivate', 'wafi_focal_point', req.params.id);
        res.json({ ok: true });
    } catch (err) { console.error('[DELETE /api/wafi-claims/focal-points/:id]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /api/wafi-claims/employee-claims?employeeCode=...&dateFrom=...&dateTo=...&claimType=...
// Consolidated view: all claims across all months for a given employee
app.get('/api/wafi-claims/employee-claims', requireAuth, async (req, res) => {
    try {
        const { employeeCode, dateFrom, dateTo, claimType } = req.query;
        const vals = [];
        let where = `WHERE wci.active = TRUE AND wcs.processing_status IN ('PENDING_REVIEW','VERIFIED','PROCESSED_SUCCESSFULLY')`;

        if (employeeCode) {
            vals.push(`%${employeeCode}%`);
            where += ` AND (wci.employee_id ILIKE $${vals.length} OR wci.employee_code_raw ILIKE $${vals.length} OR wci.employee_name_db ILIKE $${vals.length})`;
        }
        if (dateFrom) { vals.push(dateFrom); where += ` AND wci.claim_date >= $${vals.length}::date`; }
        if (dateTo)   { vals.push(dateTo);   where += ` AND wci.claim_date <= $${vals.length}::date`; }
        if (claimType && claimType !== 'ALL') { vals.push(claimType); where += ` AND wci.claim_type = $${vals.length}`; }

        const { rows } = await pool.query(`
            SELECT
                wci.employee_id,
                wci.employee_name_db,
                wci.claim_type,
                DATE_TRUNC('month', wci.claim_date) AS claim_month,
                COUNT(*) AS row_count,
                SUM(wci.ot_hours) AS total_ot_hours,
                SUM(wci.ot_payout) AS total_ot_payout,
                SUM(wci.raw_amount) AS total_amount,
                wcs.processing_status,
                wcs.id AS session_id,
                wcs.attachment_filename,
                wcs.settlement_month
            FROM wafi_claims_items wci
            JOIN wafi_claims_sessions wcs ON wcs.id = wci.session_id
            ${where}
            GROUP BY wci.employee_id, wci.employee_name_db, wci.claim_type,
                     DATE_TRUNC('month', wci.claim_date), wcs.processing_status,
                     wcs.id, wcs.attachment_filename, wcs.settlement_month
            ORDER BY claim_month DESC, wci.employee_name_db, wci.claim_type
        `, vals);

        // Group by employee then by month
        const byEmployee = {};
        for (const row of rows) {
            const empKey = row.employee_id || row.employee_name_db || 'Unknown';
            if (!byEmployee[empKey]) {
                byEmployee[empKey] = { employee_id: row.employee_id, name: row.employee_name_db, months: {} };
            }
            const mKey = row.claim_month ? row.claim_month.toISOString().slice(0, 7) : 'unknown';
            if (!byEmployee[empKey].months[mKey]) {
                byEmployee[empKey].months[mKey] = { month: mKey, claims: [] };
            }
            byEmployee[empKey].months[mKey].claims.push({
                claim_type: row.claim_type,
                row_count: parseInt(row.row_count),
                total_ot_hours: parseFloat(row.total_ot_hours) || 0,
                total_ot_payout: parseFloat(row.total_ot_payout) || 0,
                total_amount: parseFloat(row.total_amount) || 0,
                status: row.processing_status,
                session_id: row.session_id,
                attachment_filename: row.attachment_filename,
                settlement_month: row.settlement_month,
            });
        }

        const employees = Object.values(byEmployee).map(e => ({
            ...e,
            months: Object.values(e.months).sort((a, b) => b.month.localeCompare(a.month)),
        }));

        res.json({ employees, total: employees.length });
    } catch (err) { console.error('[GET /api/wafi-claims/employee-claims]', err); res.status(500).json({ error: 'Internal server error' }); }
});


// POST /api/wafi-claims/trigger-poll
app.post('/api/wafi-claims/trigger-poll', requireAuth, async (req, res) => {
    try {
        const result = await triggerWafiManualPoll(pool);
        res.json({ ok: true, result });
    } catch (err) { console.error('[POST /api/wafi-claims/trigger-poll]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /api/wafi-claims/admin/undo-all-staged
// SUPERADMIN ONLY — reverses ALL currently staged sessions.
// One-time utility; safe to call multiple times (idempotent per session).
app.post('/api/wafi-claims/admin/undo-all-staged', requireAuth, requireRole('superadmin'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: stagedSessions } = await client.query(
            `SELECT id, sender_email, attachment_filename, payroll_month,
                    total_ot_rows, total_expense_rows, total_medical_rows
             FROM wafi_claims_sessions
             WHERE pushed_to_payroll = TRUE
             ORDER BY received_at ASC`
        );

        if (!stagedSessions.length) {
            await client.query('ROLLBACK');
            return res.json({ ok: true, message: 'No staged sessions found — nothing to undo', undone: [] });
        }

        const results = [];
        for (const sess of stagedSessions) {
            const payrollMonth = new Date(sess.payroll_month);
            const month = payrollMonth.getMonth() + 1;
            const year  = payrollMonth.getFullYear();

            const { rows: items } = await client.query(
                `SELECT wci.*, e.salary
                 FROM wafi_claims_items wci
                 LEFT JOIN employees e ON e.id = wci.employee_id
                 WHERE wci.session_id = $1 AND wci.active = TRUE`,
                [sess.id]
            );

            const otMap = {}, expMap = {}, medMap = {};
            for (const item of items) {
                const empId = item.employee_id;
                if (!empId) continue;
                const salary = parseFloat(item.salary) || 0;
                const hourlyRate = salary / 26 / 8;
                if (item.claim_type === 'OT') {
                    const hrs    = parseFloat(item.ot_hours)             || 0;
                    const factor = parseFloat(item.ot_multiplier_factor) || 1;
                    otMap[empId]  = (otMap[empId]  || 0) + hrs * factor * hourlyRate;
                } else if (item.claim_type === 'EXPENSE') {
                    expMap[empId] = (expMap[empId] || 0) + (parseFloat(item.raw_amount) || 0);
                } else if (item.claim_type === 'MEDICAL') {
                    medMap[empId] = (medMap[empId] || 0) + (parseFloat(item.raw_amount) || 0);
                }
            }

            const allEmps = new Set([...Object.keys(otMap), ...Object.keys(expMap), ...Object.keys(medMap)]);
            let reversed = 0;
            for (const empId of allEmps) {
                const otAmt  = parseFloat((otMap[empId]  || 0).toFixed(2));
                const expAmt = parseFloat((expMap[empId] || 0).toFixed(2));
                const medAmt = parseFloat((medMap[empId] || 0).toFixed(2));
                await client.query(`
                    UPDATE payroll_transactions
                    SET ot    = GREATEST(0, ot    - $4),
                        reimb = GREATEST(0, reimb - $5),
                        opd   = GREATEST(0, opd   - $6)
                    WHERE employee_id = $1 AND month = $2 AND year = $3
                `, [empId, month, year, otAmt, expAmt, medAmt]);
                reversed++;
            }

            await client.query(`
                UPDATE wafi_claims_sessions
                SET pushed_to_payroll = FALSE,
                    payroll_month     = NULL,
                    processing_status = CASE
                        WHEN processing_status = 'VERIFIED' THEN 'PENDING_REVIEW'
                        ELSE 'PROCESSED_SUCCESSFULLY'
                    END
                WHERE id = $1
            `, [sess.id]);

            results.push({
                sessionId: sess.id,
                sender: sess.sender_email,
                file: sess.attachment_filename,
                month: `${year}-${String(month).padStart(2,'0')}`,
                employeesReversed: reversed,
            });
            console.log(`[Wafi Claims] ADMIN undo: session ${sess.id} (${sess.sender_email}) reversed — ${reversed} employees`);
        }

        await client.query('COMMIT');
        res.json({
            ok: true,
            message: `Undone ${results.length} staged session(s)`,
            undone: results,
            undoneBy: req.user?.email || req.user?.name || 'superadmin',
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[POST /api/wafi-claims/admin/undo-all-staged]', err);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// GET /api/wafi-claims/gmail-auth-status
app.get('/api/wafi-claims/gmail-auth-status', requireAuth, async (req, res) => {
    try {
        const gmailUser = process.env.GMAIL_USER || '';
        const configured = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
        const { rows } = await pool.query(
            'SELECT COUNT(*) AS total, MAX(received_at) AS last_received FROM wafi_claims_sessions'
        ).catch(() => ({ rows: [{ total: 0, last_received: null }] }));
        const maskedUser = gmailUser
            ? `${gmailUser.split('@')[0].slice(0, 3)}***@${gmailUser.split('@')[1] || ''}`
            : '(not set)';
        res.json({
            connected: configured,
            gmail_user: maskedUser,
            last_poll: getLastPollAt(),
            total_captured: parseInt(rows[0]?.total) || 0,
        });
    } catch (err) { console.error('[GET /api/wafi-claims/gmail-auth-status]', err); res.status(500).json({ error: 'Internal server error' }); }
});

// ── Central Error Handler ──────────────────────────────────────────────────

// Catches errors passed via next(err). Sanitizes output in production.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || err.statusCode || 500;
    const isDev = process.env.NODE_ENV !== 'production';
    console.error('[ERROR]', req.method, req.path, err.message);
    res.status(status).json({
        error: isDev ? err.message : 'An internal server error occurred.',
        ...(isDev && { detail: err.stack?.split('\n').slice(0, 3).join(' | ') }),
    });
});

process.on('SIGTERM', async () => {
    console.log('[SIGTERM] Shutting down gracefully — draining DB pool...');
    await pool.end();
    process.exit(0);
});
process.on('SIGINT', async () => {
    console.log('[SIGINT] Shutting down — draining DB pool...');
    await pool.end();
    process.exit(0);
});

// Export app for supertest (tests import server.js without starting a live server)
phase2.registerPhase2Routes(app, {
    pool,
    requireAuth,
    requireRole,
    requirePortalAuth,
    sendJazzSMS,
    sendAppEmail,
    JWT_SECRET,
    APP_BASE_URL,
});

const { mountRestructureModules, bootstrapRestructure, getMigrationStatus } = require('./mountModules');
mountRestructureModules(app, {
    pool,
    requireAuth,
    requireRole,
    logAudit,
    sendAppEmail,
    sendJazzSMS,
    getXeroAccessToken: xeroGetAccessToken,
});

phase2.setupPhase2Tables(pool, { sendAppEmail }).catch(e => console.warn('Phase 2 table setup warning:', e.message));

module.exports = app;

// Only bind a port when this file is run directly: `node server.js`
// When require()'d by Jest, this block is skipped — no EADDRINUSE conflicts.
if (require.main === module) app.listen(PORT, async () => {


    console.log(`ASIL HCM Backend running on port ${PORT}`);
    console.log(`[DB] Pool configured: max=10, idle=30s`);
    console.log(`Allowed domain: @${ALLOWED_DOMAIN}`);
    console.log(`[SMS] Jazz proxy ${isJazzProxyConfigured() ? `active (${jazzProxyLogLabel()})` : 'NOT configured — SMS will fail with IP not authorized'}`);
    // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼ One-time migrations (safe to run every restart, IF NOT EXISTS guards) ├óΓÇ¥Γé¼├óΓÇ¥Γé¼
    try {
        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼ hcm_users table (RBAC) ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS hcm_users (
                id          SERIAL PRIMARY KEY,
                google_id   TEXT UNIQUE NOT NULL,
                email       TEXT UNIQUE NOT NULL,
                name        TEXT,
                avatar      TEXT,
                role        TEXT NOT NULL DEFAULT 'pending',
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                last_login  TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('Migration OK: hcm_users table ready');

        await pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_date DATE');
        console.log('Migration OK: contract_date column ready');
        await pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_id TEXT');
        console.log('Migration OK: contract_id column ready');

        // MD Mandate §1 — seed known users (only if still pending; startup block above forces roles)
        const roleSeed = [
            { email: 'huzaifa.rafaqat@asil.com.pk', role: 'finance_manager' },
            { email: 'laiba.mughal@asil.com.pk',    role: 'procurement_manager' },
            { email: 'asif.awan@asil.com.pk',       role: 'finance_approver' },
            { email: 'obaid.rana@asil.com.pk',      role: 'operations' },
            { email: 'rabia.bhutto@asil.com.pk',    role: 'operations_supervisor' },
        ];
        for (const u of roleSeed) {
            await pool.query(
                `INSERT INTO hcm_users (google_id, email, name, role)
                 VALUES ($1, $2, split_part($2,'@',1), $3)
                 ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
                 WHERE hcm_users.role = 'pending'`,
                [`pending_${u.email}`, u.email, u.role]
            );
        }
        console.log('Migration OK: known user roles seeded');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_status_change_log (
                id SERIAL PRIMARY KEY,
                invoice_id INT,
                invoice_number TEXT,
                from_status TEXT,
                to_status TEXT NOT NULL,
                changed_by TEXT,
                changed_at TIMESTAMPTZ DEFAULT NOW(),
                summarized_at TIMESTAMPTZ
            )
        `);
        console.log('Migration OK: payment_status_change_log');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Inventory tables ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS inventory_items (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT,
                description TEXT,
                unit TEXT DEFAULT 'piece',
                has_expiry BOOLEAN DEFAULT FALSE,
                expiry_months INTEGER,
                min_stock INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS inventory_stock (
                id SERIAL PRIMARY KEY,
                item_id INTEGER REFERENCES inventory_items(id) ON DELETE CASCADE,
                quantity INTEGER NOT NULL,
                unit_cost NUMERIC(12,2),
                supplier TEXT,
                receipt_no TEXT,
                po_number TEXT,
                received_date DATE,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS inventory_issuance (
                id SERIAL PRIMARY KEY,
                item_id INTEGER REFERENCES inventory_items(id) ON DELETE RESTRICT,
                employee_id TEXT,
                employee_name TEXT,
                quantity INTEGER DEFAULT 1,
                issue_date DATE,
                expiry_date DATE,
                return_date DATE,
                status TEXT DEFAULT 'Issued',
                condition_out TEXT DEFAULT 'New',
                condition_in TEXT,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Migration OK: inventory tables ready');

        // Seed default items (only if catalog is empty)
        const { rows: existing } = await pool.query('SELECT COUNT(*) AS cnt FROM inventory_items');
        if (parseInt(existing[0].cnt) === 0) {
            await pool.query(`
                INSERT INTO inventory_items (name, category, description, unit, has_expiry, expiry_months, min_stock) VALUES
                ('Uniform (Shirt + Trouser)', 'Clothing', 'Standard company uniform set per contract spec', 'set', true, 12, 10),
                ('Safety Shoes / Boots', 'PPE', 'Steel-toe safety shoes as per PPE policy', 'pair', true, 12, 5),
                ('Safety Helmet', 'PPE', 'Hard hat meeting ANSI/ISEA Z89.1 standard', 'piece', true, 24, 5),
                ('Safety Vest (High-Vis)', 'PPE', 'High-visibility reflective vest', 'piece', true, 12, 10),
                ('PPE Kit (Full)', 'PPE', 'Complete PPE pack: gloves, goggles, mask, vest', 'kit', true, 12, 5),
                ('Laptop', 'IT Equipment', 'Assigned workstation laptop', 'piece', false, null, 2),
                ('Mobile Phone', 'IT Equipment', 'Company-issued smart phone', 'piece', false, null, 2),
                ('Electrical Tool Box', 'Tools', 'Complete electrical tools set', 'box', false, null, 1),
                ('Mechanical Tool Box', 'Tools', 'Complete mechanical / hand tools set', 'box', false, null, 1),
                ('Motor Bike', 'Vehicle', 'Company-assigned motor bike for field operations', 'unit', false, null, 1)
                ON CONFLICT DO NOTHING;
            `);
            console.log('Seeded 10 default inventory items');
        }

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Vendor tables ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendors (
                id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT,
                ntn TEXT, strn TEXT, cnic TEXT, address TEXT,
                contact_person TEXT, phone TEXT, email TEXT,
                bank_name TEXT, bank_account TEXT, account_title TEXT,
                is_filer BOOLEAN DEFAULT TRUE, is_active BOOLEAN DEFAULT TRUE,
                payment_terms TEXT, notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS vendor_payments (
                id SERIAL PRIMARY KEY,
                vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
                payment_date DATE, amount NUMERIC(12,2), wht_rate NUMERIC(5,2),
                wht_amount NUMERIC(12,2), net_payment NUMERIC(12,2),
                description TEXT, bill_ref TEXT, category TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Migration OK: vendor tables ready');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼ System Config ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`CREATE TABLE IF NOT EXISTS system_config (
            key TEXT PRIMARY KEY, value JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        )`);
        const { rows: cfgChk } = await pool.query("SELECT key FROM system_config WHERE key='fbr_individual_tax'");
        if (!cfgChk.length) {
            const iTax = [
                {from:0,to:600000,rate:0,base:0,label:'Up to Rs. 600,000'},
                {from:600001,to:1200000,rate:5,base:0,label:'Rs. 600,001 \u2013 1,200,000'},
                {from:1200001,to:2200000,rate:15,base:30000,label:'Rs. 1,200,001 \u2013 2,200,000'},
                {from:2200001,to:3200000,rate:25,base:180000,label:'Rs. 2,200,001 \u2013 3,200,000'},
                {from:3200001,to:4100000,rate:30,base:430000,label:'Rs. 3,200,001 \u2013 4,100,000'},
                {from:4100001,to:null,rate:35,base:700000,label:'Above Rs. 4,100,000'}
            ];
            const vWHT = [
                {category:'Supply of Goods',filer:4,nonFiler:8,section:'153(1)(a)'},
                {category:'Services',filer:8,nonFiler:16,section:'153(1)(b)'},
                {category:'Execution of Contract / Works',filer:7,nonFiler:7,section:'153(1)(c)'},
                {category:'IT Services',filer:8,nonFiler:16,section:'153A'},
                {category:'Advertising Services',filer:10,nonFiler:20,section:'153(1)(b)'},
                {category:'Transport / Freight',filer:2,nonFiler:4,section:'153(1)(b)'},
                {category:'Electricity & Gas',filer:7.5,nonFiler:10,section:'235'},
                {category:'Cleaning & Janitorial',filer:8,nonFiler:16,section:'153(1)(b)'},
                {category:'PPE & Safety Equipment',filer:4,nonFiler:8,section:'153(1)(a)'},
                {category:'Uniform & Clothing Supply',filer:4,nonFiler:8,section:'153(1)(a)'},
                {category:'Office Supplies & Stationery',filer:4,nonFiler:8,section:'153(1)(a)'},
                {category:'Security Services',filer:8,nonFiler:16,section:'153(1)(b)'},
                {category:'Catering & Food',filer:8,nonFiler:16,section:'153(1)(b)'},
                {category:'Fuel & Petroleum',filer:4,nonFiler:8,section:'153(1)(a)'},
                {category:'Construction & Civil Works',filer:7,nonFiler:7,section:'153(1)(c)'}
            ];
            await pool.query("INSERT INTO system_config (key,value) VALUES ('fbr_individual_tax',$1),('fbr_vendor_wht',$2) ON CONFLICT (key) DO NOTHING",
                [JSON.stringify(iTax),JSON.stringify(vWHT)]);
            console.log('Seeded FBR default tax configuration');
        }
        console.log('Migration OK: system_config ready');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Employee Docs + Messages ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS employee_documents (
                id SERIAL PRIMARY KEY, employee_id TEXT NOT NULL,
                doc_type TEXT NOT NULL, doc_name TEXT,
                issue_date DATE, expiry_date DATE,
                issuing_authority TEXT, doc_no TEXT, notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS employee_messages (
                id SERIAL PRIMARY KEY, employee_id TEXT NOT NULL,
                channel TEXT DEFAULT 'email', subject TEXT, body TEXT,
                sender TEXT, sent_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Migration OK: employee_documents + employee_messages ready');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ New columns on employees ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_policy_no TEXT;
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_card_status TEXT DEFAULT 'Pending';
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_date DATE;
        `).catch(() => {});

        // New cols: employees (contract_name + region); contracts (end_of_service + region_province)
        await pool.query(`
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_name TEXT;
            ALTER TABLE employees ADD COLUMN IF NOT EXISTS region TEXT;
        `).catch(() => {});
        await pool.query(`
            ALTER TABLE contracts ADD COLUMN IF NOT EXISTS end_of_service TEXT DEFAULT 'Gratuity';
            ALTER TABLE contracts ADD COLUMN IF NOT EXISTS region_province TEXT;
        `).catch(() => {});
        console.log('Migration OK: contract_name/region on employees; end_of_service/region_province on contracts');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Advances / Loans ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS employee_advances (
                id          SERIAL PRIMARY KEY,
                employee_id TEXT NOT NULL,
                type        TEXT DEFAULT 'Advance',    -- 'Advance' | 'Loan'
                reason      TEXT,
                total_amount      NUMERIC(12,2) NOT NULL,
                installments      INT DEFAULT 1,
                installment_amt   NUMERIC(12,2) NOT NULL,
                paid_installments INT DEFAULT 0,
                remaining         NUMERIC(12,2) NOT NULL,
                status      TEXT DEFAULT 'Active',     -- 'Active' | 'Settled'
                created_by  TEXT,
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                updated_at  TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Migration OK: employee_advances');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ PF Ledger ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS employee_pf_ledger (
                id          SERIAL PRIMARY KEY,
                employee_id TEXT NOT NULL,
                month       INT NOT NULL,
                year        INT NOT NULL,
                ee_contribution NUMERIC(12,2) DEFAULT 0,
                er_contribution NUMERIC(12,2) DEFAULT 0,
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(employee_id, month, year)
            );
        `);
        console.log('Migration OK: employee_pf_ledger');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Gratuity Ledger ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS employee_gratuity_ledger (
                id          SERIAL PRIMARY KEY,
                employee_id TEXT NOT NULL,
                month       INT NOT NULL,
                year        INT NOT NULL,
                accrual     NUMERIC(12,2) DEFAULT 0,
                cumulative  NUMERIC(12,2) DEFAULT 0,
                created_at  TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(employee_id, month, year)
            );
        `);
        console.log('Migration OK: employee_gratuity_ledger');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Asset / Uniform Issuances ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS asset_issuances (
                id              SERIAL PRIMARY KEY,
                employee_id     TEXT NOT NULL,
                category        TEXT DEFAULT 'Uniform',  -- 'Uniform' | 'PPE' | 'Equipment'
                item_desc       TEXT NOT NULL,
                issue_date      DATE NOT NULL,
                replacement_due DATE,          -- auto = +6m Uniform, +12m PPE
                cost            NUMERIC(12,2),
                returned        BOOLEAN DEFAULT FALSE,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Migration OK: asset_issuances');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Portal OTPs ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS portal_otps (
                id         SERIAL PRIMARY KEY,
                phone      TEXT NOT NULL,
                otp        TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                used       BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await pool.query(`ALTER TABLE portal_otps ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'sms'`).catch(() => {});
        await pool.query(`ALTER TABLE portal_otps ADD COLUMN IF NOT EXISTS destination TEXT`).catch(() => {});
        await pool.query(`ALTER TABLE portal_otps ADD COLUMN IF NOT EXISTS employee_id TEXT`).catch(() => {});
        await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_file_id INT`).catch(() => {});
        await ensurePortalChangeSettings(pool);
        console.log('Migration OK: portal_otps');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Invoices (persistent) ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id           TEXT PRIMARY KEY,
                client       TEXT NOT NULL,
                contract     TEXT,
                period       TEXT,
                po_number    TEXT,
                due_date     DATE,
                payroll_ids  JSONB DEFAULT '[]',
                bill_ids     JSONB DEFAULT '[]',
                subtotal     NUMERIC(12,2) DEFAULT 0,
                svc_charges  NUMERIC(12,2) DEFAULT 0,
                sales_tax    NUMERIC(12,2) DEFAULT 0,
                wht          NUMERIC(12,2) DEFAULT 0,
                grand_total  NUMERIC(12,2) DEFAULT 0,
                status       TEXT DEFAULT 'Draft',
                created_by   TEXT,
                created_at   TIMESTAMPTZ DEFAULT NOW(),
                updated_at   TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Migration OK: invoices');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Payroll Transactions ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payroll_transactions (
                id                SERIAL PRIMARY KEY,
                month             INT NOT NULL,
                year              INT NOT NULL,
                employee_id       TEXT NOT NULL,
                paid_days         NUMERIC(5,2),
                ot2_hrs           NUMERIC(8,2) DEFAULT 0,
                ot3_hrs           NUMERIC(8,2) DEFAULT 0,
                opd_claim         NUMERIC(12,2) DEFAULT 0,
                reimbursement     NUMERIC(12,2) DEFAULT 0,
                arrears           NUMERIC(12,2) DEFAULT 0,
                bonus_amount      NUMERIC(12,2) DEFAULT 0,
                special_allowance NUMERIC(12,2) DEFAULT 0,
                fuel_mobile       NUMERIC(12,2) DEFAULT 0,
                other_deduction   NUMERIC(12,2) DEFAULT 0,
                advance_deduction NUMERIC(12,2) DEFAULT 0,
                loan_deduction    NUMERIC(12,2) DEFAULT 0,
                medical_ee        NUMERIC(12,2),
                medical_sp        NUMERIC(12,2),
                medical_ch1       NUMERIC(12,2),
                medical_ch2       NUMERIC(12,2),
                gross             NUMERIC(12,2) DEFAULT 0,
                net               NUMERIC(12,2) DEFAULT 0,
                wht               NUMERIC(12,2) DEFAULT 0,
                eobi_ee           NUMERIC(12,2) DEFAULT 0,
                service_charges   NUMERIC(12,2) DEFAULT 0,
                sales_tax         NUMERIC(12,2) DEFAULT 0,
                total_invoice     NUMERIC(12,2) DEFAULT 0,
                locked            BOOLEAN DEFAULT FALSE,
                locked_by         TEXT,
                locked_at         TIMESTAMPTZ,
                created_by        TEXT,
                created_at        TIMESTAMPTZ DEFAULT NOW(),
                updated_at        TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(employee_id, month, year)
            );
        `);
        console.log('Migration OK: payroll_transactions table ready');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Schema migrations: add columns that may be missing from existing table ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        // These run safely with IF NOT EXISTS ├óΓé¼ΓÇ¥ needed because CREATE TABLE IF NOT EXISTS
        // is a no-op when the table already exists (so new columns never get added).
        const payrollCols = [
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS paid_days         NUMERIC(5,2)`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS ot2_hrs           NUMERIC(8,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS ot3_hrs           NUMERIC(8,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS opd_claim         NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS reimbursement     NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS special_allowance NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS fuel_mobile       NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS other_deduction   NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS advance_deduction NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS loan_deduction    NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS bonus_amount      NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS arrears           NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS medical_ee        NUMERIC(12,2)`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS medical_sp        NUMERIC(12,2)`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS medical_ch1       NUMERIC(12,2)`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS medical_ch2       NUMERIC(12,2)`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS service_charges   NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS sales_tax         NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS total_invoice     NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS eobi_ee           NUMERIC(12,2) DEFAULT 0`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS locked            BOOLEAN DEFAULT FALSE`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS locked_by         TEXT`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS locked_at         TIMESTAMPTZ`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS created_by        TEXT`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ DEFAULT NOW()`,
            `ALTER TABLE payroll_transactions ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW()`,
        ];


        for (const sql of payrollCols) {
            try { await pool.query(sql); } catch (e) { /* column already exists ├óΓé¼ΓÇ¥ ignore */ }
        }
        console.log('Migration OK: payroll_transactions column migrations done');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Fix column types: ensure OT/paid_days are NUMERIC not INTEGER ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        // ADD COLUMN IF NOT EXISTS never changes the type of an existing column.
        // If ot2_hrs/ot3_hrs were created as INTEGER before this schema, PostgreSQL
        // silently rounds 10.5 ├óΓÇáΓÇÖ 11 on insert. Force them to NUMERIC(8,2) now.
        const typeFixCols = [
            `ALTER TABLE payroll_transactions ALTER COLUMN ot2_hrs  TYPE NUMERIC(8,2) USING ot2_hrs::NUMERIC(8,2)`,
            `ALTER TABLE payroll_transactions ALTER COLUMN ot3_hrs  TYPE NUMERIC(8,2) USING ot3_hrs::NUMERIC(8,2)`,
            `ALTER TABLE payroll_transactions ALTER COLUMN paid_days TYPE NUMERIC(5,2) USING paid_days::NUMERIC(5,2)`,
        ];
        for (const sql of typeFixCols) {
            try {
                await pool.query(sql);
                console.log('├ó┼ôΓÇ£ Type migration OK:', sql.substring(47, 90));
            } catch (e) {
                // PG error 42804 = cannot change type (already correct type)
                if (e.code !== '42804') console.warn('├ó┼í┬á Type migration issue:', e.message);
            }
        }
        console.log('Migration OK: ot2_hrs/ot3_hrs/paid_days type ensured as NUMERIC(8,2)');

        // ── Data fix: zero out stale medical spouse/child premiums in payroll_transactions ──
        // Some employees had medical_sp/ch1/ch2 saved from old CSV imports that didn't check
        // family data. Now we permanently fix the DB so employees with no spouse/children
        // have these zeroed directly in the table — no frontend compensation needed.
        try {
            const medFix = await pool.query(`
                UPDATE payroll_transactions pt
                SET
                    medical_sp  = CASE WHEN (e.spouse_name  IS NULL OR TRIM(e.spouse_name)  IN ('','0')) THEN 0 ELSE pt.medical_sp  END,
                    medical_ch1 = CASE WHEN (e.child1_name  IS NULL OR TRIM(e.child1_name)  IN ('','0')) THEN 0 ELSE pt.medical_ch1 END,
                    medical_ch2 = CASE WHEN (e.child2_name  IS NULL OR TRIM(e.child2_name)  IN ('','0')) THEN 0 ELSE pt.medical_ch2 END
                FROM employees e
                WHERE pt.employee_id = e.id
                  AND (
                      (pt.medical_sp  > 0 AND (e.spouse_name  IS NULL OR TRIM(e.spouse_name)  IN ('','0')))
                   OR (pt.medical_ch1 > 0 AND (e.child1_name  IS NULL OR TRIM(e.child1_name)  IN ('','0')))
                   OR (pt.medical_ch2 > 0 AND (e.child2_name  IS NULL OR TRIM(e.child2_name)  IN ('','0')))
                  )
            `);
            if (medFix.rowCount > 0)
                console.log(`Data fix OK: zeroed stale medical premiums for ${medFix.rowCount} payroll row(s) with no family data`);
        } catch (e) { console.warn('Data fix warning (medical premiums):', e.message); }

        // ─── One-time fix: Apr-2026 bonus migration ──────────────────────────────────
        // Root cause: April 2026 bonus was entered in 'Special Allowance' during CSV
        // upload instead of 'Bonus Amount'. This inflated grossMonthly incorrectly.
        // Fix: move special_allowance -> bonus_amount and zero it.
        // Idempotent: only rows where bonus_amount=0 AND special_allowance>0 are updated.
        try {
            const bonusFix = await pool.query(`
                UPDATE payroll_transactions
                SET bonus_amount      = special_allowance,
                    special_allowance = 0,
                    updated_at        = NOW()
                WHERE year = 2026 AND month = 4
                  AND bonus_amount = 0 AND special_allowance > 0
            `);
            if (bonusFix.rowCount > 0)
                console.log(`[Migration] Apr-2026: moved bonus for ${bonusFix.rowCount} employees (special_allowance->bonus_amount)`);
        } catch (e) { console.warn('[Migration] Apr-2026 bonus fix warning:', e.message); }

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ placeholder so existing closing brace still works ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        const _dummy = true; if (!_dummy) {
        }

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Banks Master ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS banks (
                id         SERIAL PRIMARY KEY,
                name       TEXT NOT NULL UNIQUE,
                short_name TEXT,
                swift_code TEXT,
                is_hbl     BOOLEAN DEFAULT FALSE,
                is_active  BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        const { rows: bankChk } = await pool.query('SELECT COUNT(*) AS cnt FROM banks');
        if (parseInt(bankChk[0].cnt) === 0) {
            await pool.query(`
                INSERT INTO banks (name, short_name, swift_code, is_hbl) VALUES
                ('Habib Bank Limited', 'HBL', 'HABBPKKA', TRUE),
                ('MCB Bank Limited', 'MCB', 'MUCBPKKA', FALSE),
                ('United Bank Limited', 'UBL', 'UNILPKKA', FALSE),
                ('National Bank of Pakistan', 'NBP', 'NBPAPKKA', FALSE),
                ('Allied Bank Limited', 'ABL', 'ABPAPKKA', FALSE),
                ('Meezan Bank Limited', 'MBL', 'MEZNPKKA', FALSE),
                ('Bank Alfalah Limited', 'BAFL', 'ALFHPKKA', FALSE),
                ('Askari Bank Limited', 'AKBL', 'ASCMPKKA', FALSE),
                ('Faysal Bank Limited', 'FBL', 'FAYSPKKA', FALSE),
                ('Bank Al Habib Limited', 'BAHL', 'BKALHKKA', FALSE),
                ('Standard Chartered Bank', 'SCB', 'SCBLPKKX', FALSE),
                ('Silk Bank Limited', 'SILK', 'SILKPKKA', FALSE),
                ('Summit Bank Limited', 'SMBL', 'SMBKPKKA', FALSE),
                ('Soneri Bank Limited', 'SNBL', 'SONEPKKA', FALSE),
                ('JS Bank Limited', 'JSB', 'JSBLPKKA', FALSE),
                ('Habib Metropolitan Bank', 'HMB', 'MPBLPKKA', FALSE),
                ('Zarai Taraqiati Bank', 'ZTBL', '', FALSE),
                ('First Women Bank', 'FWB', '', FALSE),
                ('Emirates NBD Pakistan', 'ENBD', 'EBILADKK', FALSE),
                ('Dubai Islamic Bank Pakistan', 'DIBP', 'DUIBPKKA', FALSE)
                ON CONFLICT (name) DO NOTHING;
            `);
            console.log('Seeded 20 default Pakistan banks');
        }
        console.log('Migration OK: banks table ready');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Payment Batches ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_batches (
                id             TEXT PRIMARY KEY,
                batch_type     TEXT NOT NULL,
                year           INT,
                month          INT,
                source_bill_id TEXT,
                bank_id        INT,
                bank_name      TEXT,
                payment_date   DATE,
                reference_no   TEXT,
                total_amount   NUMERIC(14,2) DEFAULT 0,
                employee_count INT DEFAULT 0,
                notes          TEXT,
                status         TEXT DEFAULT 'Pending',
                xero_ref       TEXT,
                created_by     TEXT,
                created_at     TIMESTAMPTZ DEFAULT NOW(),
                updated_at     TIMESTAMPTZ DEFAULT NOW(),
                client        TEXT,
                contract_name TEXT,
                UNIQUE(batch_type, year, month, client, contract_name)
            );
        `);
        // Idempotent migrations ├óΓé¼ΓÇ¥ extend payment_batches with client/contract scope
        await pool.query(`ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS client TEXT`).catch(()=>{});
        await pool.query(`ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS contract_name TEXT`).catch(()=>{});
        console.log('Migration OK: payment_batches');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Payment Ledger ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS payment_ledger (
                id               SERIAL PRIMARY KEY,
                batch_id         TEXT NOT NULL,
                employee_id      TEXT,
                employee_name    TEXT,
                payment_type     TEXT NOT NULL,
                amount           NUMERIC(12,2) DEFAULT 0,
                reference        TEXT,
                bank_name        TEXT,
                bank_account     TEXT,
                billable         BOOLEAN DEFAULT TRUE,
                xero_account_code TEXT DEFAULT '200',
                xero_ref         TEXT,
                status           TEXT DEFAULT 'Pending',
                created_at       TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(batch_id, employee_id)
            );
        `);
        console.log('Migration OK: payment_ledger');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Client Invoices (AR Queue) ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS client_invoices (
                id              SERIAL PRIMARY KEY,
                invoice_number  TEXT UNIQUE NOT NULL,
                client          TEXT NOT NULL,
                contract        TEXT,
                period_month    INT,
                period_year     INT,
                po_number       TEXT,
                due_date        DATE,
                line_items      JSONB DEFAULT '[]',
                subtotal        NUMERIC(14,2) DEFAULT 0,
                service_charges NUMERIC(12,2) DEFAULT 0,
                sales_tax       NUMERIC(12,2) DEFAULT 0,
                wht             NUMERIC(12,2) DEFAULT 0,
                grand_total     NUMERIC(14,2) DEFAULT 0,
                notes           TEXT,
                status          TEXT DEFAULT 'Draft',
                xero_invoice_id TEXT,
                xero_url        TEXT,
                created_by      TEXT,
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Migration OK: client_invoices');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Contract Bid Items ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contract_bid_items (
                id              SERIAL PRIMARY KEY,
                contract_id     TEXT NOT NULL,
                name            TEXT NOT NULL,
                category        TEXT DEFAULT 'Consumable',
                unit            TEXT DEFAULT 'unit',
                bid_qty         NUMERIC(10,2) DEFAULT 0,
                bid_unit_price  NUMERIC(12,2) DEFAULT 0,
                bid_total       NUMERIC(14,2) DEFAULT 0,
                frequency       TEXT DEFAULT 'Monthly',
                created_at      TIMESTAMPTZ DEFAULT NOW(),
                updated_at      TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Migration OK: contract_bid_items');

        // ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼ Contract Bid Actuals ├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼├óΓÇ¥Γé¼
        await pool.query(`
            CREATE TABLE IF NOT EXISTS contract_bid_actuals (
                id               SERIAL PRIMARY KEY,
                contract_id      TEXT NOT NULL,
                bid_item_id      INT NOT NULL REFERENCES contract_bid_items(id) ON DELETE CASCADE,
                month            INT NOT NULL,
                year             INT NOT NULL,
                actual_qty       NUMERIC(10,2) DEFAULT 0,
                actual_unit_price NUMERIC(12,2) DEFAULT 0,
                actual_total     NUMERIC(14,2) DEFAULT 0,
                notes            TEXT,
                created_at       TIMESTAMPTZ DEFAULT NOW(),
                updated_at       TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE(contract_id, bid_item_id, month, year)
            );
        `);
        console.log('Migration OK: contract_bid_actuals');


        // Bulk-fill contract_date for any employee whose contract_date is still null
        // Uses LIKE match in both directions so partial names (e.g. "PSO Serai Naurang" vs "PSO") still match
        const bulkResult = await pool.query(`
            UPDATE employees e
            SET contract_date = sub.start_date
            FROM (
                SELECT DISTINCT ON (e2.id) e2.id, c.start_date
                FROM employees e2
                JOIN clients cl ON (
                    LOWER(TRIM(e2.client)) = LOWER(TRIM(cl.name))
                    OR LOWER(TRIM(e2.client)) LIKE '%' || LOWER(TRIM(cl.name)) || '%'
                    OR LOWER(TRIM(cl.name)) LIKE '%' || LOWER(TRIM(e2.client)) || '%'
                )
                JOIN contracts c ON c.client_id = cl.id
                WHERE LOWER(TRIM(c.status)) = 'active'
                  AND e2.client IS NOT NULL AND e2.client <> ''
                  AND e2.contract_date IS NULL
                ORDER BY e2.id, c.start_date ASC
            ) sub
            WHERE e.id = sub.id
        `);
        console.log('Bulk contract_date update: ' + bulkResult.rowCount + ' employees updated');
        // ═══ Claims Inbox table ═══════════════════════════════════════════════
        await pool.query(`
            CREATE TABLE IF NOT EXISTS claims_inbox (
                id                  SERIAL PRIMARY KEY,
                received_at         TIMESTAMPTZ NOT NULL,
                sender_email        TEXT NOT NULL,
                subject             TEXT,
                message_id          TEXT,
                message_hash        TEXT UNIQUE NOT NULL,
                raw_body            TEXT,
                parsed_data         JSONB,
                employee_id         TEXT REFERENCES employees(id) ON DELETE SET NULL,
                claim_month         DATE,
                claim_type          TEXT,
                ot_hours_1x         NUMERIC(6,2),
                ot_hours_2x         NUMERIC(6,2),
                ot_hours_3x         NUMERIC(6,2),
                ot_hours            NUMERIC(6,2),
                claim_amount        NUMERIC(12,2),
                line_manager_name   TEXT,
                line_manager_email  TEXT,
                attachment_filename TEXT,
                status              TEXT DEFAULT 'PENDING',
                approval_cycle_id   INT,
                created_at          TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        // Fallback: add missing columns if table already existed with old schema
        for (const col of [
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS ot_hours_1x NUMERIC(6,2)',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS ot_hours_2x NUMERIC(6,2)',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS ot_hours_3x NUMERIC(6,2)',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS line_manager_name TEXT',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS line_manager_email TEXT',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS attachment_filename TEXT',
            // v5 new columns
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS synopsis TEXT',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS body_parsed BOOLEAN DEFAULT FALSE',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS match_remark TEXT',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS employee_name TEXT',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS payroll_month INT',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS payroll_year INT',
            'ALTER TABLE claims_inbox ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ',
        ]) { await pool.query(col).catch(() => {}); }
        await pool.query('CREATE INDEX IF NOT EXISTS idx_claims_status ON claims_inbox(status)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_claims_month ON claims_inbox(claim_month)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_claims_emp ON claims_inbox(employee_id)');
        console.log('Migration OK: claims_inbox');


        // ═══ Claims Approval Cycles table ════════════════════════════════════
        await pool.query(`
            CREATE TABLE IF NOT EXISTS claims_approval_cycles (
                id              SERIAL PRIMARY KEY,
                cycle_month     DATE NOT NULL,
                client_id       INT,
                manager_email   TEXT NOT NULL,
                manager_name    TEXT,
                sent_at         TIMESTAMPTZ,
                responded_at    TIMESTAMPTZ,
                response        TEXT,
                claims_count    INT DEFAULT 0,
                total_value     NUMERIC(12,2) DEFAULT 0,
                reminder_sent   BOOLEAN DEFAULT FALSE,
                created_at      TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        console.log('Migration OK: claims_approval_cycles');

        // ═══ Employee line manager columns ════════════════════════════════════
        await pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS line_manager_name TEXT');
        await pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS line_manager_email TEXT');
        console.log('Migration OK: employees line_manager columns');

        // ═══ Wafi Claims tables ═══════════════════════════════════════════════
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wafi_claims_sessions (
                id                   SERIAL PRIMARY KEY,
                received_at          TIMESTAMPTZ NOT NULL,
                sender_email         TEXT NOT NULL,
                subject              TEXT,
                gmail_message_id     TEXT UNIQUE,
                gmail_thread_id      TEXT,
                attachment_filename  TEXT,
                location_name        TEXT,
                claim_month          DATE,
                processing_status    TEXT DEFAULT 'VALIDATING',
                label_applied        TEXT,
                validation_errors    JSONB DEFAULT '[]',
                total_ot_rows        INT DEFAULT 0,
                total_expense_rows   INT DEFAULT 0,
                total_medical_rows   INT DEFAULT 0,
                is_revision          BOOLEAN DEFAULT FALSE,
                supersedes_session_id INT,
                qc_email_sent        BOOLEAN DEFAULT FALSE,
                confirm_email_sent   BOOLEAN DEFAULT FALSE,
                pushed_to_payroll    BOOLEAN DEFAULT FALSE,
                payroll_month        DATE,
                file_hash            VARCHAR(64),
                created_at           TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wafi_claims_items (
                id                    SERIAL PRIMARY KEY,
                session_id            INT REFERENCES wafi_claims_sessions(id) ON DELETE CASCADE,
                tab_name              TEXT NOT NULL,
                row_number            INT NOT NULL,
                employee_id           TEXT REFERENCES employees(id) ON DELETE SET NULL,
                employee_code_raw     TEXT,
                employee_name_raw     TEXT,
                employee_name_db      TEXT,
                name_similarity       NUMERIC(4,3),
                claim_date            DATE,
                claim_type            TEXT,
                ot_hours              NUMERIC(8,2),
                ot_multiplier         TEXT,
                ot_multiplier_factor  NUMERIC(4,2),
                ot_payout             NUMERIC(12,2),
                expense_type          TEXT,
                description           TEXT,
                raw_amount            NUMERIC(12,2),
                location              TEXT,
                department            TEXT,
                line_manager          TEXT,
                patient_name          TEXT,
                payroll_transaction_id INT,
                active                BOOLEAN DEFAULT TRUE,
                created_at            TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_wafi_sessions_status ON wafi_claims_sessions(processing_status)').catch(() => {});
        await pool.query('CREATE INDEX IF NOT EXISTS idx_wafi_sessions_received ON wafi_claims_sessions(received_at DESC)').catch(() => {});
        await pool.query('CREATE INDEX IF NOT EXISTS idx_wafi_items_session ON wafi_claims_items(session_id)').catch(() => {});
        await pool.query('CREATE INDEX IF NOT EXISTS idx_wafi_items_employee ON wafi_claims_items(employee_id)').catch(() => {});
        await pool.query('CREATE INDEX IF NOT EXISTS idx_wafi_items_date ON wafi_claims_items(claim_date)').catch(() => {});
        await pool.query('CREATE INDEX IF NOT EXISTS idx_wafi_items_active ON wafi_claims_items(active)').catch(() => {});
        console.log('Migration OK: wafi_claims_sessions + wafi_claims_items');

        // ─── Phase 1b: new columns on wafi_claims_items ─────────────────────────
        const wafiItemCols = [
            `ALTER TABLE wafi_claims_items ADD COLUMN IF NOT EXISTS day_type TEXT`,
        ];
        for (const sql of wafiItemCols) {
            try { await pool.query(sql); } catch (e) { /* already exists */ }
        }
        console.log('Migration OK: wafi_claims_items day_type column');

        // ─── Phase 1: new columns on wafi_claims_sessions ───────────────────────
        const wafiSessionCols = [
            `ALTER TABLE wafi_claims_sessions ADD COLUMN IF NOT EXISTS name_warnings        JSONB DEFAULT '[]'`,
            `ALTER TABLE wafi_claims_sessions ADD COLUMN IF NOT EXISTS email_summary         TEXT`,
            `ALTER TABLE wafi_claims_sessions ADD COLUMN IF NOT EXISTS is_first_time_sender  BOOLEAN DEFAULT FALSE`,
            `ALTER TABLE wafi_claims_sessions ADD COLUMN IF NOT EXISTS verified_at           TIMESTAMPTZ`,
            `ALTER TABLE wafi_claims_sessions ADD COLUMN IF NOT EXISTS verified_by           TEXT`,
            `ALTER TABLE wafi_claims_sessions ADD COLUMN IF NOT EXISTS gmail_draft_id        TEXT`,
            `ALTER TABLE wafi_claims_sessions ADD COLUMN IF NOT EXISTS settlement_month      DATE`,
            `ALTER TABLE wafi_claims_sessions ADD COLUMN IF NOT EXISTS file_hash             VARCHAR(64)`,
        ];
        for (const sql of wafiSessionCols) {
            try { await pool.query(sql); } catch (e) { /* already exists */ }
        }
        console.log('Migration OK: wafi_claims_sessions Phase 1 columns');

        // ─── Focal Points table ──────────────────────────────────────────────────
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wafi_focal_points (
                id           SERIAL PRIMARY KEY,
                email        TEXT UNIQUE NOT NULL,
                name         TEXT,
                location     TEXT,
                role         TEXT DEFAULT 'claimed_by',
                active       BOOLEAN DEFAULT TRUE,
                created_at   TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        // Pre-seed known focal points
        const knownFocalPoints = [
            { email: 'm.mustafa-contractor@wafi-energy.com', name: 'M. Mustafa', location: 'LOBP Keamari', role: 'claimed_by' },
            { email: 'mustafa.contractor@wafi-energy.com',   name: 'Mustafa',    location: 'LOBP Keamari', role: 'claimed_by' },
        ];
        for (const fp of knownFocalPoints) {
            await pool.query(`
                INSERT INTO wafi_focal_points (email, name, location, role)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (email) DO NOTHING
            `, [fp.email, fp.name, fp.location, fp.role]).catch(() => {});
        }
        console.log('Migration OK: wafi_focal_points table ready');

        // ═══ Operational fields on employees (2026-07-02) ═════════════════════
        for (const colSql of [
            'ALTER TABLE employees ADD COLUMN IF NOT EXISTS site TEXT',
            'ALTER TABLE employees ADD COLUMN IF NOT EXISTS sessi_no TEXT',
            'ALTER TABLE employees ADD COLUMN IF NOT EXISTS shirt_size TEXT',
            'ALTER TABLE employees ADD COLUMN IF NOT EXISTS trouser_size TEXT',
            'ALTER TABLE employees ADD COLUMN IF NOT EXISTS safety_shoe_size TEXT',
            'ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_uniform_issue_date DATE',
            'ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_ppe_issue_date DATE',
            'ALTER TABLE employees ADD COLUMN IF NOT EXISTS gate_pass_expiry DATE',
            "ALTER TABLE employees ADD COLUMN IF NOT EXISTS payroll_cycle_type TEXT DEFAULT 'Monthly'",
        ]) {
            await pool.query(colSql).catch(() => {});
        }
        console.log('Migration OK: employees operational fields');

        // ═══ Employee Change Requests table (2026-07-02) ══════════════════════
        await pool.query(`
            CREATE TABLE IF NOT EXISTS employee_change_requests (
                id              SERIAL PRIMARY KEY,
                employee_id     TEXT NOT NULL,
                employee_name   TEXT,
                field_name      TEXT NOT NULL,
                field_label     TEXT NOT NULL,
                old_value       TEXT,
                new_value       TEXT NOT NULL,
                status          TEXT DEFAULT 'Pending',
                submitted_at    TIMESTAMPTZ DEFAULT NOW(),
                reviewed_by     TEXT,
                reviewed_at     TIMESTAMPTZ,
                notes           TEXT
            )
        `);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_chgreq_status ON employee_change_requests(status)').catch(() => {});
        await pool.query('CREATE INDEX IF NOT EXISTS idx_chgreq_empid ON employee_change_requests(employee_id)').catch(() => {});
        console.log('Migration OK: employee_change_requests');

        // ═══ Start Email Claims Listener Service ══════════════════════════════
        startEmailClaimsService(pool);

        // ═══ Start Wafi Claims Service (gated — Portal Claims is canonical Aug 2026+) ═══
        pool.query(`SELECT value FROM system_config WHERE key = 'wafi_gmail_intake_enabled'`)
            .then(({ rows }) => {
                const v = rows[0]?.value;
                const enabled = v === true || v === 'true';
                if (enabled) {
                    startWafiClaimsService(pool);
                } else {
                    console.log('[wafi-claims] Gmail intake disabled (wafi_gmail_intake_enabled=false). Portal Claims is canonical.');
                }
            })
            .catch((err) => {
                console.error('[wafi-claims] Gmail intake config read failed — intake stays OFF:', err.message);
            });

        // ═══ Phase 2 Operations Scheduler ═════════════════════════════════════
        startOperationsScheduler({
            pool,
            runReportDispatch: (p) => phase2.runReportDispatch(p, sendAppEmail),
            runEscalationCheck: (p) => phase2.runEscalationCheck(p, sendAppEmail, sendJazzSMS),
            runPaymentStatusSummary: async (p) => {
                const { sendEndOfDayPaymentStatusSummary } = require('./src/modules/ar/paymentStatusGuard');
                return sendEndOfDayPaymentStatusSummary(p, sendAppEmail);
            },
        });

        bootstrapRestructure({ pool, sendAppEmail, sendJazzSMS }).catch(e =>
            console.warn('[restructure] bootstrap warning:', e.message)
        );


    } catch (e) {
        console.warn('Migration warning (non-fatal):', e.message);
    }
});