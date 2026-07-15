'use strict';

const crypto = require('crypto');

const FILL_OPEN_DAY = parseInt(process.env.CLAIMS_FILL_OPEN_DAY || '17', 10);
const FILL_CLOSE_DAY = parseInt(process.env.CLAIMS_FILL_CLOSE_DAY || '22', 10);
const APPROVE_CLOSE_DAY = parseInt(process.env.CLAIMS_APPROVE_CLOSE_DAY || '25', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://asil-hcm-frontend.onrender.com';

const OT_MAP = { single: 1, double: 2, triple: 3 };

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newToken() {
    return crypto.randomBytes(24).toString('hex');
}

function pktNow() {
    return new Date(Date.now() + 5 * 60 * 60 * 1000);
}

function normalizeAuthority(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    const v = String(raw).trim();
    if (/^self$/i.test(v)) return 'SELF';
    return v.toLowerCase();
}

function resolveFillerEmail(emp) {
    const auth = normalizeAuthority(emp.claim_authority);
    if (!auth) return null;
    if (auth === 'SELF') {
        return (emp.email || '').toLowerCase().trim() || null;
    }
    return auth;
}

function resolveApproverEmail(emp) {
    return (emp.supervisor_email || emp.line_manager_email || '').toLowerCase().trim() || null;
}

function periodWindow(campaignYear, campaignMonth) {
    // Claim month = previous calendar month relative to campaign month
    const claimDate = new Date(campaignYear, campaignMonth - 2, 1);
    const claimMonth = claimDate.getMonth() + 1;
    const claimYear = claimDate.getFullYear();
    const settlementDate = new Date(campaignYear, campaignMonth - 1, 1);
    const settlementMonth = settlementDate.getMonth() + 1;
    const settlementYear = settlementDate.getFullYear();

    // Deadlines in PKT stored as timestamptz (approx: treat as UTC+5 wall clock)
    const fillOpen = new Date(Date.UTC(campaignYear, campaignMonth - 1, FILL_OPEN_DAY, 4, 0, 0)); // 09:00 PKT
    const fillClose = new Date(Date.UTC(campaignYear, campaignMonth - 1, FILL_CLOSE_DAY, 18, 59, 59)); // 23:59 PKT
    const approveClose = new Date(Date.UTC(campaignYear, campaignMonth - 1, APPROVE_CLOSE_DAY, 18, 59, 59));

    return {
        claimMonth, claimYear, settlementMonth, settlementYear,
        fillOpenAt: fillOpen, fillCloseAt: fillClose, approveCloseAt: approveClose,
    };
}

function isAfterFillClose(period) {
    return Date.now() > new Date(period.fill_close_at).getTime();
}

function isAfterApproveClose(period) {
    return Date.now() > new Date(period.approve_close_at).getTime();
}

function validateOtRow(row) {
    const errors = [];
    const warnings = [];
    const hours = parseFloat(row.ot_hours);
    const mult = String(row.ot_multiplier || '').toLowerCase().trim();
    if (!row.claim_date) errors.push('OT date required');
    if (!Number.isFinite(hours) || hours <= 0) errors.push('OT hours must be positive');
    if (!OT_MAP[mult]) errors.push('OT multiplier must be Single, Double, or Triple');

    if (row.claim_date && Number.isFinite(hours) && OT_MAP[mult]) {
        const d = new Date(row.claim_date);
        const dow = d.getDay();
        if (mult === 'triple' && dow !== 0) {
            // Soft: Eid check omitted here — weekday/Sunday triple is hard error except we only hard-error weekday
            // Sunday max 2x per labour law
        }
        if (mult === 'triple' && dow !== 0) {
            // Allow triple only flagged — keep hard for non-Sunday non-holiday simple rule:
            // For portal MVP: triple on weekday = error; Sunday triple = error (max double); holidays left as warning
            if (dow >= 1 && dow <= 6) {
                errors.push('Triple OT not allowed on weekdays — use Double (max) unless Eid (ASIL will handle Eid)');
            }
        }
        if (mult === 'single' && dow === 0) {
            errors.push('Sunday work requires at least Double OT');
        }
        if (hours > 6) warnings.push(`High OT: ${hours}h claimed`);
    }
    return { errors, warnings, factor: OT_MAP[mult] || null };
}

async function ensureClaimAuthorityColumn(pool) {
    await pool.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS claim_authority TEXT`).catch(() => {});
}

async function getOrCreatePeriod(pool, campaignMonth, campaignYear) {
    const w = periodWindow(campaignYear, campaignMonth);
    const { rows: existing } = await pool.query(
        `SELECT * FROM portal_claim_periods WHERE campaign_month = $1 AND campaign_year = $2`,
        [campaignMonth, campaignYear]
    );
    if (existing[0]) return existing[0];

    const { rows } = await pool.query(
        `INSERT INTO portal_claim_periods
         (campaign_month, campaign_year, claim_month, claim_year, settlement_month, settlement_year,
          fill_open_at, fill_close_at, approve_close_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')
         RETURNING *`,
        [
            campaignMonth, campaignYear, w.claimMonth, w.claimYear, w.settlementMonth, w.settlementYear,
            w.fillOpenAt.toISOString(), w.fillCloseAt.toISOString(), w.approveCloseAt.toISOString(),
        ]
    );
    return rows[0];
}

/**
 * Eligible employees: claim_authority set, resolvable filler email, active.
 */
async function listEligibleEmployees(pool) {
    await ensureClaimAuthorityColumn(pool);
    const { rows } = await pool.query(`
        SELECT id, name, email, claim_authority, supervisor_email, line_manager_email, client, location, dept, salary
        FROM employees
        WHERE claim_authority IS NOT NULL AND TRIM(claim_authority) <> ''
          AND (
            active IS NULL
            OR LOWER(TRIM(active::text)) IN ('yes','true','1','active','')
            OR active::text = 'Yes'
          )
          AND (last_working_day IS NULL OR last_working_day >= CURRENT_DATE)
        ORDER BY client NULLS LAST, name
    `);
    return rows.map(e => ({
        ...e,
        filler_email: resolveFillerEmail(e),
        approver_email: resolveApproverEmail(e),
        claim_authority_norm: normalizeAuthority(e.claim_authority),
    })).filter(e => e.filler_email);
}

async function createCampaign(pool, { campaignMonth, campaignYear, sendAppEmail, dryRun = false, onlyEmails = null }) {
    const period = await getOrCreatePeriod(pool, campaignMonth, campaignYear);
    let eligible = await listEligibleEmployees(pool);

    // Segregation: filler !== approver
    const skipped = [];
    eligible = eligible.filter(e => {
        if (e.approver_email && e.filler_email === e.approver_email) {
            skipped.push({ employee_id: e.id, reason: 'Claim Authority email equals Approver' });
            return false;
        }
        if (onlyEmails && onlyEmails.length) {
            return onlyEmails.map(x => x.toLowerCase()).includes(e.filler_email);
        }
        return true;
    });

    const byFiller = new Map();
    for (const e of eligible) {
        if (!byFiller.has(e.filler_email)) byFiller.set(e.filler_email, []);
        byFiller.get(e.filler_email).push(e);
    }

    const invites = [];
    for (const [fillerEmail, emps] of byFiller) {
        const token = newToken();
        const tokenHash = hashToken(token);

        if (!dryRun) {
            const { rows: batchRows } = await pool.query(
                `INSERT INTO portal_claim_batches (period_id, filler_email, invite_token_hash, invite_sent_at, invite_delivered, status)
                 VALUES ($1,$2,$3,NOW(),TRUE,'invited')
                 ON CONFLICT (period_id, filler_email) DO UPDATE
                   SET invite_token_hash = EXCLUDED.invite_token_hash,
                       invite_sent_at = NOW(),
                       invite_delivered = TRUE,
                       status = CASE WHEN portal_claim_batches.status IN ('submitted','no_claims') THEN portal_claim_batches.status ELSE 'invited' END
                 RETURNING *`,
                [period.id, fillerEmail, tokenHash]
            );
            const batch = batchRows[0];

            for (const emp of emps) {
                await pool.query(
                    `INSERT INTO portal_claim_submissions
                     (period_id, batch_id, employee_id, filler_email, approver_email, status, channel)
                     VALUES ($1,$2,$3,$4,$5,'invited','portal')
                     ON CONFLICT (period_id, employee_id) DO UPDATE
                       SET batch_id = EXCLUDED.batch_id,
                           filler_email = EXCLUDED.filler_email,
                           approver_email = EXCLUDED.approver_email,
                           updated_at = NOW()
                     WHERE portal_claim_submissions.status NOT IN ('approved','in_payroll')`,
                    [period.id, batch.id, emp.id, fillerEmail, emp.approver_email]
                );
            }

            const link = `${FRONTEND_URL}/?asil_claims=fill&token=${token}`;
            if (sendAppEmail) {
                try {
                    await sendAppEmail({
                        to: fillerEmail,
                        subject: `ASIL Claims for ${period.claim_month}/${period.claim_year} — submit by day ${FILL_CLOSE_DAY}`,
                        html: buildFillerInviteHtml({ period, employeeCount: emps.length, link, fillerEmail }),
                    });
                } catch (err) {
                    await pool.query(
                        `UPDATE portal_claim_batches SET invite_delivered = FALSE WHERE id = $1`,
                        [batch.id]
                    );
                    invites.push({ fillerEmail, ok: false, error: err.message, employeeCount: emps.length });
                    continue;
                }
            }
            invites.push({ fillerEmail, ok: true, employeeCount: emps.length, link, batchId: batch.id });
        } else {
            invites.push({
                fillerEmail,
                ok: true,
                dryRun: true,
                employeeCount: emps.length,
                employees: emps.map(e => e.id),
            });
        }
    }

    return { period, invites, skipped, fillerCount: byFiller.size, employeeCount: eligible.length };
}

function buildFillerInviteHtml({ period, employeeCount, link, fillerEmail }) {
    const settleLabel = `${period.settlement_month || ''}/${period.settlement_year || ''}`.replace(/^\/|\/$/g, '') || 'the following month';
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f8fafc">
<div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
  <h2 style="margin:0 0 8px;color:#0f172a">ASIL HCM — Monthly Claims</h2>
  <p style="color:#475569;margin:0 0 16px">Claim month <strong>${period.claim_month}/${period.claim_year}</strong> · You are Claim Authority for <strong>${employeeCount}</strong> employee(s).</p>

  <p style="color:#334155;margin:0 0 8px"><strong>What to do</strong></p>
  <ol style="color:#475569;margin:0 0 16px;padding-left:20px;line-height:1.55">
    <li>Open the form with the button below (no password needed).</li>
    <li>For each employee: enter <strong>Overtime</strong>, <strong>Expense</strong>, and/or <strong>Medical</strong> — or tap <strong>Confirm No Claims</strong>.</li>
    <li>Attach receipts/supports for Expense and Medical (PDF/JPG/PNG).</li>
    <li>Submit by <strong>day ${FILL_CLOSE_DAY}</strong> of this cycle.</li>
  </ol>

  <p style="color:#334155;margin:0 0 8px"><strong>What happens next</strong></p>
  <ul style="color:#475569;margin:0 0 16px;padding-left:20px;line-height:1.55">
    <li>Your Line Manager / supervisor reviews and approves (deadline day ${APPROVE_CLOSE_DAY}).</li>
    <li>Approved amounts go into payroll for settlement in <strong>${settleLabel}</strong> (paid with the following month’s salary).</li>
    <li>If rejected after the fill deadline, raise again next month or ask ASIL finance for help.</li>
  </ul>

  <p style="margin:24px 0"><a href="${link}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open claims form</a></p>
  <p style="font-size:12px;color:#94a3b8;word-break:break-all">${link}</p>
  <p style="font-size:12px;color:#94a3b8;margin:16px 0 0">Sent to ${fillerEmail} · Allied Services International (ASIL)</p>
</div></body></html>`;
}

async function getBatchByToken(pool, token) {
    const h = hashToken(token);
    const { rows } = await pool.query(
        `SELECT b.*, p.claim_month, p.claim_year, p.settlement_month, p.settlement_year,
                p.fill_close_at, p.approve_close_at, p.fill_open_at, p.status AS period_status
         FROM portal_claim_batches b
         JOIN portal_claim_periods p ON p.id = b.period_id
         WHERE b.invite_token_hash = $1`,
        [h]
    );
    return rows[0] || null;
}

async function openFillerSession(pool, token) {
    const batch = await getBatchByToken(pool, token);
    if (!batch) return { ok: false, status: 404, error: 'Invalid or expired link' };

    if (!batch.invite_opened_at) {
        await pool.query(`UPDATE portal_claim_batches SET invite_opened_at = NOW() WHERE id = $1`, [batch.id]);
    }

    const { rows: submissions } = await pool.query(
        `SELECT s.*, e.name AS employee_name, e.dept, e.location, e.client
         FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.batch_id = $1
         ORDER BY e.name`,
        [batch.id]
    );

    const ids = submissions.map(s => s.id);
    let items = [];
    if (ids.length) {
        const { rows } = await pool.query(
            `SELECT * FROM portal_claim_items WHERE submission_id = ANY($1::int[]) AND active = TRUE ORDER BY claim_date, id`,
            [ids]
        );
        items = rows;
    }

    const fillClosed = isAfterFillClose(batch);
    return {
        ok: true,
        batch,
        period: {
            id: batch.period_id,
            claim_month: batch.claim_month,
            claim_year: batch.claim_year,
            fill_close_at: batch.fill_close_at,
            approve_close_at: batch.approve_close_at,
            fill_closed: fillClosed,
        },
        submissions,
        items,
        completion: {
            total: submissions.length,
            submitted: submissions.filter(s => ['submitted', 'approved', 'rejected', 'no_claims', 'in_payroll'].includes(s.status)).length,
        },
    };
}

async function saveSubmissionItems(pool, { token, employeeId, items, confirmNoClaims }) {
    const batch = await getBatchByToken(pool, token);
    if (!batch) return { ok: false, status: 404, error: 'Invalid link' };
    if (isAfterFillClose(batch)) {
        return { ok: false, status: 403, error: 'Payroll entry is now closed. Raise claims next month.' };
    }

    const { rows: subRows } = await pool.query(
        `SELECT * FROM portal_claim_submissions WHERE batch_id = $1 AND employee_id = $2`,
        [batch.id, employeeId]
    );
    const sub = subRows[0];
    if (!sub) return { ok: false, status: 404, error: 'Employee not in your claim list' };
    if (['approved', 'in_payroll'].includes(sub.status)) {
        return { ok: false, status: 403, error: 'This claim is locked after approval. Raise any further claims next month.' };
    }

    if (confirmNoClaims) {
        await pool.query(`DELETE FROM portal_claim_items WHERE submission_id = $1`, [sub.id]);
        await pool.query(
            `UPDATE portal_claim_submissions
             SET status = 'no_claims', submitted_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [sub.id]
        );
        await refreshBatchStatus(pool, batch.id);
        return { ok: true, status: 'no_claims' };
    }

    const errors = [];
    const normalized = [];
    for (const raw of items || []) {
        const type = String(raw.claim_type || '').toUpperCase();
        if (type === 'OT') {
            const v = validateOtRow(raw);
            if (v.errors.length) errors.push(...v.errors.map(e => `${employeeId}: ${e}`));
            normalized.push({
                claim_type: 'OT',
                claim_date: raw.claim_date,
                ot_hours: parseFloat(raw.ot_hours),
                ot_multiplier: raw.ot_multiplier,
                ot_multiplier_factor: v.factor,
                description: raw.nature || raw.description || null,
                time_from: raw.time_from || null,
                time_to: raw.time_to || null,
                nature: raw.nature || null,
            });
        } else if (type === 'EXPENSE') {
            const amt = parseFloat(raw.amount);
            if (!raw.claim_date) errors.push(`${employeeId}: Expense date required`);
            if (!Number.isFinite(amt) || amt <= 0) errors.push(`${employeeId}: Expense amount required`);
            if (!raw.attachment && !raw.has_attachment) {
                // attachment checked separately on upload — warn only if flag missing
            }
            normalized.push({
                claim_type: 'EXPENSE',
                claim_date: raw.claim_date,
                amount: amt,
                description: raw.description || null,
                expense_type: raw.expense_type || null,
            });
        } else if (type === 'MEDICAL') {
            const amt = parseFloat(raw.amount);
            if (!raw.claim_date) errors.push(`${employeeId}: Medical date required`);
            if (!Number.isFinite(amt) || amt <= 0) errors.push(`${employeeId}: Medical amount required`);
            normalized.push({
                claim_type: 'MEDICAL',
                claim_date: raw.claim_date,
                amount: amt,
                description: raw.description || null,
                patient_name: raw.patient_name || null,
            });
        }
    }
    if (errors.length) return { ok: false, status: 400, error: errors.join('; ') };

    // Require supports for expense/medical
    const needsSupport = normalized.some(i => i.claim_type === 'EXPENSE' || i.claim_type === 'MEDICAL');
    if (needsSupport) {
        const { rows: atts } = await pool.query(
            `SELECT id FROM portal_claim_attachments WHERE submission_id = $1 LIMIT 1`,
            [sub.id]
        );
        if (!atts.length) {
            return { ok: false, status: 400, error: 'Supporting document required for Expense / Medical claims' };
        }
    }

    await pool.query(`DELETE FROM portal_claim_items WHERE submission_id = $1`, [sub.id]);
    for (const item of normalized) {
        await pool.query(
            `INSERT INTO portal_claim_items
             (submission_id, claim_type, claim_date, ot_hours, ot_multiplier, ot_multiplier_factor,
              amount, description, expense_type, patient_name, time_from, time_to, nature)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
                sub.id, item.claim_type, item.claim_date || null,
                item.ot_hours || null, item.ot_multiplier || null, item.ot_multiplier_factor || null,
                item.amount || null, item.description || null, item.expense_type || null,
                item.patient_name || null, item.time_from || null, item.time_to || null, item.nature || null,
            ]
        );
    }

    const newStatus = normalized.length ? 'submitted' : 'draft';
    await pool.query(
        `UPDATE portal_claim_submissions
         SET status = $2, submitted_at = CASE WHEN $2 = 'submitted' THEN NOW() ELSE submitted_at END, updated_at = NOW()
         WHERE id = $1`,
        [sub.id, newStatus]
    );
    await refreshBatchStatus(pool, batch.id);
    return { ok: true, status: newStatus, itemCount: normalized.length };
}

async function refreshBatchStatus(pool, batchId) {
    const { rows } = await pool.query(
        `SELECT status FROM portal_claim_submissions WHERE batch_id = $1`,
        [batchId]
    );
    if (!rows.length) return;
    const allDone = rows.every(r => ['submitted', 'no_claims', 'approved', 'rejected', 'in_payroll'].includes(r.status));
    const allNo = rows.every(r => r.status === 'no_claims');
    const status = allNo ? 'no_claims' : allDone ? 'submitted' : 'in_progress';
    await pool.query(`UPDATE portal_claim_batches SET status = $2 WHERE id = $1`, [batchId, status]);
}

async function addAttachment(pool, { token, employeeId, filename, mimeType, contentBase64 }) {
    const batch = await getBatchByToken(pool, token);
    if (!batch) return { ok: false, status: 404, error: 'Invalid link' };
    if (isAfterFillClose(batch)) return { ok: false, status: 403, error: 'Payroll entry is now closed.' };

    const { rows: subRows } = await pool.query(
        `SELECT * FROM portal_claim_submissions WHERE batch_id = $1 AND employee_id = $2`,
        [batch.id, employeeId]
    );
    const sub = subRows[0];
    if (!sub) return { ok: false, status: 404, error: 'Employee not found' };
    if (['approved', 'in_payroll'].includes(sub.status)) {
        return { ok: false, status: 403, error: 'Locked after approval' };
    }

    const buf = Buffer.from(contentBase64, 'base64');
    if (buf.length > 8 * 1024 * 1024) return { ok: false, status: 400, error: 'File too large (max 8MB)' };
    const retainUntil = new Date();
    retainUntil.setFullYear(retainUntil.getFullYear() + 2);

    const { rows } = await pool.query(
        `INSERT INTO portal_claim_attachments
         (submission_id, filename, mime_type, content_base64, byte_size, retain_until)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, filename, mime_type, byte_size, retain_until, uploaded_at`,
        [sub.id, filename, mimeType || 'application/octet-stream', contentBase64, buf.length, retainUntil.toISOString().slice(0, 10)]
    );
    return { ok: true, attachment: rows[0] };
}

async function ensureApproverPacks(pool, periodId, sendAppEmail) {
    const { rows: pending } = await pool.query(
        `SELECT DISTINCT approver_email FROM portal_claim_submissions
         WHERE period_id = $1 AND status = 'submitted' AND approver_email IS NOT NULL AND TRIM(approver_email) <> ''`,
        [periodId]
    );
    const { rows: periodRows } = await pool.query(`SELECT * FROM portal_claim_periods WHERE id = $1`, [periodId]);
    const period = periodRows[0];
    const results = [];

    for (const { approver_email: approverEmail } of pending) {
        const token = newToken();
        const tokenHash = hashToken(token);
        const { rows: packRows } = await pool.query(
            `INSERT INTO portal_claim_approver_packs (period_id, approver_email, invite_token_hash, invite_sent_at, status)
             VALUES ($1,$2,$3,NOW(),'pending')
             ON CONFLICT (period_id, approver_email) DO UPDATE
               SET invite_token_hash = EXCLUDED.invite_token_hash, invite_sent_at = NOW()
             RETURNING *`,
            [periodId, approverEmail, tokenHash]
        );
        const link = `${FRONTEND_URL}/?asil_claims=approve&token=${token}`;
        const { rows: subs } = await pool.query(
            `SELECT COUNT(*)::int AS cnt FROM portal_claim_submissions
             WHERE period_id = $1 AND approver_email = $2 AND status = 'submitted'`,
            [periodId, approverEmail]
        );
        if (sendAppEmail) {
            await sendAppEmail({
                to: approverEmail,
                subject: `ASIL Claims approval — ${subs[0].cnt} submission(s) (approve by day ${APPROVE_CLOSE_DAY})`,
                html: buildApproverInviteHtml({ period, count: subs[0].cnt, link, approverEmail }),
            }).catch(() => {});
        }
        results.push({ approverEmail, link, count: subs[0].cnt, packId: packRows[0].id });
    }
    return results;
}

function buildApproverInviteHtml({ period, count, link, approverEmail }) {
    const settleLabel = `${period.settlement_month || ''}/${period.settlement_year || ''}`.replace(/^\/|\/$/g, '') || 'the following month';
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f8fafc">
<div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0">
  <h2 style="margin:0 0 8px;color:#0f172a">ASIL HCM — Approve Claims</h2>
  <p style="color:#475569;margin:0 0 16px">Claim month <strong>${period.claim_month}/${period.claim_year}</strong> · <strong>${count}</strong> submission(s) waiting on one screen.</p>
  <p style="color:#334155;margin:0 0 8px"><strong>Your role</strong></p>
  <ul style="color:#475569;margin:0 0 16px;padding-left:20px;line-height:1.55">
    <li>Review OT / Expense / Medical entered by Claim Authorities.</li>
    <li>Approve or reject each employee (add a remark if rejecting).</li>
    <li>Complete by <strong>day ${APPROVE_CLOSE_DAY}</strong>.</li>
    <li>Approved items settle in payroll for <strong>${settleLabel}</strong> (following month’s pay).</li>
  </ul>
  <p style="margin:24px 0"><a href="${link}" style="background:#15803d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open approval pack</a></p>
  <p style="font-size:12px;color:#94a3b8;word-break:break-all">${link}</p>
  <p style="font-size:12px;color:#94a3b8;margin:16px 0 0">Sent to ${approverEmail} · Allied Services International (ASIL)</p>
</div></body></html>`;
}

async function getApproverPackByToken(pool, token) {
    const h = hashToken(token);
    const { rows } = await pool.query(
        `SELECT a.*, p.claim_month, p.claim_year, p.settlement_month, p.settlement_year,
                p.fill_close_at, p.approve_close_at
         FROM portal_claim_approver_packs a
         JOIN portal_claim_periods p ON p.id = a.period_id
         WHERE a.invite_token_hash = $1`,
        [h]
    );
    return rows[0] || null;
}

async function openApproverSession(pool, token) {
    const pack = await getApproverPackByToken(pool, token);
    if (!pack) return { ok: false, status: 404, error: 'Invalid or expired link' };

    const { rows: submissions } = await pool.query(
        `SELECT s.*, e.name AS employee_name, e.client, e.location, e.dept, s.filler_email
         FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.period_id = $1 AND LOWER(s.approver_email) = LOWER($2)
           AND s.status IN ('submitted','approved','rejected','in_payroll')
         ORDER BY e.name`,
        [pack.period_id, pack.approver_email]
    );
    const ids = submissions.map(s => s.id);
    let items = [];
    let attachments = [];
    if (ids.length) {
        const { rows: itemRows } = await pool.query(
            `SELECT * FROM portal_claim_items WHERE submission_id = ANY($1::int[]) AND active = TRUE`,
            [ids]
        );
        items = itemRows;
        const { rows: attRows } = await pool.query(
            `SELECT id, submission_id, item_id, filename, mime_type, byte_size, uploaded_at, retain_until
             FROM portal_claim_attachments WHERE submission_id = ANY($1::int[])`,
            [ids]
        );
        attachments = attRows;
    }

    // Group by filler so Huzaifa sees 3 types/packs visually
    const byFiller = {};
    for (const s of submissions) {
        const k = s.filler_email || 'unknown';
        if (!byFiller[k]) byFiller[k] = [];
        byFiller[k].push(s);
    }

    return {
        ok: true,
        pack,
        period: {
            claim_month: pack.claim_month,
            claim_year: pack.claim_year,
            approve_close_at: pack.approve_close_at,
            approve_closed: isAfterApproveClose(pack),
        },
        submissions,
        items,
        attachments,
        byFiller,
        completion: {
            total: submissions.length,
            pending: submissions.filter(s => s.status === 'submitted').length,
            approved: submissions.filter(s => ['approved', 'in_payroll'].includes(s.status)).length,
        },
    };
}

async function approverDecide(pool, { token, submissionId, decision, comment }) {
    const pack = await getApproverPackByToken(pool, token);
    if (!pack) return { ok: false, status: 404, error: 'Invalid link' };
    if (isAfterApproveClose(pack) && decision === 'approved') {
        // Allow decide but mark overdue path — still allow until ASIL intervenes; hard message:
        return { ok: false, status: 403, error: 'Approval window closed (day 25). Contact ASIL operations.' };
    }

    const { rows } = await pool.query(
        `SELECT * FROM portal_claim_submissions WHERE id = $1 AND period_id = $2 AND LOWER(approver_email) = LOWER($3)`,
        [submissionId, pack.period_id, pack.approver_email]
    );
    const sub = rows[0];
    if (!sub) return { ok: false, status: 404, error: 'Submission not found' };
    if (sub.status !== 'submitted') return { ok: false, status: 409, error: `Cannot decide from status ${sub.status}` };

    if (decision === 'rejected') {
        await pool.query(
            `UPDATE portal_claim_submissions
             SET status = 'rejected', rejected_at = NOW(), approver_comment = $2, updated_at = NOW()
             WHERE id = $1`,
            [submissionId, comment || null]
        );
        return { ok: true, decision: 'rejected' };
    }

    const { rows: items } = await pool.query(
        `SELECT * FROM portal_claim_items WHERE submission_id = $1 AND active = TRUE`,
        [submissionId]
    );
    const snapshot = { items, decided_at: new Date().toISOString(), by: pack.approver_email };

    await pool.query(
        `UPDATE portal_claim_submissions
         SET status = 'approved', approved_at = NOW(), approver_comment = $2,
             approved_snapshot = $3::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [submissionId, comment || null, JSON.stringify(snapshot)]
    );

    // Inject into employee_claims for payroll run spine
    await injectApprovedToEmployeeClaims(pool, sub, items, pack);

    await pool.query(
        `UPDATE portal_claim_submissions SET status = 'in_payroll', updated_at = NOW() WHERE id = $1`,
        [submissionId]
    );

    return { ok: true, decision: 'approved' };
}

