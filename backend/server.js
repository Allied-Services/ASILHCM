const express = require('express');
const cors = require('cors');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const { calculateEOBI, calculateSESSI, calculateMonthlyIncomeTax, calculateGratuity } = require('./taxEngine');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'asil.com.pk';

// ─── DB Pool ──────────────────────────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ─── Session + Passport ───────────────────────────────────────────────────────
app.use(session({
    secret: process.env.SESSION_SECRET || 'session-secret',
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
}, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value || '';
    if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
        console.log(`Blocked: ${email}`);
        return done(null, false, { message: 'unauthorized_domain' });
    }
    return done(null, { id: profile.id, email, name: profile.displayName, avatar: profile.photos?.[0]?.value || null, role: 'staff' });
}));

// ─── JWT Middleware ───────────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
    catch { res.status(401).json({ error: 'Token expired' }); }
};

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}?error=unauthorized_domain`, session: true }),
    (req, res) => {
        const token = jwt.sign(req.user, JWT_SECRET, { expiresIn: '8h' });
        res.redirect(`${FRONTEND_URL}?token=${token}`);
    }
);
app.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));
app.post('/auth/logout', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/health/ip', (req, res) => {
    // Returns this server's outbound public IP (for Jazz CMT whitelisting)
    const https = require('https');
    https.get('https://api.ipify.org?format=json', (r) => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => res.json({ outbound_ip: JSON.parse(d).ip, note: 'Whitelist this IP with Jazz CMT' }));
    }).on('error', e => res.status(500).json({ error: e.message }));
});
app.get('/', (req, res) => res.json({ name: 'ASIL HCM API', status: 'running', app: 'https://asil-hcm-frontend.onrender.com' }));

// ─── Employee Mappers ─────────────────────────────────────────────────────────
// ─── Jazz SMS Helper ─────────────────────────────────────────────────────────
async function sendJazzSMS(to, message) {
    const user = process.env.JAZZ_CMT_USER;
    const pass = process.env.JAZZ_CMT_PASS;
    const mask = process.env.JAZZ_CMT_MASK || 'ASIL-HCM';

    // Normalise phone to E.164 (92XXXXXXXXXX)
    let phone = String(to || '').replace(/\D/g, '');
    if (phone.startsWith('0') && phone.length === 11) phone = '92' + phone.slice(1);
    if (phone.startsWith('3') && phone.length === 10) phone = '92' + phone;

    // If Jazz credentials are not configured, log and return gracefully (dev mode)
    if (!user || !pass) {
        console.log(`[SMS DEV MODE] Would send to ${phone}: "${message}"`);
        return { ok: true, response: 'DEV_MODE_NO_CREDENTIALS', phone };
    }

    const params = new URLSearchParams({
        userName: user,
        password: pass,
        mobileNumber: phone,
        message,
        senderName: mask,
        languageType: '1',
    });
    const url = `https://sendcmt.com/api/SendSMS?${params.toString()}`;
    const r = await fetch(url);
    const text = await r.text();
    if (!r.ok) throw new Error(`Jazz SMS HTTP ${r.status}: ${text}`);
    return { ok: true, response: text, phone };
}

// ─── SMS Routes ──────────────────────────────────────────────────────────────

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
    region: r.region || null,
    salaryHistory: [],
    leaves: { cl: { total: 10, used: 0 }, ml: { total: 8, used: 0 }, el: { total: 14, used: 0 } },
});

