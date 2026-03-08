const express = require('express');
const cors = require('cors');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const jwt = require('jsonwebtoken');
const { calculateEOBI, calculateSESSI, calculateMonthlyIncomeTax, calculateGratuity } = require('./taxEngine');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-prod';
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || 'asil.com.pk';

// ─── CORS — allow frontend origin only ───────────────────────────────────────
app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
}));
app.use(express.json());

// ─── Session (required by Passport for OAuth handshake only) ─────────────────
app.use(session({
    secret: process.env.SESSION_SECRET || 'session-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 60000 },
}));

app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((u, done) => done(null, u));
passport.deserializeUser((u, done) => done(null, u));

// ─── Google OAuth Strategy ────────────────────────────────────────────────────
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${BACKEND_URL}/auth/google/callback`,
}, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value || '';

    // ★ Domain restriction — only @asil.com.pk
    if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
        console.log(`Blocked login attempt from: ${email}`);
        return done(null, false, { message: 'unauthorized_domain' });
    }

    const user = {
        id: profile.id,
        email,
        name: profile.displayName,
        avatar: profile.photos?.[0]?.value || null,
        role: 'staff',
    };
    console.log(`Login: ${email}`);
    return done(null, user);
}));

// ─── JWT Auth Middleware ──────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        req.user = jwt.verify(auth.slice(7), JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token expired or invalid' });
    }
};

// ─── Auth Routes ──────────────────────────────────────────────────────────────

// Step 1: Redirect to Google
app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Step 2: Google calls back here
app.get('/auth/google/callback',
    passport.authenticate('google', {
        failureRedirect: `${FRONTEND_URL}?error=unauthorized_domain`,
        session: true,
    }),
    (req, res) => {
        // Issue a JWT valid for 8 hours
        const token = jwt.sign(req.user, JWT_SECRET, { expiresIn: '8h' });
        // Redirect back to frontend with token in URL
        res.redirect(`${FRONTEND_URL}?token=${token}`);
    }
);

// Step 3: Frontend calls this to validate stored token
app.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

// Logout — client just deletes the token
app.post('/auth/logout', (req, res) => {
    res.json({ ok: true });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Tax Calculation API (public — no auth needed, no sensitive data) ─────────
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
    const netSalary = gross - eobi.employeeShare - incomeTax;
    const totalCostToCompany = gross + eobi.employerShare + sessi;

    res.json({ parameters: { gross, join, calc }, results: { eobi, sessi, incomeTax, gratuity, netSalary, totalCostToCompany } });
});

// ─── Protected API stub (all future DB routes go here) ───────────────────────
app.get('/api/employees', requireAuth, (req, res) => {
    res.json({ employees: [], message: 'DB integration coming soon' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`ASIL HCM Backend running on port ${PORT}`);
    console.log(`Allowed domain: @${ALLOWED_DOMAIN}`);
    console.log(`Frontend URL:   ${FRONTEND_URL}`);
});