async function injectApprovedToEmployeeClaims(pool, sub, items, pack) {
    const { rows: periodRows } = await pool.query(`SELECT * FROM portal_claim_periods WHERE id = $1`, [sub.period_id]);
    const period = periodRows[0];
    const month = period.settlement_month;
    const year = period.settlement_year;

    const otItems = items.filter(i => i.claim_type === 'OT');
    const expItems = items.filter(i => i.claim_type === 'EXPENSE');
    const medItems = items.filter(i => i.claim_type === 'MEDICAL');

    if (otItems.length) {
        const claimed = otItems.map(i => ({
            ot1: Number(i.ot_multiplier_factor) === 1 ? Number(i.ot_hours) : 0,
            ot2: Number(i.ot_multiplier_factor) === 2 ? Number(i.ot_hours) : 0,
            ot3: Number(i.ot_multiplier_factor) === 3 ? Number(i.ot_hours) : 0,
            date: i.claim_date,
        }));
        await pool.query(
            `INSERT INTO employee_claims
             (employee_id, claim_type, period_month, period_year, claimed_items, status, focal_email, focal_approved_at)
             VALUES ($1,'overtime',$2,$3,$4::jsonb,'focal_approved',$5,NOW())`,
            [sub.employee_id, month, year, JSON.stringify(claimed), sub.approver_email]
        );
    }
    if (expItems.length) {
        const claimed = expItems.map(i => ({ amount: Number(i.amount), description: i.description, date: i.claim_date }));
        await pool.query(
            `INSERT INTO employee_claims
             (employee_id, claim_type, period_month, period_year, claimed_items, status, focal_email, focal_approved_at)
             VALUES ($1,'expense',$2,$3,$4::jsonb,'focal_approved',$5,NOW())`,
            [sub.employee_id, month, year, JSON.stringify(claimed), sub.approver_email]
        );
    }
    if (medItems.length) {
        const claimed = medItems.map(i => ({ amount: Number(i.amount), description: i.description, date: i.claim_date }));
        await pool.query(
            `INSERT INTO employee_claims
             (employee_id, claim_type, period_month, period_year, claimed_items, status, focal_email, focal_approved_at)
             VALUES ($1,'medical',$2,$3,$4::jsonb,'focal_approved',$5,NOW())`,
            [sub.employee_id, month, year, JSON.stringify(claimed), sub.approver_email]
        );
    }

    // Also write hours into payroll_transactions (correct columns)
    let ot2 = 0; let ot3 = 0; let ot1 = 0;
    for (const i of otItems) {
        const h = Number(i.ot_hours) || 0;
        const f = Number(i.ot_multiplier_factor) || 1;
        if (f >= 3) ot3 += h;
        else if (f >= 2) ot2 += h;
        else ot1 += h;
    }
    // Treat 1x as ot2_hrs contribution at 1x is unusual — store 1x into ot2 with note via reimbursement path? 
    // Payroll sheet uses ot2_hrs/ot3_hrs. Map 1x into ot2_hrs as hours (rate applied in calc). Prefer: add 1x hours to a field — use ot2_hrs for double only.
    // Store single as half of double equivalent by putting in ot2_hrs * 0.5? Cleaner: put single hours in ot2_hrs and document — actually payroll multiplies ot2 by 2x.
    // Best: write single hours into a JSON note; for amounts write reimbursement. For hours: ot2 gets double hours, ot3 triple; single → add to ot2_hrs as hours/2 so payout matches 1x? 
    // Simpler approach matching plan: ot2_hrs += double hours, ot3_hrs += triple; for single write hours into ot2_hrs and finance knows — NO.
    // Write single into employee_claims only; for payroll_transactions: ot2_hrs += double, ot3_hrs += triple, and single hours * 0.5 into ot2 so 2x rate * 0.5h = 1x.
    const ot2Write = ot2 + (ot1 * 0.5);
    const exp = expItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const med = medItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);

    if (ot2Write || ot3 || exp || med) {
        await pool.query(
            `INSERT INTO payroll_transactions (employee_id, month, year, ot2_hrs, ot3_hrs, opd_claim, reimbursement)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (employee_id, month, year) DO UPDATE SET
               ot2_hrs = payroll_transactions.ot2_hrs + EXCLUDED.ot2_hrs,
               ot3_hrs = payroll_transactions.ot3_hrs + EXCLUDED.ot3_hrs,
               opd_claim = payroll_transactions.opd_claim + EXCLUDED.opd_claim,
               reimbursement = payroll_transactions.reimbursement + EXCLUDED.reimbursement,
               updated_at = NOW()`,
            [sub.employee_id, month, year, ot2Write, ot3, med, exp]
        );
    }
}