// ─── Employee Routes ──────────────────────────────────────────────────────────
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
        const cols = ['id', 'bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'province', 'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth', 'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'primary_contact', 'emergency_contact', 'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic', 'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id', 'medical_type', 'medical_maternity', 'total_medical_coverage', 'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date', 'contract_name', 'region'];
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
        const cols = ['bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'province', 'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth', 'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'primary_contact', 'emergency_contact', 'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic', 'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id', 'medical_type', 'medical_maternity', 'total_medical_coverage', 'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date', 'contract_name', 'region'];
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
    const COLS = ['id', 'bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'province',
        'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth',
        'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'primary_contact', 'emergency_contact',
        'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic',
        'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id',
        'medical_type', 'medical_maternity', 'total_medical_coverage',
        'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date', 'contract_name', 'region'];
    const placeholders = COLS.map((_, i) => `$${i + 1}`).join(',');
    const updates = COLS.slice(1).map(c => `${c}=EXCLUDED.${c}`).join(',');
    for (const emp of employees) {
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

// ─── Admin: diagnostics + cleanup ────────────────────────────────────────────
// Find duplicate employees by CNIC
app.get('/api/admin/employee-duplicates', requireAuth, async (req, res) => {
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
app.post('/api/admin/dedup-employees', requireAuth, async (req, res) => {
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
app.delete('/api/admin/delete-by-client', requireAuth, async (req, res) => {
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


// ─── SMS Routes (Jazz CMT) ────────────────────────────────────────────────────
const https = require('https');

// Normalise Pakistani mobile numbers → 03XXXXXXXXX (10 digits starting with 0)
const normalisePhone = (raw = '') => {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('92') && digits.length === 12) return '0' + digits.slice(2);
    if (digits.startsWith('3') && digits.length === 10) return '0' + digits;
    if (digits.startsWith('03') && digits.length === 11) return digits;
    return digits; // return as-is if unrecognised, let Jazz CMT reject it
};

const sendJazzSMS = (to, message) => new Promise(async (resolve, reject) => {
    const SMS_USER = process.env.JAZZ_SMS_USER || '03268366056';
    const SMS_PASS = process.env.JAZZ_SMS_PASS || 'Jazz@123';
    const SMS_MASK = process.env.JAZZ_SMS_MASK || 'ALLIED SERV';
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
        console.log(`Jazz SMS → ${phone}: ${text}`);
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


// ─── Bills / Procurement (persisted) ─────────────────────────────────────────

// ── OCR endpoint — GPT-4o Vision ─────────────────────────────────────────────
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
2. Amounts are in Pakistani Rupees (Rs) — numbers like 2600, 5000, 2800 are PKR amounts
3. The last/largest number at the bottom is usually the GRAND TOTAL
4. Translate any Urdu item descriptions to English (best effort)
5. If unit price is not shown, calculate it from total ÷ qty
6. Do NOT invent data — if something is unclear, write "?" for text or 0 for numbers
7. The confidence score must reflect actual legibility (blurry/old receipts = 0.5-0.7)

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

// Auto-create table if missing
pool.query(`
    CREATE TABLE IF NOT EXISTS bills (
        id          TEXT PRIMARY KEY,
        type        TEXT,
        vendor      TEXT,
        date        TEXT,
        client      TEXT,
        contract    TEXT,
        site        TEXT,
        bill_type   TEXT,
        purpose     TEXT,
        note        TEXT,
        items       JSONB DEFAULT '[]',
        amount      NUMERIC(12,2) DEFAULT 0,
        gst         NUMERIC(12,2) DEFAULT 0,
        total       NUMERIC(12,2) DEFAULT 0,
        status      TEXT DEFAULT 'Draft',
        created_by  TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
`).catch(e => console.error('bills table init error:', e.message));

app.get('/api/bills', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM bills ORDER BY created_at DESC');
        res.json(rows.map(r => ({
            id: r.id, type: r.type, vendor: r.vendor, date: r.date,
            client: r.client, contract: r.contract, site: r.site,
            billType: r.bill_type, purpose: r.purpose, note: r.note,
            items: r.items || [], amount: parseFloat(r.amount) || 0,
            gst: parseFloat(r.gst) || 0, total: parseFloat(r.total) || 0,
            status: r.status, createdBy: r.created_by,
            createdAt: r.created_at,
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/bills', requireAuth, async (req, res) => {
    const b = req.body;
    try {
        const { rows } = await pool.query(
            `INSERT INTO bills (id,type,vendor,date,client,contract,site,bill_type,purpose,note,items,amount,gst,total,status,created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             ON CONFLICT (id) DO UPDATE SET
               vendor=EXCLUDED.vendor, date=EXCLUDED.date, client=EXCLUDED.client,
               contract=EXCLUDED.contract, site=EXCLUDED.site, bill_type=EXCLUDED.bill_type,
               purpose=EXCLUDED.purpose, note=EXCLUDED.note, items=EXCLUDED.items,
               amount=EXCLUDED.amount, gst=EXCLUDED.gst, total=EXCLUDED.total,
               status=EXCLUDED.status, updated_at=NOW()
             RETURNING *`,
            [b.id, b.type, b.vendor, b.date, b.client, b.contract, b.site,
             b.billType, b.purpose, b.note, JSON.stringify(b.items || []),
             b.amount || 0, b.gst || 0, b.total || 0, b.status || 'Draft', req.user.email]
        );
        const r = rows[0];
        res.json({ ok: true, bill: { id: r.id, type: r.type, vendor: r.vendor, date: r.date, client: r.client, contract: r.contract, site: r.site, billType: r.bill_type, purpose: r.purpose, note: r.note, items: r.items || [], amount: parseFloat(r.amount) || 0, gst: parseFloat(r.gst) || 0, total: parseFloat(r.total) || 0, status: r.status, createdBy: r.created_by } });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/bills/:id/status', requireAuth, async (req, res) => {
    const { status } = req.body;
    try {
        await pool.query('UPDATE bills SET status=$1, updated_at=NOW() WHERE id=$2', [status, req.params.id]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Client Mappers ───────────────────────────────────────────────────────────

const clientFromDb = (r) => ({
    id: r.id, name: r.name, hq: r.hq, ntn: r.ntn, strn: r.strn, industry: r.industry,
    contacts: r.contacts || [],
    contracts: [],  // loaded separately
});

// ─── Client Routes ────────────────────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════════════════
// VENDOR MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// SYSTEM CONFIGURATION (FBR Tax Tables — editable)
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// EMPLOYEE DOCUMENTS (Fitness to Work, Police Clearance, CNIC etc.)
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// ADVANCES & LOANS
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// PF LEDGER
// ════════════════════════════════════════════════════════════════════════════════

app.get('/api/employees/:id/pf-ledger', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM employee_pf_ledger WHERE employee_id=$1 ORDER BY year DESC, month DESC',
            [req.params.id]);
        res.json({ ledger: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/employees/:id/pf-ledger', requireAuth, async (req, res) => {
    try {
        const { month, year, ee_contribution, er_contribution } = req.body;
        const { rows } = await pool.query(
            `INSERT INTO employee_pf_ledger (employee_id,month,year,ee_contribution,er_contribution)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (employee_id,month,year)
             DO UPDATE SET ee_contribution=$4, er_contribution=$5 RETURNING *`,
            [req.params.id, month, year, parseFloat(ee_contribution)||0, parseFloat(er_contribution)||0]
        );
        res.json({ entry: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════════
// GRATUITY LEDGER
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// ASSET / UNIFORM ISSUANCES
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// INVOICES (persistent DB-backed)
// ════════════════════════════════════════════════════════════════════════════════

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

app.post('/api/invoices', requireAuth, async (req, res) => {
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

app.patch('/api/invoices/:id/status', requireAuth, async (req, res) => {
    try {
        const { status } = req.body;
        const { rows } = await pool.query(
            'UPDATE invoices SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',
            [status, req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Invoice not found' });
        res.json({ invoice: rows[0] });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════════
// PAYSLIP GENERATION
// ════════════════════════════════════════════════════════════════════════════════

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

        // ── Salary components from employee master (prorated if paid_days saved) ─
        const grossSalary  = parseFloat(emp.salary) || 0;
        const workDays     = 26;
        const paidDays     = parseFloat(pay?.paid_days ?? workDays);
        const ratio        = paidDays / workDays;
        const basicSalary  = Math.round(grossSalary * 0.60 * ratio);
        const hra          = Math.round(grossSalary * 0.20 * ratio);
        const conveyance   = Math.round(grossSalary * 0.10 * ratio);
        const medical      = Math.round(grossSalary * 0.07 * ratio);
        const otherAllow   = Math.round(grossSalary * 0.03 * ratio);

        // ── Variable components from payroll_transactions ─────────────────────
        const otAmount       = Math.round(parseFloat(pay?.ot2_hrs||0) * 2 * (grossSalary*0.60/workDays/8)
                                         + parseFloat(pay?.ot3_hrs||0) * 3 * (grossSalary*0.60/workDays/8));
        const opdClaim       = Math.round(parseFloat(pay?.opd_claim||0));
        const reimbursement  = Math.round(parseFloat(pay?.reimbursement||0));
        const arrears        = Math.round(parseFloat(pay?.arrears||0));
        const splAllow       = Math.round(parseFloat(pay?.special_allowance||0));
        const fuelMobile     = Math.round(parseFloat(pay?.fuel_mobile||0));
        const bonusAmount    = Math.round(parseFloat(pay?.bonus_amount||0));

        // ── Gross = sum of all earnings ────────────────────────────────────────
        const grossTotal = basicSalary + hra + conveyance + medical + otherAllow
                         + otAmount + opdClaim + reimbursement + arrears + splAllow + fuelMobile + bonusAmount;

        // ── Deductions ────────────────────────────────────────────────────────
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
        // PF: 8.33% of basic if enrolled (we don't track pf_enrolled in payroll_transactions, use 0 as default)
        const pfEE         = 0;

        const totalDeductions = incomeTax + eobiEE + pfEE + advanceDed + loanDed + otherDed;
        const netPay          = grossTotal - totalDeductions;

        // ── Helper: only emit row if value > 0 ───────────────────────────────
        const row = (label, val, isDeduction = false) =>
            val > 0 ? `<tr><td>${label}</td><td class="amount${isDeduction?' deduction':''}">
                ${isDeduction ? '- ' : ''}${fmt(val)}</td></tr>` : '';

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Salary Slip — ${emp.name} — ${monthName} ${year}</title>
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
  <div class="meta-cell"><label>Designation</label><span>${emp.designation||'—'}</span></div>
  <div class="meta-cell"><label>Client / Location</label><span>${emp.client||'—'} / ${emp.location||'—'}</span></div>
  <div class="meta-cell"><label>CNIC</label><span>${emp.cnic||'—'}</span></div>
  <div class="meta-cell"><label>Bank Account</label><span>${emp.bank_name||'—'} &nbsp;—&nbsp; ${emp.bank_account||'—'}</span></div>
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
    <div class="sub">${monthName} ${year} &nbsp;|&nbsp; Gross ${fmt(grossTotal)} − Deductions ${fmt(totalDeductions)}</div>
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

// ════════════════════════════════════════════════════════════════════════════════
// HITL FLAGS — Bills where OCR total ≠ items sum
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// BULK PAYROLL SMS
// ════════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════════
// EMPLOYEE PORTAL — OTP LOGIN + SELF-SERVICE
// ════════════════════════════════════════════════════════════════════════════════

// Request OTP — looks up employee by phone, sends OTP via Jazz SMS
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

// Verify OTP — returns portal JWT
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

// ─── Tax Calculation (public) ─────────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════════════════
// INVENTORY MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

// ── Inventory Items (catalog) ─────────────────────────────────────────────────
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

// ── Stock In (procurement) ────────────────────────────────────────────────────
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

// ── Issuances ─────────────────────────────────────────────────────────────────
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




// ════════════════════════════════════════════════════════════════════════════════
// PAYROLL TRANSACTIONS — persistent storage for monthly payroll data
// ════════════════════════════════════════════════════════════════════════════════

// GET /api/payroll/:year/:month — load saved overrides for a given month
app.get('/api/payroll/:year/:month', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
        const { rows } = await pool.query(
            'SELECT * FROM payroll_transactions WHERE year=$1 AND month=$2',
            [parseInt(year), parseInt(month)]
        );
        // Also check if any row for this month is locked
        const locked = rows.length > 0 && rows.every(r => r.locked);
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

// POST /api/payroll/:year/:month — bulk UPSERT (newest import wins, blocked if locked)
app.post('/api/payroll/:year/:month', requireAuth, async (req, res) => {
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
                    req.user?.email || 'system',
                ]
            );
            if (upserted.length) saved.push(upserted[0].employee_id);
        }
        res.json({ ok: true, saved: saved.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/payroll/:year/:month/lock — lock a payroll month
app.patch('/api/payroll/:year/:month/lock', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
        await pool.query(
            `UPDATE payroll_transactions SET locked=TRUE, locked_by=$1, locked_at=NOW()
             WHERE year=$2 AND month=$3`,
            [req.user.email, parseInt(year), parseInt(month)]
        );
        res.json({ ok: true, locked: true, lockedBy: req.user.email });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/payroll/:year/:month/unlock — unlock a payroll month
app.patch('/api/payroll/:year/:month/unlock', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
        await pool.query(
            `UPDATE payroll_transactions SET locked=FALSE, locked_by=NULL, locked_at=NULL
             WHERE year=$1 AND month=$2`,
            [parseInt(year), parseInt(month)]
        );
        res.json({ ok: true, locked: false });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// ── Payroll CSV Export (server-side, avoids CSP/blob issues) ──────────────────
app.get('/api/payroll/:year/:month/export', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
        const { type = 'payroll' } = req.query;
        const yrInt = parseInt(year), moInt = parseInt(month);

        const [empRes, payRes] = await Promise.all([
            pool.query('SELECT * FROM employees ORDER BY name'),
            pool.query('SELECT * FROM payroll_transactions WHERE year=$1 AND month=$2', [yrInt, moInt])
        ]);

        const payMap = {};
        payRes.rows.forEach(p => { payMap[p.employee_id] = p; });

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

        const calcRow = (emp, pay) => {
            const gross = parseFloat(emp.salary) || 0;
            const pd = parseFloat(pay?.paid_days ?? WD);
            const ratio = pd / WD;
            const basic    = Math.round(gross * 0.60 * ratio);
            const hra      = Math.round(gross * 0.20 * ratio);
            const conv     = Math.round(gross * 0.10 * ratio);
            const med      = Math.round(gross * 0.07 * ratio);
            const other    = Math.round(gross * 0.03 * ratio);
            const hrly     = (gross * 0.60) / WD / 8;
            const ot2hrs   = parseFloat(pay?.ot2_hrs||0);
            const ot3hrs   = parseFloat(pay?.ot3_hrs||0);
            const otAmt    = Math.round(hrly * (ot2hrs*2 + ot3hrs*3));
            const opd      = Math.round(parseFloat(pay?.opd_claim||0));
            const reimb    = Math.round(parseFloat(pay?.reimbursement||0));
            const arr      = Math.round(parseFloat(pay?.arrears||0));
            const spl      = Math.round(parseFloat(pay?.special_allowance||0));
            const fuel     = Math.round(parseFloat(pay?.fuel_mobile||0));
            const bonus    = Math.round(parseFloat(pay?.bonus_amount||0));
            const grossM   = basic + hra + conv + med + other + otAmt + opd + reimb + arr + spl + fuel + bonus;
            const wht      = pay?.wht && parseFloat(pay.wht) > 0 ? Math.round(parseFloat(pay.wht)) : whtCalc(grossM*12);
            const eobi_ee  = 400, eobi_er = 2000;
            const sessi    = grossM < 45000 ? Math.round(grossM * 0.06) : 0;
            const advDed   = Math.round(parseFloat(pay?.advance_deduction||0));
            const loanDed  = Math.round(parseFloat(pay?.loan_deduction||0));
            const otherDed = Math.round(parseFloat(pay?.other_deduction||0));
            const totalDed = wht + eobi_ee + advDed + loanDed + otherDed;
            const netPay   = grossM - totalDed;
            const gratuity = Math.round((gross / WD) * 30 / 12);
            const costBase = grossM + eobi_er + sessi + bonus + gratuity;
            const sc       = pay?.service_charges ? Math.round(parseFloat(pay.service_charges)) : 0;
            const st       = pay?.sales_tax       ? Math.round(parseFloat(pay.sales_tax))       : 0;
            const inv      = pay?.total_invoice   ? Math.round(parseFloat(pay.total_invoice))   : costBase+sc+st;
            return { grossM, wht, eobi_ee, eobi_er, sessi, advDed, loanDed, otherDed, totalDed, netPay,
                     gratuity, costBase, sc, st, inv, otAmt, opd, reimb, arr, spl, fuel, bonus, pd, ot2hrs, ot3hrs };
        };

        let rows = [], filename = 'export.csv';
        const bu  = e => e.client_bu || e.clientbu || e.clientBU || '';
        const cnic = e => e.cnic || '';

        if (type === 'payroll') {
            rows = empRes.rows.map(emp => {
                const c = calcRow(emp, payMap[emp.id]);
                return { 'Month': monthLabel, 'Employee ID': emp.id, 'Name': emp.name,
                    'CNIC': cnic(emp), 'Contract': bu(emp), 'Location': emp.location||'',
                    'Salary': parseFloat(emp.salary)||0, 'Paid Days': c.pd,
                    'OT @2X': c.ot2hrs, 'OT @3X': c.ot3hrs, 'OT Amount': c.otAmt,
                    'OPD': c.opd, 'Reimb': c.reimb, 'Arrears': c.arr,
                    'Spl Allow': c.spl, 'Fuel/Mob': c.fuel, 'Bonus': c.bonus,
                    'Gross Monthly': c.grossM, 'Income Tax': c.wht, 'EOBI EE': c.eobi_ee,
                    'Advance': c.advDed, 'Loan': c.loanDed,
                    'Total Deductions': c.totalDed, 'Net Pay': c.netPay,
                    'EOBI ER': c.eobi_er, 'SESSI': c.sessi, 'Gratuity': c.gratuity,
                    'Total Payroll Cost': c.costBase, 'Service Charges': c.sc,
                    'Sales Tax': c.st, 'Total Invoice': c.inv };
            });
            filename = `Payroll_${year}-${String(month).padStart(2,'0')}.csv`;

        } else if (type === 'hbl') {
            rows = empRes.rows.map((emp, i) => {
                const c = calcRow(emp, payMap[emp.id]);
                return { 'Employee ID': emp.id, 'Beneficiary Name': emp.name,
                    'Account Number': emp.bank_account || emp.bankaccount || '',
                    'Net Pay': c.netPay,
                    'Reference': `ASIL-${year}${String(month).padStart(2,'0')}-${String(i+1).padStart(3,'0')}`,
                    'Bank': emp.bank_name || emp.bankname || 'HBL',
                    'Contact': emp.primary_contact || emp.primarycontact || '',
                    'Email': emp.email || '' };
            });
            filename = `HBL_Bank_${year}-${String(month).padStart(2,'0')}.csv`;

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
            return res.status(400).json({ error: 'Invalid type. Use payroll|hbl|wht|eobi|sessi' });
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

// ── Send payslips by email ─────────────────────────────────────────────────────
app.post('/api/payroll/:year/:month/send-payslips', requireAuth, async (req, res) => {
    try {
        const { year, month } = req.params;
        const { employeeIds = [] } = req.body; // [] = all
        const yrInt = parseInt(year), moInt = parseInt(month);
        const monthName = new Date(2000, moInt-1, 1).toLocaleString('en-PK', { month: 'long' });

        if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
            return res.status(503).json({ error: 'Email not configured. Set EMAIL_USER and EMAIL_APP_PASSWORD env vars.' });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD }
        });

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
            const netPay = grossM - wht - eobi - adv - loan;

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
    <h2>Salary Slip — ${monthName} ${year}</h2>
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

            try {
                await transporter.sendMail({
                    from: `"ASIL HR" <${process.env.EMAIL_USER}>`,
                    to: emp.email,
                    subject: `Salary Slip — ${monthName} ${year} | Allied Services International`,
                    html,
                });
                sent++;
            } catch (e) { failed.push({ id: emp.id, name: emp.name, err: e.message }); }
        }
        res.json({ ok: true, sent, failed, total: empRes.rows.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, async () => {
    console.log(`ASIL HCM Backend running on port ${PORT}`);
    console.log(`Allowed domain: @${ALLOWED_DOMAIN}`);
    // ── One-time migrations (safe to run every restart, IF NOT EXISTS guards) ──
    try {
        await pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_date DATE');
        console.log('Migration OK: contract_date column ready');

        // ── Inventory tables ──────────────────────────────────────────────────
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

        // ── Vendor tables ─────────────────────────────────────────────────────
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

        // ── System Config ─────────────────────────────────────────────────────
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

        // ── Employee Docs + Messages ───────────────────────────────────────────
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

        // ─── New columns on employees ─────────────────────────────────────────
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

        // ─── Advances / Loans ─────────────────────────────────────────────────
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

        // ─── PF Ledger ────────────────────────────────────────────────────────
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

        // ─── Gratuity Ledger ──────────────────────────────────────────────────
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

        // ─── Asset / Uniform Issuances ────────────────────────────────────────
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

        // ─── Portal OTPs ──────────────────────────────────────────────────────
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

        // ─── Invoices (persistent) ────────────────────────────────────────────
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

        // ─── Payroll Transactions ─────────────────────────────────────────────
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

        // ─── placeholder so existing closing brace still works ───────────────
        const _dummy = true; if (!_dummy) {
        }

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
    } catch (e) {
        console.warn('Migration warning (non-fatal):', e.message);
    }
});

