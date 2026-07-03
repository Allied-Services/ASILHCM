'use strict';

const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const LOBP_CATEGORIES = [
    'Housekeeping', 'Gardening', 'Painting', 'Rider', 'Tea Boy', 'AC Technician',
    'Sanitation', 'HSSE', 'Staff Welfare', 'Safety', 'Other',
];

const cmmsOtpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many OTP requests. Try again later.' },
});

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function normaliseEmail(email) {
    return String(email || '').trim().toLowerCase();
}

async function getSiteRow(pool, siteName) {
    const { rows } = await pool.query(
        'SELECT * FROM cmms_sites WHERE site_name=$1 AND active=true',
        [siteName]
    );
    return rows[0] || null;
}

async function sendAssignmentEmail(sendAppEmail, ticket, siteRow, appBaseUrl) {
    if (!ticket.assigned_to || !sendAppEmail) return;
    const recipients = [ticket.assigned_to];
    if (ticket.cc_email && !recipients.includes(ticket.cc_email)) recipients.push(ticket.cc_email);
    if (siteRow?.cc_email && !recipients.includes(siteRow.cc_email)) recipients.push(siteRow.cc_email);
    const link = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/` : '';
    const html = `<p>You have been assigned CMMS ticket <strong>${escapeHtml(ticket.id)}</strong> at site <strong>${escapeHtml(ticket.site)}</strong>.</p>
        <p><strong>${escapeHtml(ticket.title)}</strong></p>
        <p>Priority: ${escapeHtml(ticket.priority)}${ticket.due_date ? ` · Deadline: ${escapeHtml(String(ticket.due_date).slice(0, 10))}` : ''}</p>
        <p>${escapeHtml(ticket.description || '')}</p>
        ${link ? `<p><a href="${escapeHtml(link)}">Open ASIL HCM</a></p>` : ''}`;
    await sendAppEmail({
        to: recipients,
        subject: `[ASIL CMMS] Assigned — ${ticket.id}`,
        html,
    }).catch(err => console.error('[cmms-assignment-email]', err));
}

async function setupCmmsSiteTables(pool, sendAppEmail) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cmms_sites (
            id                      SERIAL PRIMARY KEY,
            site_name               TEXT UNIQUE NOT NULL,
            client_name             TEXT,
            categories              TEXT[] NOT NULL DEFAULT '{}',
            default_assignee_email  TEXT,
            default_assignee_name   TEXT,
            cc_email                TEXT,
            active                  BOOLEAN DEFAULT TRUE,
            created_at              TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS cmms_client_users (
            id         SERIAL PRIMARY KEY,
            email      TEXT UNIQUE NOT NULL,
            name       TEXT,
            site       TEXT NOT NULL,
            active     BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS client_otps (
            id         SERIAL PRIMARY KEY,
            email      TEXT NOT NULL,
            otp        TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            used       BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS due_date DATE`).catch(() => {});
    await pool.query(`ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS billable_to_client TEXT DEFAULT 'tbd'`).catch(() => {});
    await pool.query(`ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS raised_via TEXT DEFAULT 'staff'`).catch(() => {});
    await pool.query(`ALTER TABLE maintenance_tickets ADD COLUMN IF NOT EXISTS cc_email TEXT`).catch(() => {});

    await pool.query(`ALTER TABLE site_escalation_rules ADD COLUMN IF NOT EXISTS basis TEXT DEFAULT 'hours_open'`).catch(() => {});

    await pool.query('CREATE INDEX IF NOT EXISTS idx_cmms_sites_active ON cmms_sites(active)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_client_otps_email ON client_otps(email, used)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_maint_due ON maintenance_tickets(due_date, status)').catch(() => {});

    await seedLobpData(pool, sendAppEmail);
}