async function listClaimsForAdmin(pool, { month, year, channel, approver, filler, status, client }) {
    const vals = [];
    let where = `WHERE 1=1`;
    if (month && year) {
        vals.push(parseInt(month, 10), parseInt(year, 10));
        where += ` AND p.claim_month = $${vals.length - 1} AND p.claim_year = $${vals.length}`;
    }
    if (channel) { vals.push(channel); where += ` AND s.channel = $${vals.length}`; }
    if (approver) { vals.push(`%${approver}%`); where += ` AND s.approver_email ILIKE $${vals.length}`; }
    if (filler) { vals.push(`%${filler}%`); where += ` AND s.filler_email ILIKE $${vals.length}`; }
    if (status) { vals.push(status); where += ` AND s.status = $${vals.length}`; }
    if (client) { vals.push(`%${client}%`); where += ` AND e.client ILIKE $${vals.length}`; }

    const { rows } = await pool.query(
        `SELECT s.*, e.name AS employee_name, e.client, e.location,
                p.claim_month, p.claim_year, p.settlement_month, p.settlement_year,
                (SELECT COUNT(*)::int FROM portal_claim_items i WHERE i.submission_id = s.id AND i.active) AS item_count,
                (SELECT COUNT(*)::int FROM portal_claim_attachments a WHERE a.submission_id = s.id) AS attachment_count
         FROM portal_claim_submissions s
         JOIN portal_claim_periods p ON p.id = s.period_id
         JOIN employees e ON e.id = s.employee_id
         ${where}
         ORDER BY s.updated_at DESC
         LIMIT 500`,
        vals
    );
    return rows;
}

