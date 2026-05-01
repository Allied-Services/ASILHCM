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

// â”€â”€â”€ Startup Guard â€” refuse to start if critical secrets are missing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REQUIRED_ENV = ['JWT_SECRET', 'SESSION_SECRET', 'DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
    console.error('FATAL: Missing required environment variables:', missingEnv.join(', '));
    console.error('Set these in Render â†’ Environment before starting the server.');
    // In production, exit so Render marks the deploy as failed
    if (process.env.NODE_ENV === 'production') process.exit(1);
    else console.warn('Running in dev mode with missing vars â€” continuing anyway');
}

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_' + Math.random().toString(36);
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'asil.com.pk';

// â”€â”€â”€ Resend Email Client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const resend = new Resend(process.env.RESEND_API_KEY || '');
const EMAIL_FROM = process.env.SMTP_FROM || 'ASIL HR <hr@asil.com.pk>';

// â”€â”€â”€ DB Pool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// â”€â”€â”€ Security Headers (helmet) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(helmet({ contentSecurityPolicy: false })); // CSP off â€” frontend served separately

// â”€â”€â”€ CORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// â”€â”€â”€ Rate Limiters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const globalLimiter = rateLimit({ windowMs: 60*1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, slow down.' } });
const strictLimiter = rateLimit({ windowMs: 60*1000, max: 10, message: { error: 'Too many attempts. Try again in a minute.' } });
app.use(globalLimiter);
// Strict limits on sensitive endpoints applied inline below

// â”€â”€â”€ Session + Passport â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(session({
    secret: process.env.SESSION_SECRET || JWT_SECRET,
    resave: false, saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 60000 },
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
    if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
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
        // Upsert user â€” match on google_id (re-login) OR email (pre-registered by admin)
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

// â”€â”€â”€ JWT Middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const requireAuth = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
    catch { res.status(401).json({ error: 'Token expired' }); }
};

// Require one of the listed roles (superadmin always passes)
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'superadmin' || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden: insufficient role', required: roles, got: req.user.role });
};

// â”€â”€â”€ Auth Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        // Always look up fresh from DB â€” catches role changes + saved custom permissions
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

// â”€â”€â”€ User Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Blueprint: superadmin, finance_approver, finance_manager can all access User Management tab
const USER_MGMT_ROLES = ['superadmin', 'finance_approver', 'finance_manager'];