async function seedLobpData(pool, sendAppEmail) {
    await pool.query(`
        INSERT INTO cmms_sites (site_name, client_name, categories, default_assignee_email, default_assignee_name, cc_email)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (site_name) DO UPDATE SET
            client_name = EXCLUDED.client_name,
            categories = EXCLUDED.categories,
            default_assignee_email = EXCLUDED.default_assignee_email,
            default_assignee_name = EXCLUDED.default_assignee_name,
            cc_email = EXCLUDED.cc_email,
            active = TRUE
    `, ['LOBP', 'Wafi Energy', LOBP_CATEGORIES, 'mukesh.solanky@asil.com.pk', 'Mukesh', 'obaid.rana@asil.com.pk']);

    await pool.query(`
        INSERT INTO cmms_client_users (email, name, site)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, site = EXCLUDED.site, active = TRUE
    `, ['sami.abdul@wafi-energy.com', 'Sami Abdul', 'LOBP']);

    const escalationRules = [
        { hours: 0, name: 'Obaid Rana', email: 'obaid.rana@asil.com.pk', basis: 'hours_overdue', priority: 'any' },
        { hours: 48, name: 'Rabia Bhutto', email: 'rabia.bhutto@asil.com.pk', basis: 'hours_overdue', priority: 'any' },
        { hours: 120, name: 'Shezad Mumtaz', email: 'shezad.mumtaz@asil.com.pk', basis: 'hours_overdue', priority: 'any' },
        { hours: 4, name: 'Obaid Rana', email: 'obaid.rana@asil.com.pk', basis: 'hours_open', priority: 'critical' },
    ];

    for (const rule of escalationRules) {
        const { rows } = await pool.query(`
            SELECT id FROM site_escalation_rules
            WHERE site='LOBP' AND priority=$1 AND basis=$2 AND hours_open=$3 AND escalate_to_email=$4
        `, [rule.priority, rule.basis, rule.hours, rule.email]);
        if (!rows.length) {
            await pool.query(`
                INSERT INTO site_escalation_rules (site, priority, hours_open, escalate_to_name, escalate_to_email, basis)
                VALUES ('LOBP', $1, $2, $3, $4, $5)
            `, [rule.priority, rule.hours, rule.name, rule.email, rule.basis]);
        }
    }

    const backlog = [
        {
            id: 'MT-LOBP-1', category: 'Sanitation', priority: 'critical',
            title: 'Repair Lab washroom faulty flush system and reopen washroom',
            description: 'Closed 20+ days; supplies approved on ApprovalMax 27 Jun but work not executed.',
            assigned_to: 'mukesh.solanky@asil.com.pk', cc_email: 'obaid.rana@asil.com.pk',
            due_date: '2026-07-03', status: 'in_progress', created_at: '2026-07-01',
        },
        {
            id: 'MT-LOBP-2', category: 'Staff Welfare', priority: 'high',
            title: 'Issue new FM staff uniforms (no replacement in over 1 year)',
            description: 'Confirm sizes, place order, deliver.',
            assigned_to: 'laiba.mughal@asil.com.pk', cc_email: 'obaid.rana@asil.com.pk',
            due_date: '2026-07-15', status: 'in_progress', created_at: '2026-02-27',
        },
        {
            id: 'MT-LOBP-3', category: 'Staff Welfare', priority: 'high',
            title: 'Issue company ID cards for all FM resources',
            description: 'Pending ID card issuance for all LOBP FM staff.',
            assigned_to: 'obaid.rana@asil.com.pk', cc_email: 'laiba.mughal@asil.com.pk',
            due_date: '2026-07-10', status: 'open', created_at: '2026-01-15',
        },
        {
            id: 'MT-LOBP-4', category: 'HSSE', priority: 'critical',
            title: 'Audit and replenish FM resource PPE stock',
            description: 'Replace missing/damaged PPE (shoes, gloves, hi-vis, helmet, mask).',
            assigned_to: 'mukesh.solanky@asil.com.pk', cc_email: 'obaid.rana@asil.com.pk',
            due_date: '2026-07-06', status: 'in_progress', created_at: '2026-06-01',
        },
        {
            id: 'MT-LOBP-5', category: 'Sanitation', priority: 'high',
            title: 'CFP guard washroom: install wash basin, flush tank, mirror, hand wash dispenser',
            description: 'Legacy sanitation rectification at CFP guard washroom.',
            assigned_to: 'mukesh.solanky@asil.com.pk', cc_email: 'obaid.rana@asil.com.pk',
            due_date: '2026-07-10', status: 'open', created_at: '2026-06-17',
        },
        {
            id: 'MT-LOBP-6', category: 'Safety', priority: 'high',
            title: 'Lab washroom door — install see-through safety panel',
            description: 'Per Wafi PI action item.',
            assigned_to: 'mukesh.solanky@asil.com.pk', cc_email: 'obaid.rana@asil.com.pk',
            due_date: '2026-07-10', status: 'open', created_at: '2026-06-02',
        },
        {
            id: 'MT-LOBP-7', category: 'Sanitation', priority: 'high',
            title: 'Ablution area rectification',
            description: 'Legacy sanitation work at ablution area.',
            assigned_to: 'mukesh.solanky@asil.com.pk', cc_email: 'obaid.rana@asil.com.pk',
            due_date: '2026-07-08', status: 'open', created_at: '2026-06-17',
        },
    ];

    for (const t of backlog) {
        const { rows } = await pool.query('SELECT id FROM maintenance_tickets WHERE id=$1', [t.id]);
        if (rows.length) continue;
        const { rows: inserted } = await pool.query(`
            INSERT INTO maintenance_tickets (
                id, site, category, priority, title, description, status, reported_by,
                assigned_to, cc_email, due_date, raised_via, billable_to_client, created_at
            ) VALUES ($1,'LOBP',$2,$3,$4,$5,$6,'system-seed',$7,$8,$9,'seed','tbd',$10::timestamptz)
            RETURNING *
        `, [t.id, t.category, t.priority, t.title, t.description, t.status, t.assigned_to, t.cc_email, t.due_date, t.created_at]);
        if (inserted[0] && sendAppEmail) {
            await sendAssignmentEmail(sendAppEmail, inserted[0], await getSiteRow(pool, 'LOBP'), process.env.APP_BASE_URL);
        }
    }
}