async function exportClaimsPayrollTieout(pool, month, year) {
    const { rows } = await pool.query(
        `SELECT e.id AS employee_id, e.name, e.client,
                s.channel, s.status, s.filler_email, s.approver_email,
                p.claim_month, p.claim_year, p.settlement_month, p.settlement_year,
                COALESCE(SUM(CASE WHEN i.claim_type='OT' AND i.ot_multiplier_factor=1 THEN i.ot_hours ELSE 0 END),0) AS ot1_hours,
                COALESCE(SUM(CASE WHEN i.claim_type='OT' AND i.ot_multiplier_factor=2 THEN i.ot_hours ELSE 0 END),0) AS ot2_hours,
                COALESCE(SUM(CASE WHEN i.claim_type='OT' AND i.ot_multiplier_factor=3 THEN i.ot_hours ELSE 0 END),0) AS ot3_hours,
                COALESCE(SUM(CASE WHEN i.claim_type='EXPENSE' THEN i.amount ELSE 0 END),0) AS expense,
                COALESCE(SUM(CASE WHEN i.claim_type='MEDICAL' THEN i.amount ELSE 0 END),0) AS medical
         FROM portal_claim_submissions s
         JOIN portal_claim_periods p ON p.id = s.period_id
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN portal_claim_items i ON i.submission_id = s.id AND i.active = TRUE
         WHERE p.settlement_month = $1 AND p.settlement_year = $2
           AND s.status IN ('approved','in_payroll')
         GROUP BY e.id, e.name, e.client, s.channel, s.status, s.filler_email, s.approver_email,
                  p.claim_month, p.claim_year, p.settlement_month, p.settlement_year
         ORDER BY e.client, e.name`,
        [parseInt(month, 10), parseInt(year, 10)]
    );

    const { rows: manuals } = await pool.query(
        `SELECT o.*, e.name, e.client FROM claim_manual_overrides o
         JOIN employees e ON e.id = o.employee_id
         WHERE o.period_month = $1 AND o.period_year = $2 AND o.applied = TRUE AND o.dry_run = FALSE
         ORDER BY e.name`,
        [parseInt(month, 10), parseInt(year, 10)]
    );

    return { portal: rows, manual: manuals };
}

