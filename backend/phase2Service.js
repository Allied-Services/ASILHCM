'use strict';

const multer = require('multer');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cmmsSite = require('./cmmsSiteService');

const LEAVE_ENTITLEMENTS = { CL: 10, ML: 8, EL: 14 };
const UNEXCUSED_SMS = 'Ap aaj duty se ghair-hazir hain. Baraye meherbani apne supervisor se foran rabta karien. - Allied Services';
const LEAVE_APPROVED_SMS = 'Apki chutti manzoor ho gayi hai. Allied Services se rabta karen. - Allied Services';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 3 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype);
        cb(ok ? null : new Error('Only JPEG, PNG, WebP, or PDF files allowed'), ok);
    },
});

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dateRange(from, to) {
    const dates = [];
    const d = new Date(from);
    const end = new Date(to);
    while (d <= end) {
        dates.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
    }
    return dates;
}

async function setupPhase2Tables(pool, opts = {}) {
    const { sendAppEmail } = opts;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS uploaded_files (
            id           SERIAL PRIMARY KEY,
            kind         TEXT NOT NULL,
            ref_id       TEXT,
            filename     TEXT,
            mime         TEXT,
            size_bytes   INT,
            data         BYTEA NOT NULL,
            uploaded_by  TEXT,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS site TEXT
    `).catch(() => {});
    await pool.query(`
        ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS dept TEXT
    `).catch(() => {});

    // Expand status CHECK to include unexcused
    await pool.query(`
        ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check
    `).catch(() => {});
    await pool.query(`
        ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_status_check
        CHECK (status IN ('present','absent','unexcused','half_day','leave','ot'))
    `).catch(() => {});

    await pool.query(`
        CREATE TABLE IF NOT EXISTS employee_warnings (
            id            SERIAL PRIMARY KEY,
            employee_id   TEXT NOT NULL,
            warning_type  TEXT NOT NULL DEFAULT 'written',
            subject       TEXT NOT NULL,
            body          TEXT NOT NULL,
            issued_by     TEXT NOT NULL,
            issued_at     TIMESTAMPTZ DEFAULT NOW(),
            status        TEXT NOT NULL DEFAULT 'issued',
            ack_file_id   INT REFERENCES uploaded_files(id),
            ack_note      TEXT,
            acknowledged_at TIMESTAMPTZ
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS report_subscriptions (
            id           SERIAL PRIMARY KEY,
            site         TEXT NOT NULL,
            report_type  TEXT NOT NULL DEFAULT 'daily_attendance',
            recipients   TEXT[] NOT NULL,
            active       BOOLEAN DEFAULT TRUE,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS report_dispatch_log (
            id              SERIAL PRIMARY KEY,
            subscription_id INT REFERENCES report_subscriptions(id),
            report_date     DATE NOT NULL,
            sent_to         TEXT[],
            status          TEXT NOT NULL,
            error           TEXT,
            sent_at         TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(subscription_id, report_date)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS maintenance_tickets (
            id                   TEXT PRIMARY KEY,
            site                 TEXT NOT NULL,
            category             TEXT NOT NULL,
            priority             TEXT NOT NULL DEFAULT 'normal',
            title                TEXT NOT NULL,
            description          TEXT,
            status               TEXT NOT NULL DEFAULT 'open',
            reported_by          TEXT NOT NULL,
            assigned_to          TEXT,
            is_minor_petty_cash  BOOLEAN DEFAULT FALSE,
            petty_cash_amount    NUMERIC DEFAULT 0,
            photo_file_id        INT REFERENCES uploaded_files(id),
            resolution_note      TEXT,
            created_at           TIMESTAMPTZ DEFAULT NOW(),
            resolved_at          TIMESTAMPTZ
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS site_escalation_rules (
            id                 SERIAL PRIMARY KEY,
            site               TEXT NOT NULL,
            priority           TEXT NOT NULL,
            hours_open         NUMERIC NOT NULL,
            escalate_to_name   TEXT,
            escalate_to_email  TEXT NOT NULL,
            escalate_to_phone  TEXT,
            active             BOOLEAN DEFAULT TRUE,
            created_at         TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ticket_escalations (
            id           SERIAL PRIMARY KEY,
            ticket_id    TEXT NOT NULL REFERENCES maintenance_tickets(id),
            rule_id      INT NOT NULL REFERENCES site_escalation_rules(id),
            escalated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(ticket_id, rule_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS petty_cash_funds (
            id                 SERIAL PRIMARY KEY,
            site               TEXT UNIQUE NOT NULL,
            monthly_threshold  NUMERIC NOT NULL DEFAULT 0,
            finance_emails     TEXT[] NOT NULL DEFAULT '{}',
            low_alert_sent_at  TIMESTAMPTZ,
            active             BOOLEAN DEFAULT TRUE,
            created_at         TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS petty_cash_ledger (
            id          SERIAL PRIMARY KEY,
            site        TEXT NOT NULL,
            entry_type  TEXT NOT NULL CHECK (entry_type IN ('allocation','spend','replenishment')),
            amount      NUMERIC NOT NULL,
            ticket_id   TEXT,
            notes       TEXT,
            entered_by  TEXT NOT NULL,
            entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS employee_leaves (
            id                  SERIAL PRIMARY KEY,
            employee_id         TEXT NOT NULL,
            leave_type          TEXT NOT NULL,
            from_date           DATE NOT NULL,
            to_date             DATE NOT NULL,
            days                NUMERIC NOT NULL,
            reason              TEXT,
            status              TEXT NOT NULL DEFAULT 'pending',
            requested_via       TEXT DEFAULT 'office',
            internal_approver   TEXT,
            internal_decided_at TIMESTAMPTZ,
            client_focal_email  TEXT,
            client_decided_at   TIMESTAMPTZ,
            action_token_hash   TEXT,
            created_by          TEXT,
            created_at          TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS employee_leave_balances (
            id           SERIAL PRIMARY KEY,
            employee_id  TEXT NOT NULL,
            year         INT NOT NULL,
            leave_type   TEXT NOT NULL,
            entitled     NUMERIC NOT NULL,
            used         NUMERIC NOT NULL DEFAULT 0,
            UNIQUE(employee_id, year, leave_type)
        )
    `);

    await pool.query(`
        INSERT INTO system_config (key, value) VALUES ('leave_entitlements', $1)
        ON CONFLICT (key) DO NOTHING
    `, [JSON.stringify(LEAVE_ENTITLEMENTS)]).catch(() => {});

    await pool.query(`
        ALTER TABLE contracts ADD COLUMN IF NOT EXISTS allied_focal_email TEXT
    `).catch(() => {});
    await pool.query(`
        ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_focal_name TEXT
    `).catch(() => {});
    await pool.query(`
        ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_focal_email TEXT
    `).catch(() => {});

    await pool.query('CREATE INDEX IF NOT EXISTS idx_warnings_emp ON employee_warnings(employee_id)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_maint_site ON maintenance_tickets(site, status)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_petty_site ON petty_cash_ledger(site, entry_date)').catch(() => {});
    await pool.query('CREATE INDEX IF NOT EXISTS idx_leaves_status ON employee_leaves(status)').catch(() => {});

    await cmmsSite.setupCmmsSiteTables(pool, sendAppEmail);

    console.log('Phase 2 tables: OK');
}

async function getLeaveEntitlements(pool) {
    const { rows } = await pool.query(`SELECT value FROM system_config WHERE key='leave_entitlements'`).catch(() => ({ rows: [] }));
    if (rows[0]?.value) return { ...LEAVE_ENTITLEMENTS, ...rows[0].value };
    return LEAVE_ENTITLEMENTS;
}

async function ensureLeaveBalance(pool, employeeId, year, leaveType) {
    const ent = await getLeaveEntitlements(pool);
    const entitled = ent[leaveType] || 0;
    const { rows } = await pool.query(`
        INSERT INTO employee_leave_balances (employee_id, year, leave_type, entitled, used)
        VALUES ($1,$2,$3,$4,0)
        ON CONFLICT (employee_id, year, leave_type) DO UPDATE SET entitled = EXCLUDED.entitled
        RETURNING *
    `, [employeeId, year, leaveType, entitled]);
    return rows[0];
}

async function getPettyCashBalance(pool, site) {
    const now = new Date();
    const mo = now.getMonth() + 1;
    const yr = now.getFullYear();
    const { rows } = await pool.query(`
        SELECT
            COALESCE(SUM(CASE WHEN entry_type IN ('allocation','replenishment') THEN amount ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN entry_type = 'spend' THEN amount ELSE 0 END), 0) AS balance
        FROM petty_cash_ledger
        WHERE site = $1 AND EXTRACT(MONTH FROM entry_date) = $2 AND EXTRACT(YEAR FROM entry_date) = $3
    `, [site, mo, yr]);
    return parseFloat(rows[0]?.balance || 0);
}

async function checkPettyCashAlert(pool, site, sendAppEmail) {
    const { rows } = await pool.query('SELECT * FROM petty_cash_funds WHERE site=$1 AND active=true', [site]);
    if (!rows.length) return;
    const fund = rows[0];
    const threshold = parseFloat(fund.monthly_threshold) || 0;
    if (threshold <= 0) return;
    const balance = await getPettyCashBalance(pool, site);
    const pct = balance / threshold;
    if (pct >= 0.2) {
        await pool.query('UPDATE petty_cash_funds SET low_alert_sent_at=NULL WHERE id=$1', [fund.id]);
        return;
    }
    if (fund.low_alert_sent_at) return;
    const emails = fund.finance_emails || [];
    if (!emails.length) return;
    const html = `<p>Emergency petty cash at <strong>${escapeHtml(site)}</strong> is at <strong>Rs ${balance.toFixed(0)}</strong> (${Math.round(pct * 100)}% of threshold Rs ${threshold.toFixed(0)}).</p><p>Please replenish immediately.</p>`;
    await sendAppEmail({ to: emails, subject: `[ASIL] Low Emergency Petty Cash — ${site}`, html });
    await pool.query('UPDATE petty_cash_funds SET low_alert_sent_at=NOW() WHERE id=$1', [fund.id]);
}

async function writeLeaveToAttendance(pool, employeeId, fromDate, toDate, markedBy) {
    const { rows: empRows } = await pool.query('SELECT dept, location, site FROM employees WHERE id=$1', [employeeId]);
    const emp = empRows[0] || {};
    const site = emp.site || emp.location || null;
    const dept = emp.dept || null;
    for (const d of dateRange(fromDate, toDate)) {
        await pool.query(`
            INSERT INTO attendance_records (employee_id, date, status, marked_by, site, dept, updated_at)
            VALUES ($1,$2,'leave',$3,$4,$5,NOW())
            ON CONFLICT (employee_id, date) DO UPDATE SET status='leave', marked_by=$3, site=$4, dept=$5, updated_at=NOW()
        `, [employeeId, d, markedBy || 'leave-system', site, dept]);
    }
}

async function finalizeLeaveApproval(pool, leave, sendAppEmail, sendJazzSMS) {
    await writeLeaveToAttendance(pool, leave.employee_id, leave.from_date, leave.to_date, leave.internal_approver || 'system');
    const yr = new Date(leave.from_date).getFullYear();
    if (leave.leave_type !== 'unpaid') {
        await ensureLeaveBalance(pool, leave.employee_id, yr, leave.leave_type);
        await pool.query(`
            UPDATE employee_leave_balances SET used = used + $1
            WHERE employee_id=$2 AND year=$3 AND leave_type=$4
        `, [parseFloat(leave.days) || 1, leave.employee_id, yr, leave.leave_type]);
    }
    const { rows: empRows } = await pool.query('SELECT primary_contact FROM employees WHERE id=$1', [leave.employee_id]);
    const phone = empRows[0]?.primary_contact;
    if (phone && sendJazzSMS) {
        sendJazzSMS(phone, LEAVE_APPROVED_SMS).catch(err => console.error('[leave-sms]', err));
    }
}

async function sendClientLeaveEmail(pool, leave, sendAppEmail, appBaseUrl, jwtSecret) {
    const actionToken = jwt.sign({ leaveId: leave.id, purpose: 'leave_action' }, jwtSecret, { expiresIn: '7d' });
    const hash = crypto.createHash('sha256').update(actionToken).digest('hex');
    const recipients = Array.isArray(leave.client_focal_emails) && leave.client_focal_emails.length
        ? leave.client_focal_emails
        : [leave.client_focal_email].filter(Boolean);
    await pool.query(
        `UPDATE employee_leaves SET action_token_hash=$1, client_focal_email=$2 WHERE id=$3`,
        [hash, recipients[0] || leave.client_focal_email, leave.id]
    );

    const tokenEnc = encodeURIComponent(actionToken);
    const formUrl = `${appBaseUrl}/api/leave/action/${tokenEnc}`;
    const approveUrl = `${appBaseUrl}/api/leave/action/${tokenEnc}?decision=approved`;
    const rejectUrl = `${appBaseUrl}/api/leave/action/${tokenEnc}?decision=rejected`;
    const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
            <h2 style="color:#0ea5e9;">Leave Approval Request</h2>
            <p>Employee <strong>${escapeHtml(leave.employee_name || leave.employee_id)}</strong> has requested ${escapeHtml(leave.leave_type)} leave from ${leave.from_date} to ${leave.to_date} (${leave.days} day(s)).</p>
            <p>Reason: ${escapeHtml(leave.reason || '—')}</p>
            <p style="margin:24px 0;display:flex;gap:12px;flex-wrap:wrap;">
                <a href="${approveUrl}" style="background:#22c55e;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:700;">Approve</a>
                <a href="${rejectUrl}" style="background:#ef4444;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:700;">Reject</a>
                <a href="${formUrl}" style="background:#0ea5e9;color:#fff;padding:12px 20px;text-decoration:none;border-radius:8px;font-weight:700;">Remarks + Decide</a>
            </p>
            <p style="color:#64748b;font-size:12px;">Passwordless — no login required. Approve / Reject / Remarks update the database directly. Allied Services International Limited</p>
        </div>`;
    await sendAppEmail({
        to: recipients,
        subject: `[ASIL] Leave Approval — ${leave.employee_name || leave.employee_id}`,
        html,
    });
}

async function runReportDispatch(pool, sendAppEmail) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
    const { rows: subs } = await pool.query(`SELECT * FROM report_subscriptions WHERE active=true AND report_type='daily_attendance'`);
    for (const sub of subs) {
        const exists = await pool.query(
            `SELECT id FROM report_dispatch_log WHERE subscription_id=$1 AND report_date=$2 AND status='sent'`,
            [sub.id, today]
        );
        if (exists.rows.length) continue;

        try {
            const { rows } = await pool.query(`
                SELECT e.name, e.id, ar.status, ar.site, ar.dept, ar.remarks
                FROM attendance_records ar
                JOIN employees e ON e.id = ar.employee_id
                WHERE ar.date = $1 AND COALESCE(ar.site, e.location, e.site) = $2
                ORDER BY e.name
            `, [today, sub.site]);

            const counts = { present: 0, absent: 0, unexcused: 0, half_day: 0, leave: 0, ot: 0 };
            rows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

            const rowsHtml = rows.map(r =>
                `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.dept || '—')}</td><td>${r.status}</td><td>${escapeHtml(r.remarks || '')}</td></tr>`
            ).join('');

            const html = `
                <h2>Daily Attendance — ${escapeHtml(sub.site)} — ${today}</h2>
                <p>Present: ${counts.present} | Absent: ${counts.absent} | Unexcused: ${counts.unexcused} | Half: ${counts.half_day} | Leave: ${counts.leave} | OT: ${counts.ot}</p>
                <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
                    <tr><th>Employee</th><th>Dept</th><th>Status</th><th>Remarks</th></tr>
                    ${rowsHtml || '<tr><td colspan="4">No records</td></tr>'}
                </table>`;

            await sendAppEmail({ to: sub.recipients, subject: `[ASIL] Daily Logs — ${sub.site} — ${today}`, html });
            await pool.query(
                `INSERT INTO report_dispatch_log (subscription_id, report_date, sent_to, status) VALUES ($1,$2,$3,'sent')
                 ON CONFLICT (subscription_id, report_date) DO UPDATE SET status='sent', sent_to=$3, sent_at=NOW()`,
                [sub.id, today, sub.recipients]
            );
        } catch (err) {
            console.error('[report-dispatch]', sub.site, err);
            await pool.query(
                `INSERT INTO report_dispatch_log (subscription_id, report_date, sent_to, status, error) VALUES ($1,$2,$3,'failed',$4)
                 ON CONFLICT (subscription_id, report_date) DO UPDATE SET status='failed', error=$4`,
                [sub.id, today, sub.recipients, String(err.message || err)]
            ).catch(() => {});
        }
    }
}

async function runEscalationCheck(pool, sendAppEmail, sendJazzSMS) {
    return cmmsSite.runEscalationCheckEnhanced(pool, sendAppEmail, sendJazzSMS);
}

async function applyLeaveDecision(pool, { leaveId, decision, token, remarks, sendAppEmail, sendJazzSMS, res }) {
    const { rows: lvRows } = await pool.query(`
        SELECT l.*, e.name AS employee_name FROM employee_leaves l
        JOIN employees e ON e.id = l.employee_id
        WHERE l.id=$1 AND l.status='internal_approved'
    `, [leaveId]);
    if (!lvRows.length) {
        return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:48px;"><h2>This leave request has already been processed.</h2></body></html>');
    }
    const leave = lvRows[0];
    const note = remarks ? String(remarks).slice(0, 2000) : null;

    if (decision === 'rejected') {
        if (note) {
            await pool.query(
                `UPDATE employee_leaves SET status='rejected_client', client_decided_at=NOW(),
                 reason = CASE WHEN reason IS NULL OR reason = '' THEN $2 ELSE reason || E'\\n[Client remarks] ' || $2 END
                 WHERE id=$1`,
                [leaveId, note]
            );
        } else {
            await pool.query(`UPDATE employee_leaves SET status='rejected_client', client_decided_at=NOW() WHERE id=$1`, [leaveId]);
        }
        return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:48px;"><h2 style="color:#ef4444;">Leave Rejected</h2><p>Request for ${escapeHtml(leave.employee_name)} has been rejected.</p>${note ? `<p>Remarks: ${escapeHtml(note)}</p>` : ''}</body></html>`);
    }

    if (note) {
        await pool.query(
            `UPDATE employee_leaves SET status='approved', client_decided_at=NOW(),
             reason = CASE WHEN reason IS NULL OR reason = '' THEN $2 ELSE reason || E'\\n[Client remarks] ' || $2 END
             WHERE id=$1`,
            [leaveId, note]
        );
    } else {
        await pool.query(`UPDATE employee_leaves SET status='approved', client_decided_at=NOW() WHERE id=$1`, [leaveId]);
    }
    await finalizeLeaveApproval(pool, leave, sendAppEmail, sendJazzSMS);
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:48px;"><h2 style="color:#22c55e;">Leave Approved</h2><p>Request for ${escapeHtml(leave.employee_name)} has been approved. Attendance records updated.</p>${note ? `<p>Remarks: ${escapeHtml(note)}</p>` : ''}</body></html>`);
}

function registerPhase2Routes(app, deps) {
    const { pool, requireAuth, requireRole, sendJazzSMS, sendAppEmail, JWT_SECRET, APP_BASE_URL } = deps;

    // ── File uploads ──────────────────────────────────────────────────────────
    app.post('/api/files', requireAuth, upload.single('file'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'file required' });
            const { kind, ref_id } = req.body;
            const { rows } = await pool.query(`
                INSERT INTO uploaded_files (kind, ref_id, filename, mime, size_bytes, data, uploaded_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, kind, ref_id, filename, mime, size_bytes, created_at
            `, [kind || 'general', ref_id || null, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.user.email]);
            res.json({ file: rows[0] });
        } catch (err) {
            console.error('[POST /api/files]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/files/:id', requireAuth, async (req, res) => {
        try {
            const { rows } = await pool.query('SELECT mime, filename, data FROM uploaded_files WHERE id=$1', [req.params.id]);
            if (!rows.length) return res.status(404).json({ error: 'File not found' });
            res.setHeader('Content-Type', rows[0].mime || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename="${rows[0].filename || 'file'}"`);
            res.send(rows[0].data);
        } catch (err) {
            console.error('[GET /api/files/:id]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Warnings ──────────────────────────────────────────────────────────────
    app.get('/api/employees/:id/warnings', requireAuth, async (req, res) => {
        try {
            const { rows } = await pool.query(
                'SELECT * FROM employee_warnings WHERE employee_id=$1 ORDER BY issued_at DESC', [req.params.id]);
            res.json({ warnings: rows });
        } catch (err) {
            console.error('[GET warnings]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/employees/:id/warnings', requireAuth, requireRole('operations', 'superadmin', 'hr_manager', 'supervisor', 'admin'), async (req, res) => {
        try {
            const { warning_type, subject, body } = req.body;
            if (!subject || !body) return res.status(400).json({ error: 'subject and body required' });
            const { rows } = await pool.query(`
                INSERT INTO employee_warnings (employee_id, warning_type, subject, body, issued_by)
                VALUES ($1,$2,$3,$4,$5) RETURNING *
            `, [req.params.id, warning_type || 'written', subject, body, req.user.email]);
            res.json({ warning: rows[0] });
        } catch (err) {
            console.error('[POST warnings]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/warnings/:id/print', requireAuth, async (req, res) => {
        try {
            const { rows } = await pool.query(`
                SELECT w.*, e.name AS employee_name, e.designation, e.client, e.location
                FROM employee_warnings w JOIN employees e ON e.id = w.employee_id WHERE w.id=$1
            `, [req.params.id]);
            if (!rows.length) return res.status(404).send('Not found');
            const w = rows[0];
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Warning ${w.id}</title>
                <style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:40px;line-height:1.6;}
                h1{font-size:1.4rem;border-bottom:2px solid #333;padding-bottom:8px;}
                .meta{color:#555;font-size:0.9rem;margin-bottom:24px;}</style></head><body>
                <h1>Formal Employee Warning</h1>
                <div class="meta">Allied Services International Limited (Pvt.) Ltd.</div>
                <p><strong>Employee:</strong> ${escapeHtml(w.employee_name)} (${escapeHtml(w.employee_id)})</p>
                <p><strong>Designation:</strong> ${escapeHtml(w.designation)} | <strong>Site:</strong> ${escapeHtml(w.location)}</p>
                <p><strong>Type:</strong> ${escapeHtml(w.warning_type)} | <strong>Date:</strong> ${new Date(w.issued_at).toLocaleDateString('en-PK')}</p>
                <p><strong>Subject:</strong> ${escapeHtml(w.subject)}</p>
                <div style="margin:24px 0;white-space:pre-wrap;">${escapeHtml(w.body)}</div>
                <p style="margin-top:48px;">Issued by: ${escapeHtml(w.issued_by)}</p>
                <p style="margin-top:60px;border-top:1px solid #999;padding-top:8px;">Employee Acknowledgment Signature: _________________________ Date: _________</p>
                </body></html>`;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (err) {
            console.error('[GET warning print]', err);
            res.status(500).send('Internal server error');
        }
    });

    app.post('/api/warnings/:id/acknowledge', requireAuth, requireRole('operations', 'superadmin', 'hr_manager', 'supervisor', 'admin'), async (req, res) => {
        try {
            const { ack_file_id, ack_note } = req.body;
            if (!ack_file_id) return res.status(400).json({ error: 'ack_file_id required (signed photo)' });
            const { rows } = await pool.query(`
                UPDATE employee_warnings SET status='acknowledged', ack_file_id=$1, ack_note=$2, acknowledged_at=NOW()
                WHERE id=$3 RETURNING *
            `, [ack_file_id, ack_note || null, req.params.id]);
            if (!rows.length) return res.status(404).json({ error: 'Warning not found' });
            res.json({ warning: rows[0] });
        } catch (err) {
            console.error('[POST acknowledge warning]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Report subscriptions ──────────────────────────────────────────────────
    app.get('/api/report-subscriptions', requireAuth, requireRole('superadmin', 'finance_manager', 'finance_approver'), async (req, res) => {
        try {
            const { rows } = await pool.query('SELECT * FROM report_subscriptions ORDER BY site');
            res.json({ subscriptions: rows });
        } catch (err) {
            console.error('[GET report-subscriptions]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/report-subscriptions', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            const { site, report_type, recipients, active } = req.body;
            if (!site || !recipients?.length) return res.status(400).json({ error: 'site and recipients required' });
            const { rows } = await pool.query(`
                INSERT INTO report_subscriptions (site, report_type, recipients, active)
                VALUES ($1,$2,$3,$4) RETURNING *
            `, [site, report_type || 'daily_attendance', recipients, active !== false]);
            res.json({ subscription: rows[0] });
        } catch (err) {
            console.error('[POST report-subscriptions]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.put('/api/report-subscriptions/:id', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            const { site, recipients, active } = req.body;
            const { rows } = await pool.query(`
                UPDATE report_subscriptions SET site=COALESCE($1,site), recipients=COALESCE($2,recipients), active=COALESCE($3,active)
                WHERE id=$4 RETURNING *
            `, [site, recipients, active, req.params.id]);
            if (!rows.length) return res.status(404).json({ error: 'Not found' });
            res.json({ subscription: rows[0] });
        } catch (err) {
            console.error('[PUT report-subscriptions]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.delete('/api/report-subscriptions/:id', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            await pool.query('DELETE FROM report_subscriptions WHERE id=$1', [req.params.id]);
            res.json({ ok: true });
        } catch (err) {
            console.error('[DELETE report-subscriptions]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/report-subscriptions/dispatch-log', requireAuth, requireRole('superadmin', 'finance_manager'), async (req, res) => {
        try {
            const { rows } = await pool.query(`
                SELECT l.*, s.site FROM report_dispatch_log l
                JOIN report_subscriptions s ON s.id = l.subscription_id
                ORDER BY l.sent_at DESC LIMIT 50
            `);
            res.json({ log: rows });
        } catch (err) {
            console.error('[GET dispatch-log]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Maintenance / CMMS ────────────────────────────────────────────────────
    app.get('/api/maintenance/tickets', requireAuth, async (req, res) => {
        try {
            const { site, status } = req.query;
            let q = 'SELECT * FROM maintenance_tickets WHERE 1=1';
            const params = [];
            if (site) { params.push(site); q += ` AND site=$${params.length}`; }
            if (status) { params.push(status); q += ` AND status=$${params.length}`; }
            q += ' ORDER BY created_at DESC LIMIT 200';
            const { rows } = await pool.query(q, params);
            res.json({ tickets: rows });
        } catch (err) {
            console.error('[GET maintenance tickets]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/maintenance/tickets', requireAuth, upload.single('photo'), async (req, res) => {
        try {
            const { site, category, priority, title, description, is_minor_petty_cash, petty_cash_amount, due_date, cc_email, billable_to_client } = req.body;
            if (!site || !category || !title) return res.status(400).json({ error: 'site, category, title required' });
            if (!req.file) return res.status(400).json({ error: 'Photo upload is mandatory' });

            const siteRow = await cmmsSite.getSiteRow(pool, site);
            const assignedTo = siteRow?.default_assignee_email || null;

            const fileRes = await pool.query(`
                INSERT INTO uploaded_files (kind, filename, mime, size_bytes, data, uploaded_by)
                VALUES ('cmms_photo',$1,$2,$3,$4,$5) RETURNING id
            `, [req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.user.email]);
            const photoId = fileRes.rows[0].id;
            const ticketId = `MT-${site}-${Date.now()}`;

            const { rows } = await pool.query(`
                INSERT INTO maintenance_tickets (
                    id, site, category, priority, title, description, reported_by, assigned_to,
                    is_minor_petty_cash, petty_cash_amount, photo_file_id, due_date, cc_email,
                    raised_via, billable_to_client
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'staff',$14) RETURNING *
            `, [ticketId, site, category, priority || 'normal', title, description || null, req.user.email, assignedTo,
                is_minor_petty_cash === 'true' || is_minor_petty_cash === true,
                parseFloat(petty_cash_amount) || 0, photoId, due_date || null,
                cc_email || siteRow?.cc_email || null, billable_to_client || 'tbd']);

            if (rows[0].is_minor_petty_cash && parseFloat(petty_cash_amount) > 0) {
                await pool.query(`
                    INSERT INTO petty_cash_ledger (site, entry_type, amount, ticket_id, notes, entered_by)
                    VALUES ($1,'spend',$2,$3,$4,$5)
                `, [site, parseFloat(petty_cash_amount), ticketId, `CMMS ticket ${ticketId}`, req.user.email]);
                await checkPettyCashAlert(pool, site, sendAppEmail);
            }

            await cmmsSite.sendAssignmentEmail(sendAppEmail, rows[0], siteRow, APP_BASE_URL);
            res.json({ ticket: rows[0] });
        } catch (err) {
            console.error('[POST maintenance ticket]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.patch('/api/maintenance/tickets/:id', requireAuth, requireRole('operations', 'procurement_manager', 'superadmin', 'supervisor', 'finance_manager', 'finance_proposer'), async (req, res) => {
        try {
            const { status, assigned_to, resolution_note, due_date, billable_to_client, cc_email } = req.body;
            const { rows: prevRows } = await pool.query('SELECT * FROM maintenance_tickets WHERE id=$1', [req.params.id]);
            if (!prevRows.length) return res.status(404).json({ error: 'Ticket not found' });
            const prev = prevRows[0];

            const resolvedAt = ['resolved', 'closed'].includes(status) ? new Date() : null;
            const { rows } = await pool.query(`
                UPDATE maintenance_tickets SET
                    status=COALESCE($1,status),
                    assigned_to=COALESCE($2,assigned_to),
                    resolution_note=COALESCE($3,resolution_note),
                    resolved_at=COALESCE($4,resolved_at),
                    due_date=COALESCE($5,due_date),
                    billable_to_client=COALESCE($6,billable_to_client),
                    cc_email=COALESCE($7,cc_email)
                WHERE id=$8 RETURNING *
            `, [status, assigned_to, resolution_note, resolvedAt, due_date, billable_to_client, cc_email, req.params.id]);
            if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });

            if (assigned_to && assigned_to !== prev.assigned_to) {
                const siteRow = await cmmsSite.getSiteRow(pool, rows[0].site);
                await cmmsSite.sendAssignmentEmail(sendAppEmail, rows[0], siteRow, APP_BASE_URL);
            }
            res.json({ ticket: rows[0] });
        } catch (err) {
            console.error('[PATCH maintenance ticket]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/maintenance/escalation-rules', requireAuth, requireRole('superadmin', 'operations', 'procurement_manager'), async (req, res) => {
        try {
            const { rows } = await pool.query('SELECT * FROM site_escalation_rules ORDER BY site, priority, hours_open');
            res.json({ rules: rows });
        } catch (err) {
            console.error('[GET escalation rules]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/maintenance/escalation-rules', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const { site, priority, hours_open, escalate_to_name, escalate_to_email, escalate_to_phone, basis } = req.body;
            if (!site || !priority || hours_open == null || !escalate_to_email) {
                return res.status(400).json({ error: 'site, priority, hours_open, escalate_to_email required' });
            }
            const { rows } = await pool.query(`
                INSERT INTO site_escalation_rules (site, priority, hours_open, escalate_to_name, escalate_to_email, escalate_to_phone, basis)
                VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
            `, [site, priority, hours_open, escalate_to_name, escalate_to_email, escalate_to_phone, basis || 'hours_open']);
            res.json({ rule: rows[0] });
        } catch (err) {
            console.error('[POST escalation rule]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.put('/api/maintenance/escalation-rules/:id', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            const { site, priority, hours_open, escalate_to_name, escalate_to_email, escalate_to_phone, basis, active } = req.body;
            if (!site || !priority || hours_open == null || !escalate_to_email) {
                return res.status(400).json({ error: 'site, priority, hours_open, escalate_to_email required' });
            }
            const { rows } = await pool.query(`
                UPDATE site_escalation_rules SET
                    site = $1,
                    priority = $2,
                    hours_open = $3,
                    escalate_to_name = $4,
                    escalate_to_email = $5,
                    escalate_to_phone = $6,
                    basis = $7,
                    active = COALESCE($8, active)
                WHERE id = $9 RETURNING *
            `, [site, priority, hours_open, escalate_to_name || null, escalate_to_email, escalate_to_phone || null, basis || 'hours_open', active, req.params.id]);
            if (!rows.length) return res.status(404).json({ error: 'Rule not found' });
            res.json({ rule: rows[0] });
        } catch (err) {
            console.error('[PUT escalation rule]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.delete('/api/maintenance/escalation-rules/:id', requireAuth, requireRole('superadmin', 'operations'), async (req, res) => {
        try {
            await pool.query('DELETE FROM site_escalation_rules WHERE id=$1', [req.params.id]);
            res.json({ ok: true });
        } catch (err) {
            console.error('[DELETE escalation rule]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Petty cash ────────────────────────────────────────────────────────────
    app.get('/api/petty-cash/funds', requireAuth, requireRole('finance_manager', 'finance_proposer', 'superadmin', 'operations'), async (req, res) => {
        try {
            const { rows } = await pool.query('SELECT * FROM petty_cash_funds WHERE active=true ORDER BY site');
            const enriched = [];
            for (const f of rows) {
                const balance = await getPettyCashBalance(pool, f.site);
                enriched.push({ ...f, balance, pct_remaining: f.monthly_threshold > 0 ? balance / parseFloat(f.monthly_threshold) : 0 });
            }
            res.json({ funds: enriched });
        } catch (err) {
            console.error('[GET petty cash funds]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/petty-cash/funds', requireAuth, requireRole('finance_manager', 'finance_proposer', 'superadmin'), async (req, res) => {
        try {
            const { site, monthly_threshold, finance_emails } = req.body;
            if (!site) return res.status(400).json({ error: 'site required' });
            const { rows } = await pool.query(`
                INSERT INTO petty_cash_funds (site, monthly_threshold, finance_emails)
                VALUES ($1,$2,$3) ON CONFLICT (site) DO UPDATE SET monthly_threshold=$2, finance_emails=$3, active=true
                RETURNING *
            `, [site, parseFloat(monthly_threshold) || 0, finance_emails || []]);
            res.json({ fund: rows[0] });
        } catch (err) {
            console.error('[POST petty cash fund]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/petty-cash/ledger', requireAuth, requireRole('finance_manager', 'finance_proposer', 'superadmin', 'operations'), async (req, res) => {
        try {
            const { site } = req.query;
            let q = 'SELECT * FROM petty_cash_ledger WHERE 1=1';
            const params = [];
            if (site) { params.push(site); q += ` AND site=$${params.length}`; }
            q += ' ORDER BY entry_date DESC, created_at DESC LIMIT 200';
            const { rows } = await pool.query(q, params);
            res.json({ ledger: rows });
        } catch (err) {
            console.error('[GET petty cash ledger]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/petty-cash/ledger', requireAuth, requireRole('finance_manager', 'finance_proposer', 'superadmin'), async (req, res) => {
        try {
            const { site, entry_type, amount, notes } = req.body;
            if (!site || !entry_type || !amount) return res.status(400).json({ error: 'site, entry_type, amount required' });
            const { rows } = await pool.query(`
                INSERT INTO petty_cash_ledger (site, entry_type, amount, notes, entered_by)
                VALUES ($1,$2,$3,$4,$5) RETURNING *
            `, [site, entry_type, parseFloat(amount), notes || null, req.user.email]);

            if (entry_type === 'replenishment') {
                await pool.query(`UPDATE petty_cash_funds SET low_alert_sent_at=NULL WHERE site=$1`, [site]);
            }
            if (entry_type === 'spend') {
                await checkPettyCashAlert(pool, site, sendAppEmail);
            }
            res.json({ entry: rows[0] });
        } catch (err) {
            console.error('[POST petty cash ledger]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Leave engine ──────────────────────────────────────────────────────────
    app.post('/api/portal/leave-request', deps.requirePortalAuth, async (req, res) => {
        try {
            const empId = req.portalEmployee.employeeId;
            const { leave_type, from_date, to_date, reason } = req.body;
            if (!leave_type || !from_date || !to_date) return res.status(400).json({ error: 'leave_type, from_date, to_date required' });
            const days = Math.max(1, dateRange(from_date, to_date).length);
            const { rows } = await pool.query(`
                INSERT INTO employee_leaves (employee_id, leave_type, from_date, to_date, days, reason, status, requested_via, created_by)
                VALUES ($1,$2,$3,$4,$5,$6,'pending','portal',$7) RETURNING *
            `, [empId, leave_type, from_date, to_date, days, reason || null, empId]);
            res.json({ leave: rows[0] });
        } catch (err) {
            console.error('[POST portal leave-request]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/leave/requests', requireAuth, requireRole('operations', 'superadmin', 'hr_manager', 'admin'), async (req, res) => {
        try {
            const status = req.query.status || 'pending';
            const { rows } = await pool.query(`
                SELECT l.*, e.name AS employee_name, e.client, e.location, e.contract_id
                FROM employee_leaves l JOIN employees e ON e.id = l.employee_id
                WHERE l.status = $1 ORDER BY l.created_at DESC LIMIT 100
            `, [status]);
            res.json({ requests: rows });
        } catch (err) {
            console.error('[GET leave requests]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post('/api/leave/requests/:id/internal-decision', requireAuth, requireRole('operations', 'superadmin', 'hr_manager', 'admin'), async (req, res) => {
        try {
            const { decision, note } = req.body;
            if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'decision must be approve or reject' });

            const { rows: lvRows } = await pool.query(`
                SELECT l.*, e.name AS employee_name, e.contract_id FROM employee_leaves l
                JOIN employees e ON e.id = l.employee_id WHERE l.id=$1 AND l.status='pending'
            `, [req.params.id]);
            if (!lvRows.length) return res.status(404).json({ error: 'Pending leave request not found' });
            const leave = lvRows[0];

            if (decision === 'reject') {
                const { rows } = await pool.query(`
                    UPDATE employee_leaves SET status='rejected_internal', internal_approver=$1, internal_decided_at=NOW()
                    WHERE id=$2 RETURNING *
                `, [req.user.email, req.params.id]);
                return res.json({ leave: rows[0] });
            }

            // Internal approve — resolve focals from project_client_focals then contracts
            const { resolveClientFocalEmails } = require('./src/modules/attendance/clientFocals');
            const focalEmails = await resolveClientFocalEmails(pool, {
                employeeId: leave.employee_id,
                contractId: leave.contract_id,
            });
            const clientFocalEmail = focalEmails[0] || null;

            if (!clientFocalEmail) {
                const { rows } = await pool.query(`
                    UPDATE employee_leaves SET status='approved', internal_approver=$1, internal_decided_at=NOW(), client_decided_at=NOW()
                    WHERE id=$2 RETURNING *
                `, [req.user.email, req.params.id]);
                await finalizeLeaveApproval(pool, { ...leave, ...rows[0], internal_approver: req.user.email }, sendAppEmail, sendJazzSMS);
                return res.json({ leave: rows[0], auto_finalized: true });
            }

            const { rows } = await pool.query(`
                UPDATE employee_leaves SET status='internal_approved', internal_approver=$1, internal_decided_at=NOW(), client_focal_email=$2
                WHERE id=$3 RETURNING *
            `, [req.user.email, clientFocalEmail, req.params.id]);

            await sendClientLeaveEmail(pool, {
                ...leave,
                ...rows[0],
                client_focal_email: clientFocalEmail,
                client_focal_emails: focalEmails,
            }, sendAppEmail, APP_BASE_URL, JWT_SECRET);
            res.json({ leave: rows[0], focals: focalEmails });
        } catch (err) {
            console.error('[POST internal-decision]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.get('/api/leave/action/:token', async (req, res) => {
        try {
            const payload = jwt.verify(req.params.token, JWT_SECRET);
            const leaveId = payload.leaveId;
            const qDecision = req.query?.decision;
            // One-click Approve/Reject from email, or legacy JWT decision
            if (
                !req.query.form
                && (
                    (qDecision && ['approved', 'rejected'].includes(qDecision))
                    || (payload.decision && ['approved', 'rejected'].includes(payload.decision))
                )
            ) {
                return applyLeaveDecision(pool, {
                    leaveId,
                    decision: qDecision || payload.decision,
                    token: req.params.token,
                    remarks: req.query?.remarks || null,
                    sendAppEmail,
                    sendJazzSMS,
                    res,
                });
            }

            const { rows: lvRows } = await pool.query(`
                SELECT l.*, e.name AS employee_name FROM employee_leaves l
                JOIN employees e ON e.id = l.employee_id
                WHERE l.id=$1 AND l.status='internal_approved'
            `, [leaveId]);
            if (!lvRows.length) {
                return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:48px;"><h2>This leave request has already been processed.</h2></body></html>');
            }
            const leave = lvRows[0];
            const token = encodeURIComponent(req.params.token);
            res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Leave Decision</title></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f8fafc;margin:0;padding:32px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.08);">
  <h2 style="color:#0ea5e9;margin-top:0;">Leave Decision</h2>
  <p><strong>${escapeHtml(leave.employee_name)}</strong> — ${escapeHtml(leave.leave_type)} leave</p>
  <p>${leave.from_date} → ${leave.to_date} (${leave.days} day(s))</p>
  <p style="color:#64748b;">Reason: ${escapeHtml(leave.reason || '—')}</p>
  <form method="POST" action="/api/leave/action/${token}" style="margin-top:24px;">
    <label style="display:block;font-weight:600;margin-bottom:6px;">Remarks</label>
    <textarea name="remarks" rows="3" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box;" placeholder="Optional remarks"></textarea>
    <div style="display:flex;gap:12px;margin-top:16px;">
      <button type="submit" name="decision" value="approved" style="flex:1;background:#22c55e;color:#fff;border:none;padding:12px;border-radius:8px;font-weight:700;cursor:pointer;">Approve</button>
      <button type="submit" name="decision" value="rejected" style="flex:1;background:#ef4444;color:#fff;border:none;padding:12px;border-radius:8px;font-weight:700;cursor:pointer;">Reject</button>
    </div>
  </form>
  <p style="color:#94a3b8;font-size:12px;margin-top:20px;">Passwordless — no login required. Allied Services International Limited</p>
</div></body></html>`);
        } catch (err) {
            console.error('[GET leave action]', err);
            res.status(400).send('<html><body><h2>Invalid or expired link</h2></body></html>');
        }
    });

    app.post('/api/leave/action/:token', async (req, res) => {
        try {
            const payload = jwt.verify(req.params.token, JWT_SECRET);
            const decision = (req.body?.decision || req.query?.decision) === 'rejected' ? 'rejected' : 'approved';
            await applyLeaveDecision(pool, {
                leaveId: payload.leaveId,
                decision,
                token: req.params.token,
                remarks: req.body?.remarks || null,
                sendAppEmail,
                sendJazzSMS,
                res,
            });
        } catch (err) {
            console.error('[POST leave action]', err);
            res.status(400).send('<html><body><h2>Invalid or expired link</h2></body></html>');
        }
    });

    cmmsSite.registerCmmsSiteRoutes(app, { pool, requireAuth, requireRole, sendAppEmail, JWT_SECRET, APP_BASE_URL, upload });

    app.get('/api/portal/leave-balance', deps.requirePortalAuth, async (req, res) => {
        try {
            const empId = req.portalEmployee.employeeId;
            const yr = new Date().getFullYear();
            const ent = await getLeaveEntitlements(pool);
            const balances = {};
            for (const lt of Object.keys(ent)) {
                balances[lt] = await ensureLeaveBalance(pool, empId, yr, lt);
            }
            const { rows: history } = await pool.query(
                `SELECT * FROM employee_leaves WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 20`, [empId]);
            res.json({ balances, history, year: yr });
        } catch (err) {
            console.error('[GET portal leave-balance]', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

module.exports = {
    setupPhase2Tables,
    registerPhase2Routes,
    runReportDispatch,
    runEscalationCheck,
    getPettyCashBalance,
    UNEXCUSED_SMS,
};
