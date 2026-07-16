'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const {
    parseMasterClaimsWorkbook,
    buildPersonalizedClaimsWorkbook,
    buildPersonalizedClaimsWorkbookAsync,
    parseTimeToMinutes,
    hoursBetween,
    toIsoDate,
    parseAmount,
    formatDateDdMonYyyy,
    isMeaningfulOtRow,
    isMeaningfulMoneyRow,
    MONTH_NAMES,
} = require('./portalExcel');

/** Standard weekday shift end (minutes from midnight) — OT may start at/after this. */
const WEEKDAY_SHIFT_END_MIN = 17 * 60; // 5:00 PM

const FILL_OPEN_DAY = parseInt(process.env.CLAIMS_FILL_OPEN_DAY || '17', 10);
const FILL_CLOSE_DAY = parseInt(process.env.CLAIMS_FILL_CLOSE_DAY || '22', 10);
const APPROVE_CLOSE_DAY = parseInt(process.env.CLAIMS_APPROVE_CLOSE_DAY || '25', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://asil-hcm-frontend.onrender.com';
/** immediate | daily | day22 — when approvers get email digests */
const APPROVER_NOTIFY_MODE = String(process.env.CLAIMS_APPROVER_NOTIFY_MODE || 'immediate').toLowerCase();
const MANUAL_OVERRIDE_NOTIFY = (process.env.CLAIMS_OVERRIDE_NOTIFY_EMAILS
    || 'huzaifa.rafaqat@asil.com.pk,shezad.mumtaz@asil.com.pk')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const OT_MAP = { single: 1, double: 2, triple: 3 };

/** Pakistan gazetted / Eid dates (same policy as Wafi claims). 3× OT only on Eid. */
const PK_PUBLIC_HOLIDAYS = {
    '2025-02-05': { name: 'Kashmir Solidarity Day', isEid: false },
    '2025-03-23': { name: 'Pakistan Day', isEid: false },
    '2025-03-31': { name: 'Eid-ul-Fitr Day 1 (est.)', isEid: true },
    '2025-04-01': { name: 'Eid-ul-Fitr Day 2 (est.)', isEid: true },
    '2025-04-02': { name: 'Eid-ul-Fitr Day 3 (est.)', isEid: true },
    '2025-05-01': { name: 'International Labour Day', isEid: false },
    '2025-06-06': { name: 'Eid-ul-Adha Day 1 (est.)', isEid: true },
    '2025-06-07': { name: 'Eid-ul-Adha Day 2 (est.)', isEid: true },
    '2025-06-08': { name: 'Eid-ul-Adha Day 3 (est.)', isEid: true },
    '2025-06-26': { name: 'Ashura (Muharram 10) (est.)', isEid: false },
    '2025-08-14': { name: 'Independence Day', isEid: false },
    '2025-09-05': { name: 'Eid Milad-un-Nabi (est.)', isEid: false },
    '2025-11-09': { name: 'Allama Iqbal Day', isEid: false },
    '2025-12-25': { name: 'Quaid-e-Azam Day / Christmas', isEid: false },
    '2026-02-05': { name: 'Kashmir Solidarity Day', isEid: false },
    '2026-03-20': { name: 'Eid-ul-Fitr Day 1 (est.)', isEid: true },
    '2026-03-21': { name: 'Eid-ul-Fitr Day 2 (est.)', isEid: true },
    '2026-03-22': { name: 'Eid-ul-Fitr Day 3 (est.)', isEid: true },
    '2026-03-23': { name: 'Pakistan Day', isEid: false },
    '2026-05-01': { name: 'International Labour Day', isEid: false },
    '2026-05-27': { name: 'Eid-ul-Adha Day 1 (est.)', isEid: true },
    '2026-05-28': { name: 'Eid-ul-Adha Day 2 (est.)', isEid: true },
    '2026-05-29': { name: 'Eid-ul-Adha Day 3 (est.)', isEid: true },
    '2026-06-16': { name: 'Ashura (Muharram 10) (est.)', isEid: false },
    '2026-08-14': { name: 'Independence Day', isEid: false },
    '2026-08-25': { name: 'Eid Milad-un-Nabi (est.)', isEid: false },
    '2026-11-09': { name: 'Allama Iqbal Day', isEid: false },
    '2026-12-25': { name: 'Quaid-e-Azam Day / Christmas', isEid: false },
};
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newToken() {
    return crypto.randomBytes(24).toString('hex');
}

/** Stable magic link so the same approver URL works all month (pending + already decided). */
function stableApproverToken(periodId, email) {
    const secret = process.env.CLAIMS_LINK_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET || 'asil-portal-claims';
    return crypto.createHmac('sha256', secret)
        .update(`approver:${periodId}:${String(email || '').toLowerCase()}`)
        .digest('hex');
}

function parseLocalDate(raw) {
    if (!raw) return null;
    const s = String(raw).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
        const d = new Date(raw);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function getPkDateType(date) {
    if (!date || Number.isNaN(date.getTime())) return null;
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateStr = `${y}-${mo}-${d}`;
    const holiday = PK_PUBLIC_HOLIDAYS[dateStr];
    if (holiday) return { type: holiday.isEid ? 'EID' : 'HOLIDAY', name: holiday.name, dateStr };
    const dow = date.getDay();
    if (dow === 0) return { type: 'SUNDAY', name: 'Sunday', dateStr };
    return { type: 'WEEKDAY', name: WEEKDAY_NAMES[dow], dateStr };
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

function claimMonthLabel(period) {
    const m = period?.claim_month;
    const y = period?.claim_year;
    if (!m || !y) return 'the current claim month';
    return `${MONTH_NAMES[m] || m} ${y}`;
}

/** Dates outside the open claim month cannot be processed in this portal. */
function validateClaimDateInPeriod(rawDate, period, kind = 'Claim') {
    const errors = [];
    let iso = null;
    if (rawDate == null || String(rawDate).trim() === '') {
        errors.push(`${kind} date is missing. Please enter the date the work / expense happened (DD-MON-YYYY, e.g. 15-JUN-2026).`);
        return { errors, iso: null };
    }
    iso = toIsoDate(rawDate) || (String(rawDate).match(/^\d{4}-\d{2}-\d{2}/) ? String(rawDate).slice(0, 10) : null);
    if (!iso) {
        errors.push(
            `${kind} date "${rawDate}" could not be read. `
            + 'Try 15-JUN-2026, 15-06-2026, 15/06/2026, or 15 Jun 2026.'
        );
        return { errors, iso: null };
    }
    const nice = formatDateDdMonYyyy(iso);
    if (period?.claim_month && period?.claim_year) {
        const [yy, mm] = iso.split('-').map(Number);
        if (yy !== Number(period.claim_year) || mm !== Number(period.claim_month)) {
            const got = `${MONTH_NAMES[mm] || mm} ${yy}`;
            const want = claimMonthLabel(period);
            errors.push(
                `The date ${nice} falls in ${got}, but this form is only for ${want}. `
                + 'Older (or future) claim months cannot be submitted here. '
                + 'Please email claims@asil.com.pk if you have questions about prior-period claims.'
            );
        }
    }
    return { errors, iso, nice };
}

function validateOtRow(row, period = null) {
    const errors = [];
    const warnings = [];
    const dateCheck = validateClaimDateInPeriod(row.claim_date || row.claim_date_raw, period, 'OT');
    errors.push(...dateCheck.errors);
    const iso = dateCheck.iso;
    const niceDate = dateCheck.nice || (iso ? formatDateDdMonYyyy(iso) : '');
    const hours = parseFloat(row.ot_hours);
    const multRaw = String(row.ot_multiplier || 'Double').trim();
    const mult = multRaw.toLowerCase();
    if (!Number.isFinite(hours) || hours <= 0) {
        errors.push(
            row.ot_hours == null || row.ot_hours === ''
                ? `OT hours are missing${niceDate ? ` for ${niceDate}` : ''}. Enter overtime hours only (after the 8-hour shift on weekdays).`
                : `OT hours "${row.ot_hours}"${niceDate ? ` on ${niceDate}` : ''} is not valid. Enter a number such as 2 or 2.5.`
        );
    }
    if (!OT_MAP[mult]) {
        errors.push(`OT rate "${multRaw}" is not valid. Choose Single (1×), Double (2×), or Triple (3×).`);
    }

    if (iso && Number.isFinite(hours) && hours > 0 && OT_MAP[mult]) {
        const d = parseLocalDate(iso);
        const dateType = getPkDateType(d);
        const isWeekday = dateType && dateType.type === 'WEEKDAY';
        const dayLabel = `${niceDate}${dateType ? ` (${dateType.name})` : ''}`;

        if (dateType) {
            if (mult === 'triple' && dateType.type !== 'EID') {
                if (isWeekday) {
                    errors.push(
                        `On weekday ${dayLabel}, Triple (3×) overtime is not allowed under applicable rules. `
                        + 'Only Double (2×) can be applied. Triple (3×) is reserved for gazetted Eid holidays only. '
                        + 'Please change the rate to Double (2×).'
                    );
                } else {
                    errors.push(
                        `Triple (3×) OT is only allowed on gazetted Eid days. ${dayLabel} is not Eid — only Double (2×) can be applied.`
                    );
                }
            }
            if (mult === 'single' && (dateType.type === 'SUNDAY' || dateType.type === 'HOLIDAY' || dateType.type === 'EID')) {
                errors.push(
                    `Single (1×) is not allowed on ${dayLabel}. Use Double (2×), or Triple (3×) on Eid only.`
                );
            }
        }

        if (isWeekday) {
            const tf = String(row.time_from || '').trim();
            const tt = String(row.time_to || '').trim();
            if (!tf || !tt) {
                errors.push(
                    `On weekday ${dayLabel}, enter Time From and Time To for OT after completing the mandatory 8-hour duty `
                    + '(example: 5:00 PM to 8:00 PM). Hours Worked must be OT hours only.'
                );
            } else {
                const fromMin = parseTimeToMinutes(tf);
                const toMin = parseTimeToMinutes(tt);
                if (fromMin == null || toMin == null) {
                    const bad = fromMin == null ? tf : tt;
                    errors.push(
                        `Could not read time "${bad}" on ${dayLabel}. Try 5:00 PM, 17:00, 5pm, or 1700.`
                    );
                } else {
                    const span = hoursBetween(fromMin, toMin);
                    // OT must start after standard 8-hour shift end (5:00 PM). Earlier = still within regular duty.
                    if (fromMin < WEEKDAY_SHIFT_END_MIN) {
                        errors.push(
                            `On weekday ${dayLabel}, overtime is allowed only after completing the mandatory 8 hours duty. `
                            + `Time From (${tf}) is still within the regular shift (OT may start from 5:00 PM onward). `
                            + 'The hours entered do not qualify for overtime.'
                        );
                    }
                    // Claiming a block shorter than 8h that begins before shift end = incomplete duty as OT
                    if (fromMin < WEEKDAY_SHIFT_END_MIN && span != null && span < 8) {
                        // already covered above; keep single clear message
                    }
                    if (span != null && Math.abs(span - hours) > 0.51) {
                        errors.push(
                            `On ${dayLabel}, OT hours (${hours}) do not match Time From→To (${span}h). `
                            + 'Please correct the hours or the times so they agree.'
                        );
                    }
                }
            }
            if (hours > 8) {
                errors.push(
                    `On weekday ${dayLabel}, you cannot claim more than 8 OT hours in one day. `
                    + 'Enter only overtime after the standard shift — not total hours worked.'
                );
            }
        }

        if (hours > 6) warnings.push(`High OT: ${hours}h on ${niceDate} — please confirm this is correct`);
    }
    return { errors, warnings, factor: OT_MAP[mult] || null, claim_date: iso };
}

function validateExpenseOrMedicalRow(row, period, kind) {
    const errors = [];
    const dateCheck = validateClaimDateInPeriod(row.claim_date || row.claim_date_raw, period, kind);
    errors.push(...dateCheck.errors);
    const amtRaw = row.amount;
    const amt = parseAmount(amtRaw);
    if (!Number.isFinite(amt) || amt <= 0) {
        errors.push(
            amtRaw == null || amtRaw === ''
                ? `${kind} amount is missing. Enter the amount in PKR (e.g. 1500 or 1,500).`
                : `${kind} amount "${amtRaw}" is not valid. Enter a positive number in PKR (commas OK, e.g. 8,000).`
        );
    }
    return { errors, claim_date: dateCheck.iso, amount: Number.isFinite(amt) && amt > 0 ? amt : null };
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

/** Resolve period from hub Month/Year (campaign first, then claim month). */
async function findPeriodForUi(pool, month, year) {
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!m || !y) return null;
    const { rows: byCampaign } = await pool.query(
        `SELECT * FROM portal_claim_periods WHERE campaign_month = $1 AND campaign_year = $2`,
        [m, y]
    );
    if (byCampaign[0]) return byCampaign[0];
    const { rows: byClaim } = await pool.query(
        `SELECT * FROM portal_claim_periods WHERE claim_month = $1 AND claim_year = $2 ORDER BY id DESC LIMIT 1`,
        [m, y]
    );
    if (byClaim[0]) return byClaim[0];
    return getOrCreatePeriod(pool, m, y);
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
                        html: buildFillerInviteHtml({
                            period,
                            employeeCount: emps.length,
                            link,
                            fillerEmail,
                            employees: emps.map(e => ({ id: e.id, name: e.name })),
                        }),
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

function buildFillerInviteHtml({ period, employeeCount, link, fillerEmail, employees = [] }) {
    const settleLabel = `${period.settlement_month || ''}/${period.settlement_year || ''}`.replace(/^\/|\/$/g, '') || 'the following month';
    const claimLabel = `${period.claim_month}/${period.claim_year}`;
    const empList = (employees || [])
        .map(e => `<li style="margin:4px 0"><strong>${e.id || ''}</strong> — ${e.name || 'Employee'}</li>`)
        .join('');
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden">
  <tr><td style="background:#1e3a8a;color:#fff;padding:22px 28px">
    <div style="font-size:13px;opacity:.9;letter-spacing:.04em;text-transform:uppercase">Allied Services International Private Limited (ASIL)</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px">Monthly Claims — your turn to submit</div>
  </td></tr>
  <tr><td style="padding:28px">
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#334155">
      Hello — you are the <strong>Claim Authority</strong> for <strong>${employeeCount}</strong> employee(s) for claim month <strong>${claimLabel}</strong>.
    </p>
    ${empList ? `<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a">Your employees</p>
    <ul style="margin:0 0 16px;padding-left:20px;color:#334155;font-size:14px;line-height:1.55">${empList}</ul>` : ''}
    <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a">Why this process</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#475569">
      Due to compilation errors in earlier claim cycles, we are now <strong>fully automating</strong> OT, Expense, and Medical claims
      to avoid delays and errors when disbursing overtime and expense/medical refunds.
    </p>
    <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a">What you should do (by day ${FILL_CLOSE_DAY})</p>
    <ol style="margin:0 0 16px;padding-left:20px;color:#334155;font-size:14px;line-height:1.6">
      <li>Open the secure form (no password — this link is personal to you).</li>
      <li><strong>Option A:</strong> Enter OT / Expense / Medical on screen for each employee, <em>or</em><br/>
          <strong>Option B:</strong> Download <em>your</em> Excel (Code/Name already filled), complete claim columns only, and upload it.</li>
      <li>Upload <strong>two separate support files</strong> if you have Expense or Medical claims:<br/>
          (1) Expense receipts / bills &nbsp; (2) Medical receipts / prescriptions.</li>
      <li>If there is nothing to claim for an employee, tap <strong>Confirm No Claims</strong>.</li>
      <li>Submit — your Line Manager will review.</li>
    </ol>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 14px">
      <strong>Important:</strong> If there are no supports for Medical and Expense claims, those refunds <strong>will not be processed</strong>.
    </p>
    <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a">What happens next</p>
    <ul style="margin:0 0 18px;padding-left:20px;color:#475569;font-size:14px;line-height:1.6">
      <li>Line Manager approves or rejects (deadline day ${APPROVE_CLOSE_DAY}).</li>
      <li>You get an email when a decision is made.</li>
      <li>Approved amounts go into payroll for <strong>${settleLabel}</strong> (paid with the <strong>following month’s</strong> salary).</li>
      <li><strong>OT tip:</strong> on weekdays claim only hours after the standard 8-hour shift (with Time From / Time To). Double (2×) for most days; Triple (3×) only on gazetted <strong>Eid</strong> days.</li>
    </ul>
    <p style="margin:0 0 18px">
      <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Open claims form</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">If the button does not work, copy this link:<br/>${link}</p>
    <p style="margin:18px 0 0;font-size:13px;color:#475569">
      Please let us know if there are any errors by emailing <a href="mailto:ops-support@asil.com.pk" style="color:#1d4ed8">ops-support@asil.com.pk</a>.
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#94a3b8">Sent to ${fillerEmail} · Allied Services International Private Limited (ASIL)</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildApproverInviteHtml({ period, count, link, approverEmail, summaryHtml = '' }) {
    const settleLabel = `${period.settlement_month || ''}/${period.settlement_year || ''}`.replace(/^\/|\/$/g, '') || 'the following month';
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden">
  <tr><td style="background:#14532d;color:#fff;padding:22px 28px">
    <div style="font-size:13px;opacity:.9;letter-spacing:.04em;text-transform:uppercase">ASIL HCM · Line Manager</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px">Claims waiting for your approval</div>
  </td></tr>
  <tr><td style="padding:28px">
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#334155">
      Claim month <strong>${period.claim_month}/${period.claim_year}</strong> — <strong>${count}</strong> employee submission(s) need your review.
    </p>
    <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a">How to use this</p>
    <ol style="margin:0 0 14px;padding-left:20px;color:#334155;font-size:14px;line-height:1.6">
      <li>Open the pack (same link all month — outstanding + already decided stay visible).</li>
      <li>For each employee, review OT hours, Expense PKR, Medical PKR, line items, and support files.</li>
      <li>Approve or Reject. Rejected claims can be corrected next month.</li>
      <li>Finish by day <strong>${APPROVE_CLOSE_DAY}</strong>. After that the window closes; anything still pending rolls to next month.</li>
    </ol>
    <p style="margin:0 0 14px;font-size:14px;color:#475569;line-height:1.55">
      Approved amounts settle in payroll for <strong>${settleLabel}</strong> (following month’s pay). The Claim Authority is emailed when you decide.
    </p>
    ${summaryHtml}
    <p style="margin:22px 0 18px">
      <a href="${link}" style="display:inline-block;background:#15803d;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Open approval pack</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${link}</p>
    <p style="margin:18px 0 0;font-size:12px;color:#94a3b8">Sent to ${approverEmail} · ASIL HCM</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
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
    let attachments = [];
    if (ids.length) {
        const { rows } = await pool.query(
            `SELECT * FROM portal_claim_items WHERE submission_id = ANY($1::int[]) AND active = TRUE ORDER BY claim_date, id`,
            [ids]
        );
        items = rows;
        await pool.query(`ALTER TABLE portal_claim_attachments ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other'`).catch(() => {});
        const { rows: attRows } = await pool.query(
            `SELECT id, submission_id, filename, mime_type, byte_size, uploaded_at, retain_until, category
             FROM portal_claim_attachments WHERE submission_id = ANY($1::int[])`,
            [ids]
        );
        attachments = attRows;
    }

    const fillClosed = isAfterFillClose(batch);
    const apiBase = process.env.API_PUBLIC_URL || 'https://asilhcm.onrender.com';
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
        attachments,
        templateUrl: `${apiBase}/api/portal-claims/fill/${encodeURIComponent(token)}/template.xlsx`,
        blankTemplateUrl: `${apiBase}/api/portal-claims/template.xlsx`,
        completion: {
            total: submissions.length,
            submitted: submissions.filter(s => ['submitted', 'approved', 'rejected', 'no_claims', 'in_payroll'].includes(s.status)).length,
        },
    };
}

async function saveSubmissionItems(pool, { token, employeeId, items, confirmNoClaims, skipSupportCheck = false, asDraft = false }) {
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
        return {
            ok: true,
            status: 'no_claims',
            message: 'Thank you. “No Claims” is recorded. Your Line Manager can see this for the period. Nothing will be added to payroll for this employee.',
        };
    }

    const period = {
        claim_month: batch.claim_month,
        claim_year: batch.claim_year,
    };
    const errors = [];
    const normalized = [];
    let otIdx = 0;
    let expIdx = 0;
    let medIdx = 0;

    for (const raw of items || []) {
        const type = String(raw.claim_type || '').toUpperCase();
        const rowTag = raw._rowLabel || null;

        if (type === 'OT') {
            if (!isMeaningfulOtRow(raw)) continue;
            otIdx += 1;
            const label = rowTag || `OT line ${otIdx}`;
            const v = validateOtRow(raw, period);
            if (v.errors.length) {
                errors.push(...v.errors.map(e => `${label}: ${e}`));
            } else {
                normalized.push({
                    claim_type: 'OT',
                    claim_date: v.claim_date,
                    ot_hours: parseFloat(raw.ot_hours),
                    ot_multiplier: raw.ot_multiplier || 'Double',
                    ot_multiplier_factor: v.factor,
                    description: raw.nature || raw.description || null,
                    time_from: raw.time_from || null,
                    time_to: raw.time_to || null,
                    nature: raw.nature || null,
                });
            }
        } else if (type === 'EXPENSE') {
            if (!isMeaningfulMoneyRow(raw)) continue;
            expIdx += 1;
            const label = rowTag || `Expense line ${expIdx}`;
            const v = validateExpenseOrMedicalRow(raw, period, 'Expense');
            if (v.errors.length) {
                errors.push(...v.errors.map(e => `${label}: ${e}`));
            } else {
                normalized.push({
                    claim_type: 'EXPENSE',
                    claim_date: v.claim_date,
                    amount: v.amount,
                    description: raw.description || null,
                    expense_type: raw.expense_type || null,
                });
            }
        } else if (type === 'MEDICAL') {
            if (!isMeaningfulMoneyRow(raw)) continue;
            medIdx += 1;
            const label = rowTag || `Medical line ${medIdx}`;
            const v = validateExpenseOrMedicalRow(raw, period, 'Medical');
            if (v.errors.length) {
                errors.push(...v.errors.map(e => `${label}: ${e}`));
            } else {
                normalized.push({
                    claim_type: 'MEDICAL',
                    claim_date: v.claim_date,
                    amount: v.amount,
                    description: raw.description || null,
                    patient_name: raw.patient_name || null,
                });
            }
        }
    }

    if (errors.length) {
        const unique = [...new Set(errors)];
        const body = unique.slice(0, 20).map((e, i) => `${i + 1}. ${e}`).join('\n');
        const more = unique.length > 20 ? `\n…and ${unique.length - 20} more.` : '';
        return {
            ok: false,
            status: 400,
            error: `Please fix the following before continuing:\n${body}${more}`,
            errors: unique,
        };
    }

    // Intentional submit with nothing to claim → force user to use Confirm No Claims
    if (!normalized.length && !asDraft && !skipSupportCheck) {
        return {
            ok: false,
            status: 400,
            error: 'No valid claim lines to submit. Add OT / Expense / Medical with a date and hours/amount for '
                + `${claimMonthLabel(period)}, or tap Confirm No Claims.`,
        };
    }

    // Require separate supports for expense and medical on Submit (not on Excel draft import)
    const needsExpense = normalized.some(i => i.claim_type === 'EXPENSE');
    const needsMedical = normalized.some(i => i.claim_type === 'MEDICAL');
    if (!skipSupportCheck && !asDraft && (needsExpense || needsMedical)) {
        await pool.query(`ALTER TABLE portal_claim_attachments ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other'`).catch(() => {});
        const { rows: atts } = await pool.query(
            `SELECT category FROM portal_claim_attachments WHERE submission_id = $1`,
            [sub.id]
        );
        const cats = atts.map(a => String(a.category || 'other').toLowerCase());
        const strictExpense = cats.some(c => c === 'expense_support' || c === 'expense');
        const strictMedical = cats.some(c => c === 'medical_support' || c === 'medical');
        if (needsExpense && !strictExpense) {
            return {
                ok: false,
                status: 400,
                error: 'Expense claims require an Expense supports file (receipts/bills) before Submit. Upload it under Supports, then Submit again. Without supports, expense refunds will not be processed.',
            };
        }
        if (needsMedical && !strictMedical) {
            return {
                ok: false,
                status: 400,
                error: 'Medical claims require a Medical supports file (prescriptions/bills) before Submit. Upload it under Supports, then Submit again. Without supports, medical refunds will not be processed.',
            };
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

    const wantDraft = asDraft || skipSupportCheck;
    const newStatus = normalized.length
        ? (wantDraft ? 'draft' : 'submitted')
        : 'draft';
    await pool.query(
        `UPDATE portal_claim_submissions
         SET status = $2, submitted_at = CASE WHEN $2 = 'submitted' THEN NOW() ELSE submitted_at END, updated_at = NOW()
         WHERE id = $1`,
        [sub.id, newStatus]
    );
    await refreshBatchStatus(pool, batch.id);

    const message = newStatus === 'submitted'
        ? 'Thank you. Your claim has been submitted to your Line Manager for approval. '
          + 'You will receive an email when they approve or reject it. '
          + 'Approved amounts are added to payroll and paid with the following month’s salary.'
        : skipSupportCheck
            ? 'Excel imported as a draft. Review the rows, upload Expense and Medical supports if needed, then Submit to Line Manager.'
            : 'Draft saved. When ready, click Submit to Line Manager (Expense/Medical need support files first).';

    return {
        ok: true,
        status: newStatus,
        itemCount: normalized.length,
        message,
        notifyApprover: newStatus === 'submitted' && APPROVER_NOTIFY_MODE === 'immediate',
        periodId: batch.period_id,
        approverEmail: sub.approver_email,
    };
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

async function addAttachment(pool, { token, employeeId, filename, mimeType, contentBase64, category = 'other' }) {
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
    if (buf.length > 12 * 1024 * 1024) return { ok: false, status: 400, error: 'File too large (max 12MB)' };
    const retainUntil = new Date();
    retainUntil.setFullYear(retainUntil.getFullYear() + 2);

    await pool.query(`ALTER TABLE portal_claim_attachments ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other'`).catch(() => {});
    const cat = ['expense_support', 'medical_support', 'excel_workbook', 'other'].includes(category)
        ? category
        : 'other';

    const { rows } = await pool.query(
        `INSERT INTO portal_claim_attachments
         (submission_id, filename, mime_type, content_base64, byte_size, retain_until, category)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, filename, mime_type, byte_size, retain_until, uploaded_at, category`,
        [sub.id, filename, mimeType || 'application/octet-stream', contentBase64, buf.length, retainUntil.toISOString().slice(0, 10), cat]
    );
    return { ok: true, attachment: rows[0] };
}

async function importExcelWorkbook(pool, { token, contentBase64, filename }) {
    const batch = await getBatchByToken(pool, token);
    if (!batch) return { ok: false, status: 404, error: 'Invalid link' };
    if (isAfterFillClose(batch)) return { ok: false, status: 403, error: 'Payroll entry is now closed.' };

    const { rows: subs } = await pool.query(
        `SELECT employee_id FROM portal_claim_submissions WHERE batch_id = $1`,
        [batch.id]
    );
    const allowed = subs.map(s => s.employee_id);
    const buf = Buffer.from(contentBase64, 'base64');
    if (buf.length > 12 * 1024 * 1024) return { ok: false, status: 400, error: 'File too large (max 12MB)' };

    const parsed = parseMasterClaimsWorkbook(buf, { allowedEmployeeIds: allowed });
    const parseErrors = parsed.errors || [];

    if (parsed.itemsByEmployee.size === 0) {
        const detail = parseErrors.length
            ? parseErrors.join('; ')
            : 'No claim rows found. Fill Date + Hours/Amount on the prefilled employee rows (do not change Employee Code).';
        return {
            ok: false,
            status: 400,
            error: detail,
            parseErrors,
            warnings: parsed.warnings,
            sheetNames: parsed.sheetNames,
        };
    }

    const results = [];
    const saveErrors = [];
    for (const [employeeId, items] of parsed.itemsByEmployee.entries()) {
        const save = await saveSubmissionItems(pool, {
            token,
            employeeId,
            items,
            confirmNoClaims: false,
            skipSupportCheck: true,
            asDraft: true,
        });
        results.push({ employeeId, ...save });
        if (!save.ok) saveErrors.push(`${employeeId}: ${save.error}`);
    }

    const okResults = results.filter(r => r.ok);
    if (!okResults.length) {
        return {
            ok: false,
            status: 400,
            error: (saveErrors.length ? saveErrors : parseErrors).join('; ') || 'Import failed for all rows',
            parseErrors: [...parseErrors, ...saveErrors],
            results,
            warnings: parsed.warnings,
        };
    }

    const firstEmp = okResults[0].employeeId;
    if (firstEmp) {
        await addAttachment(pool, {
            token,
            employeeId: firstEmp,
            filename: filename || 'claims_workbook.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            contentBase64,
            category: 'excel_workbook',
        }).catch(() => {});
    }

    return {
        ok: true,
        warnings: parsed.warnings,
        parseErrors: [...parseErrors, ...saveErrors],
        sheetNames: parsed.sheetNames,
        results,
        employeesTouched: okResults.length,
        message: saveErrors.length
            ? `Imported draft for ${okResults.length} employee(s). Some rows had errors — see details.`
            : `Imported draft for ${okResults.length} employee(s). Upload Expense/Medical supports if needed, then Submit to Line Manager.`,
    };
}

function getMasterClaimsTemplatePath() {
    const candidates = [
        path.join(__dirname, '../../../assets/ASIL_Consolidated_Master_Claims_Template.xlsx'),
        path.join(process.cwd(), 'assets/ASIL_Consolidated_Master_Claims_Template.xlsx'),
        path.join(process.cwd(), 'backend/assets/ASIL_Consolidated_Master_Claims_Template.xlsx'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

async function buildPersonalizedTemplateForToken(pool, token) {
    const batch = await getBatchByToken(pool, token);
    if (!batch) return { ok: false, status: 404, error: 'Invalid link' };
    const { rows } = await pool.query(
        `SELECT s.employee_id AS id, e.name, e.dept, e.location,
                COALESCE(e.line_manager_name, '') AS line_manager_name
         FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.batch_id = $1
         ORDER BY e.name`,
        [batch.id]
    );
    const opts = {
        claimMonth: batch.claim_month,
        claimYear: batch.claim_year,
        templatePath: getMasterClaimsTemplatePath(),
    };
    let buf;
    try {
        buf = await buildPersonalizedClaimsWorkbookAsync(rows, opts);
    } catch (err) {
        console.warn('[portalClaims] ExcelJS template failed, using fallback:', err.message);
        buf = buildPersonalizedClaimsWorkbook(rows, opts);
    }
    const monthLabel = `${batch.claim_year || ''}-${String(batch.claim_month || '').padStart(2, '0')}`;
    return { ok: true, buffer: buf, filename: `ASIL_Claims_${monthLabel}_Your_Team.xlsx` };
}

async function ensureApproverPacks(pool, periodId, sendAppEmail, { forceEmail = false } = {}) {
    const { rows: pending } = await pool.query(
        `SELECT DISTINCT approver_email FROM portal_claim_submissions
         WHERE period_id = $1 AND status = 'submitted' AND approver_email IS NOT NULL AND TRIM(approver_email) <> ''`,
        [periodId]
    );
    const { rows: periodRows } = await pool.query(`SELECT * FROM portal_claim_periods WHERE id = $1`, [periodId]);
    const period = periodRows[0];
    const results = [];

    for (const { approver_email: approverEmail } of pending) {
        const token = stableApproverToken(periodId, approverEmail);
        const tokenHash = hashToken(token);
        const { rows: packRows } = await pool.query(
            `INSERT INTO portal_claim_approver_packs (period_id, approver_email, invite_token_hash, invite_sent_at, status)
             VALUES ($1,$2,$3,NOW(),'pending')
             ON CONFLICT (period_id, approver_email) DO UPDATE
               SET invite_token_hash = EXCLUDED.invite_token_hash,
                   invite_sent_at = NOW(),
                   status = 'pending'
             RETURNING *`,
            [periodId, approverEmail, tokenHash]
        );
        const link = `${FRONTEND_URL}/?asil_claims=approve&token=${token}`;
        const summary = await buildApproverPendingSummary(pool, periodId, approverEmail);
        const shouldEmail = !!sendAppEmail && (forceEmail || APPROVER_NOTIFY_MODE === 'immediate');
        if (shouldEmail && summary.pendingCount > 0) {
            await sendAppEmail({
                to: approverEmail,
                subject: `ASIL Claims — ${summary.pendingCount} pending for ${period.claim_month}/${period.claim_year} (approve by day ${APPROVE_CLOSE_DAY})`,
                html: buildApproverInviteHtml({
                    period,
                    count: summary.pendingCount,
                    link,
                    approverEmail,
                    summaryHtml: summary.html,
                }),
            }).catch(() => {});
        }
        results.push({
            approverEmail,
            link,
            count: summary.pendingCount,
            approvedCount: summary.approvedCount,
            packId: packRows[0].id,
            notifyMode: APPROVER_NOTIFY_MODE,
        });
    }
    return results;
}

async function buildApproverPendingSummary(pool, periodId, approverEmail) {
    const { rows: submissions } = await pool.query(
        `SELECT s.id, s.status, s.filler_email, e.name AS employee_name, e.id AS employee_id
         FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.period_id = $1 AND LOWER(s.approver_email) = LOWER($2)
           AND s.status IN ('submitted','approved','rejected','in_payroll')
         ORDER BY e.name`,
        [periodId, approverEmail]
    );
    const pending = submissions.filter(s => s.status === 'submitted');
    const approved = submissions.filter(s => ['approved', 'in_payroll'].includes(s.status));
    const ids = pending.map(s => s.id);
    let items = [];
    if (ids.length) {
        const { rows } = await pool.query(
            `SELECT * FROM portal_claim_items WHERE submission_id = ANY($1::int[]) AND active = TRUE`,
            [ids]
        );
        items = rows;
    }
    const lines = pending.map(s => {
        const its = items.filter(i => i.submission_id === s.id);
        const bits = its.map(i => {
            if (i.claim_type === 'OT') return `OT ${i.ot_hours}h ${i.ot_multiplier || ''} on ${String(i.claim_date).slice(0, 10)}`;
            return `${i.claim_type} PKR ${i.amount} on ${String(i.claim_date).slice(0, 10)}`;
        }).join('; ') || 'No line items';
        return `<li style="margin:0 0 8px"><strong style="color:#0f172a">${s.employee_name}</strong> `
            + `<span style="color:#64748b">(${s.employee_id})</span><br/>`
            + `<span style="color:#334155">${bits}</span><br/>`
            + `<span style="color:#64748b;font-size:12px">Filled by ${s.filler_email || '—'}</span></li>`;
    });
    return {
        pendingCount: pending.length,
        approvedCount: approved.length,
        html: lines.length
            ? `<p style="color:#334155;margin:16px 0 8px"><strong>Pending for your review</strong></p><ul style="padding-left:18px;margin:0;color:#334155">${lines.join('')}</ul>`
            : '<p style="color:#64748b">No pending claims right now. Open the link anytime to see what you already approved.</p>',
    };
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
             `SELECT id, submission_id, item_id, filename, mime_type, byte_size, uploaded_at, retain_until, category
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
            settlement_month: pack.settlement_month,
            settlement_year: pack.settlement_year,
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
            rejected: submissions.filter(s => s.status === 'rejected').length,
        },
        notifyMode: APPROVER_NOTIFY_MODE,
    };
}

async function approverDecide(pool, { token, submissionId, decision, comment, sendAppEmail }) {
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
        await notifyFillerDecision(pool, sendAppEmail, sub, 'rejected', comment);
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

    await notifyFillerDecision(pool, sendAppEmail, sub, 'approved', comment);
    return { ok: true, decision: 'approved' };
}

async function notifyFillerDecision(pool, sendAppEmail, sub, decision, comment) {
    if (!sendAppEmail || !sub.filler_email) return;
    const { rows: emp } = await pool.query(`SELECT name FROM employees WHERE id = $1`, [sub.employee_id]);
    const name = emp[0]?.name || sub.employee_id;
    const approved = decision === 'approved';
    await sendAppEmail({
        to: sub.filler_email,
        subject: approved
            ? `ASIL Claims approved — ${name}`
            : `ASIL Claims rejected — ${name}`,
        html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f8fafc;color:#0f172a">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
  <h2 style="margin:0 0 8px;color:#0f172a">${approved ? 'Claim approved' : 'Claim rejected'}</h2>
  <p style="color:#334155">Employee <strong>${name}</strong> (${sub.employee_id}) was <strong>${decision}</strong> by the Line Manager.</p>
  ${comment ? `<p style="color:#475569">Remark: ${String(comment).replace(/</g, '&lt;')}</p>` : ''}
  <p style="color:#475569">${approved
    ? 'Approved amounts will be included in the following month’s payroll settlement.'
    : 'You may correct and re-raise next month (or contact ASIL finance if still within the fill window).'}</p>
  <p style="font-size:12px;color:#94a3b8;margin-top:16px">ASIL HCM</p>
</div></body></html>`,
    }).catch(() => {});
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
        // Hub month is usually the campaign month users pick; also match claim_month
        where += ` AND (
          (p.claim_month = $${vals.length - 1} AND p.claim_year = $${vals.length})
          OR (p.campaign_month = $${vals.length - 1} AND p.campaign_year = $${vals.length})
        )`;
    }
    if (channel) { vals.push(channel); where += ` AND s.channel = $${vals.length}`; }
    if (approver) { vals.push(`%${approver}%`); where += ` AND s.approver_email ILIKE $${vals.length}`; }
    if (filler) { vals.push(`%${filler}%`); where += ` AND s.filler_email ILIKE $${vals.length}`; }
    if (status) { vals.push(status); where += ` AND s.status = $${vals.length}`; }
    if (client) { vals.push(`%${client}%`); where += ` AND e.client ILIKE $${vals.length}`; }

    const { rows } = await pool.query(
        `SELECT s.*, e.name AS employee_name, e.client, e.location,
                p.claim_month, p.claim_year, p.settlement_month, p.settlement_year,
                p.campaign_month, p.campaign_year,
                (SELECT COUNT(*)::int FROM portal_claim_items i WHERE i.submission_id = s.id AND i.active) AS item_count,
                (SELECT COUNT(*)::int FROM portal_claim_attachments a WHERE a.submission_id = s.id) AS attachment_count,
                COALESCE((SELECT SUM(i.ot_hours) FROM portal_claim_items i WHERE i.submission_id = s.id AND i.active AND i.claim_type='OT' AND i.ot_multiplier_factor=1),0) AS ot1_hours,
                COALESCE((SELECT SUM(i.ot_hours) FROM portal_claim_items i WHERE i.submission_id = s.id AND i.active AND i.claim_type='OT' AND i.ot_multiplier_factor=2),0) AS ot2_hours,
                COALESCE((SELECT SUM(i.ot_hours) FROM portal_claim_items i WHERE i.submission_id = s.id AND i.active AND i.claim_type='OT' AND i.ot_multiplier_factor=3),0) AS ot3_hours,
                COALESCE((SELECT SUM(i.amount) FROM portal_claim_items i WHERE i.submission_id = s.id AND i.active AND i.claim_type='EXPENSE'),0) AS expense_amount,
                COALESCE((SELECT SUM(i.amount) FROM portal_claim_items i WHERE i.submission_id = s.id AND i.active AND i.claim_type='MEDICAL'),0) AS medical_amount
         FROM portal_claim_submissions s
         JOIN portal_claim_periods p ON p.id = s.period_id
         JOIN employees e ON e.id = s.employee_id
         ${where}
         ORDER BY s.updated_at DESC
         LIMIT 500`,
        vals
    );

    // Attach line-item details for expandable HCM view
    const ids = rows.map(r => r.id);
    let items = [];
    if (ids.length) {
        const { rows: itemRows } = await pool.query(
            `SELECT id, submission_id, claim_type, claim_date, ot_hours, ot_multiplier, ot_multiplier_factor,
                    amount, description, expense_type, patient_name, nature, time_from, time_to
             FROM portal_claim_items WHERE submission_id = ANY($1::int[]) AND active = TRUE
             ORDER BY claim_date NULLS LAST, id`,
            [ids]
        );
        items = itemRows;
    }
    return rows.map(r => ({
        ...r,
        items: items.filter(i => i.submission_id === r.id),
    }));
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

    return { ok: true, override: logRows[0], before, after, warning, notifyEmails: MANUAL_OVERRIDE_NOTIFY };
}

async function notifyManualOverride(sendAppEmail, payload) {
    if (!sendAppEmail || !MANUAL_OVERRIDE_NOTIFY.length) return;
    const {
        employeeId, month, year, mode, reason, createdBy,
        ot1Hours, ot2Hours, ot3Hours, expenseAmount, medicalAmount, before, after, warning,
    } = payload;
    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f8fafc;color:#0f172a">
<div style="max-width:640px;margin:auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
  <h2 style="margin:0 0 8px;color:#0f172a">Manual ADD OT / CLAIMS override</h2>
  <p style="color:#334155">A payroll claims override was <strong>committed</strong> in ASIL HCM.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;color:#0f172a;margin:12px 0">
    <tr><td style="padding:6px 0;color:#64748b">Employee</td><td style="padding:6px 0"><strong>${employeeId}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#64748b">Period</td><td style="padding:6px 0">${month}/${year}</td></tr>
    <tr><td style="padding:6px 0;color:#64748b">Mode</td><td style="padding:6px 0">${mode}</td></tr>
    <tr><td style="padding:6px 0;color:#64748b">By</td><td style="padding:6px 0">${createdBy || '—'}</td></tr>
    <tr><td style="padding:6px 0;color:#64748b">Reason</td><td style="padding:6px 0">${String(reason || '').replace(/</g, '&lt;')}</td></tr>
    <tr><td style="padding:6px 0;color:#64748b">OT 1× / 2× / 3×</td><td style="padding:6px 0">${ot1Hours} / ${ot2Hours} / ${ot3Hours} hrs</td></tr>
    <tr><td style="padding:6px 0;color:#64748b">Expense / Medical</td><td style="padding:6px 0">${expenseAmount} / ${medicalAmount}</td></tr>
    <tr><td style="padding:6px 0;color:#64748b">Payroll before</td><td style="padding:6px 0;font-family:monospace;font-size:12px">${JSON.stringify(before)}</td></tr>
    <tr><td style="padding:6px 0;color:#64748b">Payroll after</td><td style="padding:6px 0;font-family:monospace;font-size:12px">${JSON.stringify(after)}</td></tr>
  </table>
  ${warning ? `<p style="color:#b45309">${String(warning).replace(/</g, '&lt;')}</p>` : ''}
  <p style="font-size:12px;color:#94a3b8;margin-top:16px">ASIL HCM · automatic notice</p>
</div></body></html>`;
    for (const to of MANUAL_OVERRIDE_NOTIFY) {
        await sendAppEmail({
            to,
            subject: `Manual OT/Claims override — ${employeeId} (${month}/${year})`,
            html,
        }).catch(() => {});
    }
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
            const { rows: emps } = await pool.query(
                `SELECT s.employee_id AS id, e.name FROM portal_claim_submissions s
                 JOIN employees e ON e.id = s.employee_id WHERE s.batch_id = $1 ORDER BY e.name`,
                [b.id]
            );
            const link = `${FRONTEND_URL}/?asil_claims=fill&token=${token}`;
            if (sendAppEmail) {
                await sendAppEmail({
                    to: b.filler_email,
                    subject: `Reminder: ASIL claims due by day ${FILL_CLOSE_DAY}`,
                    html: buildFillerInviteHtml({
                        period: b,
                        employeeCount: emps.length,
                        link,
                        fillerEmail: b.filler_email,
                        employees: emps,
                    }),
                }).catch(() => {});
            }
            results.filler++;
        }
    }

    // Approver digests: daily mode any day with pending; day22 on the 22nd; always remind 23–24
    const runApproverDigest = (APPROVER_NOTIFY_MODE === 'daily')
        || (APPROVER_NOTIFY_MODE === 'day22' && day === FILL_CLOSE_DAY)
        || [23, 24].includes(day);
    if (runApproverDigest) {
        const { rows: periods } = await pool.query(
            `SELECT DISTINCT p.id FROM portal_claim_periods p
             JOIN portal_claim_submissions s ON s.period_id = p.id
             WHERE s.status = 'submitted' AND p.approve_close_at > NOW()`
        );
        for (const p of periods) {
            const packs = await ensureApproverPacks(pool, p.id, sendAppEmail, { forceEmail: true });
            results.approver += packs.filter(x => x.count > 0).length;
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
    const { rows: emps } = await pool.query(
        `SELECT s.employee_id AS id, e.name FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id WHERE s.batch_id = $1 ORDER BY e.name`,
        [batchId]
    );
    const link = `${FRONTEND_URL}/?asil_claims=fill&token=${token}`;
    if (sendAppEmail) {
        await sendAppEmail({
            to: b.filler_email,
            subject: `ASIL Claims link (resent) — due day ${FILL_CLOSE_DAY}`,
            html: buildFillerInviteHtml({
                period: b,
                employeeCount: emps.length,
                link,
                fillerEmail: b.filler_email,
                employees: emps,
            }),
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
    importExcelWorkbook,
    getMasterClaimsTemplatePath,
    buildPersonalizedTemplateForToken,
    ensureApproverPacks,
    openApproverSession,
    approverDecide,
    listClaimsForAdmin,
    exportClaimsPayrollTieout,
    applyManualOverride,
    notifyManualOverride,
    autoCloseNoClaims,
    sendReminders,
    resendFillerInvite,
    getAttachmentContent,
    getOrCreatePeriod,
    findPeriodForUi,
    periodWindow,
    validateOtRow,
    APPROVER_NOTIFY_MODE,
    MANUAL_OVERRIDE_NOTIFY,
    resetPortalClaimsSample,
};

const SAMPLE_TEST_EMPLOYEE_IDS = [
    'ASIL/TEST-CLAIM-SHEZAD/26',
    'ASIL/TEST-CLAIM-RABIA/26',
    'ASIL/TEST-CLAIM-LAIBA/26',
];
const SAMPLE_FILLER_EMAILS = [
    'shezad.mumtaz@asil.com.pk',
    'rabia.bhutto@asil.com.pk',
    'laiba.mughal@asil.com.pk',
];

/** Wipe only synthetic sample portal claims so ASIL can re-test the cycle. */
async function resetPortalClaimsSample(pool) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: subs } = await client.query(
            `SELECT id, period_id, employee_id, status FROM portal_claim_submissions
             WHERE employee_id = ANY($1::text[])`,
            [SAMPLE_TEST_EMPLOYEE_IDS]
        );
        const subIds = subs.map(s => s.id);
        const periodIds = [...new Set(subs.map(s => s.period_id).filter(Boolean))];

        if (subIds.length) {
            await client.query(`DELETE FROM portal_claim_attachments WHERE submission_id = ANY($1::int[])`, [subIds]);
            await client.query(`DELETE FROM portal_claim_items WHERE submission_id = ANY($1::int[])`, [subIds]);
            await client.query(`DELETE FROM portal_claim_submissions WHERE id = ANY($1::int[])`, [subIds]);
        }

        await client.query(
            `DELETE FROM portal_claim_batches WHERE LOWER(filler_email) = ANY($1::text[])`,
            [SAMPLE_FILLER_EMAILS]
        );

        if (periodIds.length) {
            await client.query(
                `DELETE FROM portal_claim_approver_packs
                 WHERE period_id = ANY($1::int[])
                   AND LOWER(approver_email) = 'huzaifa.rafaqat@asil.com.pk'`,
                [periodIds]
            );
        }

        await client.query(
            `DELETE FROM employee_claims WHERE employee_id = ANY($1::text[])`,
            [SAMPLE_TEST_EMPLOYEE_IDS]
        ).catch(() => {});

        await client.query(
            `DELETE FROM claim_manual_overrides WHERE employee_id = ANY($1::text[])`,
            [SAMPLE_TEST_EMPLOYEE_IDS]
        ).catch(() => {});

        const payroll = await client.query(
            `UPDATE payroll_transactions
             SET ot2_hrs = 0, ot3_hrs = 0, opd_claim = 0, reimbursement = 0, updated_at = NOW()
             WHERE employee_id = ANY($1::text[])`,
            [SAMPLE_TEST_EMPLOYEE_IDS]
        );

        await client.query('COMMIT');
        return {
            ok: true,
            clearedSubmissions: subs.map(s => ({ employee_id: s.employee_id, status: s.status })),
            payrollRowsZeroed: payroll.rowCount || 0,
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}