async function getPayrollSnapshot(pool, employeeId, month, year) {
    const { rows } = await pool.query(
        `SELECT ot2_hrs, ot3_hrs, opd_claim, reimbursement, locked
         FROM payroll_transactions WHERE employee_id = $1 AND month = $2 AND year = $3`,
        [employeeId, month, year]
    );
    return rows[0] || { ot2_hrs: 0, ot3_hrs: 0, opd_claim: 0, reimbursement: 0, locked: false };
}

async function applyManualOverride(pool, {
    employeeId, month, year,
    ot1Hours = 0, ot2Hours = 0, ot3Hours = 0,
    expenseAmount = 0, medicalAmount = 0,
    mode, reason, createdBy, dryRun = false, isSuperadmin = false,
}) {
    if (!reason || !String(reason).trim()) return { ok: false, status: 400, error: 'Reason is required' };
    if (!['add', 'replace', 'remove'].includes(mode)) return { ok: false, status: 400, error: 'mode must be add|replace|remove' };
    if ((mode === 'replace' || mode === 'remove') && !isSuperadmin) {
        return { ok: false, status: 403, error: 'Only superadmin can replace or remove claims' };
    }

    const before = await getPayrollSnapshot(pool, employeeId, month, year);
    if (before.locked && !isSuperadmin) {
        return { ok: false, status: 403, error: 'Payroll month is locked' };
    }

    // Warn if portal approved exists
    const { rows: portalHits } = await pool.query(
        `SELECT s.id, s.status FROM portal_claim_submissions s
         JOIN portal_claim_periods p ON p.id = s.period_id
         WHERE s.employee_id = $1 AND p.settlement_month = $2 AND p.settlement_year = $3
           AND s.status IN ('approved','in_payroll')`,
        [employeeId, month, year]
    );

    let after = { ...before };
    const o1 = Number(ot1Hours) || 0;
    const o2 = Number(ot2Hours) || 0;
    const o3 = Number(ot3Hours) || 0;
    const exp = Number(expenseAmount) || 0;
    const med = Number(medicalAmount) || 0;
    const ot2Write = o2 + o1 * 0.5;

    if (mode === 'add') {
        after = {
            ot2_hrs: Number(before.ot2_hrs || 0) + ot2Write,
            ot3_hrs: Number(before.ot3_hrs || 0) + o3,
            opd_claim: Number(before.opd_claim || 0) + med,
            reimbursement: Number(before.reimbursement || 0) + exp,
        };
    } else if (mode === 'replace') {
        after = { ot2_hrs: ot2Write, ot3_hrs: o3, opd_claim: med, reimbursement: exp };
    } else if (mode === 'remove') {
        after = {
            ot2_hrs: Math.max(0, Number(before.ot2_hrs || 0) - ot2Write),
            ot3_hrs: Math.max(0, Number(before.ot3_hrs || 0) - o3),
            opd_claim: Math.max(0, Number(before.opd_claim || 0) - med),
            reimbursement: Math.max(0, Number(before.reimbursement || 0) - exp),
        };
    }

    const warning = portalHits.length
        ? `Portal claim already approved/in payroll for this employee (submission #${portalHits.map(p => p.id).join(', ')}). Confirm you are not double-counting.`
        : null;

    if (dryRun) {
        return {
            ok: true, dryRun: true, before, after, warning,
            preview: { employeeId, month, year, mode, ot1Hours: o1, ot2Hours: o2, ot3Hours: o3, expenseAmount: exp, medicalAmount: med },
        };
    }

    await pool.query(
        `INSERT INTO payroll_transactions (employee_id, month, year, ot2_hrs, ot3_hrs, opd_claim, reimbursement)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (employee_id, month, year) DO UPDATE SET
           ot2_hrs = EXCLUDED.ot2_hrs,
           ot3_hrs = EXCLUDED.ot3_hrs,
           opd_claim = EXCLUDED.opd_claim,
           reimbursement = EXCLUDED.reimbursement,
           updated_at = NOW()`,
        [employeeId, month, year, after.ot2_hrs, after.ot3_hrs, after.opd_claim, after.reimbursement]
    );

    const { rows: logRows } = await pool.query(
        `INSERT INTO claim_manual_overrides
         (employee_id, period_month, period_year, ot1_hours, ot2_hours, ot3_hours,
          expense_amount, medical_amount, mode, reason, created_by, before_snapshot, after_snapshot, dry_run, applied)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,FALSE,TRUE)
         RETURNING *`,
        [
            employeeId, month, year, o1, o2, o3, exp, med, mode, reason.trim(), createdBy || null,
            JSON.stringify(before), JSON.stringify(after),
        ]
    );

    // Mirror channel on a synthetic submission row for Claims tab visibility
    await ensureClaimAuthorityColumn(pool);
    const campMonth = month;
    const campYear = year;
    const period = await getOrCreatePeriod(pool, campMonth, campYear);
    await pool.query(
        `INSERT INTO portal_claim_submissions
         (period_id, employee_id, filler_email, approver_email, status, channel, submitted_at, approved_at)
         VALUES ($1,$2,$3,$4,'in_payroll','manual_override',NOW(),NOW())
         ON CONFLICT (period_id, employee_id) DO UPDATE SET
           status = 'in_payroll', channel = 'manual_override', updated_at = NOW()`,
        [period.id, employeeId, createdBy || 'manual', createdBy || 'manual']
    ).catch(() => {});

    return { ok: true, override: logRows[0], before, after, warning };
}