function requireCmmsClient(JWT_SECRET) {
    return (req, res, next) => {
        const auth = req.headers.authorization;
        if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Client auth required' });
        try {
            const payload = jwt.verify(auth.slice(7), JWT_SECRET);
            if (!payload.cmmsClient) return res.status(403).json({ error: 'Client token required' });
            req.cmmsClient = { email: payload.email, site: payload.site, name: payload.name };
            next();
        } catch {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
    };
}

function registerCmmsSiteRoutes(app, deps) {
    const { pool, requireAuth, requireRole, sendAppEmail, JWT_SECRET, APP_BASE_URL, upload } = deps;
    const clientAuth = requireCmmsClient(JWT_SECRET);

    // ── Sites registry ────────────────────────────────────────────────────────
    app.get('/api/cmms/sites', requireAuth, async (_req, res) => {
        try {
            const { rows } = await pool.query('SELECT * FROM cmms_sites WHERE active=true ORDER BY site_name');
            res.json({ sites: rows });
        } catch (err) {
            console.error('[GET /api/cmms/sites]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/cmms/sites', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const { site_name, client_name, categories, default_assignee_email, default_assignee_name, cc_email } = req.body;
            if (!site_name) return res.status(400).json({ error: 'site_name required' });
            const { rows } = await pool.query(`
                INSERT INTO cmms_sites (site_name, client_name, categories, default_assignee_email, default_assignee_name, cc_email)
                VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
            `, [site_name, client_name || null, categories || [], default_assignee_email || null, default_assignee_name || null, cc_email || null]);
            res.json({ site: rows[0] });
        } catch (err) {
            console.error('[POST /api/cmms/sites]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.put('/api/cmms/sites/:id', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const { site_name, client_name, categories, default_assignee_email, default_assignee_name, cc_email, active } = req.body;
            const { rows } = await pool.query(`
                UPDATE cmms_sites SET
                    site_name = COALESCE($1, site_name),
                    client_name = COALESCE($2, client_name),
                    categories = COALESCE($3, categories),
                    default_assignee_email = COALESCE($4, default_assignee_email),
                    default_assignee_name = COALESCE($5, default_assignee_name),
                    cc_email = COALESCE($6, cc_email),
                    active = COALESCE($7, active)
                WHERE id = $8 RETURNING *
            `, [site_name, client_name, categories, default_assignee_email, default_assignee_name, cc_email, active, req.params.id]);
            if (!rows.length) return res.status(404).json({ error: 'Site not found' });
            res.json({ site: rows[0] });
        } catch (err) {
            console.error('[PUT /api/cmms/sites/:id]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Client users (admin) ──────────────────────────────────────────────────
    app.get('/api/cmms/client-users', requireAuth, requireRole('superadmin', 'operations'), async (_req, res) => {
        try {
            const { rows } = await pool.query('SELECT * FROM cmms_client_users ORDER BY site, email');
            res.json({ users: rows });
        } catch (err) {
            console.error('[GET /api/cmms/client-users]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/cmms/client-users', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const { email, name, site } = req.body;
            if (!email || !site) return res.status(400).json({ error: 'email and site required' });
            const { rows } = await pool.query(`
                INSERT INTO cmms_client_users (email, name, site)
                VALUES ($1,$2,$3)
                ON CONFLICT (email) DO UPDATE SET name=$2, site=$3, active=TRUE
                RETURNING *
            `, [normaliseEmail(email), name || null, site]);
            res.json({ user: rows[0] });
        } catch (err) {
            console.error('[POST /api/cmms/client-users]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Client email OTP ──────────────────────────────────────────────────────
    app.post('/api/cmms/client/request-otp', cmmsOtpLimiter, async (req, res) => {
        try {
            const email = normaliseEmail(req.body.email);
            if (!email) return res.status(400).json({ error: 'Email required' });
            const { rows } = await pool.query(
                'SELECT * FROM cmms_client_users WHERE email=$1 AND active=true',
                [email]
            );
            if (!rows.length) return res.status(404).json({ error: 'No CMMS client access for this email' });

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
            await pool.query(
                'INSERT INTO client_otps (email, otp, expires_at) VALUES ($1,$2,$3)',
                [email, otp, expiresAt]
            );

            await sendAppEmail({
                to: [email],
                subject: 'Your ASIL CMMS login code',
                html: `<p>Your CMMS login code is: <strong>${otp}</strong></p><p>Valid for 10 minutes. Do not share this code.</p>`,
            });

            res.json({ ok: true, message: `OTP sent to ${email}`, name: rows[0].name, site: rows[0].site });
        } catch (err) {
            console.error('[POST /api/cmms/client/request-otp]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/cmms/client/verify-otp', async (req, res) => {
        try {
            const email = normaliseEmail(req.body.email);
            const { otp } = req.body;
            const { rows: otpRows } = await pool.query(`
                SELECT * FROM client_otps
                WHERE email=$1 AND otp=$2 AND used=FALSE AND expires_at > NOW()
                ORDER BY created_at DESC LIMIT 1
            `, [email, otp]);
            if (!otpRows.length) return res.status(401).json({ error: 'Invalid or expired OTP' });

            await pool.query('UPDATE client_otps SET used=TRUE WHERE id=$1', [otpRows[0].id]);

            const { rows: userRows } = await pool.query(
                'SELECT * FROM cmms_client_users WHERE email=$1 AND active=true',
                [email]
            );
            if (!userRows.length) return res.status(404).json({ error: 'Client user not found' });
            const user = userRows[0];

            const token = jwt.sign(
                { cmmsClient: true, email: user.email, site: user.site, name: user.name },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            res.json({
                ok: true,
                token,
                client: { email: user.email, name: user.name, site: user.site },
            });
        } catch (err) {
            console.error('[POST /api/cmms/client/verify-otp]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/cmms/client/me', clientAuth, (req, res) => {
        res.json({ client: req.cmmsClient });
    });

    app.get('/api/cmms/client/tickets', clientAuth, async (req, res) => {
        try {
            const { rows } = await pool.query(`
                SELECT * FROM maintenance_tickets
                WHERE site=$1 ORDER BY created_at DESC LIMIT 200
            `, [req.cmmsClient.site]);
            res.json({ tickets: rows });
        } catch (err) {
            console.error('[GET /api/cmms/client/tickets]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/cmms/client/tickets', clientAuth, (req, res, next) => {
        if ((req.headers['content-type'] || '').includes('multipart/form-data')) {
            return upload.single('photo')(req, res, next);
        }
        next();
    }, async (req, res) => {
        try {
            const { category, priority, title, description, due_date, cc_email } = req.body;
            if (!category || !title) return res.status(400).json({ error: 'category and title required' });

            const site = req.cmmsClient.site;
            const siteRow = await getSiteRow(pool, site);
            const assignedTo = siteRow?.default_assignee_email || null;

            let photoId = null;
            if (req.file) {
                const fileRes = await pool.query(`
                    INSERT INTO uploaded_files (kind, filename, mime, size_bytes, data, uploaded_by)
                    VALUES ('cmms_photo',$1,$2,$3,$4,$5) RETURNING id
                `, [req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.cmmsClient.email]);
                photoId = fileRes.rows[0].id;
            }

            const ticketId = `MT-${site}-${Date.now()}`;
            const { rows } = await pool.query(`
                INSERT INTO maintenance_tickets (
                    id, site, category, priority, title, description, reported_by, assigned_to,
                    photo_file_id, due_date, cc_email, raised_via, billable_to_client
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'client','tbd') RETURNING *
            `, [
                ticketId, site, category, priority || 'normal', title, description || null,
                req.cmmsClient.email, assignedTo, photoId, due_date || null, cc_email || siteRow?.cc_email || null,
            ]);

            await sendAssignmentEmail(sendAppEmail, rows[0], siteRow, APP_BASE_URL);
            await sendAppEmail({
                to: [req.cmmsClient.email],
                subject: `[ASIL CMMS] Ticket logged — ${ticketId}`,
                html: `<p>Your maintenance ticket <strong>${escapeHtml(ticketId)}</strong> has been logged at site ${escapeHtml(site)}.</p>
                    <p><strong>${escapeHtml(title)}</strong></p>`,
            }).catch(() => {});

            res.json({ ticket: rows[0] });
        } catch (err) {
            console.error('[POST /api/cmms/client/tickets]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Billing report ────────────────────────────────────────────────────────
    app.get('/api/cmms/billing-report', requireAuth, requireRole('finance_manager', 'finance_proposer', 'superadmin', 'operations'), async (req, res) => {
        try {
            const site = req.query.site || null;
            const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);
            const year = parseInt(req.query.year, 10) || new Date().getFullYear();
            const params = [month, year];
            let siteClause = '';
            if (site) {
                params.push(site);
                siteClause = ` AND t.site = $${params.length}`;
            }

            const { rows: tickets } = await pool.query(`
                SELECT t.*,
                    COALESCE(l.spend_total, 0) AS spend_total
                FROM maintenance_tickets t
                LEFT JOIN (
                    SELECT ticket_id, SUM(amount) AS spend_total
                    FROM petty_cash_ledger
                    WHERE entry_type = 'spend'
                    GROUP BY ticket_id
                ) l ON l.ticket_id = t.id
                WHERE EXTRACT(MONTH FROM t.created_at) = $1
                  AND EXTRACT(YEAR FROM t.created_at) = $2
                  ${siteClause}
                ORDER BY t.site, t.created_at DESC
            `, params);

            const summary = { billable: 0, internal: 0, tbd: 0, spend_billable: 0, spend_internal: 0, spend_tbd: 0 };
            for (const t of tickets) {
                const spend = parseFloat(t.spend_total) || 0;
                const bucket = t.billable_to_client || 'tbd';
                summary[bucket] = (summary[bucket] || 0) + 1;
                summary[`spend_${bucket}`] = (summary[`spend_${bucket}`] || 0) + spend;
            }

            if (req.query.format === 'csv') {
                const header = 'id,site,category,priority,title,status,billable_to_client,spend_total,due_date,assigned_to\n';
                const lines = tickets.map(t => [
                    t.id, t.site, t.category, t.priority, `"${String(t.title).replace(/"/g, '""')}"`,
                    t.status, t.billable_to_client, parseFloat(t.spend_total) || 0,
                    t.due_date ? String(t.due_date).slice(0, 10) : '', t.assigned_to || '',
                ].join(','));
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="cmms-billing-${year}-${month}.csv"`);
                return res.send(header + lines.join('\n'));
            }

            res.json({ tickets, summary, month, year, site: site || 'all' });
        } catch (err) {
            console.error('[GET /api/cmms/billing-report]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

async function runEscalationCheckEnhanced(pool, sendAppEmail, sendJazzSMS) {
    const { rows: tickets } = await pool.query(`
        SELECT t.*,
            EXTRACT(EPOCH FROM (NOW() - t.created_at))/3600 AS hours_open,
            CASE WHEN t.due_date IS NOT NULL AND NOW()::date > t.due_date
                THEN EXTRACT(EPOCH FROM (NOW() - ((t.due_date + INTERVAL '1 day')::timestamptz)))/3600
                ELSE NULL END AS hours_overdue
        FROM maintenance_tickets t
        WHERE t.status IN ('open','in_progress')
    `);

    for (const ticket of tickets) {
        const hoursOpen = parseFloat(ticket.hours_open) || 0;
        const hoursOverdue = ticket.hours_overdue != null ? parseFloat(ticket.hours_overdue) : null;
        const useOverdue = ticket.due_date && hoursOverdue != null && hoursOverdue >= 0;

        let rules;
        if (useOverdue) {
            const { rows } = await pool.query(`
                SELECT * FROM site_escalation_rules
                WHERE site=$1 AND active=true AND basis='hours_overdue'
                  AND (priority=$2 OR priority='any')
                  AND hours_open <= $3
                ORDER BY hours_open DESC
            `, [ticket.site, ticket.priority, hoursOverdue]);
            rules = rows;
        } else {
            const { rows } = await pool.query(`
                SELECT * FROM site_escalation_rules
                WHERE site=$1 AND active=true AND (basis='hours_open' OR basis IS NULL)
                  AND (priority=$2 OR priority='any')
                  AND hours_open <= $3
                ORDER BY hours_open DESC
            `, [ticket.site, ticket.priority, hoursOpen]);
            rules = rows;
        }

        for (const rule of rules) {
            const dup = await pool.query(
                'SELECT id FROM ticket_escalations WHERE ticket_id=$1 AND rule_id=$2',
                [ticket.id, rule.id]
            );
            if (dup.rows.length) continue;

            const overdueNote = useOverdue
                ? `overdue ${Math.round(hoursOverdue)}h past deadline`
                : `open ${Math.round(hoursOpen)}h`;
            const html = `<p>Ticket <strong>${escapeHtml(ticket.id)}</strong> at ${escapeHtml(ticket.site)} (${ticket.priority}) is ${overdueNote}.</p>
                <p><strong>${escapeHtml(ticket.title)}</strong></p><p>${escapeHtml(ticket.description || '')}</p>
                ${ticket.due_date ? `<p>Deadline: ${escapeHtml(String(ticket.due_date).slice(0, 10))}</p>` : ''}`;
            await sendAppEmail({ to: [rule.escalate_to_email], subject: `[ASIL CMMS] Escalation — ${ticket.id}`, html });
            if (rule.escalate_to_phone && sendJazzSMS) {
                sendJazzSMS(rule.escalate_to_phone, `CMMS: Ticket ${ticket.id} at ${ticket.site} requires attention.`).catch(() => {});
            }
            await pool.query('INSERT INTO ticket_escalations (ticket_id, rule_id) VALUES ($1,$2)', [ticket.id, rule.id]);
            break;
        }
    }
}

module.exports = {
    setupCmmsSiteTables,
    registerCmmsSiteRoutes,
    runEscalationCheckEnhanced,
    sendAssignmentEmail,
    getSiteRow,
    requireCmmsClient,
    LOBP_CATEGORIES,
};