app.get('/api/users', requireAuth, requireRole(...USER_MGMT_ROLES), async (req, res) => {
    try {
        // Include permissions so the frontend can restore saved custom access on panel open
        const { rows } = await pool.query(
            'SELECT id, google_id, email, name, avatar, role, permissions, created_at, last_login FROM hcm_users ORDER BY created_at ASC'
        );
        res.json({ users: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/users â€” pre-register a user by email
app.post('/api/users', requireAuth, requireRole(...USER_MGMT_ROLES), async (req, res) => {
    try {
        const { email, role = 'pending' } = req.body;
        if (!email || !email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
            return res.status(400).json({ error: `Email must be @${ALLOWED_DOMAIN}` });
        }
        const VALID_ROLES = ['superadmin','operations','procurement_proposer','procurement_approver',
            'finance_proposer','finance_approver','ap_team','ar_team','payroll_initiator',
            'procurement_manager','finance_manager','pending'];
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/users/:id/role â€” change a user's role
app.patch('/api/users/:id/role', requireAuth, requireRole(...USER_MGMT_ROLES), async (req, res) => {
    try {
        const { role } = req.body;
        const VALID_ROLES = ['superadmin','operations','procurement_proposer','procurement_approver',
            'finance_proposer','finance_approver','ap_team','ar_team','payroll_initiator',
            'procurement_manager','finance_manager','pending'];
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
        res.json({ ok: true, user: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/users/:id/permissions â€” save granular sub-permissions (superadmin only)
app.patch('/api/users/:id/permissions', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { permissions } = req.body;
        if (!permissions || typeof permissions !== 'object') {
            return res.status(400).json({ error: 'permissions object is required' });
        }
        // Ensure the column exists on every call â€” safe no-op once it exists
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
        res.status(500).json({ error: err.message });
    }
});
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/health/ip', requireAuth, requireRole('superadmin'), (req, res) => {
    // Returns this server's outbound public IP (for Jazz CMT whitelisting) â€” SuperAdmin only
    const https = require('https');
    https.get('https://api.ipify.org?format=json', (r) => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => res.json({ outbound_ip: JSON.parse(d).ip, note: 'Whitelist this IP with Jazz CMT' }));
    }).on('error', e => res.status(500).json({ error: e.message }));
});
app.get('/', (req, res) => res.json({ name: 'ASIL HCM API', status: 'running', app: 'https://asil-hcm-frontend.onrender.com' }));

// Temporary diagnostic â€” lists all contracts and their bonus_months (no auth needed, read-only)
app.get('/api/debug/bonus-check', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT id, contract_name,
                costs->>'bonus_months' AS bonus_months,
                costs->>'overhead_per_employee' AS overhead,
                costs->>'eosb_type' AS eosb_type
            FROM contracts ORDER BY contract_name
        `);
        res.json({ count: rows.length, contracts: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// â”€â”€â”€ SMS Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Single SMS
app.post('/api/sms/send', requireAuth, async (req, res) => {
    try {
        const { to, message, employee_id } = req.body;
        if (!to || !message) return res.status(400).json({ error: 'to and message are required' });
        const result = await sendJazzSMS(to, message);
        // Log to DB if employee_id given
        if (employee_id) {
            await pool.query(
                `INSERT INTO employee_messages (employee_id, channel, subject, body, sender) VALUES ($1,'sms','SMS',$2,$3)`,
                [employee_id, message, req.user.email]
            ).catch(() => {});
        }
        res.json({ ok: true, response: result.response });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk SMS
app.post('/api/sms/bulk', requireAuth, async (req, res) => {
    try {
        const { recipients, message } = req.body; // recipients: [{id, phone, name}]
        if (!recipients?.length || !message) return res.status(400).json({ error: 'recipients and message are required' });
        const results = [];
        for (const r of recipients) {
            if (!r.phone) { results.push({ name: r.name, ok: false, error: 'No phone' }); continue; }
            try {
                const smsMsg = message.replace('{name}', r.name || '');
                const result = await sendJazzSMS(r.phone, smsMsg);
                if (r.id) {
                    await pool.query(
                        `INSERT INTO employee_messages (employee_id, channel, subject, body, sender) VALUES ($1,'sms','Bulk SMS',$2,$3)`,
                        [r.id, smsMsg, req.user.email]
                    ).catch(() => {});
                }
                results.push({ name: r.name, phone: r.phone, ok: true, response: result.response });
            } catch (e) { results.push({ name: r.name, phone: r.phone, ok: false, error: e.message }); }
        }
        res.json({ sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const nullDate = (d) => (d && d !== '' && d !== 'undefined') ? d : null;
const toDateStr = d => !d ? '' : (d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10));
const nullNum = (n) => (n !== '' && n != null) ? parseFloat(n) || null : null;

const empToDb = (e) => ({
    id: e.id || `ASIL-${Date.now()}`,
    bu: e.bu || null, active: e.active || 'Yes',
    client: e.client || null, client_bu: e.clientBU || null,
    dept: e.dept || null, designation: e.designation || null,
    location: e.location || null, province: e.province || null,
    name: e.name,
    father_name: e.fatherName || null, mother_name: e.motherName || null,
    cnic: e.cnic || null,
    cnic_issue: nullDate(e.cnicIssue), cnic_expiry: nullDate(e.cnicExpiry),
    place_of_birth: e.placeOfBirth || null, eobi_no: e.eobiNo || null,
    religion: e.religion || null, marital_status: e.maritalStatus || null,
    dob: nullDate(e.dob), doj: nullDate(e.doj),
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
});

const empFromDb = (r) => ({
    id: r.id, bu: r.bu, active: r.active,
    client: r.client, clientBU: r.client_bu,
    dept: r.dept, designation: r.designation,
    location: r.location, province: r.province,
    name: r.name, fatherName: r.father_name, motherName: r.mother_name,
    cnic: r.cnic,
    cnicIssue: toDateStr(r.cnic_issue),
    cnicExpiry: toDateStr(r.cnic_expiry),
    placeOfBirth: r.place_of_birth, eobiNo: r.eobi_no,
    religion: r.religion, maritalStatus: r.marital_status,
    dob: toDateStr(r.dob),
    doj: toDateStr(r.doj),
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
    salaryHistory: [],
    leaves: { cl: { total: 10, used: 0 }, ml: { total: 8, used: 0 }, el: { total: 14, used: 0 } },
});

// â”€â”€â”€ Employee Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/employees', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT e.*,
              COALESCE(
                -- Priority 1: manually set contract_date on employee record
                e.contract_date::text,
                -- Priority 2: auto-match by client name (flexible LIKE in both directions)
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
            ORDER BY e.name ASC
        `);
        res.json({ employees: rows.map(empFromDb) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/employees', requireAuth, async (req, res) => {
    try {
        const d = empToDb(req.body);
        const cols = ['id', 'bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'province', 'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth', 'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'primary_contact', 'emergency_contact', 'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic', 'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id', 'medical_type', 'medical_maternity', 'total_medical_coverage', 'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date', 'contract_name', 'contract_id', 'region'];
        const vals = cols.map(c => d[c]);
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
        const updates = cols.slice(1).map((c, i) => `${c}=EXCLUDED.${c}`).join(',');
        const { rows } = await pool.query(
            `INSERT INTO employees (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at=NOW() RETURNING *`,
            vals
        );
        res.json({ employee: empFromDb(rows[0]) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/employees/:id', requireAuth, async (req, res) => {
    try {
        const d = empToDb({ ...req.body, id: req.params.id });
        const cols = ['bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'province', 'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth', 'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'primary_contact', 'emergency_contact', 'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic', 'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id', 'medical_type', 'medical_maternity', 'total_medical_coverage', 'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date', 'contract_name', 'contract_id', 'region'];
        const setClauses = cols.map((c, i) => `${c}=$${i + 1}`).join(',');
        const vals = [...cols.map(c => d[c]), req.params.id];
        const { rows } = await pool.query(
            `UPDATE employees SET ${setClauses}, updated_at=NOW() WHERE id=$${cols.length + 1} RETURNING *`,
            vals
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ employee: empFromDb(rows[0]) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/employees/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM employees WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/employees/bulk', requireAuth, async (req, res) => {
    const { employees = [] } = req.body;
    const saved = [], errors = [];

    // \u2500\u2500 Step 1: Build contract lookup from DB \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const ctRows = (await pool.query(`
        SELECT c.id, c.contract_name, c.costs, c.financials, cl.name AS client_name, c.status
        FROM contracts c LEFT JOIN clients cl ON c.client_id = cl.id
    `)).rows;
    const ctByName = {}, ctById = {};
    ctRows.forEach(ct => {
        ctByName[ct.contract_name?.toLowerCase()?.trim()] = ct;
        if (ct.id) ctById[ct.id] = ct;
    });

    const COLS = ['id', 'bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'province',
        'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth',
        'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'primary_contact', 'emergency_contact',
        'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic',
        'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id',
        'medical_type', 'medical_maternity', 'total_medical_coverage',
        'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact',
        'contract_date', 'contract_name', 'contract_id', 'region'];
    const placeholders = COLS.map((_, i) => `$${i + 1}`).join(',');
    const updates = COLS.slice(1).map(c => `${c}=EXCLUDED.${c}`).join(',');

    for (const emp of employees) {
        // \u2500\u2500 Step 2: Resolve contract \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        const rawContract = emp.contractName || emp.contractId || '';
        let resolvedCt = null;
        if (rawContract) {
            // Try exact ID first, then name (case-insensitive)
            resolvedCt = ctById[rawContract]
                || ctByName[rawContract.toLowerCase().trim()]
                || null;
        }

        // \u2500\u2500 Step 3: Hard-reject unrecognised contract names \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        if (rawContract && !resolvedCt) {
            errors.push({
                id: emp.id, name: emp.name,
                error: `Contract "${rawContract}" not found in database. Please register this contract first or correct the name.`
            });
            continue; // skip this row \u2014 do NOT save to DB
        }

        // \u2500\u2500 Step 4: Inherit contract fields if resolved \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        if (resolvedCt) {
            emp.contractId   = resolvedCt.id;
            emp.contractName = resolvedCt.contract_name;
            // Auto-fill client name from contract if not provided
            if (!emp.client) emp.client = resolvedCt.client_name || emp.client;
        }

        try {
            const d = empToDb(emp);
            const vals = COLS.map(c => d[c]);
            const { rows } = await pool.query(
                `INSERT INTO employees (${COLS.join(',')}) VALUES (${placeholders})
                 ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at=NOW()
                 RETURNING *`,
                vals
            );
            if (rows.length) saved.push(empFromDb(rows[0]));
        } catch (err) { errors.push({ id: emp.id, name: emp.name, error: err.message }); }
    }
    res.json({ saved: saved.length, errors, employees: saved });
});

// â”€â”€â”€ Admin: diagnostics + cleanup (SuperAdmin only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
            }
        }
        const total = await pool.query('SELECT COUNT(*) FROM employees');
        res.json({ ok: true, deleted, remaining: parseInt(total.rows[0].count) });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        res.json({ ok: true, deleted: rowCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// â”€â”€â”€ SMS Routes (Jazz CMT) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const https = require('https');

// Normalise Pakistani mobile numbers â†’ 03XXXXXXXXX (10 digits starting with 0)
const normalisePhone = (raw = '') => {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('92') && digits.length === 12) return '0' + digits.slice(2);
    if (digits.startsWith('3') && digits.length === 10) return '0' + digits;
    if (digits.startsWith('03') && digits.length === 11) return digits;
    return digits; // return as-is if unrecognised, let Jazz CMT reject it
};

const sendJazzSMS = (to, message) => new Promise(async (resolve, reject) => {
    const SMS_USER = process.env.JAZZ_SMS_USER;
    const SMS_PASS = process.env.JAZZ_SMS_PASS;
    const SMS_MASK = process.env.JAZZ_SMS_MASK || 'ALLIED SERV';
    if (!SMS_USER || !SMS_PASS) {
        return reject(new Error('JAZZ_SMS_USER / JAZZ_SMS_PASS not set in environment. SMS not configured.'));
    }
    const phone    = normalisePhone(to);

    // Call Jazz CMT API directly (Render server IP is whitelisted)
    // Jazz uses a GET request with query parameters
    const params = new URLSearchParams({
        Username: SMS_USER,
        Password: SMS_PASS,
        From:     SMS_MASK,
        To:       phone,
        Message:  message,
    });
    const url = `https://connect.jazzcmt.com/sendsms_url.html?${params.toString()}&`;

    try {
        const resp = await fetch(url, { method: 'GET' });
        const text = await resp.text();
        console.log(`Jazz SMS â†’ ${phone}: ${text}`);
        resolve({ to: phone, response: text.trim() });
    } catch (err) {
        reject(err);
    }
});

// Send to a single number
app.post('/api/sms/send', requireAuth, async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message are required' });
    if (message.length > 160) return res.status(400).json({ error: 'Message exceeds 160 characters' });
    try {
        const result = await sendJazzSMS(to, message);
        // Log to employee_messages table if employee_id provided
        if (req.body.employee_id) {
            try {
                await pool.query(
                    `INSERT INTO employee_messages (employee_id, channel, direction, body, sent_by) VALUES ($1,'sms','out',$2,$3)`,
                    [req.body.employee_id, message, req.user.email]
                );
            } catch (_) {}
        }
        res.json({ ok: true, ...result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send to multiple employees at once
app.post('/api/sms/bulk', requireAuth, async (req, res) => {
    const { recipients = [], message } = req.body; // recipients = [{ employee_id, phone, name }]
    if (!message || !recipients.length) return res.status(400).json({ error: 'recipients and message required' });
    const results = [];
    for (const r of recipients) {
        try {
            const result = await sendJazzSMS(r.phone, message);
            try {
                await pool.query(
                    `INSERT INTO employee_messages (employee_id, channel, direction, body, sent_by) VALUES ($1,'sms','out',$2,$3)`,
                    [r.employee_id, message, req.user.email]
                );
            } catch (_) {}
            results.push({ name: r.name, phone: r.phone, ok: true, response: result.response });
        } catch (err) {
            results.push({ name: r.name, phone: r.phone, ok: false, error: err.message });
        }
    }
    res.json({ sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
});


// â”€â”€â”€ Bills / Procurement (persisted) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€ OCR endpoint â€” GPT-4o Vision â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/bills/ocr', requireAuth, async (req, res) => {
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
2. Amounts are in Pakistani Rupees (Rs) â€” numbers like 2600, 5000, 2800 are PKR amounts
3. The last/largest number at the bottom is usually the GRAND TOTAL
4. Translate any Urdu item descriptions to English (best effort)
5. If unit price is not shown, calculate it from total Ã· qty
6. Do NOT invent data â€” if something is unclear, write "?" for text or 0 for numbers
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
            return res.status(502).json({ error: 'Could not parse OCR response â€” try a clearer image' });
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

// Idempotent migrations â€” add columns that may not exist on older live tables
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
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_at      TIMESTAMPTZ`,
    `ALTER TABLE bills ADD COLUMN IF NOT EXISTS paid_by      TEXT`,
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
].forEach(sql => pool.query(sql).catch(e => console.error('bills migration:', e.message)));

// Named-user role assignments â€” enforced on every startup
[
    ['laiba.mughal@asil.com.pk',    'finance_proposer'],
    ['huzaifa.rafaqat@asil.com.pk', 'finance_approver'],
].forEach(([email, role]) => {
    pool.query('UPDATE hcm_users SET role=$1 WHERE email=$2', [role, email])
        .then(r => { if (r.rowCount) console.log('Role enforced: ' + email + ' -> ' + role); })
        .catch(e => console.error('Named role error:', e.message));
});


app.get('/api/bills', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM bills ORDER BY created_at DESC');
        res.json(rows.map(r => ({
            id: r.id, type: r.type, vendor: r.vendor, date: r.date,
            client: r.client, contract: r.contract, contractId: r.contract_id,
            bu: r.bu, site: r.site,
            billType: r.bill_type, purpose: r.purpose, note: r.note,
            invoiceNo: r.invoice_no,
            items: r.items || [], amount: parseFloat(r.amount) || 0,
            gst: parseFloat(r.gst) || 0, total: parseFloat(r.total) || 0,
            status: r.status || 'Draft', createdBy: r.created_by,
            createdAt: r.created_at,
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bills', requireAuth, requireRole('procurement_proposer','finance_proposer','finance_approver','superadmin'), async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO bills (id,type,vendor,date,client,contract,contract_id,bu,site,bill_type,purpose,note,invoice_no,items,amount,gst,total,status,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
             ON CONFLICT (id) DO UPDATE SET
               vendor=EXCLUDED.vendor, date=EXCLUDED.date, client=EXCLUDED.client,
               contract=EXCLUDED.contract, contract_id=EXCLUDED.contract_id,
               bu=EXCLUDED.bu, site=EXCLUDED.site, bill_type=EXCLUDED.bill_type,
               purpose=EXCLUDED.purpose, note=EXCLUDED.note, invoice_no=EXCLUDED.invoice_no,
               items=EXCLUDED.items, amount=EXCLUDED.amount, gst=EXCLUDED.gst,
               total=EXCLUDED.total, status=EXCLUDED.status, updated_at=NOW()
             RETURNING *`,
            [b.id, b.type, b.vendor, b.date, b.client, b.contract, b.contractId || null,
             b.bu || null, b.site, b.billType, b.purpose, b.note, b.invoiceNo || null,
             JSON.stringify(b.items || []), b.amount || 0, b.gst || 0, b.total || 0,
             b.status || 'Draft', req.user.email]
        );
        const r = rows[0];
        res.json({ ok: true, bill: { id: r.id, type: r.type, vendor: r.vendor, date: r.date, client: r.client, contract: r.contract, contractId: r.contract_id, bu: r.bu, site: r.site, billType: r.bill_type, purpose: r.purpose, note: r.note, invoiceNo: r.invoice_no, items: r.items || [], amount: parseFloat(r.amount) || 0, gst: parseFloat(r.gst) || 0, total: parseFloat(r.total) || 0, status: r.status || 'Draft', createdBy: r.created_by } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/bills/:id/status', requireAuth, requireRole('procurement_approver','finance_approver','superadmin'), async (req, res) => {
    const { status } = req.body;
    const VALID = ['Draft','Pending Approval','Approved','Rejected','Pushed to Xero','Posted','Paid'];
    if (!VALID.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID.join(', ')}` });
    try {
        const extra = status === 'Paid'
            ? ', paid_at=NOW(), paid_by=$3'
            : '';
        const params = status === 'Paid'
            ? [status, req.params.id, req.user.email]
            : [status, req.params.id];
        await pool.query(`UPDATE bills SET status=$1, updated_at=NOW()${extra} WHERE id=$2`, params);
        res.json({ ok: true, status });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/bills/:id/unlock â€” password-protected unlock for paid bills
app.post('/api/bills/:id/unlock', requireAuth, async (req, res) => {
    const { password } = req.body;
    const correctPwd = process.env.BILLS_UNLOCK_PASSWORD;
    if (!correctPwd) return res.status(503).json({ error: 'BILLS_UNLOCK_PASSWORD not set in environment. Please contact your system administrator.' });
    if (password !== correctPwd) return res.status(403).json({ error: 'Incorrect password. Access denied.' });
    try {
        await pool.query(`UPDATE bills SET status='Approved', paid_at=NULL, paid_by=NULL, updated_at=NOW() WHERE id=$1`, [req.params.id]);
        res.json({ ok: true, message: 'Bill unlocked and reset to Approved status.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/bills/:id/challan â€” generate or retrieve a delivery challan
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/bills/:id/challan â€” retrieve existing challan for a bill
app.get('/api/bills/:id/challan', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM delivery_challans WHERE bill_id=$1', [req.params.id]);
        res.json({ challan: rows[0] || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


app.delete('/api/bills/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM bills WHERE id=$1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Bill not found' });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€â”€ Client Mappers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const clientFromDb = (r) => ({
    id: r.id, name: r.name, hq: r.hq, ntn: r.ntn, strn: r.strn, industry: r.industry,
    contacts: r.contacts || [],
    contracts: [],  // loaded separately
});

// â”€â”€â”€ Client Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/clients', requireAuth, async (req, res) => {
    try {
        const { rows: clients } = await pool.query('SELECT * FROM clients ORDER BY name ASC');
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
            }))
        }));
        res.json({ clients: result });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/clients', requireAuth, async (req, res) => {
    try {
        const { name, hq, ntn, strn, industry, contacts = [] } = req.body;
        const id = req.body.id || `CLT-${Date.now()}`;
        const { rows } = await pool.query(
            `INSERT INTO clients (id,name,hq,ntn,strn,industry,contacts) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,hq=EXCLUDED.hq,ntn=EXCLUDED.ntn,strn=EXCLUDED.strn,industry=EXCLUDED.industry,contacts=EXCLUDED.contacts RETURNING *`,
            [id, name, hq || null, ntn || null, strn || null, industry || null, JSON.stringify(contacts)]
        );
        res.json({ client: { ...clientFromDb(rows[0]), contracts: [] } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/clients/:id', requireAuth, async (req, res) => {
    try {
        const { name, hq, ntn, strn, industry, contacts = [] } = req.body;
        const { rows } = await pool.query(
            `UPDATE clients SET name=$1,hq=$2,ntn=$3,strn=$4,industry=$5,contacts=$6 WHERE id=$7 RETURNING *`,
            [name, hq || null, ntn || null, strn || null, industry || null, JSON.stringify(contacts), req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });

        // Also upsert contracts passed in req.body.contracts
        const contracts = req.body.contracts || [];
        for (const ct of contracts) {
            await pool.query(
                `INSERT INTO contracts (id, client_id, contract_name, location, service_type, headcount, status, start_date, end_date, costs, financials)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 ON CONFLICT (id) DO UPDATE SET contract_name=EXCLUDED.contract_name, location=EXCLUDED.location, service_type=EXCLUDED.service_type, headcount=EXCLUDED.headcount, status=EXCLUDED.status, start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, costs=EXCLUDED.costs, financials=EXCLUDED.financials`,
                [ct.id || `CTR-${Date.now()}`, req.params.id, ct.contractName || null, ct.location || null, ct.serviceType || null, ct.headcount || 0, ct.status || 'Active', nullDate(ct.startDate), nullDate(ct.endDate), JSON.stringify(ct.costs || {}), JSON.stringify(ct.financials || {})]
            );
        }
        // Return updated client with contracts
        const { rows: ctRows } = await pool.query('SELECT * FROM contracts WHERE client_id=$1', [req.params.id]);
        res.json({ client: { ...clientFromDb(rows[0]), contracts: ctRows.map(ct => ({ id: ct.id, contractName: ct.contract_name, location: ct.location, serviceType: ct.service_type, headcount: ct.headcount, status: ct.status, startDate: toDateStr(ct.start_date), endDate: toDateStr(ct.end_date), costs: ct.costs, financials: ct.financials })) } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/clients/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/contracts/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM contracts WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// VENDOR MANAGEMENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/vendors/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM vendors WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vendors/:id/payments', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM vendor_payments WHERE vendor_id=$1 ORDER BY payment_date DESC, created_at DESC',
            [req.params.id]);
        res.json({ payments: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SYSTEM CONFIGURATION (FBR Tax Tables â€” editable)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

app.get('/api/config/:key', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM system_config WHERE key=$1', [req.params.key]);
        if (!rows.length) return res.status(404).json({ error: 'Config key not found' });
        res.json({ config: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/config/:key', requireAuth, async (req, res) => {
    try {
        const { value } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO system_config (key,value) VALUES ($1,$2)
             ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW() RETURNING *`,
            [req.params.key, JSON.stringify(value)]
        );
        res.json({ config: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EMPLOYEE DOCUMENTS (Fitness to Work, Police Clearance, CNIC etc.)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

app.get('/api/employees/:id/documents', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_documents WHERE employee_id=$1 ORDER BY doc_type, expiry_date ASC',
            [req.params.id]);
        res.json({ documents: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/employees/:id/documents/:docId', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM employee_documents WHERE id=$1 AND employee_id=$2', [req.params.docId, req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/employees/:id/messages', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_messages WHERE employee_id=$1 ORDER BY sent_at DESC',
            [req.params.id]);
        res.json({ messages: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ADVANCES & LOANS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

app.get('/api/employees/:id/advances', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_advances WHERE employee_id=$1 ORDER BY created_at DESC',
            [req.params.id]);
        res.json({ advances: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/employees/:id/advances/:advId', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM employee_advances WHERE id=$1 AND employee_id=$2', [req.params.advId, req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PF LEDGER â€” full ledger with opening balance, contributions, withdrawals
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Auto-migrate: add new columns if they don't exist yet
const migratePFLedger = async () => {
    await pool.query(`ALTER TABLE employee_pf_ledger ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'monthly'`).catch(() => {});
    await pool.query(`ALTER TABLE employee_pf_ledger ADD COLUMN IF NOT EXISTS narration TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE employee_pf_ledger ADD COLUMN IF NOT EXISTS reference_no TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE employee_pf_ledger ADD COLUMN IF NOT EXISTS withdrawal_amount NUMERIC(12,2) DEFAULT 0`).catch(() => {});
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
               OR (costs->>'bonus_months')::numeric = 0
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

// GET â€” returns all entries sorted oldest first + computed running balance
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST monthly contribution (existing endpoint â€” keeps backward compat)
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST opening balance â€” only one allowed per employee (upsert on year=0, month=0)
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST withdrawal â€” records a debit with cheque/bank ref
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE a ledger entry (superadmin only â€” irreversible)
app.delete('/api/employees/:id/pf-ledger/:entryId', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM employee_pf_ledger WHERE id=$1 AND employee_id=$2',
            [req.params.entryId, req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GRATUITY LEDGER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

app.get('/api/employees/:id/gratuity-ledger', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_gratuity_ledger WHERE employee_id=$1 ORDER BY year DESC, month DESC',
            [req.params.id]);
        res.json({ ledger: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ASSET / UNIFORM ISSUANCES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

app.get('/api/employees/:id/assets', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM asset_issuances WHERE employee_id=$1 ORDER BY issue_date DESC',
            [req.params.id]);
        res.json({ assets: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/employees/:id/assets/:assetId/return', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'UPDATE asset_issuances SET returned=TRUE WHERE id=$1 AND employee_id=$2 RETURNING *',
            [req.params.assetId, req.params.id]);
        res.json({ asset: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/employees/:id/assets/:assetId', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM asset_issuances WHERE id=$1 AND employee_id=$2', [req.params.assetId, req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INVOICES (persistent DB-backed)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/invoices/:id/status', requireAuth, requireRole('finance_approver'), async (req, res) => {
    try {
        const { status } = req.body;
        const { rows } = await pool.query(
            'UPDATE invoices SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',
            [status, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
        res.json({ invoice: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/invoices/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM invoices WHERE id=$1 RETURNING id', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Invoice not found' });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PAYSLIP GENERATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

app.get('/api/payslip/:employeeId/:month/:year', requireAuth, async (req, res) => {
    try {
        const employeeId = decodeURIComponent(req.params.employeeId);
        const { month, year } = req.params;

        const [empRes, payRes] = await Promise.all([
            pool.query('SELECT * FROM employees WHERE id=$1', [employeeId]),
            pool.query('SELECT * FROM payroll_transactions WHERE employee_id=$1 AND month=$2 AND year=$3',
                [employeeId, month, year])
        ]);
        const emp = empRes.rows[0];
        const pay = payRes.rows[0];
        if (!emp) return res.status(404).json({ error: 'Employee not found' });

        const monthName = new Date(2000, parseInt(month)-1, 1).toLocaleString('en-PK', { month: 'long' });
        const fmt = v => Math.round(parseFloat(v)||0).toLocaleString('en-PK');

        // â”€â”€ Salary components from employee master (prorated if paid_days saved) â”€
        const grossSalary  = parseFloat(emp.salary) || 0;
        const workDays     = 26;
        const paidDays     = parseFloat(pay?.paid_days ?? workDays);
        const ratio        = paidDays / workDays;
        const basicSalary  = Math.round(grossSalary * 0.60 * ratio);
        const hra          = Math.round(grossSalary * 0.20 * ratio);
        const conveyance   = Math.round(grossSalary * 0.10 * ratio);
        const medical      = Math.round(grossSalary * 0.07 * ratio);
        const otherAllow   = Math.round(grossSalary * 0.03 * ratio);

        // â”€â”€ Variable components from payroll_transactions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // OT rate = Gross / (26Ã—8) = Gross / 208
        const otAmount       = Math.round(parseFloat(pay?.ot2_hrs||0) * 2 * (grossSalary/workDays/8)
                                         + parseFloat(pay?.ot3_hrs||0) * 3 * (grossSalary/workDays/8));
        const opdClaim       = Math.round(parseFloat(pay?.opd_claim||0));
        const reimbursement  = Math.round(parseFloat(pay?.reimbursement||0));
        const arrears        = Math.round(parseFloat(pay?.arrears||0));
        const splAllow       = Math.round(parseFloat(pay?.special_allowance||0));
        const fuelMobile     = Math.round(parseFloat(pay?.fuel_mobile||0));
        const bonusAmount    = Math.round(parseFloat(pay?.bonus_amount||0));

        // â”€â”€ Gross = sum of all earnings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const grossTotal = basicSalary + hra + conveyance + medical + otherAllow
                         + otAmount + opdClaim + reimbursement + arrears + splAllow + fuelMobile + bonusAmount;

        // â”€â”€ Deductions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // WHT: use saved DB value if available, else calculate from gross
        const incomeTax = (() => {
            if (pay?.wht && parseFloat(pay.wht) > 0) return Math.round(parseFloat(pay.wht));
            const ann = grossTotal * 12;
            if (ann <= 600000) return 0;
            if (ann <= 1200000) return Math.round(((ann-600000)*0.05)/12);
            if (ann <= 2200000) return Math.round((30000+(ann-1200000)*0.15)/12);
            if (ann <= 3200000) return Math.round((180000+(ann-2200000)*0.25)/12);
            if (ann <= 4100000) return Math.round((430000+(ann-3200000)*0.30)/12);
            return Math.round((700000+(ann-4100000)*0.35)/12);
        })();
        const eobiEE       = Math.round(parseFloat(pay?.eobi_ee||0)) || 400;  // flat Rs.400
        const advanceDed   = Math.round(parseFloat(pay?.advance_deduction||0));
        const loanDed      = Math.round(parseFloat(pay?.loan_deduction||0));
        const otherDed     = Math.round(parseFloat(pay?.other_deduction||0));
        // PF: gross/24 â€” ONLY if contract eosb_type is 'Provident Fund'
        // emp.pf_enrolled does NOT exist as a DB column â€” check contract via JOIN
        const empContractRes = await pool.query(
            `SELECT c.costs->>'eosb_type' AS eosb_type FROM contracts c WHERE c.contract_name=$1`,
            [emp.contract_name || '']
        );
        const empEosbType = empContractRes.rows[0]?.eosb_type || 'None';
        const pfEE = empEosbType === 'Provident Fund' ? Math.round(grossSalary / 24) : 0;

        const totalDeductions = incomeTax + eobiEE + pfEE + advanceDed + loanDed + otherDed;
        const netPay          = grossTotal - totalDeductions;

        // â”€â”€ Helper: only emit row if value > 0 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const row = (label, val, isDeduction = false) =>
            val > 0 ? `<tr><td>${label}</td><td class="amount${isDeduction?' deduction':''}">
                ${isDeduction ? '- ' : ''}${fmt(val)}</td></tr>` : '';

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Salary Slip â€” ${emp.name} â€” ${monthName} ${year}</title>
<style>
  @media print { body { margin: 0; } .page { padding: 16px 20px; } }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; margin: 0; background: #f0f4f8; }
  .page { max-width: 720px; margin: 20px auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.12); }
  .hdr { background: #1e3a5f; color: #fff; padding: 18px 26px; display: flex; justify-content: space-between; align-items: flex-start; }
  .hdr h2 { margin: 0 0 4px; font-size: 16pt; letter-spacing: .5px; }
  .hdr p { margin: 3px 0; font-size: 9pt; opacity: .85; }
  .hdr-right { text-align: right; font-size: 9pt; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0; border-bottom: 2px solid #e2e8f0; }
  .meta-cell { padding: 10px 18px; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; }
  .meta-cell:nth-child(even) { border-right: none; }
  .meta-cell label { font-size: 7.5pt; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; display: block; margin-bottom: 3px; }
  .meta-cell span { font-size: 10pt; font-weight: 600; color: #1e293b; }
  .section { margin: 0 18px 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; }
  th { background: #334155; color: #fff; padding: 8px 12px; font-size: 8.5pt; text-align: left; letter-spacing: .05em; }
  th:last-child { text-align: right; }
  td { padding: 7px 12px; border-bottom: 1px solid #f1f5f9; font-size: 9.5pt; color: #1e293b; }
  .amount { text-align: right; font-weight: 600; }
  .deduction { color: #dc2626; }
  .total-row td { background: #f8fafc; font-weight: 800; font-size: 10.5pt; border-top: 2px solid #cbd5e1; border-bottom: 2px solid #cbd5e1; }
  .net-box { background: #1e3a5f; color: #fff; padding: 16px 24px; margin: 0; display: flex; justify-content: space-between; align-items: center; }
  .net-box .label { font-size: 10pt; opacity: .85; }
  .net-box .sub { font-size: 8pt; opacity: .65; margin-top: 2px; }
  .net-box .amount { font-size: 20pt; font-weight: 800; }
  .footer { padding: 12px 20px; font-size: 8pt; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; background: #f8fafc; }
  .paid-days-badge { background: rgba(255,255,255,.15); padding: 3px 10px; border-radius: 20px; font-size: 8pt; margin-top: 6px; display: inline-block; }
</style></head><body><div class="page">

<div class="hdr">
  <div>
    <h2>SALARY SLIP</h2>
    <p>Allied Services International (Pvt.) Ltd.</p>
    <p>NTN: 7483900-1 &nbsp;|&nbsp; accounts@asil.com.pk</p>
  </div>
  <div class="hdr-right">
    <p style="font-size:12pt;font-weight:700">${monthName} ${year}</p>
    <p>Generated: ${new Date().toLocaleDateString('en-PK', {day:'2-digit',month:'short',year:'numeric'})}</p>
    <div class="paid-days-badge">Paid Days: ${paidDays} / ${workDays}</div>
  </div>
</div>

<div class="meta">
  <div class="meta-cell"><label>Employee Name</label><span>${emp.name}</span></div>
  <div class="meta-cell"><label>Employee Code</label><span>${emp.id}</span></div>
  <div class="meta-cell"><label>Designation</label><span>${emp.designation||'â€”'}</span></div>
  <div class="meta-cell"><label>Client / Location</label><span>${emp.client||'â€”'} / ${emp.location||'â€”'}</span></div>
  <div class="meta-cell"><label>CNIC</label><span>${emp.cnic||'â€”'}</span></div>
  <div class="meta-cell"><label>Bank Account</label><span>${emp.bank_name||'â€”'} &nbsp;â€”&nbsp; ${emp.bank_account||'â€”'}</span></div>
</div>

<div class="section">
<table>
  <thead><tr><th>EARNINGS</th><th class="amount">Amount (Rs.)</th></tr></thead>
  <tbody>
    <tr><td>Basic Salary</td><td class="amount">${fmt(basicSalary)}</td></tr>
    <tr><td>House Rent Allowance (HRA)</td><td class="amount">${fmt(hra)}</td></tr>
    <tr><td>Conveyance Allowance</td><td class="amount">${fmt(conveyance)}</td></tr>
    <tr><td>Medical Allowance</td><td class="amount">${fmt(medical)}</td></tr>
    ${otherAllow > 0 ? `<tr><td>Other Allowances</td><td class="amount">${fmt(otherAllow)}</td></tr>` : ''}
    ${row('Overtime (OT)', otAmount)}
    ${row('OPD Claim', opdClaim)}
    ${row('Expense Reimbursement', reimbursement)}
    ${row('Arrears', arrears)}
    ${row('Special Allowance', splAllow)}
    ${row('Fuel / Mobile Allowance', fuelMobile)}
    ${row('Bonus', bonusAmount)}
    <tr class="total-row"><td>GROSS SALARY</td><td class="amount">${fmt(grossTotal)}</td></tr>
  </tbody>
</table>
</div>

<div class="section">
<table>
  <thead><tr><th>DEDUCTIONS</th><th class="amount">Amount (Rs.)</th></tr></thead>
  <tbody>
    <tr><td class="deduction">Income Tax (WHT)</td><td class="amount deduction">- ${fmt(incomeTax)}</td></tr>
    <tr><td class="deduction">EOBI (Employee Share)</td><td class="amount deduction">- ${fmt(eobiEE)}</td></tr>
    ${pfEE > 0 ? `<tr><td class="deduction">Provident Fund (Employee)</td><td class="amount deduction">- ${fmt(pfEE)}</td></tr>` : ''}
    ${row('Advance Deduction', advanceDed, true)}
    ${row('Loan Installment', loanDed, true)}
    ${row('Other Deduction', otherDed, true)}
    <tr class="total-row"><td>TOTAL DEDUCTIONS</td><td class="amount deduction">- ${fmt(totalDeductions)}</td></tr>
  </tbody>
</table>
</div>

<div class="net-box">
  <div>
    <div class="label">NET SALARY PAYABLE</div>
    <div class="sub">${monthName} ${year} &nbsp;|&nbsp; Gross ${fmt(grossTotal)} âˆ’ Deductions ${fmt(totalDeductions)}</div>
  </div>
  <div class="amount">Rs. ${fmt(netPay)}</div>
</div>

<div class="footer">
  This is a system-generated salary slip and does not require a signature.&nbsp;&nbsp;|&nbsp;&nbsp;Allied Services International (Pvt.) Ltd.
</div>
</div></body></html>`;

        res.setHeader('Content-Type', 'text/html');
        // ?download=1 triggers attachment download instead of opening in new tab
        if (req.query.download === '1') {
            const safeName = (emp.name || 'Employee').replace(/[^a-zA-Z0-9 ]/g, '_').trim();
            res.setHeader('Content-Disposition', `attachment; filename="PaySlip_${safeName}_${monthName}_${year}.html"`);
        }
        res.send(html);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HITL FLAGS â€” Bills where OCR total â‰  items sum
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BULK PAYROLL SMS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
            results.push({ name: emp.name, phone: emp.primary_contact, ok: true, response: result.response });
        }
        res.json({ sent: results.filter(r=>r.ok).length, failed: results.filter(r=>!r.ok).length, results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EMPLOYEE PORTAL â€” OTP LOGIN + SELF-SERVICE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Request OTP â€” looks up employee by phone, sends OTP via Jazz SMS
app.post('/api/portal/request-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone number required' });
        // Normalise phone
        let p = phone.replace(/\D/g, '');
        if (p.startsWith('92') && p.length === 12) p = '0' + p.slice(2);
        if (p.startsWith('3') && p.length === 10) p = '0' + p;

        // Find employee with this phone
        const { rows } = await pool.query(
            `SELECT id, name FROM employees WHERE regexp_replace(primary_contact,'\\D','','g') = $1 AND active='Yes'`,
            [p]
        );
        if (!rows.length) return res.status(404).json({ error: 'No active employee found with this phone number' });

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Save OTP
        await pool.query(
            `INSERT INTO portal_otps (phone, otp, expires_at) VALUES ($1,$2,$3)`,
            [p, otp, expiresAt]
        );

        // Send via Jazz SMS
        const message = `Your ASIL HCM login code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
        await sendJazzSMS(p, message);

        res.json({ ok: true, message: `OTP sent to ${p.slice(0,5)}****${p.slice(-2)}`, employeeName: rows[0].name });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Verify OTP â€” returns portal JWT
app.post('/api/portal/verify-otp', async (req, res) => {
    try {
        const { phone, otp } = req.body;
        let p = (phone||'').replace(/\D/g, '');
        if (p.startsWith('92') && p.length === 12) p = '0' + p.slice(2);
        if (p.startsWith('3') && p.length === 10) p = '0' + p;

        const { rows: otpRows } = await pool.query(
            `SELECT * FROM portal_otps WHERE phone=$1 AND otp=$2 AND used=FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`,
            [p, otp]
        );
        if (!otpRows.length) return res.status(401).json({ error: 'Invalid or expired OTP' });

        // Mark as used
        await pool.query('UPDATE portal_otps SET used=TRUE WHERE id=$1', [otpRows[0].id]);

        // Find employee
        const { rows: empRows } = await pool.query(
            `SELECT id, name, designation, client, location FROM employees WHERE regexp_replace(primary_contact,'\\D','','g') = $1 AND active='Yes'`,
            [p]
        );
        if (!empRows.length) return res.status(404).json({ error: 'Employee not found' });
        const emp = empRows[0];

        // Issue portal JWT (24h, limited scope)
        const token = jwt.sign(
            { employeeId: emp.id, name: emp.name, portal: true },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.json({ ok: true, token, employee: { id: emp.id, name: emp.name, designation: emp.designation, client: emp.client, location: emp.location } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Portal middleware â€” validates portal JWT
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
        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        const [empRes, payrollRes, advancesRes, leavesRes] = await Promise.all([
            pool.query('SELECT * FROM employees WHERE id=$1', [empId]),
            pool.query('SELECT * FROM payroll_transactions WHERE employee_id=$1 ORDER BY year DESC, month DESC LIMIT 12', [empId]),
            pool.query('SELECT * FROM employee_advances WHERE employee_id=$1 ORDER BY created_at DESC', [empId]),
            pool.query('SELECT * FROM employee_leaves WHERE employee_id=$1 ORDER BY taken_on DESC LIMIT 20', [empId]).catch(() => ({ rows: [] }))
        ]);

        const emp = empRes.rows[0];
        if (!emp) return res.status(404).json({ error: 'Employee not found' });

        // Remove sensitive fields before sending to portal
        const { bank_account, cnic, ...safeEmp } = emp;

        res.json({
            employee: {
                ...safeEmp,
                cnicMasked: emp.cnic ? emp.cnic.replace(/(\d{5})(\d{7})(\d)/, '$1-*******-$3') : null,
                bankAccountMasked: emp.bank_account ? '****' + emp.bank_account.slice(-4) : null
            },
            payslips: payrollRes.rows.map(p => ({
                month: p.month, year: p.year,
                gross: parseFloat(p.gross)||0, net: parseFloat(p.net)||0,
                wht: parseFloat(p.wht)||0, eobi: parseFloat(p.eobi_ee)||0,
                advance: parseFloat(p.adv)||0, status: p.status
            })),
            advances: advancesRes.rows.map(a => ({
                id: a.id, type: a.type, reason: a.reason,
                totalAmount: parseFloat(a.total_amount), installmentAmt: parseFloat(a.installment_amt),
                paidInstallments: a.paid_installments, totalInstallments: a.installments,
                remaining: parseFloat(a.remaining), status: a.status
            })),
            leaves: leavesRes.rows
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€â”€ Tax Calculation (public) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/calculate', (req, res) => {
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INVENTORY MANAGEMENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Inventory Items (catalog) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/inventory/items/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM inventory_items WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€ Stock In (procurement) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/inventory/stock/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM inventory_stock WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€ Issuances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/inventory/issuances/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM inventory_issuance WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});




// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PAYROLL TRANSACTIONS â€” persistent storage for monthly payroll data
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET /api/payroll/:year/:month â€” load saved overrides for a given month
app.get('/api/payroll/:year/:month', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
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
            })),
            locked,
            lockedBy:  rows[0]?.locked_by  || null,
            lockedAt:  rows[0]?.locked_at  || null,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/payroll/:year/:month â€” bulk UPSERT (newest import wins, blocked if locked)
app.post('/api/payroll/:year/:month', requireAuth, requireRole('finance_proposer'), async (req, res) => {
    try {
        const { year, month } = req.params;
        const { rows: incoming = [] } = req.body; // array of { employee_id, overrides, calc }

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
            const { rows: upserted } = await pool.query(`
                INSERT INTO payroll_transactions
                    (month, year, employee_id, paid_days, ot2_hrs, ot3_hrs, opd_claim,
                     reimbursement, arrears, bonus_amount, special_allowance, fuel_mobile,
                     other_deduction, advance_deduction, loan_deduction,
                     medical_ee, medical_sp, medical_ch1, medical_ch2,
                     gross, net, wht, eobi_ee, service_charges, sales_tax, total_invoice,
                     created_by, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW())
                ON CONFLICT (employee_id, month, year) DO UPDATE SET
                    paid_days=$4, ot2_hrs=$5, ot3_hrs=$6, opd_claim=$7,
                    reimbursement=$8, arrears=$9, bonus_amount=$10, special_allowance=$11,
                    fuel_mobile=$12, other_deduction=$13, advance_deduction=$14, loan_deduction=$15,
                    medical_ee=$16, medical_sp=$17, medical_ch1=$18, medical_ch2=$19,
                    gross=$20, net=$21, wht=$22, eobi_ee=$23, service_charges=$24,
                    sales_tax=$25, total_invoice=$26, updated_at=NOW()
                RETURNING employee_id`,
                [
                    parseInt(month), parseInt(year), employee_id,
                    ov.paid_days   != null ? parseFloat(ov.paid_days)   : null,
                    parseFloat(ov.ot2_hrs)           || 0,
                    parseFloat(ov.ot3_hrs)           || 0,
                    parseFloat(ov.opd_claim)         || 0,
                    parseFloat(calc.serviceCharges)  || 0,
                    parseFloat(calc.salesTax)        || 0,
                    parseFloat(calc.totalInvoice)    || 0,
                    req.user?.email || 'system',
                ]
            );
            if (upserted.length) saved.push(upserted[0].employee_id);
        }
        res.json({ ok: true, saved: saved.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/payroll/:year/:month/lock â€” lock a payroll month + auto-post PF/Gratuity
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

        // â”€â”€ Auto-post PF and Gratuity accrual for each newly locked employee â”€â”€
        if (lockedEmpIds && lockedEmpIds.length > 0) {
            // Join contracts to get eosb_type from costs JSON
            // pf_enrolled does NOT exist as a column â€” eosb_type lives in contracts.costs
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

                // PF: gross/24 per month â€” ONLY when Provident Fund scheme
                const pfContrib = isPF ? Math.round(gross / 24) : 0;

                // Gratuity: gross/12 per month â€” ONLY when Gratuity scheme (mutually exclusive with PF)
                const gratuityAccrual = isGratuity ? Math.round(gross / 12) : 0;

                if (pfContrib > 0) {
                    await pool.query(`
                        INSERT INTO employee_pf_ledger (employee_id, month, year, ee_contribution, er_contribution)
                        VALUES ($1,$2,$3,$4,$4)
                        ON CONFLICT (employee_id, month, year)
                        DO UPDATE SET ee_contribution=$4, er_contribution=$4
                    `, [emp.id, mo, yr, pfContrib]).catch(() => {});
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
                    `, [emp.id, mo, yr, gratuityAccrual, prevCum + gratuityAccrual]).catch(() => {});
                }
            }
        }

        res.json({ ok: true, locked: true, lockedBy: req.user.email, accruals_posted: lockedEmpIds?.length || 0 });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/payroll/:year/:month/unlock â€” unlock a payroll month (scoped to employee_ids if provided)
app.patch('/api/payroll/:year/:month/unlock', requireAuth, requireRole('finance_approver'), async (req, res) => {
    try {
        const { year, month } = req.params;
        const { employee_ids } = req.body || {};
        const yr = parseInt(year), mo = parseInt(month);
        if (employee_ids && employee_ids.length > 0) {
            // Scoped unlock â€” only the specified employees
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
        res.json({ ok: true, locked: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/payroll/:year/:month/:employeeId â€” delete one employee's payroll row (superadmin only)
app.delete('/api/payroll/:year/:month/:employeeId', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        const { year, month, employeeId } = req.params;
        const result = await pool.query(
            'DELETE FROM payroll_transactions WHERE employee_id=$1 AND year=$2 AND month=$3 RETURNING employee_id',
            [employeeId, parseInt(year), parseInt(month)]
        );
        // If 0 rows deleted the employee simply never had a saved override â€” treat as success
        res.json({ ok: true, deleted: result.rows.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});



// â”€â”€ Payroll CSV Export (server-side, avoids CSP/blob issues) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // Build contract lookup by name (lowercase) â†’ enrich employees with financials
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
            // bonus_months Ã— gross gives ANNUAL bonus; /12 = monthly accrual
            // We store bonus_months in costs â€” gross comes from emp.salary in calcRow
            emp._bonus_months = parseFloat(costs.bonus_months || 0);
            emp._overhead_per_employee = parseFloat(costs.overhead_per_employee || 0);
            emp._svc_pct      = parseFloat(fin.service_charges_pct || 0);
            emp._sales_tax_pct= parseFloat(fin.wht_pct || 0);
        });

        const payMap = {};
        payRes.rows.forEach(p => { payMap[p.employee_id] = p; });

        // â”€â”€ Apply active UI filters to restrict export scope â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let filteredEmps = empRes.rows;
        if (filterClient && filterClient !== 'All') {
            filteredEmps = filteredEmps.filter(e =>
                e.client === filterClient ||
                e.client_bu === filterClient
            );
        }
        if (filterContract && filterContract !== 'All') {
            // EXACT match â€” do NOT use .includes() which matches 'Facility Management'
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
            if (a <= 600000) return 0;
            if (a <= 1200000) return Math.round(((a-600000)*0.05)/12);
            if (a <= 2200000) return Math.round((30000+(a-1200000)*0.15)/12);
            if (a <= 3200000) return Math.round((180000+(a-2200000)*0.25)/12);
            if (a <= 4100000) return Math.round((430000+(a-3200000)*0.30)/12);
            return Math.round((700000+(a-4100000)*0.35)/12);
        };

        // Province â†’ provincial service tax rate (DB-driven from System Config Tax by Region)
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
            const gross = parseFloat(emp.salary) || parseFloat(emp.gross) || 0;
            const pd = parseFloat(pay?.paid_days ?? WD);
            const ratio = pd / WD;
            // Gross components â€” employee record stores breakdown if available
            // Fallback to standard ASIL split: 60/20/10/7/3
            const basic    = parseFloat(emp.basic)  || Math.round(gross * 0.60 * ratio);
            const hra      = parseFloat(emp.hra)    || Math.round(gross * 0.20 * ratio);
            const conv     = parseFloat(emp.conveyance) || Math.round(gross * 0.10 * ratio);
            const medAll   = parseFloat(emp.medical_allowance) || Math.round(gross * 0.07 * ratio);
            const other    = parseFloat(emp.other_allowances)  || Math.round(gross * 0.03 * ratio);
            const hrly     = gross / (WD * 8);
            const ot2hrs   = parseFloat(pay?.ot2_hrs||0);
            const ot3hrs   = parseFloat(pay?.ot3_hrs||0);
            const otAmt    = Math.round(hrly * (ot2hrs*2 + ot3hrs*3));
            const opd      = Math.round(parseFloat(pay?.opd_claim||0));
            const reimb    = Math.round(parseFloat(pay?.reimbursement||0));
            const arr      = Math.round(parseFloat(pay?.arrears||0));
            const spl      = Math.round(parseFloat(pay?.special_allowance||0));
            const fuel     = Math.round(parseFloat(pay?.fuel_mobile||0));
            const bonus    = Math.round(parseFloat(pay?.bonus_amount||0));
            // grossM: use stored gross if available, else compute from components
            const grossM   = pay?.gross && parseFloat(pay.gross) > 0
                ? Math.round(parseFloat(pay.gross))
                : Math.round(basic + hra + conv + medAll + other + otAmt + opd + reimb + arr + spl + fuel + bonus);
            // WHT: prefer stored value, else compute from FBR slabs
            const wht = pay?.wht && parseFloat(pay.wht) > 0 ? Math.round(parseFloat(pay.wht)) : whtCalc(grossM*12);
            const eobi_ee  = 400, eobi_er = 2000;
            const sessi    = Math.min(2400, Math.round(grossM * 0.06));
            // â”€â”€ EOSB: PF and Gratuity are MUTUALLY EXCLUSIVE â€” mirrors frontend exactly â”€â”€
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
            const netPay   = grossM - totalDed;
            // â”€â”€ Medical: priority: payroll_transactions override â†’ contract costs â†’ 0
            const medEE  = Math.round(parseFloat(pay?.medical_ee  != null ? pay.medical_ee  : emp._medical_ee  || 0));
            const medSP  = Math.round(parseFloat(pay?.medical_sp  != null ? pay.medical_sp  : emp._medical_sp  || 0));
            const medCh1 = Math.round(parseFloat(pay?.medical_ch1 != null ? pay.medical_ch1 : emp._medical_ch  || 0));
            const medCh2 = Math.round(parseFloat(pay?.medical_ch2 != null ? pay.medical_ch2 : 0));
            const medTotal = medEE + medSP + medCh1 + medCh2;
            // Life Insurance: from contract costs
            const lifeIns = Math.round(parseFloat(emp._life_ins || emp.life_insurance || 0));
            // Bonus accrual: bonus_months Ã— gross / 12 per month
            const bonusMonths  = parseFloat(emp._bonus_months || emp.bonus_months || 0);
            const bonusAccrual = Math.round(bonusMonths * gross / 12);
            // Overhead: fixed per-employee charge from contract
            const overhead = Math.round(parseFloat(emp._overhead_per_employee || 0));
            // Total employer cost = gross + all employer obligations
            const costBase = grossM + eobi_er + sessi + pfER + gratuity + lifeIns + medTotal + bonusAccrual + overhead;
            const sc       = pay?.service_charges ? Math.round(parseFloat(pay.service_charges)) : 0;
            const stRate   = provinceTaxRate(emp.province);
            // Sales tax base: Total Payroll Cost + Service Charges (per MD instruction)
            const st       = pay?.sales_tax ? Math.round(parseFloat(pay.sales_tax)) : Math.round((costBase + sc) * stRate);
            const inv      = pay?.total_invoice ? Math.round(parseFloat(pay.total_invoice)) : costBase+sc+st;
            return { grossM, wht, eobi_ee, eobi_er, sessi, pfDed, pfER, advDed, loanDed, otherDed, totalDed, netPay,
                     gratuity, eosbType, costBase, sc, st, inv, otAmt, opd, reimb, arr, spl, fuel, bonus, other, overhead,
                     pd, ot2hrs, ot3hrs, medEE, medSP, medCh1, medCh2, medTotal, bonusAccrual, lifeIns };
        };

        let rows = [], filename = 'export.csv';
        const bu  = e => e.client_bu || e.clientbu || e.clientBU || '';
        const cnic = e => e.cnic || '';
        const isHBL = e => (e.bank_name || '').toLowerCase().replace(/\s/g,'').includes('hbl') ||
                           (e.bank_name || '').toLowerCase().includes('habib');
        const monthAbbr = new Date(2000, moInt-1, 1).toLocaleString('en-US', { month: 'short' }); // 'Mar'
        const yr2 = String(yrInt).slice(-2); // '26'

        // Build locked ID set â€” always from the full month's payroll_transactions
        const lockedIds = new Set(payRes.rows.filter(p => p.locked).map(p => p.employee_id));
        // ALWAYS export locked-only rows scoped to the current filter.
        // bankEmps = employees who (a) match current filter AND (b) are locked in this month.
        // This is the only correct source for ALL export types.
        const bankEmps = filteredEmps.filter(e => lockedIds.has(e.id));

        if (type === 'payroll') {
            // Payroll CSV always locked+filtered â€” never all 514
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
                    'Other Allowances': c.other,
                    'Spl Allowance':    c.spl,
                    'Fuel/Mobile':      c.fuel,
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
            // HBL to HBL transfers â€” only employees with HBL accounts, locked rows only
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
            // HBL to Other Banks (IBFT) â€” non-HBL bank accounts, locked rows only
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
            // Legacy single HBL file â€” redirect to split files message
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
        } else {
            return res.status(400).json({ error: 'Invalid type. Use payroll|hbl_same|hbl_other|hbl|wht|eobi|sessi' });
        }

        if (!rows.length) return res.status(200).send('No data to export.');
        const hdrs = Object.keys(rows[0]);
        const esc  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const csv  = [hdrs.map(esc).join(','), ...rows.map(r => hdrs.map(h => esc(r[h])).join(','))].join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\uFEFF' + csv);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€ Send payslips by email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/payroll/:year/:month/send-payslips', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
        const { employeeIds = [] } = req.body; // [] = all
        const yrInt = parseInt(year), moInt = parseInt(month);
        const monthName = new Date(2000, moInt-1, 1).toLocaleString('en-PK', { month: 'long' });

        if (!process.env.RESEND_API_KEY) {
            return res.status(503).json({ error: 'RESEND_API_KEY not configured in Render environment.' });
        }

        let empQuery = "SELECT * FROM employees WHERE email IS NOT NULL AND email != ''";
        const params = [];
        if (employeeIds.length) {
            empQuery += ` AND id = ANY($1)`;
            params.push(employeeIds);
        }
        const [empRes, payRes] = await Promise.all([
            pool.query(empQuery, params),
            pool.query('SELECT * FROM payroll_transactions WHERE year=$1 AND month=$2', [yrInt, moInt])
        ]);
        const payMap = {};
        payRes.rows.forEach(p => { payMap[p.employee_id] = p; });

        const calcWHT = (a) => {
            if (a <= 600000) return 0;
            if (a <= 1200000) return Math.round(((a-600000)*0.05)/12);
            if (a <= 2200000) return Math.round((30000+(a-1200000)*0.15)/12);
            if (a <= 3200000) return Math.round((180000+(a-2200000)*0.25)/12);
            if (a <= 4100000) return Math.round((430000+(a-3200000)*0.30)/12);
            return Math.round((700000+(a-4100000)*0.35)/12);
        };
        const fmt = v => Math.round(v||0).toLocaleString('en-PK');

        let sent = 0, failed = [];
        for (const emp of empRes.rows) {
            if (!emp.email) continue;
            const pay = payMap[emp.id];
            const gross = parseFloat(emp.salary)||0;
            const WD = 26, pd = parseFloat(pay?.paid_days ?? WD);
            const ratio = pd / WD;
            const grossM = Math.round(gross * ratio);
            const wht = pay?.wht && parseFloat(pay.wht)>0 ? Math.round(parseFloat(pay.wht)) : calcWHT(grossM*12);
            const eobi = 400;
            const adv  = Math.round(parseFloat(pay?.advance_deduction||0));
            const loan = Math.round(parseFloat(pay?.loan_deduction||0));
            // PF: gross/24 â€” ONLY when Provident Fund scheme (eosb_type in contract costs)
            // pf_enrolled is NOT a DB column on employees â€” use emp._eosb_type enriched above
            const pfDedEmail = emp._isPF ? Math.round(gross / 24) : 0;
            // netPay computed after pfDedEmail is known
            const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#333;background:#f5f5f5;margin:0;padding:20px}
  .card{background:#fff;max-width:600px;margin:0 auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)}
  .header{background:#1e3a5f;color:#fff;padding:24px 28px}
  .header h2{margin:0 0 4px;font-size:20px}
  .header p{margin:0;opacity:.8;font-size:12px}
  .body{padding:24px 28px}
  .greeting{font-size:15px;margin-bottom:16px;color:#1e3a5f}
  .slip{border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;margin:16px 0}
  .slip-title{background:#f0f4f8;padding:10px 16px;font-weight:bold;font-size:13px;color:#1e3a5f;border-bottom:1px solid #e0e0e0}
  table{width:100%;border-collapse:collapse}
  td{padding:8px 16px;font-size:12px;border-bottom:1px solid #f0f0f0}
  td:last-child{text-align:right;font-weight:600}
  .total-row td{background:#f8fafc;font-weight:bold;font-size:13px;color:#1e3a5f}
  .net-row td{background:#1e3a5f;color:#fff;font-weight:bold;font-size:14px}
  .footer{padding:20px 28px;font-size:11px;color:#888;border-top:1px solid #eee;text-align:center}
</style></head><body>
<div class="card">
  <div class="header">
    <h2>Salary Slip â€” ${monthName} ${year}</h2>
    <p>Allied Services International (Pvt.) Ltd.</p>
  </div>
  <div class="body">
    <p class="greeting">Dear ${emp.name},</p>
    <p>We are pleased to inform you that your salary for the month of <strong>${monthName} ${year}</strong> has been processed and sent to your bank for payment. The amount should reflect in your account shortly.</p>
    <p>Please find below a summary of your salary details:</p>
    <div class="slip">
      <div class="slip-title">EARNINGS</div>
      <table>
        <tr><td>Basic Salary</td><td>Rs. ${fmt(gross*0.60*ratio)}</td></tr>
        <tr><td>House Rent Allowance</td><td>Rs. ${fmt(gross*0.20*ratio)}</td></tr>
        <tr><td>Conveyance</td><td>Rs. ${fmt(gross*0.10*ratio)}</td></tr>
        <tr><td>Medical Allowance</td><td>Rs. ${fmt(gross*0.07*ratio)}</td></tr>
        ${pay?.arrears > 0 ? `<tr><td>Arrears</td><td>Rs. ${fmt(pay.arrears)}</td></tr>` : ''}
        ${pay?.bonus_amount > 0 ? `<tr><td>Bonus</td><td>Rs. ${fmt(pay.bonus_amount)}</td></tr>` : ''}
        <tr class="total-row"><td>Gross Earnings</td><td>Rs. ${fmt(grossM)}</td></tr>
      </table>
    </div>
    <div class="slip">
      <div class="slip-title">DEDUCTIONS</div>
      <table>
        <tr><td>Income Tax (WHT)</td><td>Rs. ${fmt(wht)}</td></tr>
        <tr><td>EOBI</td><td>Rs. ${fmt(eobi)}</td></tr>
        ${adv > 0 ? `<tr><td>Advance Recovery</td><td>Rs. ${fmt(adv)}</td></tr>` : ''}
        ${loan > 0 ? `<tr><td>Loan Installment</td><td>Rs. ${fmt(loan)}</td></tr>` : ''}
        <tr class="total-row"><td>Total Deductions</td><td>Rs. ${fmt(wht+eobi+adv+loan)}</td></tr>
      </table>
    </div>
    <table><tr class="net-row"><td>NET SALARY PAYABLE</td><td>Rs. ${fmt(netPay)}</td></tr></table>
    <br>
    <p>If you have any queries regarding your salary, please contact the HR department at <a href="mailto:hr@asil.com.pk">hr@asil.com.pk</a>.</p>
    <p>Warm regards,<br><strong>HR Department</strong><br>Allied Services International (Pvt.) Ltd.</p>
  </div>
  <div class="footer">This is an automated email. Please do not reply directly to this message.</div>
</div>
</body></html>`;

            const netPayFinal = grossM - wht - eobi - pfDedEmail - adv - loan;

            const emailHtml = html
                .replace('${fmt(netPay)}', fmt(netPayFinal))
                .replace('${fmt(wht+eobi+adv+loan)}', fmt(wht+eobi+pfDedEmail+adv+loan));

            try {
                await resend.emails.send({
                    from: EMAIL_FROM,
                    to: emp.email,
                    subject: `Salary Slip â€” ${monthName} ${year} | Allied Services International`,
                    html: emailHtml,
                });
                sent++;

            } catch (e) { failed.push({ id: emp.id, name: emp.name, err: e.message }); }
        }
        res.json({ ok: true, sent, failed, total: empRes.rows.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// XERO INTEGRATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Env vars required:
//   XERO_CLIENT_ID     â€” OAuth2 Client ID from Xero Developer Portal
//   XERO_CLIENT_SECRET â€” OAuth2 Client Secret
//   XERO_REDIRECT_URI  â€” e.g. https://asilhcm.onrender.com/api/xero/callback
//
// Flow: Admin visits /api/xero/connect â†’ Xero login â†’ /api/xero/callback
//       â†’ stores refresh_token + expires_at in system_config â†’ all future POSTs
//       use refresh_token only when access_token is near expiry (< 5 min).

const XERO_CLIENT_ID     = process.env.XERO_CLIENT_ID     || '';
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET || '';
const XERO_REDIRECT_URI  = process.env.XERO_REDIRECT_URI  || 'https://asilhcm.onrender.com/api/xero/callback';
// Includes accounting.transactions for Bills + read:chart-of-accounts for CoA sync
const XERO_SCOPES = 'offline_access openid profile email accounting.invoices accounting.contacts accounting.transactions accounting.settings';

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
    let tokens = JSON.parse(cfg.rows[0].value);

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

    // Get tenantId â€” use cached value if stored, otherwise fetch once
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

// â”€â”€ 0. Xero Status Check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/xero/status', requireAuth, async (req, res) => {
    try {
        const cfg = await pool.query(`SELECT value FROM system_config WHERE key = 'xero_tokens'`);
        if (!cfg.rows.length) return res.json({ connected: false, message: 'Not connected. Visit /api/xero/connect to authorise.' });
        const tokens = JSON.parse(cfg.rows[0].value);
        const now = Date.now();
        const expiresAt = tokens.expires_at || 0;
        const expiresIn = Math.max(0, Math.round((expiresAt - now) / 1000 / 60)); // minutes
        // If we have a recent access_token (not expired) report connected without doing a refresh
        if (tokens.access_token && expiresAt > now + 60_000) {
            return res.json({
                connected: true,
                tenant_id: tokens.tenant_id || null,
                expires_in_minutes: expiresIn,
                message: `Connected âœ“ â€” token valid for ~${expiresIn} more minutes`,
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
                message: 'Connected âœ“ â€” token refreshed',
            });
        } catch(e) {
            res.json({ connected: false, message: 'Token expired or revoked. Please reconnect at /api/xero/connect. Reason: ' + e.message });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€ 1. Initiate Xero OAuth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ 2. Xero OAuth Callback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        res.send(`<h2 style="font-family:sans-serif;color:#00B5C8">âœ“ Xero Connected Successfully!</h2>
            <p>Your Xero account is now linked to ASIL HCM. You can close this window.</p>
            <script>setTimeout(() => window.close(), 3000);</script>`);
    } catch (err) {
        res.status(500).send(`<h2>Error: ${err.message}</h2>`);
    }
});

// â”€â”€ 3. Check Xero connection status (duplicate route removed â€” see route 0 above) â”€
// Kept for backward compatibility as a redirect
app.get('/api/xero/check', requireAuth, async (req, res) => {
    try {
        const cfg = await pool.query(`SELECT value FROM system_config WHERE key = 'xero_tokens'`);
        if (!cfg.rows.length) return res.json({ connected: false });
        const tokens = JSON.parse(cfg.rows[0].value);
        const now = Date.now();
        const expiresAt = tokens.expires_at || 0;
        res.json({ connected: !!tokens.access_token, tenantId: tokens.tenant_id || null, expires_in_minutes: Math.max(0, Math.round((expiresAt - now) / 60_000)) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€ 3b. Sync Xero Chart of Accounts (for account code mapping) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        // Cache in system_config for offline use
        await pool.query(
            `INSERT INTO system_config (key, value) VALUES ('xero_chart_of_accounts', $1)
             ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW()`,
            [JSON.stringify(accounts)]
        ).catch(() => {});
        res.json({ ok: true, count: accounts.length, accounts });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€ 3c. Get cached Chart of Accounts (no Xero call needed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/xero/chart-of-accounts/cached', requireAuth, async (req, res) => {
    try {
        const cfg = await pool.query(`SELECT value, updated_at FROM system_config WHERE key = 'xero_chart_of_accounts'`);
        if (!cfg.rows.length) return res.json({ accounts: [], cached: false, message: 'No cache yet. Call /api/xero/chart-of-accounts to sync.' });
        res.json({ accounts: cfg.rows[0].value, cached: true, last_synced: cfg.rows[0].updated_at });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â”€â”€ 4. Push invoice to Xero â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/xero/invoices', requireAuth, async (req, res) => {
    try {
        const { invoice } = req.body;
        if (!invoice) return res.status(400).json({ error: 'invoice payload required' });

        const { accessToken, tenantId } = await xeroGetAccessToken();

        // Build Xero line items from payrolls + debit notes
        const lineItems = [
            ...(invoice.payrolls || []).map(p => ({
                Description:  `Manpower Services â€” ${p.contract?.split('â€”')[1]?.trim() || p.contract} (${p.period}, ${p.employees} employees)`,
                Quantity:     1,
                UnitAmount:   p.totalPayrollCost,
                AccountCode:  '200', // default sales account â€” customise as needed
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
        res.status(500).json({ error: err.message });
    }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BANKS MASTER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

app.get('/api/banks', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM banks ORDER BY is_hbl DESC, name ASC');
        res.json({ banks: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AP PAYMENT QUEUE â€” Accounts Payable
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET /api/ap/payroll-queue â€” locked payroll batches grouped by client+contract+month
app.get('/api/ap/payroll-queue', requireAuth, requireRole('ap_team','finance_manager','superadmin'), async (req, res) => {
    try {
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
            WHERE pt.locked=TRUE
            GROUP BY pt.year, pt.month, e.client, e.contract_name
            ORDER BY pt.year DESC, pt.month DESC, e.client ASC, e.contract_name ASC
        `);
        res.json({ queue: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ap/payroll-queue/:year/:month â€” employee details scoped by client+contract
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ap/payroll-queue/:year/:month/confirm â€” AP team confirms payment + selects bank
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

        // Create payment batch â€” scoped to client+contract if provided
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

        // Create payment ledger entries â€” scoped to client+contract filter
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

        for (const emp of empRows.rows) {
            await pool.query(`
                INSERT INTO payment_ledger
                    (batch_id, employee_id, employee_name, payment_type, amount, reference,
                     bank_name, bank_account, billable, xero_account_code, status)
                VALUES ($1,$2,$3,'SALARY',$4,$5,$6,$7,TRUE,'200','Paid')
                ON CONFLICT (batch_id, employee_id) DO NOTHING
            `, [batchRows[0].id, emp.employee_id, emp.name,
                parseFloat(emp.net)||0,
                `PR${monthName}${yr2}-${emp.employee_id}`,
                emp.bank_name||bank_name||'', emp.bank_account||'']);
        }

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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/ap/bills-queue â€” bills pending AP confirmation
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ap/bills/:id/confirm â€” AP team confirms bill payment
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

        // Optional Xero push
        let xeroResult = null;
        if (push_to_xero) {
            try {
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
            } catch (xe) { xeroResult = { pushed: false, error: xe.message }; }
        }

        res.json({ ok: true, batch: batchRows[0], xero: xeroResult });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payment-ledger â€” full payment ledger view
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AR / CLIENT INVOICES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

// GET /api/client-invoices â€” all client invoices (AR queue)
app.get('/api/client-invoices', requireAuth, requireRole('ar_team','finance_manager','finance_approver','finance_proposer','superadmin'), async (req, res) => {
    try {
        const { status, client } = req.query;
        const conds = []; const params = [];
        if (status) { conds.push(`status=$${params.length+1}`); params.push(status); }
        if (client) { conds.push(`client=$${params.length+1}`); params.push(client); }
        const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
        const { rows } = await pool.query(`SELECT * FROM client_invoices ${where} ORDER BY created_at DESC`, params);
        res.json({ invoices: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/client-invoices â€” AR team raises an invoice
app.post('/api/client-invoices', requireAuth, requireRole('ar_team','finance_manager','finance_approver','finance_proposer','superadmin'), async (req, res) => {
    try {
        const { client, contract, period_month, period_year, po_number, due_date,
                line_items, subtotal, service_charges, sales_tax, wht, grand_total,
                invoice_number, notes } = req.body;
        // System-generate invoice number if not provided (historical override allowed)
        const invNo = invoice_number || await generateInvoiceNumber(period_year, period_month);
        const { rows } = await pool.query(`
            INSERT INTO client_invoices
                (invoice_number, client, contract, period_month, period_year, po_number, due_date,
                 line_items, subtotal, service_charges, sales_tax, wht, grand_total, notes, status, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Draft',$15)
            RETURNING *
        `, [invNo, client, contract||null, parseInt(period_month)||null, parseInt(period_year)||null,
            po_number||null, due_date||null, JSON.stringify(line_items||[]),
            parseFloat(subtotal)||0, parseFloat(service_charges)||0, parseFloat(sales_tax)||0,
            parseFloat(wht)||0, parseFloat(grand_total)||0, notes||null, req.user.email]);
        res.json({ ok: true, invoice: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/bills/:id/create-invoice â€” auto-create a draft client invoice from a billable bill
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
            : [{ description: (b.bill_type + ' â€” ' + (b.vendor || 'Vendor') + (b.purpose ? ' | ' + b.purpose : '')), amount: parseFloat(b.total) || 0 }];

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
        res.status(500).json({ error: err.message });
    }
});

// PATCH /api/client-invoices/:id â€” update invoice (AR can override number, change status)
app.patch('/api/client-invoices/:id', requireAuth, requireRole('ar_team','finance_manager','finance_approver','superadmin'), async (req, res) => {
    try {
        const { invoice_number, status, po_number, due_date, notes, xero_invoice_id, xero_url } = req.body;
        const VALID_STATUSES = ['Draft','Raised','Sent','Paid','Voided'];
        if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
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
        res.json({ ok: true, invoice: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/client-invoices/:id/push-xero â€” push to Xero as AR invoice
app.post('/api/client-invoices/:id/push-xero', requireAuth, requireRole('ar_team','finance_manager','superadmin'), async (req, res) => {
    try {
        const inv = await pool.query('SELECT * FROM client_invoices WHERE id=$1', [req.params.id]);
        if (!inv.rows.length) return res.status(404).json({ error: 'Invoice not found' });
        const ci = inv.rows[0];
        const { accessToken, tenantId } = await xeroGetAccessToken();
        const lineItems = (ci.line_items||[]).length > 0
            ? ci.line_items.map(li => ({ Description: li.description||li.desc, Quantity: li.qty||1, UnitAmount: li.amount||li.unit_amount||0, AccountCode: li.account_code||'200' }))
            : [{ Description: `Services \u2014 ${ci.contract||ci.client}`, Quantity: 1, UnitAmount: parseFloat(ci.grand_total)||0, AccountCode: '200' }];
        const xeroPayload = {
            Type: 'ACCREC',
            InvoiceNumber: ci.invoice_number,
            Reference: ci.po_number||'',
            CurrencyCode: 'PKR',
            Status: 'AUTHORISED',
            Contact: { Name: ci.client },
            LineAmountTypes: 'Exclusive',
            LineItems: lineItems,
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
        res.json({ ok: true, xeroId, xeroUrl });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// ═══════════════════════════════════════════════════════════════════════
// PAYROLL INV-STATUS
// ═══════════════════════════════════════════════════════════════════════
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/payroll/:year/:month/preview-invoice — aggregate locked payroll for invoice wizard
app.get('/api/payroll/:year/:month/preview-invoice', requireAuth, async (req, res) => {
    try {
        const yr = parseInt(req.params.year), mo = parseInt(req.params.month);
        const { client, contract_id } = req.query;
        if (!client) return res.status(400).json({ error: 'client is required' });

        // Pull contract for credit cycle and financial settings
        let contractRow = null;
        if (contract_id) {
            const ctRes = await pool.query(
                `SELECT c.*, cl.name AS client_name FROM contracts c
                 LEFT JOIN clients cl ON c.client_id = cl.id WHERE c.id = $1`, [contract_id]);
            contractRow = ctRes.rows[0] || null;
        }
        const creditDays = contractRow?.financials?.credit_cycle_days || 30;

        // Locked payroll rows for this client/contract
        let query, params;
        if (contract_id && contractRow) {
            // Filter by client AND contract_name (employees use contract_name text, not FK)
            query = `SELECT pt.*, e.name AS emp_name, e.designation AS emp_designation
                     FROM payroll_transactions pt
                     JOIN employees e ON e.id = pt.employee_id
                     WHERE pt.year=$1 AND pt.month=$2 AND pt.locked=TRUE
                       AND LOWER(e.client) = LOWER($3)
                       AND COALESCE(LOWER(e.contract_name),'') = COALESCE(LOWER($4),'')`;
            params = [yr, mo, client, contractRow.contract_name];
        } else {
            // All locked payroll for this client regardless of contract
            query = `SELECT pt.*, e.name AS emp_name, e.designation AS emp_designation
                     FROM payroll_transactions pt
                     JOIN employees e ON e.id = pt.employee_id
                     WHERE pt.year=$1 AND pt.month=$2 AND pt.locked=TRUE
                       AND LOWER(e.client) = LOWER($3)`;
            params = [yr, mo, client];
        }
        const { rows } = await pool.query(query, params);

        if (rows.length === 0) {
            return res.json({ found: false, message: 'No locked payroll found. Please lock the payroll for this month before generating an invoice.' });
        }

        // Aggregate totals
        const totals = rows.reduce((a, r) => ({
            gross:           a.gross           + (parseFloat(r.gross)           || 0),
            net:             a.net             + (parseFloat(r.net)             || 0),
            wht:             a.wht             + (parseFloat(r.wht)             || 0),
            eobi_ee:         a.eobi_ee         + (parseFloat(r.eobi_ee)         || 0),
            service_charges: a.service_charges + (parseFloat(r.service_charges) || 0),
            sales_tax:       a.sales_tax       + (parseFloat(r.sales_tax)       || 0),
            total_invoice:   a.total_invoice   + (parseFloat(r.total_invoice)   || 0),
            opd_claim:       a.opd_claim       + (parseFloat(r.opd_claim)       || 0),
            reimbursement:   a.reimbursement   + (parseFloat(r.reimbursement)   || 0),
            arrears:         a.arrears         + (parseFloat(r.arrears)         || 0),
        }), { gross:0,net:0,wht:0,eobi_ee:0,service_charges:0,sales_tax:0,total_invoice:0,opd_claim:0,reimbursement:0,arrears:0 });

        // Auto payment due date
        const due = new Date(); due.setDate(due.getDate() + creditDays);
        const dueDateStr = due.toISOString().split('T')[0];

        // Check if already invoiced this period
        const existQ = await pool.query(
            `SELECT id, invoice_number, status FROM client_invoices
             WHERE LOWER(client) = LOWER($1) AND period_year=$2 AND period_month=$3
               AND ($4::int IS NULL OR contract_id = $4) AND status != 'Voided' LIMIT 1`,
            [client, yr, mo, contract_id ? parseInt(contract_id) : null]
        );

        res.json({
            found: true,
            employee_count: rows.length,
            employees: rows.map(r => ({
                id: r.employee_id, name: r.emp_name, designation: r.emp_designation,
                gross: parseFloat(r.gross)||0, net: parseFloat(r.net)||0,
                total_invoice: parseFloat(r.total_invoice)||0,
            })),
            totals,
            credit_cycle_days: creditDays,
            due_date: dueDateStr,
            contract: contractRow ? {
                id: contractRow.id,
                name: contractRow.contract_name,
                location: contractRow.location,
                region_province: contractRow.region_province,
                credit_cycle_days: creditDays,
                invoice_segregation: contractRow.financials?.invoice_segregation || 'combined',
            } : null,
            already_invoiced: existQ.rows[0] || null,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// PURCHASE ORDER (PO) TRACKING
// ═══════════════════════════════════════════════════════════════════════
// Proper async init — ensures table exists before any API call hits it
(async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS purchase_orders (
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
        )`);
        await pool.query(`ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS po_id INT REFERENCES purchase_orders(id) ON DELETE SET NULL`);
        console.log('✅ purchase_orders table ready');
    } catch (e) {
        console.warn('PO table init warning:', e.message);
    }
})();

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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/purchase-orders/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM purchase_orders WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/purchase-orders/:id/link-invoice', requireAuth, requireRole('ar_team','finance_manager','finance_approver','finance_proposer','superadmin'), async (req, res) => {
    try {
        const { invoice_id } = req.body;
        await pool.query('UPDATE client_invoices SET po_id=$1, updated_at=NOW() WHERE id=$2', [req.params.id, invoice_id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// CONTRACT BID TRACKING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

app.get('/api/contracts/:id/bid-items', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM contract_bid_items WHERE contract_id=$1 ORDER BY category, name',
            [req.params.id]
        );
        res.json({ items: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/contracts/:id/bid-items/:itemId', requireAuth, requireRole('superadmin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM contract_bid_items WHERE id=$1 AND contract_id=$2', [req.params.itemId, req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bid Actuals â€” record actual monthly spend vs budget
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
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AUDIT LOG
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DASHBOARD â€” Live KPIs (MD View)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.get('/api/dashboard/summary', requireAuth, async (req, res) => {
    try {
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const curYear  = now.getFullYear();

        const [empCount, contractData, invoiceData, billData, payrollData, expiring30, expiring60, recentLogs] = await Promise.all([
            // Headcount
            pool.query(`SELECT COUNT(*) AS total, COUNT(DISTINCT client) AS clients, COUNT(DISTINCT contract_name) AS contracts FROM employees WHERE active='Yes' OR active='Active' OR active IS NULL`),
            // Contracts by status
            pool.query(`SELECT status, COUNT(*) AS cnt FROM contracts GROUP BY status`),
            // Outstanding invoices
            pool.query(`SELECT COUNT(*) AS cnt, COALESCE(SUM(grand_total),0) AS value FROM client_invoices WHERE status NOT IN ('Paid','Void')`),
            // Pending bills
            pool.query(`SELECT COUNT(*) AS pending, COALESCE(SUM(CASE WHEN status='Paid' THEN total ELSE 0 END),0) AS paid_this_month FROM bills WHERE (status NOT IN ('Paid','Rejected') OR (status='Paid' AND EXTRACT(MONTH FROM paid_at)=$1 AND EXTRACT(YEAR FROM paid_at)=$2))`, [curMonth, curYear]),
            // Payroll cost locked this month
            pool.query(`SELECT COALESCE(SUM(total_invoice),0) AS monthly_cost, COUNT(*) AS locked_count FROM payroll_transactions WHERE year=$1 AND month=$2 AND locked=TRUE`, [curYear, curMonth]),
            // Contracts expiring in 30 days
            pool.query(`SELECT contract_name, client_id, end_date FROM contracts WHERE end_date BETWEEN NOW() AND NOW() + INTERVAL '30 days' ORDER BY end_date ASC`),
            // Contracts expiring in 31-60 days
            pool.query(`SELECT contract_name, client_id, end_date FROM contracts WHERE end_date BETWEEN NOW() + INTERVAL '31 days' AND NOW() + INTERVAL '60 days' ORDER BY end_date ASC`),
            // Recent audit activity
            pool.query(`SELECT user_email, action_type, entity_type, entity_id, created_at FROM audit_log ORDER BY created_at DESC LIMIT 10`).catch(() => ({ rows: [] })),
        ]);

        // Headcount breakdown by client
        const { rows: byClient } = await pool.query(
            `SELECT client, COUNT(*) AS cnt FROM employees WHERE active='Yes' OR active='Active' OR active IS NULL GROUP BY client ORDER BY cnt DESC LIMIT 8`
        );

        res.json({
            headcount: { total: parseInt(empCount.rows[0].total), clients: parseInt(empCount.rows[0].clients), contracts: parseInt(empCount.rows[0].contracts) },
            contracts: contractData.rows,
            invoices: { pending_count: parseInt(invoiceData.rows[0].cnt), pending_value: parseFloat(invoiceData.rows[0].value) },
            bills: { pending_count: parseInt(billData.rows[0].pending), paid_this_month: parseFloat(billData.rows[0].paid_this_month) },
            payroll: { monthly_cost: parseFloat(payrollData.rows[0].monthly_cost), locked_count: parseInt(payrollData.rows[0].locked_count), month: curMonth, year: curYear },
            alerts: {
                expiring_30: expiring30.rows,
                expiring_60: expiring60.rows,
            },
            top_clients: byClient,
            recent_activity: recentLogs.rows,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LEAVE MANAGEMENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Get leave history for an employee
app.get('/api/employees/:id/leaves', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_leaves WHERE employee_id=$1 ORDER BY from_date DESC', [req.params.id]);
        res.json({ leaves: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Apply for leave (HR applies on behalf of employee)
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
            await pool.query(`
                INSERT INTO employee_leave_balances (employee_id, year, leave_type, entitled, used)
                VALUES ($1,$2,$3,
                    CASE $3 WHEN 'CL' THEN 10 WHEN 'EL' THEN 14 WHEN 'ML' THEN 8 ELSE 5 END, $4)
                ON CONFLICT (employee_id, year, leave_type)
                DO UPDATE SET used = employee_leave_balances.used + $4
            `, [req.params.id, yr, leave_type, days]);
        }
        res.json({ leave: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
            await pool.query(`
                INSERT INTO employee_leave_balances (employee_id, year, leave_type, entitled, used)
                VALUES ($1,$2,$3, CASE $3 WHEN 'CL' THEN 10 WHEN 'EL' THEN 14 WHEN 'ML' THEN 8 ELSE 5 END, $4)
                ON CONFLICT (employee_id, year, leave_type)
                DO UPDATE SET used = employee_leave_balances.used + EXCLUDED.used
            `, [req.params.id, yr, lv.leave_type, parseFloat(lv.days)||1]);
        }
        res.json({ leave: lv });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get leave balance for employee for a year
app.get('/api/employees/:id/leave-balance/:year', requireAuth, async (req, res) => {
    try {
        const yr = parseInt(req.params.year);
        // Seed defaults if no record exists
        const leaveTypes = ['CL', 'EL', 'ML'];
        const entitlements = { CL: 10, EL: 14, ML: 8 };
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BILLS EXPORT (CSV + GST Summary)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FINANCE MANAGER TWO-STEP AP APPROVAL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FM approves a payment batch AFTER AP team confirms it
app.patch('/api/ap/batches/:batchId/fm-approve', requireAuth, requireRole('finance_manager','superadmin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE payment_batches SET status='FM Approved', fm_approved_by=$1, fm_approved_at=NOW(), updated_at=NOW()
             WHERE id=$2 AND status='Confirmed' RETURNING *`,
            [req.user.email, req.params.batchId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Batch not found or not in Confirmed state' });
        res.json({ ok: true, batch: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all batches pending FM approval
app.get('/api/ap/pending-fm-approval', requireAuth, requireRole('finance_manager','superadmin'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM payment_batches WHERE status='Confirmed' ORDER BY created_at DESC`);
        res.json({ batches: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INVENTORY â†” BILLS LINKAGE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
                 `From Bill ${bill.id} â€” ${bill.purpose||''}`.trim(), req.user.email]
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DOCUMENT VERSION HISTORY
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.post('/api/employees/:id/document-history', requireAuth, async (req, res) => {
    try {
        const { doc_type, action = 'Generated', notes } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO document_history (employee_id, doc_type, action, generated_by, notes)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [req.params.id, doc_type, action, req.user.email, notes||null]
        );
        res.json({ entry: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/employees/:id/document-history', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM document_history WHERE employee_id=$1 ORDER BY generated_at DESC',
            [req.params.id]);
        res.json({ history: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SYSTEM CONFIG HISTORY (Tax Slab Versioning)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.get('/api/config/:key/history', requireAuth, requireRole('superadmin','finance_manager'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM system_config_history WHERE config_key=$1 ORDER BY changed_at DESC LIMIT 50`,
            [req.params.key]);
        res.json({ history: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
app.listen(PORT, async () => {


    console.log(`ASIL HCM Backend running on port ${PORT}`);
    console.log(`Allowed domain: @${ALLOWED_DOMAIN}`);
    // â”€â”€ One-time migrations (safe to run every restart, IF NOT EXISTS guards) â”€â”€
    try {
        // â”€â”€ hcm_users table (RBAC) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€ Seed known users with correct roles (only if still pending) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Safe to run every restart â€” only updates 'pending' users, never demotes
        const roleSeed = [
            { email: 'laiba.mughal@asil.com.pk',    role: 'finance_proposer' },
            { email: 'huzaifa.rafaqat@asil.com.pk', role: 'finance_approver' },
        ];
        for (const u of roleSeed) {
            await pool.query(
                `UPDATE hcm_users SET role=$1 WHERE email=$2 AND role='pending'`,
                [u.role, u.email]
            );
        }
        console.log('Migration OK: known user roles seeded');

        // â”€â”€ Inventory tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€ Vendor tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€ System Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€ Employee Docs + Messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ New columns on employees â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Advances / Loans â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ PF Ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Gratuity Ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Asset / Uniform Issuances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Portal OTPs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        console.log('Migration OK: portal_otps');

        // â”€â”€â”€ Invoices (persistent) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Payroll Transactions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Schema migrations: add columns that may be missing from existing table â”€â”€â”€â”€â”€
        // These run safely with IF NOT EXISTS â€” needed because CREATE TABLE IF NOT EXISTS
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
            try { await pool.query(sql); } catch (e) { /* column already exists â€” ignore */ }
        }
        console.log('Migration OK: payroll_transactions column migrations done');

        // â”€â”€â”€ Fix column types: ensure OT/paid_days are NUMERIC not INTEGER â”€â”€â”€â”€â”€â”€â”€
        // ADD COLUMN IF NOT EXISTS never changes the type of an existing column.
        // If ot2_hrs/ot3_hrs were created as INTEGER before this schema, PostgreSQL
        // silently rounds 10.5 â†’ 11 on insert. Force them to NUMERIC(8,2) now.
        const typeFixCols = [
            `ALTER TABLE payroll_transactions ALTER COLUMN ot2_hrs  TYPE NUMERIC(8,2) USING ot2_hrs::NUMERIC(8,2)`,
            `ALTER TABLE payroll_transactions ALTER COLUMN ot3_hrs  TYPE NUMERIC(8,2) USING ot3_hrs::NUMERIC(8,2)`,
            `ALTER TABLE payroll_transactions ALTER COLUMN paid_days TYPE NUMERIC(5,2) USING paid_days::NUMERIC(5,2)`,
        ];
        for (const sql of typeFixCols) {
            try {
                await pool.query(sql);
                console.log('âœ“ Type migration OK:', sql.substring(47, 90));
            } catch (e) {
                // PG error 42804 = cannot change type (already correct type)
                if (e.code !== '42804') console.warn('âš  Type migration issue:', e.message);
            }
        }
        console.log('Migration OK: ot2_hrs/ot3_hrs/paid_days type ensured as NUMERIC(8,2)');

        // â”€â”€â”€ placeholder so existing closing brace still works â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const _dummy = true; if (!_dummy) {
        }

        // â”€â”€â”€ Banks Master â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Payment Batches â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        // Idempotent migrations â€” extend payment_batches with client/contract scope
        await pool.query(`ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS client TEXT`).catch(()=>{});
        await pool.query(`ALTER TABLE payment_batches ADD COLUMN IF NOT EXISTS contract_name TEXT`).catch(()=>{});
        console.log('Migration OK: payment_batches');

        // â”€â”€â”€ Payment Ledger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Client Invoices (AR Queue) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Contract Bid Items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

        // â”€â”€â”€ Contract Bid Actuals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        // --- Purchase Orders (PO Tracking) ---
        await pool.query(CREATE TABLE IF NOT EXISTS purchase_orders (
            id               SERIAL PRIMARY KEY,
            po_number        VARCHAR(120) NOT NULL,
            client_name      VARCHAR(200) NOT NULL,
            contract_id      INT REFERENCES contracts(id) ON DELETE SET NULL,
            contract_name    VARCHAR(200),
            bu_name          VARCHAR(200),
            po_value         NUMERIC(18,2) NOT NULL DEFAULT 0,
            po_date          DATE, po_expiry DATE,
            allocation_method VARCHAR(20) DEFAULT 'fifo',
            priority         INT DEFAULT 100,
            notes            TEXT,
            status           VARCHAR(30) DEFAULT 'active',
            created_by       VARCHAR(120),
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW()
        ));
        await pool.query(ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS po_id INT REFERENCES purchase_orders(id) ON DELETE SET NULL).catch(()=>{});
        await pool.query(ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS contract_id INT REFERENCES contracts(id) ON DELETE SET NULL).catch(()=>{});
        console.log('Migration OK: purchase_orders + client_invoices extended');
    } catch (e) {
        console.warn('Migration warning (non-fatal):', e.message);
    }
});