async function autoCloseNoClaims(pool) {
    const { rows: periods } = await pool.query(
        `SELECT * FROM portal_claim_periods WHERE status = 'open' AND fill_close_at < NOW()`
    );
    let updated = 0;
    for (const p of periods) {
        const { rows } = await pool.query(
            `UPDATE portal_claim_submissions s
             SET status = 'no_claims', submitted_at = COALESCE(submitted_at, NOW()), updated_at = NOW()
             FROM portal_claim_batches b
             WHERE s.batch_id = b.id AND s.period_id = $1
               AND s.status IN ('invited','draft')
               AND b.invite_delivered = TRUE
             RETURNING s.id`,
            [p.id]
        );
        updated += rows.length;
        await pool.query(`UPDATE portal_claim_periods SET status = 'fill_closed' WHERE id = $1`, [p.id]);
    }
    return { updated };
}

async function sendReminders(pool, sendAppEmail) {
    const now = pktNow();
    const day = now.getUTCDate();
    const results = { filler: 0, approver: 0 };

    // Filler reminders on ~19 and 21
    if ([19, 20, 21].includes(day)) {
        const { rows: batches } = await pool.query(
            `SELECT b.*, p.claim_month, p.claim_year, p.fill_close_at
             FROM portal_claim_batches b
             JOIN portal_claim_periods p ON p.id = b.period_id
             WHERE p.fill_close_at > NOW()
               AND b.status IN ('invited','in_progress')
               AND b.reminder_count < 3
               AND b.invite_delivered = TRUE`
        );
        for (const b of batches) {
            const token = newToken();
            await pool.query(
                `UPDATE portal_claim_batches
                 SET invite_token_hash = $2, reminder_count = reminder_count + 1, last_reminder_at = NOW()
                 WHERE id = $1`,
                [b.id, hashToken(token)]
            );
            const link = `${FRONTEND_URL}/?asil_claims=fill&token=${token}`;
            if (sendAppEmail) {
                await sendAppEmail({
                    to: b.filler_email,
                    subject: `Reminder: ASIL claims due by day ${FILL_CLOSE_DAY}`,
                    html: buildFillerInviteHtml({ period: b, employeeCount: 'your', link, fillerEmail: b.filler_email }),
                }).catch(() => {});
            }
            results.filler++;
        }
    }

    // Approver reminders ~23-24
    if ([23, 24].includes(day)) {
        const { rows: packs } = await pool.query(
            `SELECT a.*, p.claim_month, p.claim_year, p.approve_close_at
             FROM portal_claim_approver_packs a
             JOIN portal_claim_periods p ON p.id = a.period_id
             WHERE p.approve_close_at > NOW() AND a.reminder_count < 2 AND a.status = 'pending'`
        );
        for (const a of packs) {
            const token = newToken();
            await pool.query(
                `UPDATE portal_claim_approver_packs
                 SET invite_token_hash = $2, reminder_count = reminder_count + 1, last_reminder_at = NOW()
                 WHERE id = $1`,
                [a.id, hashToken(token)]
            );
            const { rows: cnt } = await pool.query(
                `SELECT COUNT(*)::int AS c FROM portal_claim_submissions
                 WHERE period_id = $1 AND approver_email = $2 AND status = 'submitted'`,
                [a.period_id, a.approver_email]
            );
            const link = `${FRONTEND_URL}/?asil_claims=approve&token=${token}`;
            if (sendAppEmail && cnt[0].c > 0) {
                await sendAppEmail({
                    to: a.approver_email,
                    subject: `Reminder: approve ${cnt[0].c} ASIL claim(s) by day ${APPROVE_CLOSE_DAY}`,
                    html: buildApproverInviteHtml({ period: a, count: cnt[0].c, link, approverEmail: a.approver_email }),
                }).catch(() => {});
                results.approver++;
            }
        }
    }

    return results;
}

