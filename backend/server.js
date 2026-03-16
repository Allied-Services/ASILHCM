const express = require('express');
const cors = require('cors');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

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
        const cols = ['id', 'bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'province', 'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth', 'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'primary_contact', 'emergency_contact', 'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic', 'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id', 'medical_type', 'medical_maternity', 'total_medical_coverage', 'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date'];
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
        const cols = ['bu', 'active', 'client', 'client_bu', 'dept', 'designation', 'location', 'province', 'name', 'father_name', 'mother_name', 'cnic', 'cnic_issue', 'cnic_expiry', 'place_of_birth', 'eobi_no', 'religion', 'marital_status', 'dob', 'doj', 'primary_contact', 'emergency_contact', 'email', 'present_address', 'permanent_address', 'salary', 'spouse_name', 'spouse_age', 'spouse_cnic', 'child1_name', 'child1_age', 'child1_id', 'child2_name', 'child2_age', 'child2_id', 'medical_type', 'medical_maternity', 'total_medical_coverage', 'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date'];
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
        'bank_name', 'bank_account', 'account_title', 'nok_name', 'nok_relation', 'nok_contact', 'contract_date'];
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
    const SMS_MASK = process.env.JAZZ_SMS_MASK || 'AlliedServ';
    const WORKER_URL = process.env.JAZZ_WORKER_URL || 'https://jazz-sms-proxy.shezad-mumtaz.workers.dev';
    const phone = normalisePhone(to);

    try {
        const resp = await fetch(WORKER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: phone,
                message,
                username: SMS_USER,
                password: SMS_PASS,
                from_mask: SMS_MASK,
            }),
        });
        const data = await resp.json();
        resolve({ to: phone, response: data.response || JSON.stringify(data) });
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

    const prompt = `You are a bill/receipt data extraction assistant for a Pakistani company.
Extract data from this bill image (may be handwritten, printed, in Urdu or English).

Return ONLY valid JSON (no markdown, no extra text) with this exact structure:
{
  "vendor": "vendor or supplier name",
  "date": "YYYY-MM-DD or empty string if not found",
  "items": [
    { "desc": "item description", "qty": 1, "unit": 0, "total": 0 }
  ],
  "subtotal": 0,
  "gst": 0,
  "grandTotal": 0,
  "confidence": 0.85,
  "raw": "all text visible in the image, line by line"
}

Rules:
- All amounts must be numbers (no commas, no currency symbols)
- If GST is not mentioned, set gst to 0
- grandTotal = subtotal + gst
- confidence is your estimate of extraction quality (0.0 to 1.0)
- If you cannot read a value clearly, use 0 for numbers and a "?" for strings
- Extract every line item separately`;

    try {
        const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENAI_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                max_tokens: 1000,
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