async function resendFillerInvite(pool, batchId, sendAppEmail) {
    const { rows } = await pool.query(
        `SELECT b.*, p.claim_month, p.claim_year FROM portal_claim_batches b
         JOIN portal_claim_periods p ON p.id = b.period_id WHERE b.id = $1`,
        [batchId]
    );
    if (!rows[0]) return { ok: false, error: 'Batch not found' };
    const b = rows[0];
    const token = newToken();
    await pool.query(
        `UPDATE portal_claim_batches
         SET invite_token_hash = $2, invite_sent_at = NOW(), invite_delivered = TRUE WHERE id = $1`,
        [batchId, hashToken(token)]
    );
    const { rows: cnt } = await pool.query(
        `SELECT COUNT(*)::int AS c FROM portal_claim_submissions WHERE batch_id = $1`,
        [batchId]
    );
    const link = `${FRONTEND_URL}/?asil_claims=fill&token=${token}`;
    if (sendAppEmail) {
        await sendAppEmail({
            to: b.filler_email,
            subject: `ASIL Claims link (resent) — due day ${FILL_CLOSE_DAY}`,
            html: buildFillerInviteHtml({ period: b, employeeCount: cnt[0].c, link, fillerEmail: b.filler_email }),
        });
    }
    return { ok: true, link, fillerEmail: b.filler_email };
}

async function getAttachmentContent(pool, attachmentId) {
    const { rows } = await pool.query(
        `SELECT * FROM portal_claim_attachments WHERE id = $1`,
        [attachmentId]
    );
    return rows[0] || null;
}

module.exports = {
    FILL_OPEN_DAY, FILL_CLOSE_DAY, APPROVE_CLOSE_DAY,
    normalizeAuthority,
    ensureClaimAuthorityColumn,
    listEligibleEmployees,
    createCampaign,
    openFillerSession,
    saveSubmissionItems,
    addAttachment,
    ensureApproverPacks,
    openApproverSession,
    approverDecide,
    listClaimsForAdmin,
    exportClaimsPayrollTieout,
    applyManualOverride,
    autoCloseNoClaims,
    sendReminders,
    resendFillerInvite,
    getAttachmentContent,
    getOrCreatePeriod,
    periodWindow,
    validateOtRow,
};
