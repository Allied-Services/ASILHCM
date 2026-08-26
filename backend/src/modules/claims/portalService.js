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
    formatDateDdMmYyyy,
    isMeaningfulOtRow,
    isMeaningfulMoneyRow,
    MONTH_NAMES,
} = require('./portalExcel');
const {
    HUZAIFA_FALLBACK,
    countEligibleEmployees,
    resolveClaimsCategory,
    resolveClaimsRouting,
    isFinalSubmitProfile,
    listRules,
    upsertRule,
    previewRuleMatch,
} = require('./claimsEligibility');
const {
    stableFillerToken,
    resolveOutboundEmail,
    sampleSubjectPrefix,
    sampleBodyBanner,
    shouldSendRecordEmail,
    canInjectPayroll,
    isSamplePeriod,
    wrapClaimsHtmlFooter,
} = require('./claimsMail');
const {
    createCampaignAugust,
    computeBatchTotals,
} = require('./claimsCampaign');
const {
    portalAmountsFromItems,
    listResponseBoard,
    writePortalAmountsToSheet,
    sheetHasValues,
} = require('./claimsResponse');
const { planChase, planSmartReminder } = require('./claimsChase');
const {
    isDueForReminder,
    fillerReminderBanner,
    approverReminderBanner,
    buildSmartReminderSms,
    isJuly2026TrialPeriod,
} = require('./claimsReminders');
const { firstValidPkMobile } = require('../../../lib/sms');

const FILL_OPEN_DAY = parseInt(process.env.CLAIMS_FILL_OPEN_DAY || '1', 10);
const FILL_CLOSE_DAY = parseInt(process.env.CLAIMS_FILL_CLOSE_DAY || '18', 10);
const APPROVE_CLOSE_DAY = parseInt(process.env.CLAIMS_APPROVE_CLOSE_DAY || '22', 10);
const { getClaimsPolicy, getDefaultClaimsPolicy, normalizeEnabledTypes } = require('./claimsPolicy');
const PRODUCTION_FRONTEND_URL = 'https://asil-hcm-frontend.onrender.com';

/** Resolve at send time — never emit localhost from a laptop .env on ACTUAL mail. */
function claimsFrontendUrl() {
    const raw = String(process.env.FRONTEND_URL || PRODUCTION_FRONTEND_URL).trim().replace(/\/$/, '');
    if (/localhost|127\.0\.0\.1/i.test(raw)) return PRODUCTION_FRONTEND_URL;
    return raw || PRODUCTION_FRONTEND_URL;
}
/** immediate | daily | day22 — when approvers get email digests */
const APPROVER_NOTIFY_MODE = String(process.env.CLAIMS_APPROVER_NOTIFY_MODE || 'immediate').toLowerCase();
const MANUAL_OVERRIDE_NOTIFY = (process.env.CLAIMS_OVERRIDE_NOTIFY_EMAILS
    || 'huzaifa.rafaqat@asil.com.pk,shezad.mumtaz@asil.com.pk')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const OT_MAP = {
    single: 1, '1x': 1, '1×': 1, '1': 1,
    double: 2, '2x': 2, '2×': 2, '2': 2,
    triple: 3, '3x': 3, '3×': 3, '3': 3,
};

function normalizeOtMultiplierLabel(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (!s) return 'Double';
    if (s.includes('triple') || s === '3' || s === '3x' || s === '3×' || s === '3.0') return 'Triple';
    if (s.includes('single') || s === '1' || s === '1x' || s === '1×' || s === '1.0') return 'Single';
    if (s.includes('double') || s === '2' || s === '2x' || s === '2×' || s === '2.0') return 'Double';
    return String(raw || 'Double').trim();
}

/**
 * Pakistan gazetted / festival holidays.
 * Factories Act practice: OT beyond normal hours = Double (2×);
 * work on gazetted public/festival holidays = Triple (3×) / 300% treatment.
 */
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
    if (holiday) return { type: holiday.isEid ? 'EID' : 'HOLIDAY', name: holiday.name, dateStr, isGazetted: true };
    const dow = date.getDay();
    if (dow === 0) return { type: 'SUNDAY', name: 'Sunday', dateStr, isGazetted: false };
    return { type: 'WEEKDAY', name: WEEKDAY_NAMES[dow], dateStr, isGazetted: false };
}

function listGazettedHolidayDates() {
    return Object.keys(PK_PUBLIC_HOLIDAYS).sort();
}

function pkHolidayMapForClient() {
    return Object.fromEntries(
        Object.entries(PK_PUBLIC_HOLIDAYS).map(([dateStr, meta]) => [dateStr, meta.name])
    );
}

function pktNow() {
    return new Date(Date.now() + (5 * 60 * 60 * 1000));
}

function closeDayFromTimestamp(iso, fallback) {
    if (!iso) return fallback;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return fallback;
    return d.getUTCDate();
}

async function lookupPhoneForEmail(pool, email) {
    if (!email) return null;
    const e = String(email).trim().toLowerCase();
    const { rows } = await pool.query(
        `SELECT primary_contact FROM employees
         WHERE active = TRUE AND (
           LOWER(COALESCE(claim_authority, '')) = $1
           OR LOWER(COALESCE(line_manager_email, '')) = $1
           OR LOWER(COALESCE(supervisor_email, '')) = $1
         )
         LIMIT 1`,
        [e]
    );
    return firstValidPkMobile(rows[0]?.primary_contact);
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
    return resolveClaimsRouting(emp).approverEmail;
}

/** PKT wall-clock → UTC timestamptz (PKT = UTC+5). */
function pktDeadline(year, month, day, hourPkt, min, sec) {
    return new Date(Date.UTC(year, month - 1, day, hourPkt - 5, min, sec));
}

function periodWindowFromClaim(claimYear, claimMonth, policy = {}) {
    const payTiming = policy.claims_pay_timing || 'following_month';
    const submitDay = policy.submit_deadline_day ?? FILL_CLOSE_DAY;
    const approveDay = policy.approve_deadline_day ?? APPROVE_CLOSE_DAY;

    let settlementMonth;
    let settlementYear;
    let campaignMonth;
    let campaignYear;

    if (payTiming === 'same_month') {
        settlementMonth = claimMonth;
        settlementYear = claimYear;
        campaignMonth = claimMonth;
        campaignYear = claimYear;
    } else {
        const sd = new Date(claimYear, claimMonth - 1 + 1, 1);
        settlementMonth = sd.getMonth() + 1;
        settlementYear = sd.getFullYear();
        campaignMonth = settlementMonth;
        campaignYear = settlementYear;
    }

    const deadlineMonth = payTiming === 'same_month' ? claimMonth : campaignMonth;
    const deadlineYear = payTiming === 'same_month' ? claimYear : campaignYear;
    const fillOpen = pktDeadline(claimYear, claimMonth, FILL_OPEN_DAY, 9, 0, 0);
    const fillClose = pktDeadline(deadlineYear, deadlineMonth, submitDay, 23, 59, 59);
    const approveClose = pktDeadline(deadlineYear, deadlineMonth, approveDay, 23, 59, 59);

    return {
        claimMonth,
        claimYear,
        settlementMonth,
        settlementYear,
        campaignMonth,
        campaignYear,
        submitDeadlineDay: submitDay,
        approveDeadlineDay: approveDay,
        claimsPayTiming: payTiming,
        fillOpenAt: fillOpen,
        fillCloseAt: fillClose,
        approveCloseAt: approveClose,
    };
}

function periodWindow(campaignYear, campaignMonth, policy = {}) {
    // Legacy hub input: campaign month = settlement month (claim = previous calendar month)
    const claimDate = new Date(campaignYear, campaignMonth - 2, 1);
    const claimMonth = claimDate.getMonth() + 1;
    const claimYear = claimDate.getFullYear();
    return periodWindowFromClaim(claimYear, claimMonth, policy);
}

function periodWindowForClaimMonth(claimYear, claimMonth, policy = {}) {
    return periodWindowFromClaim(claimYear, claimMonth, policy);
}

const JULY_2026_TRIAL_CLOSE = pktDeadline(2026, 8, 27, 23, 59, 59);

function effectiveCloseAt(stored, trialFloor) {
    const storedMs = stored ? new Date(stored).getTime() : 0;
    if (!Number.isFinite(storedMs)) return trialFloor || 0;
    return trialFloor ? Math.max(storedMs, trialFloor) : storedMs;
}

function trialCloseFloorMs(period) {
    if (isSamplePeriod(period) || !isJuly2026TrialPeriod(period)) return 0;
    return JULY_2026_TRIAL_CLOSE.getTime();
}

function isAfterFillClose(period, nowMs = Date.now()) {
    if (isSamplePeriod(period)) return false;
    const closeAt = effectiveCloseAt(period?.fill_close_at, trialCloseFloorMs(period));
    if (!closeAt) return false;
    return nowMs > closeAt;
}

function isAfterApproveClose(period, nowMs = Date.now()) {
    if (isSamplePeriod(period)) return false;
    const closeAt = effectiveCloseAt(period?.approve_close_at, trialCloseFloorMs(period));
    if (!closeAt) return false;
    return nowMs > closeAt;
}

function formatPeriodBanner(period) {
    const cm = period?.claim_month;
    const cy = period?.claim_year;
    const sm = period?.settlement_month;
    const sy = period?.settlement_year;
    const submitDay = period?.submit_deadline_day || FILL_CLOSE_DAY;
    const approveDay = period?.approve_deadline_day || APPROVE_CLOSE_DAY;
    const claimName = cm && cy ? `${MONTH_NAMES[cm] || cm} ${cy}` : 'this month';
    const settleName = sm && sy ? `${MONTH_NAMES[sm] || sm} ${sy}` : 'the following month';
    if (isJuly2026TrialPeriod(period) && !isSamplePeriod(period)) {
        return {
            claimLabel: claimName,
            settlementLabel: settleName,
            submitBy: '27 August 2026, 11:59 PM',
            approveBy: '27 August 2026, 11:59 PM',
            payWith: `Approved amounts pay with your ${settleName} salary`,
        };
    }
    return {
        claimLabel: claimName,
        settlementLabel: settleName,
        submitBy: `day ${submitDay} of ${MONTH_NAMES[cm] || cm || 'claim month'}`,
        approveBy: `day ${approveDay} of ${MONTH_NAMES[cm] || cm || 'claim month'}`,
        payWith: `Approved amounts pay with your ${settleName} salary`,
    };
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
        errors.push(`${kind} date is missing. Please enter the date the work happened (DD/MM/YYYY, e.g. 15/07/2026).`);
        return { errors, iso: null };
    }
    iso = toIsoDate(rawDate) || (String(rawDate).match(/^\d{4}-\d{2}-\d{2}/) ? String(rawDate).slice(0, 10) : null);
    if (!iso) {
        errors.push(
            `${kind} date "${rawDate}" could not be read. `
            + 'Try DD/MM/YYYY (e.g. 15/07/2026), DD-MM-YYYY, or 15-JUL-2026.'
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

    const tf = String(row.time_from || '').trim();
    const tt = String(row.time_to || '').trim();
    let hours = parseAmount(row.ot_hours);
    const fromMin = parseTimeToMinutes(tf);
    const toMin = parseTimeToMinutes(tt);
    const span = hoursBetween(fromMin, toMin);

    if (!tf || !tt) {
        errors.push(
            `OT Start and OT End are required${niceDate ? ` for ${niceDate}` : ''}. `
            + 'Enter only the overtime period after normal duty hours (not the full shift start/end).'
        );
    } else if (fromMin == null || toMin == null) {
        const bad = fromMin == null ? tf : tt;
        errors.push(`Could not read time "${bad}"${niceDate ? ` on ${niceDate}` : ''}. Try 5:00 PM, 17:00, 5pm, or 1700.`);
    } else if (span != null) {
        if (!Number.isFinite(hours) || hours <= 0) hours = span;
        else if (Math.abs(span - hours) > 0.51) {
            errors.push(
                `OT hours (${hours}) do not match OT Start→End (${span}h)${niceDate ? ` on ${niceDate}` : ''}. `
                + 'Leave OT Hours blank — it is calculated automatically from OT Start and OT End.'
            );
        }
    }

    if (!Number.isFinite(hours) || hours <= 0) {
        errors.push(
            `OT hours could not be calculated${niceDate ? ` for ${niceDate}` : ''}. `
            + 'Check OT Start and OT End (overtime period only, after normal duty).'
        );
    }

    let multLabel;
    if (!row.ot_multiplier || String(row.ot_multiplier).trim() === '') {
        const d = iso ? parseLocalDate(iso) : null;
        const dateType = d ? getPkDateType(d) : null;
        multLabel = dateType?.isGazetted ? 'Triple' : 'Double';
    } else {
        multLabel = normalizeOtMultiplierLabel(row.ot_multiplier);
    }
    const multKey = multLabel.toLowerCase();
    const factor = OT_MAP[multKey] || OT_MAP[String(row.ot_multiplier || '').toLowerCase().trim()] || null;
    if (!factor) {
        errors.push(`OT rate "${row.ot_multiplier}" is not valid. Choose 1X (Single), 2X (Double), or 3X (Triple).`);
    }

    if (iso && Number.isFinite(hours) && hours > 0 && factor) {
        const d = parseLocalDate(iso);
        const dateType = getPkDateType(d);
        const dayLabel = `${niceDate}${dateType ? ` (${dateType.name})` : ''}`;

        // Triple (3×) only on gazetted public/festival holidays
        if (factor === 3 && dateType && !dateType.isGazetted) {
            errors.push(
                `Triple (3×) cannot be paid on ${dayLabel}. `
                + 'Under applicable Pakistan labour practice, 3× applies on gazetted public/festival holidays only. '
                + 'Please change the rate to Double (2×). Double (2×) is accepted without issue for OT after normal duty.'
            );
        }
        if (factor === 1 && dateType && (dateType.type === 'SUNDAY' || dateType.isGazetted)) {
            errors.push(
                `Single (1×) is not allowed on ${dayLabel}. Use Double (2×), or Triple (3×) on a gazetted holiday.`
            );
        }
        if (hours > 12) warnings.push(`High OT: ${hours}h on ${niceDate} — Line Manager should confirm`);
    }

    let finalFactor = factor;
    let finalMultLabel = multLabel;
    if (!errors.length && iso && finalFactor === 2) {
        const dFinal = parseLocalDate(iso);
        const dtFinal = dFinal ? getPkDateType(dFinal) : null;
        if (dtFinal?.isGazetted) {
            finalMultLabel = 'Triple';
            finalFactor = 3;
        }
    }

    return {
        errors,
        warnings,
        factor: finalFactor,
        claim_date: iso,
        ot_hours: Number.isFinite(hours) && hours > 0 ? hours : null,
        ot_multiplier: finalFactor ? finalMultLabel : null,
    };
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

async function getOrCreatePeriod(pool, campaignMonth, campaignYear, policyOverride = null) {
    const policy = policyOverride || await getDefaultClaimsPolicy(pool);
    const w = periodWindow(campaignYear, campaignMonth, policy);
    const { rows: existing } = await pool.query(
        `SELECT * FROM portal_claim_periods WHERE campaign_month = $1 AND campaign_year = $2`,
        [campaignMonth, campaignYear]
    );
    if (existing[0]) return refreshOpenPeriodFillClose(pool, existing[0], w);

    const { rows } = await pool.query(
        `INSERT INTO portal_claim_periods
         (campaign_month, campaign_year, claim_month, claim_year, settlement_month, settlement_year,
          fill_open_at, fill_close_at, approve_close_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')
         RETURNING *`,
        [
            w.campaignMonth, w.campaignYear, w.claimMonth, w.claimYear, w.settlementMonth, w.settlementYear,
            w.fillOpenAt.toISOString(), w.fillCloseAt.toISOString(), w.approveCloseAt.toISOString(),
        ]
    );
    return rows[0];
}

async function refreshOpenPeriodFillClose(pool, period, w) {
    if (!period || period.status !== 'open') return period;
    const currentFill = period.fill_close_at ? new Date(period.fill_close_at).getTime() : 0;
    const currentApprove = period.approve_close_at ? new Date(period.approve_close_at).getTime() : 0;
    const nextFill = w.fillCloseAt.getTime();
    const nextApprove = w.approveCloseAt.getTime();
    // Never pull a promised window backward (campaign/preview used to rewind 27 Aug → 17 Jul).
    if (currentFill >= nextFill && currentApprove >= nextApprove) return period;
    const fillClose = new Date(Math.max(currentFill || 0, nextFill)).toISOString();
    const approveClose = new Date(Math.max(currentApprove || 0, nextApprove)).toISOString();
    const { rows } = await pool.query(
        `UPDATE portal_claim_periods
         SET fill_close_at = $2,
             approve_close_at = $3
         WHERE id = $1 AND status = 'open'
         RETURNING *`,
        [period.id, fillClose, approveClose]
    );
    return rows[0] || period;
}

async function extendJuly2026ClaimsWindow(pool, { fillDay = 27, approveDay = 27 } = {}) {
    const fillClose = pktDeadline(2026, 8, fillDay, 23, 59, 59);
    const approveClose = pktDeadline(2026, 8, approveDay, 23, 59, 59);
    const { rows } = await pool.query(
        `UPDATE portal_claim_periods
         SET fill_close_at = $1,
             approve_close_at = $2,
             status = 'open'
         WHERE claim_month = 7 AND claim_year = 2026
           AND COALESCE(campaign_mode, 'actual') <> 'sample'
         RETURNING id, claim_month, claim_year, fill_close_at, approve_close_at, campaign_mode, status`,
        [fillClose.toISOString(), approveClose.toISOString()]
    );
    return { ok: true, periods: rows };
}

async function sendDeadlineExtensionNotice() {
    return { ok: false, reason: 'live_send_not_in_this_change' };
}

async function getOrCreatePeriodForClaimMonth(pool, claimMonth, claimYear, policyOverride = null) {
    const policy = policyOverride || await getDefaultClaimsPolicy(pool);
    const { rows: existing } = await pool.query(
        `SELECT * FROM portal_claim_periods WHERE claim_month = $1 AND claim_year = $2 ORDER BY id DESC LIMIT 1`,
        [claimMonth, claimYear]
    );
    if (existing[0]) return refreshOpenPeriodFillClose(pool, existing[0], periodWindowFromClaim(claimYear, claimMonth, policy));
    const w = periodWindowFromClaim(claimYear, claimMonth, policy);
    const { rows } = await pool.query(
        `INSERT INTO portal_claim_periods
         (campaign_month, campaign_year, claim_month, claim_year, settlement_month, settlement_year,
          fill_open_at, fill_close_at, approve_close_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')
         RETURNING *`,
        [
            w.campaignMonth, w.campaignYear, w.claimMonth, w.claimYear, w.settlementMonth, w.settlementYear,
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
    const { rows: byClaim } = await pool.query(
        `SELECT * FROM portal_claim_periods WHERE claim_month = $1 AND claim_year = $2 ORDER BY id DESC LIMIT 1`,
        [m, y]
    );
    if (byClaim[0]) return byClaim[0];
    const { rows: byCampaign } = await pool.query(
        `SELECT * FROM portal_claim_periods WHERE campaign_month = $1 AND campaign_year = $2`,
        [m, y]
    );
    if (byCampaign[0]) return byCampaign[0];
    return getOrCreatePeriodForClaimMonth(pool, m, y);
}

/**
 * Eligible employees per claim_eligibility_rules + routing matrix.
 */
async function listEligibleEmployees(pool) {
    await ensureClaimAuthorityColumn(pool);
    const { eligible } = await countEligibleEmployees(pool);
    return eligible.map(e => ({
        ...e,
        claim_authority_norm: normalizeAuthority(e.claim_authority),
    }));
}

async function createCampaign(pool, {
    campaignMonth, campaignYear, claimMonth, claimYear, sendAppEmail, dryRun = false, preview = false,
    onlyEmails = null, onlyEmployeeIds = null, campaignMode = 'actual', testPackFour = false,
}) {
    let period;
    if (claimMonth && claimYear) {
        period = await getOrCreatePeriodForClaimMonth(pool, claimMonth, claimYear);
    } else {
        period = await getOrCreatePeriod(pool, campaignMonth, campaignYear);
    }
    return createCampaignAugust(pool, {
        period,
        campaignMonth,
        campaignYear,
        sendAppEmail,
        dryRun,
        preview,
        onlyEmails,
        onlyEmployeeIds,
        campaignMode,
        testPackFour,
        FRONTEND_URL: claimsFrontendUrl(),
        FILL_CLOSE_DAY,
        buildFillerInviteHtml,
    });
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
      <li><strong>Option A:</strong> Download <em>your</em> Excel (Code/Name already filled), complete claim columns only, and upload it.<br/>
          <strong>Option B:</strong> Enter OT / Expense Reimbursement / Medical on screen for each employee.</li>
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
      <li>Line Manager approves or rejects (by day ${APPROVE_CLOSE_DAY} of the claim month).</li>
      <li>You get an email when a decision is made.</li>
      <li>Approved amounts go into payroll for <strong>${settleLabel}</strong> salary.</li>
      <li><strong>OT tip:</strong> enter <strong>OT Start / OT End</strong> for overtime after normal duty (not the full shift). Prefer <strong>2×</strong>; <strong>3×</strong> only on gazetted public/festival holidays.</li>
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
                p.fill_close_at, p.approve_close_at, p.fill_open_at, p.status AS period_status,
                p.campaign_mode
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
        `SELECT s.*, e.name AS employee_name, e.dept, e.location, e.client, e.contract_id,
                e.claim_authority, e.line_manager_email, e.claims_reviewer_email, e.email AS employee_email
         FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.batch_id = $1
         ORDER BY e.name`,
        [batch.id]
    );

    const policyCache = new Map();
    const policyForContract = async (contractId) => {
        const key = contractId || '__default__';
        if (!policyCache.has(key)) {
            policyCache.set(key, await getClaimsPolicy(pool, contractId));
        }
        return policyCache.get(key);
    };
    for (const sub of submissions) {
        const pack = await policyForContract(sub.contract_id);
        sub.enabled_types = pack.enabled_types;
        sub.collection_mode = pack.collection_mode;
    }
    const defaultPack = submissions.length
        ? await policyForContract(submissions[0].contract_id)
        : await getDefaultClaimsPolicy(pool);

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

    const { rows: periodRows } = await pool.query(`SELECT * FROM portal_claim_periods WHERE id = $1`, [batch.period_id]);
    const periodRow = periodRows[0] || {};
    const fillClosed = isAfterFillClose({ ...batch, campaign_mode: periodRow.campaign_mode || batch.campaign_mode });
    const banner = formatPeriodBanner({
        ...batch,
        campaign_mode: periodRow.campaign_mode || batch.campaign_mode,
        submit_deadline_day: isJuly2026TrialPeriod(batch) ? 27 : FILL_CLOSE_DAY,
        approve_deadline_day: isJuly2026TrialPeriod(batch) ? 27 : APPROVE_CLOSE_DAY,
    });
    const apiBase = process.env.API_PUBLIC_URL || 'https://asilhcm.onrender.com';
    const review = computeBatchTotals(submissions, items);
    const uniqueApprovers = [...new Set(submissions.map(s => s.approver_email).filter(Boolean))];
    const routingProfile = batch.routing_profile || 'focal_then_lm';
    const submitDestination = isFinalSubmitProfile(routingProfile)
        ? { type: 'final', label: routingProfile === 'lm_only' ? 'You are the Line Manager — final approval' : 'You are the final approver' }
        : uniqueApprovers.length === 1
            ? { type: 'lm', label: uniqueApprovers[0] }
            : { type: 'multi', label: `${uniqueApprovers.length} Line Managers` };

    return {
        ok: true,
        batch,
        period: {
            id: batch.period_id,
            claim_month: batch.claim_month,
            claim_year: batch.claim_year,
            settlement_month: batch.settlement_month,
            settlement_year: batch.settlement_year,
            fill_close_at: batch.fill_close_at,
            approve_close_at: batch.approve_close_at,
            fill_closed: fillClosed,
            campaign_mode: periodRow.campaign_mode || 'actual',
            submit_deadline_day: isJuly2026TrialPeriod(batch) ? 27 : FILL_CLOSE_DAY,
            approve_deadline_day: isJuly2026TrialPeriod(batch) ? 27 : APPROVE_CLOSE_DAY,
            banner,
        },
        routing: {
            profile: routingProfile,
            cohortType: batch.cohort_type || 'focal',
            submitDestination,
            byApprover: review.byApprover,
        },
        review,
        submissions,
        items,
        attachments,
        pkHolidays: pkHolidayMapForClient(),
        templateUrl: `${apiBase}/api/portal-claims/fill/${encodeURIComponent(token)}/template.xlsx`,
        blankTemplateUrl: `${apiBase}/api/portal-claims/template.xlsx`,
        completion: {
            total: submissions.length,
            submitted: submissions.filter(s => ['submitted', 'approved', 'rejected', 'no_claims', 'in_payroll'].includes(s.status)).length,
        },
        contractPack: {
            enabled_types: defaultPack.enabled_types,
            collection_mode: defaultPack.collection_mode,
            reviewer_required: defaultPack.reviewer_required,
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
    if (sub.status === 'submitted' && sub.submitted_locked_at && !asDraft) {
        return { ok: false, status: 403, error: 'This claim is locked after submit. Contact ASIL if you need to change it.' };
    }

    if (confirmNoClaims) {
        await pool.query(`DELETE FROM portal_claim_items WHERE submission_id = $1`, [sub.id]);
        await pool.query(
            `UPDATE portal_claim_submissions
             SET status = 'no_claims',
                 no_claims_kind = 'confirmed',
                 submitted_at = NOW(),
                 updated_at = NOW()
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

    const { rows: empPolicyRows } = await pool.query(
        `SELECT contract_id FROM employees WHERE id = $1`,
        [employeeId]
    );
    const contractPolicy = await getClaimsPolicy(pool, empPolicyRows[0]?.contract_id);
    const enabledTypes = normalizeEnabledTypes(contractPolicy.enabled_types);

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

        if (type && !enabledTypes.includes(type)) {
            errors.push(`${rowTag || type}: ${type} claims are not enabled for this contract`);
            continue;
        }

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
                    ot_hours: v.ot_hours,
                    ot_multiplier: v.ot_multiplier || 'Double',
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
        const typeHint = enabledTypes.join(' / ') || 'claims';
        return {
            ok: false,
            status: 400,
            error: `No valid claim lines to submit. Add ${typeHint} with a date and hours/amount for `
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
            const misfiledExpenseOnly = needsMedical && !needsExpense && strictExpense;
            return {
                ok: false,
                status: 400,
                error: misfiledExpenseOnly
                    ? 'Medical claims require a Medical supports file before Submit. Your uploads are tagged as Expense supports — use the Medical Reimbursement supports upload on the Supports step (re-upload if needed), then Submit again.'
                    : 'Medical claims require a Medical supports file (prescriptions/bills) before Submit. Upload it under Supports, then Submit again. Without supports, medical refunds will not be processed.',
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
    const snapshot = normalized.length ? JSON.stringify({ items: normalized, at: new Date().toISOString() }) : null;
    await pool.query(
        `UPDATE portal_claim_submissions
         SET status = $2,
             submitted_at = CASE WHEN $2 = 'submitted' THEN NOW() ELSE submitted_at END,
             submitted_locked_at = CASE WHEN $2 = 'submitted' THEN NOW() ELSE submitted_locked_at END,
             submit_snapshot = CASE WHEN $2 = 'submitted' THEN $3::jsonb ELSE submit_snapshot END,
             updated_at = NOW()
         WHERE id = $1`,
        [sub.id, newStatus, snapshot]
    );
    await refreshBatchStatus(pool, batch.id);

    let finalStatus = newStatus;
    if (newStatus === 'submitted' && ['focal_only', 'lm_only'].includes(batch.routing_profile)) {
        await autoApproveSelfFinal(pool, batch, null);
        finalStatus = 'approved';
    }

    const savedLines = normalized.map((item) => ({
        claim_type: item.claim_type,
        claim_date: item.claim_date,
        claim_date_display: formatDateDdMmYyyy(item.claim_date),
        ot_hours: item.ot_hours,
        ot_multiplier: item.ot_multiplier,
        time_from: item.time_from,
        time_to: item.time_to,
        amount: item.amount,
        description: item.description || item.nature || null,
    }));

    const profile = batch.routing_profile || 'focal_then_lm';
    let message;
    if (finalStatus === 'approved' && ['focal_only', 'lm_only'].includes(profile)) {
        message = savedLines.length
            ? `Saved and approved (${savedLines.length} line${savedLines.length === 1 ? '' : 's'}). This is final — approved amounts go to payroll with the following month’s salary.`
            : 'Saved and approved. This is final.';
    } else if (finalStatus === 'submitted') {
        message = 'Thank you. Your claim has been submitted to your Line Manager for approval. '
          + 'You will receive an email when they approve or reject it. '
          + 'Approved amounts are added to payroll and paid with the following month’s salary.';
    } else if (skipSupportCheck) {
        message = 'Excel imported as a draft. Review the rows, then upload required Expense/Medical supports (if any) before Submit to Line Manager.';
    } else {
        message = savedLines.length
            ? `Draft saved (${savedLines.length} line${savedLines.length === 1 ? '' : 's'}). Your entries are shown below — review, then Submit when ready.`
            : 'Draft saved. When ready, click Submit to Line Manager. If you entered Expense or Medical amounts, upload those support files first.';
    }

    return {
        ok: true,
        status: finalStatus,
        itemCount: normalized.length,
        savedLines,
        message,
        notifyApprover: finalStatus === 'submitted' && APPROVER_NOTIFY_MODE === 'immediate',
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

function resolveSupportCategory(requestedCategory, claimTypes) {
    const types = new Set((claimTypes || []).map((t) => String(t || '').toUpperCase()));
    const hasExpense = types.has('EXPENSE');
    const hasMedical = types.has('MEDICAL');
    const cat = ['expense_support', 'medical_support', 'excel_workbook', 'other'].includes(requestedCategory)
        ? requestedCategory
        : 'other';
    if (cat !== 'expense_support' && cat !== 'medical_support') return cat;
    // Single-type submissions: mis-clicks on the wrong upload field are common — store under the needed bucket.
    if (cat === 'expense_support' && hasMedical && !hasExpense) return 'medical_support';
    if (cat === 'medical_support' && hasExpense && !hasMedical) return 'expense_support';
    return cat;
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
    const { rows: typeRows } = await pool.query(
        `SELECT DISTINCT claim_type FROM portal_claim_items WHERE submission_id = $1 AND active = TRUE`,
        [sub.id]
    );
    const cat = resolveSupportCategory(category, typeRows.map((r) => r.claim_type));

    const { rows } = await pool.query(
        `INSERT INTO portal_claim_attachments
         (submission_id, filename, mime_type, content_base64, byte_size, retain_until, category)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, filename, mime_type, byte_size, retain_until, uploaded_at, category`,
        [sub.id, filename, mimeType || 'application/octet-stream', contentBase64, buf.length, retainUntil.toISOString().slice(0, 10), cat]
    );
    return { ok: true, attachment: rows[0], category: cat };
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

    let hasExpense = false;
    let hasMedical = false;
    for (const items of parsed.itemsByEmployee.values()) {
        for (const it of items) {
            const t = String(it.claim_type || '').toUpperCase();
            if (t === 'EXPENSE') hasExpense = true;
            if (t === 'MEDICAL') hasMedical = true;
        }
    }
    let supportMsg;
    if (hasExpense && hasMedical) {
        supportMsg = 'You entered Expense and Medical claims — you must upload Expense supports and Medical supports as two separate files before Submit to Line Manager.';
    } else if (hasExpense) {
        supportMsg = 'You entered Expense claims — you must upload an Expense supports file before Submit to Line Manager.';
    } else if (hasMedical) {
        supportMsg = 'You entered Medical claims — you must upload a Medical supports file before Submit to Line Manager.';
    } else {
        supportMsg = 'No Expense/Medical rows found — support files are not required. Review the draft, then Submit to Line Manager.';
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
        needsExpenseSupport: hasExpense,
        needsMedicalSupport: hasMedical,
        message: (
            (saveErrors.length
                ? `Imported draft for ${okResults.length} employee(s). Some rows had errors — see details. `
                : `Imported draft for ${okResults.length} employee(s). `)
            + supportMsg
        ),
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
        holidayDates: listGazettedHolidayDates(),
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

async function ensureApproverPacks(pool, periodId, sendAppEmail, { forceEmail = false, reminder = false, onlyApproverEmail = null } = {}) {
    const { rows: pending } = await pool.query(
        `SELECT DISTINCT approver_email FROM portal_claim_submissions
         WHERE period_id = $1 AND status = 'submitted' AND approver_email IS NOT NULL AND TRIM(approver_email) <> ''`,
        [periodId]
    );
    const { rows: periodRows } = await pool.query(`SELECT * FROM portal_claim_periods WHERE id = $1`, [periodId]);
    const period = periodRows[0];
    const results = [];
    const only = onlyApproverEmail ? String(onlyApproverEmail).toLowerCase() : null;

    for (const { approver_email: approverEmail } of pending) {
        if (only && String(approverEmail || '').toLowerCase() !== only) continue;
        const token = stableApproverToken(periodId, approverEmail);
        const tokenHash = hashToken(token);
        const upsertSql = reminder
            ? `INSERT INTO portal_claim_approver_packs (period_id, approver_email, invite_token_hash, invite_sent_at, status)
               VALUES ($1,$2,$3,NOW(),'pending')
               ON CONFLICT (period_id, approver_email) DO UPDATE
                 SET invite_token_hash = EXCLUDED.invite_token_hash,
                     last_reminder_at = NOW(),
                     reminder_count = COALESCE(portal_claim_approver_packs.reminder_count, 0) + 1,
                     status = 'pending'
               RETURNING *`
            : `INSERT INTO portal_claim_approver_packs (period_id, approver_email, invite_token_hash, invite_sent_at, status)
               VALUES ($1,$2,$3,NOW(),'pending')
               ON CONFLICT (period_id, approver_email) DO UPDATE
                 SET invite_token_hash = EXCLUDED.invite_token_hash,
                     invite_sent_at = NOW(),
                     status = 'pending'
               RETURNING *`;
        const { rows: packRows } = await pool.query(upsertSql, [periodId, approverEmail, tokenHash]);
        const link = `${claimsFrontendUrl()}/?asil_claims=approve&token=${token}`;
        const summary = await buildApproverPendingSummary(pool, periodId, approverEmail);
        const shouldEmail = !!sendAppEmail && (forceEmail || APPROVER_NOTIFY_MODE === 'immediate');
        if (shouldEmail && summary.pendingCount > 0) {
            const { rows: pr } = await pool.query(`SELECT * FROM portal_claim_periods WHERE id = $1`, [periodId]);
            const periodRow = pr[0] || period;
            const mail = resolveOutboundEmail(periodRow, approverEmail, { roleLabel: 'Approver' });
            const prefix = reminder
                ? approverReminderBanner(periodRow, APPROVE_CLOSE_DAY)
                : '';
            const subject = reminder
                ? `${sampleSubjectPrefix(periodRow, 'Approver')}Reminder: approve ASIL claims by ${APPROVE_CLOSE_DAY} — payroll needs this`
                : `${sampleSubjectPrefix(periodRow, 'Approver')}ASIL Claims — ${summary.pendingCount} pending for ${period.claim_month}/${period.claim_year}`;
            await sendAppEmail({
                to: mail.to,
                subject,
                html: wrapClaimsHtmlFooter(prefix + sampleBodyBanner(periodRow, approverEmail, 'Approver') + buildApproverInviteHtml({
                    period,
                    count: summary.pendingCount,
                    link,
                    approverEmail,
                    summaryHtml: summary.html,
                })),
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
                p.fill_close_at, p.approve_close_at, p.campaign_mode
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
        byFiller[k].push({
            ...s,
            is_final_review: Number(s.lm_reopen_count || 0) >= 1 && s.status === 'submitted',
        });
    }
    for (const k of Object.keys(byFiller)) {
        byFiller[k].sort((a, b) => {
            if (a.is_final_review !== b.is_final_review) return a.is_final_review ? -1 : 1;
            if (a.status === 'submitted' && b.status !== 'submitted') return -1;
            if (b.status === 'submitted' && a.status !== 'submitted') return 1;
            return String(a.employee_name || '').localeCompare(String(b.employee_name || ''));
        });
    }

    const summaryTotals = computeBatchTotals(
        submissions.filter(s => s.status === 'submitted'),
        items.filter(i => submissions.some(s => s.id === i.submission_id && s.status === 'submitted'))
    );
    const firstPending = submissions.find(s => s.status === 'submitted');
    const packMeta = {
        fromEmail: firstPending?.filler_email || null,
        fromName: firstPending ? (submissions.find(s => s.id === firstPending.id)?.employee_name) : null,
        submittedAt: firstPending?.submitted_at || null,
        claimMonth: pack.claim_month,
        claimYear: pack.claim_year,
    };

    return {
        ok: true,
        pack,
        packMeta,
        summaryTotals,
        period: {
            claim_month: pack.claim_month,
            claim_year: pack.claim_year,
            settlement_month: pack.settlement_month,
            settlement_year: pack.settlement_year,
            approve_close_at: pack.approve_close_at,
            approve_closed: isAfterApproveClose(pack),
            campaign_mode: pack.campaign_mode || 'actual',
            banner: formatPeriodBanner({
                claim_month: pack.claim_month,
                claim_year: pack.claim_year,
                settlement_month: pack.settlement_month,
                settlement_year: pack.settlement_year,
                submit_deadline_day: FILL_CLOSE_DAY,
                approve_deadline_day: APPROVE_CLOSE_DAY,
            }),
        },
        submissions,
        items,
        attachments,
        byFiller,
        completion: {
            total: submissions.length,
            pending: submissions.filter(s => s.status === 'submitted').length,
            final_review: submissions.filter(s => s.status === 'submitted' && Number(s.lm_reopen_count || 0) >= 1).length,
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
        return { ok: false, status: 403, error: `Approval window closed (day ${APPROVE_CLOSE_DAY} of claim month). Contact ASIL operations.` };
    }

    const { rows } = await pool.query(
        `SELECT * FROM portal_claim_submissions WHERE id = $1 AND period_id = $2 AND LOWER(approver_email) = LOWER($3)`,
        [submissionId, pack.period_id, pack.approver_email]
    );
    const sub = rows[0];
    if (!sub) return { ok: false, status: 404, error: 'Submission not found' };
    if (sub.status !== 'submitted') return { ok: false, status: 409, error: `Cannot decide from status ${sub.status}` };

    if (decision === 'rejected') {
        const finalReject = Number(sub.lm_reopen_count || 0) >= 1;
        await pool.query(
            `UPDATE portal_claim_submissions
             SET status = 'rejected', rejected_at = NOW(), approver_comment = $2, updated_at = NOW()
             WHERE id = $1`,
            [submissionId, comment || null]
        );
        await notifyFillerDecision(pool, sendAppEmail, sub, 'rejected', comment, { finalReject });
        return { ok: true, decision: 'rejected', final: finalReject };
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

    await notifyFillerDecision(pool, sendAppEmail, sub, 'approved', comment);
    return {
        ok: true,
        decision: 'approved',
        wrotePayroll: false,
        payrollBlocked: null,
        message: 'Approved — ASIL finance will push to payroll after review.',
    };
}

async function notifyFillerDecision(pool, sendAppEmail, sub, decision, comment, opts = {}) {
    if (!sendAppEmail || !sub.filler_email) return;
    const { rows: pr } = await pool.query(`SELECT campaign_mode FROM portal_claim_periods WHERE id = $1`, [sub.period_id]);
    if (String(pr[0]?.campaign_mode || '').toLowerCase() === 'sample') return;
    const { rows: emp } = await pool.query(`SELECT name FROM employees WHERE id = $1`, [sub.employee_id]);
    const name = emp[0]?.name || sub.employee_id;
    const approved = decision === 'approved';
    const finalReject = !!opts.finalReject;
    await sendAppEmail({
        to: sub.filler_email,
        subject: approved
            ? `ASIL Claims approved — ${name}`
            : finalReject
                ? `ASIL Claims rejected (final) — ${name}`
                : `ASIL Claims rejected — ${name}`,
        html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px;background:#f8fafc;color:#0f172a">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
  <h2 style="margin:0 0 8px;color:#0f172a">${approved ? 'Claim approved' : finalReject ? 'Claim rejected (final)' : 'Claim rejected'}</h2>
  <p style="color:#334155">Employee <strong>${name}</strong> (${sub.employee_id}) was <strong>${decision}</strong> by the Line Manager.</p>
  ${comment ? `<p style="color:#475569">Remark: ${String(comment).replace(/</g, '&lt;')}</p>` : ''}
  <p style="color:#475569">${approved
    ? 'Your Line Manager approved this claim. ASIL finance will add approved amounts to payroll after their review — you do not need to resubmit.'
    : finalReject
        ? 'This was the final Line Manager review after ASIL reopened the claim. No claim will be released for this employee this month.'
        : 'You may correct and re-raise next month (or contact ASIL finance if still within the fill window).'}</p>
  <p style="font-size:12px;color:#94a3b8;margin-top:16px">ASIL HCM</p>
</div></body></html>`,
    }).catch(() => {});
}

async function injectApprovedToEmployeeClaims(pool, sub, items, pack) {
    const { rows: periodRows } = await pool.query(`SELECT * FROM portal_claim_periods WHERE id = $1`, [sub.period_id]);
    const period = periodRows[0];
    if (!canInjectPayroll(period)) {
        return { skipped: true, reason: 'sample_mode', wrotePayroll: false };
    }

    const { rows: empRows } = await pool.query(`SELECT contract_id FROM employees WHERE id = $1`, [sub.employee_id]);
    const policy = await getClaimsPolicy(pool, empRows[0]?.contract_id);
    const month = policy.claims_pay_timing === 'same_month' ? period.claim_month : period.settlement_month;
    const year = policy.claims_pay_timing === 'same_month' ? period.claim_year : period.settlement_year;
    const sourceRef = `portal:${sub.id}`;

    const otItems = items.filter(i => i.claim_type === 'OT');
    const expItems = items.filter(i => i.claim_type === 'EXPENSE');
    const medItems = items.filter(i => i.claim_type === 'MEDICAL');

    const upsertClaim = async (claimType, claimed) => {
        await pool.query(
            `INSERT INTO employee_claims
             (employee_id, claim_type, period_month, period_year, claimed_items, status, focal_email, focal_approved_at,
              source_kind, source_session_id, source_ref)
             VALUES ($1,$2,$3,$4,$5::jsonb,'focal_approved',$6,NOW(),'portal',$7,$8)
             ON CONFLICT (source_kind, source_session_id, employee_id, claim_type)
             WHERE source_kind IS NOT NULL
             DO UPDATE SET
               claimed_items = EXCLUDED.claimed_items,
               focal_approved_at = NOW(),
               updated_at = NOW()
             WHERE employee_claims.status <> 'in_payroll_run'`,
            [sub.employee_id, claimType, month, year, JSON.stringify(claimed), sub.approver_email, sub.id, sourceRef]
        );
    };

    if (otItems.length) {
        const claimed = otItems.map(i => ({
            ot1: Number(i.ot_multiplier_factor) === 1 ? Number(i.ot_hours) : 0,
            ot2: Number(i.ot_multiplier_factor) === 2 ? Number(i.ot_hours) : 0,
            ot3: Number(i.ot_multiplier_factor) === 3 ? Number(i.ot_hours) : 0,
            date: i.claim_date,
        }));
        await upsertClaim('overtime', claimed);
    }
    if (expItems.length) {
        const claimed = expItems.map(i => ({ amount: Number(i.amount), description: i.description, date: i.claim_date }));
        await upsertClaim('expense', claimed);
    }
    if (medItems.length) {
        const claimed = medItems.map(i => ({ amount: Number(i.amount), description: i.description, date: i.claim_date }));
        await upsertClaim('medical', claimed);
    }

    const portal = portalAmountsFromItems(items);
    const payWrite = await writePortalAmountsToSheet(pool, {
        employeeId: sub.employee_id,
        month,
        year,
        portal,
    });
    return payWrite;
}

async function importIfSheetEmpty(pool, { employeeId, workMonth, workYear }) {
    const { rows: subs } = await pool.query(
        `SELECT s.*, p.campaign_mode, p.claim_month, p.claim_year, p.settlement_month, p.settlement_year
         FROM portal_claim_submissions s
         JOIN portal_claim_periods p ON p.id = s.period_id
         WHERE s.employee_id = $1 AND p.claim_month = $2 AND p.claim_year = $3
           AND s.status IN ('approved','in_payroll')
         ORDER BY CASE WHEN p.campaign_mode = 'sample' THEN 1 ELSE 0 END, s.id DESC
         LIMIT 1`,
        [employeeId, parseInt(workMonth, 10), parseInt(workYear, 10)]
    );
    const sub = subs[0];
    if (!sub) return { ok: false, status: 404, error: 'No approved portal claim for this person and work month' };
    if (String(sub.campaign_mode || '').toLowerCase() === 'sample') {
        return { ok: false, status: 409, error: 'SAMPLE claims never write to the Payroll Sheet' };
    }
    const { rows: items } = await pool.query(
        `SELECT * FROM portal_claim_items WHERE submission_id = $1 AND active = TRUE`,
        [sub.id]
    );
    const { rows: empRows } = await pool.query(`SELECT contract_id FROM employees WHERE id = $1`, [sub.employee_id]);
    const policy = await getClaimsPolicy(pool, empRows[0]?.contract_id);
    const month = policy.claims_pay_timing === 'same_month' ? sub.claim_month : sub.settlement_month;
    const year = policy.claims_pay_timing === 'same_month' ? sub.claim_year : sub.settlement_year;
    const portal = portalAmountsFromItems(items);
    const payWrite = await writePortalAmountsToSheet(pool, {
        employeeId: sub.employee_id,
        month,
        year,
        portal,
    });
    if (payWrite.blocked === 'SHEET_HAS_OTHER_DATA') {
        return {
            ok: false,
            status: 409,
            code: 'SHEET_HAS_OTHER_DATA',
            error: 'Payroll Sheet already has OT, medical, or expense. Verify those numbers, then use Manual add.',
            before: payWrite.before,
            portal,
        };
    }
    if (payWrite.blocked === 'PAYROLL_LOCKED') {
        return {
            ok: false,
            status: 409,
            code: 'PAYROLL_LOCKED',
            error: 'This Payroll Sheet month is locked.',
            before: payWrite.before,
            portal,
        };
    }
    if (payWrite.wrotePayroll) {
        await pool.query(
            `UPDATE portal_claim_submissions SET status = 'in_payroll', updated_at = NOW() WHERE id = $1`,
            [sub.id]
        );
    }
    return { ok: true, wrotePayroll: !!payWrite.wrotePayroll, portal, month, year };
}

const { formatClaimSummary } = require('./claimsDesk');

function buildAugustReopenEmailHtml({ period, subs, itemsBySub, link, approverEmail }) {
    const rows = (subs || []).map((sub) => {
        const items = itemsBySub.get(sub.id) || [];
        const portal = portalAmountsFromItems(items);
        const summary = formatClaimSummary(portal);
        return `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">${sub.employee_name || sub.employee_id}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0">${summary}</td>
        </tr>`;
    }).join('');
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden">
  <tr><td style="background:#7c2d12;color:#fff;padding:22px 28px">
    <div style="font-size:13px;opacity:.9;letter-spacing:.04em;text-transform:uppercase">ASIL HCM · Final review</div>
    <div style="font-size:22px;font-weight:700;margin-top:4px">Claims reopened for one final approval</div>
  </td></tr>
  <tr><td style="padding:28px">
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#334155">
      You previously rejected the claims below for claim month <strong>${period.claim_month}/${period.claim_year}</strong>.
      As requested, ASIL has reopened them for <strong>one final review</strong>.
    </p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px 14px">
      Please approve or reject by <strong>27 August 2026</strong>. If you reject again, this will be treated as final and <strong>no claim will be released</strong> for that employee this month.
    </p>
    <table width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;font-size:14px">
      <thead><tr>
        <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Employee</th>
        <th align="left" style="padding:8px 10px;border-bottom:2px solid #cbd5e1">Claim summary</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:22px 0 18px">
      <a href="${link}" style="display:inline-block;background:#15803d;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">Open approval pack</a>
    </p>
    <p style="margin:0;font-size:12px;color:#64748b;word-break:break-all">${link}</p>
    <p style="margin:18px 0 0;font-size:13px;color:#475569">
      Questions? Email <a href="mailto:ops-support@asil.com.pk" style="color:#1d4ed8">ops-support@asil.com.pk</a>.
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#94a3b8">Sent to ${approverEmail} · ASIL HCM</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

async function pushSelectedToPayroll(pool, opts, actorEmail) {
    const employeeIds = Array.isArray(opts.employeeIds)
        ? opts.employeeIds.map((x) => String(x)).filter(Boolean)
        : [];
    const workMonth = parseInt(opts.workMonth, 10);
    const workYear = parseInt(opts.workYear, 10);
    const dryRun = !!opts.dryRun;
    if (!employeeIds.length) return { ok: false, status: 400, error: 'employeeIds required' };
    if (!workMonth || !workYear) return { ok: false, status: 400, error: 'workMonth and workYear required' };

    const results = [];
    for (const employeeId of employeeIds) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: subs } = await client.query(
                `SELECT s.*, p.campaign_mode, p.claim_month, p.claim_year, p.settlement_month, p.settlement_year
                 FROM portal_claim_submissions s
                 JOIN portal_claim_periods p ON p.id = s.period_id
                 WHERE s.employee_id = $1 AND p.claim_month = $2 AND p.claim_year = $3
                   AND COALESCE(p.campaign_mode, 'actual') <> 'sample'
                 ORDER BY s.id DESC
                 LIMIT 1`,
                [employeeId, workMonth, workYear]
            );
            const sub = subs[0];
            if (!sub) {
                await client.query('ROLLBACK');
                results.push({ employee_id: employeeId, outcome: 'not_found', ok: false });
                continue;
            }
            if (sub.status === 'in_payroll' || sub.payroll_pushed_at) {
                await client.query('ROLLBACK');
                results.push({ employee_id: employeeId, outcome: 'already_sent', ok: true, submission_id: sub.id });
                continue;
            }
            if (sub.status !== 'approved') {
                await client.query('ROLLBACK');
                results.push({
                    employee_id: employeeId,
                    outcome: 'not_ready',
                    ok: false,
                    status: sub.status,
                    submission_id: sub.id,
                });
                continue;
            }
            const { rows: items } = await client.query(
                `SELECT * FROM portal_claim_items WHERE submission_id = $1 AND active = TRUE`,
                [sub.id]
            );
            const portal = portalAmountsFromItems(items);
            const { rows: empRows } = await client.query(`SELECT contract_id FROM employees WHERE id = $1`, [sub.employee_id]);
            const policy = await getClaimsPolicy(client, empRows[0]?.contract_id);
            const month = policy.claims_pay_timing === 'same_month' ? sub.claim_month : sub.settlement_month;
            const year = policy.claims_pay_timing === 'same_month' ? sub.claim_year : sub.settlement_year;
            const { rows: sheetRows } = await client.query(
                `SELECT ot2_hrs, ot3_hrs, opd_claim, reimbursement, locked
                 FROM payroll_transactions WHERE employee_id = $1 AND month = $2 AND year = $3`,
                [sub.employee_id, month, year]
            );
            const sheetRow = sheetRows[0] || {};
            if (sheetRow.locked) {
                await client.query('ROLLBACK');
                results.push({
                    employee_id: employeeId,
                    outcome: 'payroll_locked',
                    ok: false,
                    submission_id: sub.id,
                });
                continue;
            }
            if (sheetHasValues(sheetRow)) {
                await client.query('ROLLBACK');
                results.push({
                    employee_id: employeeId,
                    outcome: 'needs_review',
                    ok: false,
                    code: 'SHEET_HAS_OTHER_DATA',
                    submission_id: sub.id,
                    portal,
                });
                continue;
            }
            if (dryRun) {
                await client.query('ROLLBACK');
                results.push({
                    employee_id: employeeId,
                    outcome: 'ready',
                    ok: true,
                    submission_id: sub.id,
                    portal,
                    month,
                    year,
                });
                continue;
            }
            const pack = { period_id: sub.period_id, approver_email: sub.approver_email };
            const inject = await injectApprovedToEmployeeClaims(client, sub, items, pack);
            if (inject.blocked === 'SHEET_HAS_OTHER_DATA') {
                await client.query('ROLLBACK');
                results.push({
                    employee_id: employeeId,
                    outcome: 'needs_review',
                    ok: false,
                    code: 'SHEET_HAS_OTHER_DATA',
                    submission_id: sub.id,
                });
                continue;
            }
            if (inject.blocked === 'PAYROLL_LOCKED') {
                await client.query('ROLLBACK');
                results.push({
                    employee_id: employeeId,
                    outcome: 'payroll_locked',
                    ok: false,
                    submission_id: sub.id,
                });
                continue;
            }
            await client.query(
                `UPDATE portal_claim_submissions
                 SET status = 'in_payroll', payroll_pushed_at = NOW(), payroll_pushed_by = $2, updated_at = NOW()
                 WHERE id = $1`,
                [sub.id, actorEmail || 'asil']
            );
            await client.query('COMMIT');
            results.push({
                employee_id: employeeId,
                outcome: inject.wrotePayroll ? 'sent' : 'nothing_to_write',
                ok: true,
                submission_id: sub.id,
                wrotePayroll: !!inject.wrotePayroll,
                month,
                year,
            });
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            results.push({ employee_id: employeeId, outcome: 'error', ok: false, error: 'push_failed' });
            console.error('[portalClaims.pushSelectedToPayroll]', employeeId, err);
        } finally {
            client.release();
        }
    }

    const summary = {
        requested: employeeIds.length,
        sent: results.filter((r) => r.outcome === 'sent').length,
        already_sent: results.filter((r) => r.outcome === 'already_sent').length,
        needs_review: results.filter((r) => r.outcome === 'needs_review').length,
        not_ready: results.filter((r) => r.outcome === 'not_ready').length,
        ready: results.filter((r) => r.outcome === 'ready').length,
        errors: results.filter((r) => r.outcome === 'error').length,
    };
    return { ok: true, dryRun, results, summary };
}

async function reopenAugustRejectedOnce(pool, sendAppEmail, opts = {}) {
    const workMonth = parseInt(opts.workMonth || 7, 10);
    const workYear = parseInt(opts.workYear || 2026, 10);
    const dryRun = !!opts.dryRun;
    const force = !!opts.force;

    const { rows: periods } = await pool.query(
        `SELECT * FROM portal_claim_periods
         WHERE claim_month = $1 AND claim_year = $2
           AND COALESCE(campaign_mode, 'actual') <> 'sample'`,
        [workMonth, workYear]
    );
    const period = periods[0];
    if (!period) return { ok: false, status: 404, error: 'No ACTUAL portal-claims period for this work month' };

    if (period.august_reopen_ran_at && !force) {
        return {
            ok: true,
            skipped: true,
            reason: 'already_ran',
            ran_at: period.august_reopen_ran_at,
            period_id: period.id,
        };
    }

    const { rows: rejected } = await pool.query(
        `SELECT s.*, e.name AS employee_name
         FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id
         WHERE s.period_id = $1 AND s.status = 'rejected'
           AND COALESCE(s.lm_reopen_count, 0) = 0
         ORDER BY e.name`,
        [period.id]
    );

    if (!rejected.length) {
        return { ok: true, reopened: 0, emailsSent: [], period_id: period.id, message: 'No LM-rejected claims to reopen' };
    }

    const subIds = rejected.map((s) => s.id);
    const { rows: itemRows } = subIds.length
        ? await pool.query(
            `SELECT submission_id, claim_type, ot_hours, ot_multiplier_factor, amount
             FROM portal_claim_items WHERE submission_id = ANY($1::int[]) AND active = TRUE`,
            [subIds]
        )
        : { rows: [] };
    const itemsBySub = new Map();
    for (const i of itemRows) {
        if (!itemsBySub.has(i.submission_id)) itemsBySub.set(i.submission_id, []);
        itemsBySub.get(i.submission_id).push(i);
    }

    if (dryRun) {
        const byLm = {};
        for (const sub of rejected) {
            const lm = String(sub.approver_email || '').trim().toLowerCase();
            if (!lm) continue;
            byLm[lm] = (byLm[lm] || 0) + 1;
        }
        return {
            ok: true,
            dryRun: true,
            wouldReopen: rejected.length,
            approverEmails: Object.keys(byLm),
            byLm,
            period_id: period.id,
        };
    }

    await pool.query(
        `UPDATE portal_claim_submissions
         SET status = 'submitted', rejected_at = NULL, lm_reopen_count = 1,
             lm_reopen_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1::int[])`,
        [subIds]
    );

    const grouped = new Map();
    for (const sub of rejected) {
        const lm = String(sub.approver_email || '').trim().toLowerCase();
        if (!lm) continue;
        if (!grouped.has(lm)) grouped.set(lm, []);
        grouped.get(lm).push(sub);
    }

    const emailsSent = [];
    for (const [lm, subs] of grouped.entries()) {
        const token = stableApproverToken(period.id, lm);
        const link = `${claimsFrontendUrl()}/?asil_claims=approve&token=${token}`;
        if (sendAppEmail) {
            const mail = resolveOutboundEmail(period, lm, { roleLabel: 'Approver reopen' });
            await sendAppEmail({
                to: mail.to,
                subject: `${sampleSubjectPrefix(period, 'Final review')}You rejected these claims — one final review by 27 August`,
                html: wrapClaimsHtmlFooter(sampleBodyBanner(period, lm, 'Approver final review') + buildAugustReopenEmailHtml({
                    period,
                    subs,
                    itemsBySub,
                    link,
                    approverEmail: lm,
                })),
            }).catch((err) => {
                console.error('[portalClaims.reopenAugustRejectedOnce]', lm, err);
            });
        }
        await pool.query(
            `UPDATE portal_claim_submissions SET lm_reopen_email_at = NOW()
             WHERE id = ANY($1::int[])`,
            [subs.map((s) => s.id)]
        );
        await ensureApproverPacks(pool, period.id, null, { forceEmail: false }).catch(() => {});
        emailsSent.push({ approver_email: lm, count: subs.length, link });
    }

    await pool.query(
        `UPDATE portal_claim_periods SET august_reopen_ran_at = NOW() WHERE id = $1`,
        [period.id]
    );

    return {
        ok: true,
        reopened: rejected.length,
        emailsSent,
        period_id: period.id,
    };
}

async function getResponseBoard(pool, query) {
    return listResponseBoard(pool, countEligibleEmployees, query);
}

function wrapChaseSampleSend(sendAppEmail) {
    const dest = process.env.CLAIMS_SAMPLE_EMAIL;
    return async (msg) => {
        const period = { campaign_mode: 'sample' };
        return sendAppEmail({
            ...msg,
            to: dest,
            subject: `${sampleSubjectPrefix(period, 'Chase')}${msg.subject || ''}`,
            html: sampleBodyBanner(period, msg.to, 'Chase') + (msg.html || ''),
        });
    };
}

async function chaseDeskAction(pool, opts, sendAppEmail, sendJazzSMS = null) {
    const action = String(opts.action || '');
    if (!['invite', 'remind', 'remind_filler', 'remind_approver'].includes(action)) {
        return { ok: false, status: 400, error: 'action must be invite, remind, remind_filler, or remind_approver' };
    }
    const employeeIds = Array.isArray(opts.employeeIds)
        ? opts.employeeIds.map((x) => String(x)).filter(Boolean)
        : [];
    if (!employeeIds.length) return { ok: false, status: 400, error: 'employeeIds required' };

    const mode = String(opts.campaignMode || 'sample').toLowerCase() === 'actual' ? 'actual' : 'sample';
    const preview = !!opts.preview;
    if (!preview && mode === 'actual' && process.env.CLAIMS_ALLOW_ACTUAL_SEND !== 'true') {
        return {
            ok: false,
            status: 403,
            error: 'ACTUAL campaigns are blocked until MD sign-off. Use campaignMode "sample" for testing.',
        };
    }
    if (!preview && mode === 'sample' && !process.env.CLAIMS_SAMPLE_EMAIL) {
        return { ok: false, status: 500, error: 'CLAIMS_SAMPLE_EMAIL is not configured on this server.' };
    }

    const board = await getResponseBoard(pool, {
        workMonth: opts.workMonth,
        workYear: opts.workYear,
        payMonth: opts.payMonth,
        payYear: opts.payYear,
        client: opts.client || '',
        contract: opts.contract || '',
        location: opts.location || '',
        dept: opts.dept || '',
    });
    if (!board.ok) return board;

    const wanted = new Set(employeeIds);
    const people = (board.people || []).filter((p) => wanted.has(String(p.employee_id)));
    const plan = action === 'remind'
        ? planSmartReminder({ people, force: !!opts.force })
        : planChase({ people, action, force: !!opts.force });
    const result = {
        ok: true,
        preview,
        action,
        campaignMode: mode,
        send_count: plan.send.length,
        skipped: plan.skipped,
        targets: plan.targets,
        sent: [],
    };
    if (preview || !plan.send.length) return result;

    const sender = mode === 'sample' ? wrapChaseSampleSend(sendAppEmail) : sendAppEmail;

    if (action === 'invite') {
        const existing = await findPeriodForUi(pool, opts.workMonth, opts.workYear);
        const periodMode = existing
            ? (String(existing.campaign_mode || '').toLowerCase() === 'sample' ? 'sample' : 'actual')
            : mode;
        const campaign = await createCampaign(pool, {
            claimMonth: parseInt(opts.workMonth, 10),
            claimYear: parseInt(opts.workYear, 10),
            sendAppEmail: sender,
            dryRun: false,
            onlyEmployeeIds: plan.send.map((p) => p.employee_id),
            campaignMode: periodMode,
        });
        result.sent = (campaign.invites || []).map((i) => ({
            to: i.to || i.fillerEmail || i.mailTo,
            ok: i.ok !== false,
            error: i.error || null,
        }));
        result.campaign = {
            fillerCount: campaign.fillerCount,
            employeeCount: campaign.employeeCount,
        };
        return result;
    }

    if (action === 'remind') {
        for (const fb of plan.filler_batches || []) {
            const { rows } = await pool.query(
                `SELECT b.*, p.claim_month, p.claim_year, p.settlement_month, p.settlement_year,
                        p.fill_close_at, p.approve_close_at, p.campaign_mode
                 FROM portal_claim_batches b
                 JOIN portal_claim_periods p ON p.id = b.period_id
                 WHERE b.id = $1`,
                [fb.batch_id]
            );
            if (!rows[0]) continue;
            const r = await sendFillerBatchReminder(pool, rows[0], sender, sendJazzSMS, { skipDueCheck: true });
            result.sent.push({
                route: 'filler',
                batch_id: fb.batch_id,
                to: fb.email,
                ok: !!r.ok,
                error: r.error || null,
            });
        }
        for (const ap of plan.approver_packs || []) {
            const r = await sendApproverPeriodReminder(pool, ap.period_id, ap.email, sender, sendJazzSMS, { skipDueCheck: true });
            result.sent.push({
                route: 'approver',
                period_id: ap.period_id,
                to: ap.email,
                ok: !!r.ok,
                count: r.count || 0,
                error: r.error || null,
            });
        }
        return result;
    }

    if (action === 'remind_filler') {
        const batchIds = [...new Set(plan.send.map((p) => p.batch_id).filter(Boolean))];
        for (const batchId of batchIds) {
            const r = await resendFillerInvite(pool, batchId, sender);
            if (r.ok) {
                await pool.query(
                    `UPDATE portal_claim_batches
                     SET last_reminder_at = NOW(), reminder_count = COALESCE(reminder_count, 0) + 1
                     WHERE id = $1`,
                    [batchId]
                );
            }
            result.sent.push({
                batch_id: batchId,
                to: r.fillerEmail,
                ok: !!r.ok,
                error: r.error || null,
            });
        }
        return result;
    }

    const periodIds = [...new Set(plan.send.map((p) => p.period_id).filter(Boolean))];
    const wantedApprovers = new Set(plan.targets.map((t) => String(t.email || '').toLowerCase()));
    for (const periodId of periodIds) {
        const packs = await ensureApproverPacks(pool, periodId, sender, { forceEmail: true, reminder: true });
        for (const pack of packs) {
            if (!wantedApprovers.has(String(pack.approverEmail || '').toLowerCase())) continue;
            result.sent.push({
                to: pack.approverEmail,
                ok: true,
                count: pack.count,
            });
        }
    }
    return result;
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

function roundHrs(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
}

async function applyPortalCorrection(pool, sendAppEmail, {
    employeeId,
    workMonth,
    workYear,
    ot1Hours = 0,
    ot2Hours = 0,
    ot3Hours = 0,
    expenseAmount = 0,
    medicalAmount = 0,
    reason,
    createdBy,
    dryRun = false,
}) {
    if (!reason || !String(reason).trim()) return { ok: false, status: 400, error: 'Reason is required' };
    const wm = parseInt(workMonth, 10);
    const wy = parseInt(workYear, 10);
    if (!employeeId || !wm || !wy) {
        return { ok: false, status: 400, error: 'employeeId, workMonth, and workYear are required' };
    }

    const { rows: empRows } = await pool.query(`SELECT * FROM employees WHERE id = $1`, [employeeId]);
    if (!empRows.length) return { ok: false, status: 404, error: 'Employee not found' };
    const emp = empRows[0];
    const approverEmail = resolveApproverEmail(emp);
    const period = await getOrCreatePeriodForClaimMonth(pool, wm, wy);
    const { rows: subRows } = await pool.query(
        `SELECT * FROM portal_claim_submissions WHERE period_id = $1 AND employee_id = $2`,
        [period.id, employeeId]
    );
    const sub = subRows[0] || null;
    const o1 = roundHrs(ot1Hours);
    const o2 = roundHrs(ot2Hours);
    const o3 = roundHrs(ot3Hours);
    const exp = Math.round((Number(expenseAmount) || 0) * 100) / 100;
    const med = Math.round((Number(medicalAmount) || 0) * 100) / 100;
    const claimDate = `${wy}-${String(wm).padStart(2, '0')}-28`;
    const correctionNote = `[ASIL correction] ${String(reason).trim()}`;

    if (dryRun) {
        return {
            ok: true,
            dryRun: true,
            path: 'portal',
            resubmitToLm: true,
            approverEmail: approverEmail || null,
            before: sub ? { status: sub.status, channel: sub.channel } : null,
            after: {
                status: 'submitted',
                ot1Hours: o1,
                ot2Hours: o2,
                ot3Hours: o3,
                expenseAmount: exp,
                medicalAmount: med,
            },
            warning: approverEmail
                ? `Will email ${approverEmail} for Line Manager re-approval.`
                : 'No Line Manager on file — correction will wait for ASIL review.',
        };
    }

    let submissionId = sub?.id;
    if (!submissionId) {
        const { rows: ins } = await pool.query(
            `INSERT INTO portal_claim_submissions
             (period_id, employee_id, filler_email, approver_email, status, channel)
             VALUES ($1,$2,$3,$4,'draft','admin_correction')
             RETURNING id`,
            [period.id, employeeId, createdBy || 'asil-correction', approverEmail || null]
        );
        submissionId = ins[0].id;
    }

    await pool.query(`UPDATE portal_claim_items SET active = FALSE WHERE submission_id = $1`, [submissionId]);

    const inserts = [];
    if (o1 > 0) inserts.push(['OT', o1, 'Single', 1]);
    if (o2 > 0) inserts.push(['OT', o2, 'Double', 2]);
    if (o3 > 0) inserts.push(['OT', o3, 'Triple', 3]);
    if (exp > 0) inserts.push(['EXPENSE', exp, null, null]);
    if (med > 0) inserts.push(['MEDICAL', med, null, null]);

    for (const [claimType, val, multLabel, factor] of inserts) {
        if (claimType === 'OT') {
            await pool.query(
                `INSERT INTO portal_claim_items
                 (submission_id, claim_type, claim_date, ot_hours, ot_multiplier, ot_multiplier_factor, active, description)
                 VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)`,
                [submissionId, claimType, claimDate, val, multLabel, factor, correctionNote]
            );
        } else {
            await pool.query(
                `INSERT INTO portal_claim_items
                 (submission_id, claim_type, claim_date, amount, active, description)
                 VALUES ($1,$2,$3,$4,TRUE,$5)`,
                [submissionId, claimType, claimDate, val, correctionNote]
            );
        }
    }

    await pool.query(
        `UPDATE portal_claim_submissions
         SET status = 'submitted',
             approved_at = NULL,
             rejected_at = NULL,
             submitted_at = NOW(),
             channel = 'admin_correction',
             filler_email = COALESCE(NULLIF($2, ''), filler_email),
             approver_email = COALESCE(NULLIF($3, ''), approver_email),
             updated_at = NOW()
         WHERE id = $1`,
        [submissionId, createdBy || 'asil-correction', approverEmail || null]
    );

    let lmNotified = false;
    if (approverEmail && sendAppEmail) {
        const packs = await ensureApproverPacks(pool, period.id, sendAppEmail, {
            forceEmail: true,
            onlyApproverEmail: approverEmail,
        });
        lmNotified = (packs || []).some((p) => p.count > 0);
    }

    return {
        ok: true,
        path: 'portal',
        resubmitToLm: true,
        submissionId,
        approverEmail: approverEmail || null,
        lmNotified,
        message: lmNotified
            ? `Correction saved and sent to ${approverEmail} for re-approval.`
            : 'Correction saved — waiting for Line Manager approval.',
    };
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
        `SELECT * FROM portal_claim_periods WHERE status = 'open'`
    );
    let updated = 0;
    for (const p of periods) {
        if (!isAfterFillClose(p)) continue;
        const { rows } = await pool.query(
            `UPDATE portal_claim_submissions s
             SET status = 'no_claims',
                 no_claims_kind = 'auto_closed',
                 submitted_at = COALESCE(submitted_at, NOW()),
                 updated_at = NOW()
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

async function sendFillerBatchReminder(pool, batchRow, sendAppEmail, sendJazzSMS = null, { skipDueCheck = false } = {}) {
    const b = batchRow;
    if (!skipDueCheck && !isDueForReminder(b.last_reminder_at, b.invite_sent_at)) {
        return { ok: false, reason: 'not_due' };
    }
    const token = stableFillerToken(b.period_id, b.filler_email);
    const { rows: emps } = await pool.query(
        `SELECT s.employee_id AS id, e.name FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id WHERE s.batch_id = $1 ORDER BY e.name`,
        [b.id]
    );
    const link = `${claimsFrontendUrl()}/?asil_claims=fill&token=${token}`;
    const period = {
        claim_month: b.claim_month,
        claim_year: b.claim_year,
        settlement_month: b.settlement_month,
        settlement_year: b.settlement_year,
        campaign_mode: b.campaign_mode,
    };
    const submitDay = closeDayFromTimestamp(b.fill_close_at, FILL_CLOSE_DAY);
    const mail = resolveOutboundEmail(period, b.filler_email, { roleLabel: 'Focal reminder' });
    if (sendAppEmail) {
        await sendAppEmail({
            to: mail.to,
            subject: `${sampleSubjectPrefix(period, 'Reminder')}${isJuly2026TrialPeriod(period) ? 'Reminder (trial): please test the claims portal by ' + submitDay : 'Reminder: ASIL claims due by ' + submitDay + ' — payroll needs this'}`,
            html: wrapClaimsHtmlFooter(
                fillerReminderBanner(period, submitDay)
                + sampleBodyBanner(period, b.filler_email, 'Focal reminder')
                + buildFillerInviteHtml({
                    period: b,
                    employeeCount: emps.length,
                    link,
                    fillerEmail: b.filler_email,
                    employees: emps,
                })
            ),
        }).catch((err) => {
            console.error('[portalClaims.sendFillerBatchReminder]', err);
        });
    }
    await pool.query(
        `UPDATE portal_claim_batches
         SET reminder_count = COALESCE(reminder_count, 0) + 1, last_reminder_at = NOW()
         WHERE id = $1`,
        [b.id]
    );
    let sms = null;
    if (sendJazzSMS && !mail.sample) {
        const phone = await lookupPhoneForEmail(pool, b.filler_email);
        if (phone) {
            const text = buildSmartReminderSms({ target: 'filler', period, submitDay }).slice(0, 160);
            sms = await sendJazzSMS(phone, text).catch(() => ({ ok: false }));
        }
    }
    return { ok: true, fillerEmail: b.filler_email, sms };
}

async function sendApproverPeriodReminder(pool, periodId, approverEmail, sendAppEmail, sendJazzSMS = null, { skipDueCheck = false } = {}) {
    if (!skipDueCheck) {
        const { rows: packRows } = await pool.query(
            `SELECT invite_sent_at, last_reminder_at FROM portal_claim_approver_packs
             WHERE period_id = $1 AND LOWER(approver_email) = LOWER($2)`,
            [periodId, approverEmail]
        );
        const pack = packRows[0];
        if (pack && !isDueForReminder(pack.last_reminder_at, pack.invite_sent_at)) {
            return { ok: false, reason: 'not_due', count: 0 };
        }
    }
    const packs = await ensureApproverPacks(pool, periodId, sendAppEmail, {
        forceEmail: true,
        reminder: true,
        onlyApproverEmail: approverEmail,
    });
    const pack = packs.find((p) => String(p.approverEmail || '').toLowerCase() === String(approverEmail).toLowerCase());
    if (!pack || pack.count < 1) return { ok: false, count: 0 };
    let sms = null;
    if (sendJazzSMS) {
        const { rows: pr } = await pool.query(`SELECT * FROM portal_claim_periods WHERE id = $1`, [periodId]);
        const period = pr[0] || {};
        const phone = await lookupPhoneForEmail(pool, approverEmail);
        if (phone) {
            const approveDay = closeDayFromTimestamp(period.approve_close_at, APPROVE_CLOSE_DAY);
            const text = buildSmartReminderSms({
                target: 'approver',
                period,
                approveDay,
                pendingCount: pack.count,
            }).slice(0, 160);
            sms = await sendJazzSMS(phone, text).catch(() => ({ ok: false }));
        }
    }
    return { ok: true, count: pack.count, sms };
}

async function sendReminders(pool, sendAppEmail, sendJazzSMS = null) {
    const results = {
        filler: 0,
        approver: 0,
        sms_sent: 0,
        sms_skipped: 0,
        skipped_not_due: 0,
    };

    const { rows: batches } = await pool.query(
        `SELECT b.*, p.claim_month, p.claim_year, p.settlement_month, p.settlement_year,
                p.fill_close_at, p.approve_close_at, p.campaign_mode
         FROM portal_claim_batches b
         JOIN portal_claim_periods p ON p.id = b.period_id
         WHERE (p.fill_close_at > NOW() OR (p.claim_month = 7 AND p.claim_year = 2026))
           AND COALESCE(p.campaign_mode, 'actual') <> 'sample'
           AND b.invite_delivered = TRUE
           AND EXISTS (
             SELECT 1 FROM portal_claim_submissions s
             WHERE s.batch_id = b.id AND s.status IN ('invited', 'draft', 'in_progress')
           )`
    );

    for (const b of batches) {
        if (!isDueForReminder(b.last_reminder_at, b.invite_sent_at)) {
            results.skipped_not_due += 1;
            continue;
        }
        const r = await sendFillerBatchReminder(pool, b, sendAppEmail, sendJazzSMS);
        if (r.ok) {
            results.filler += 1;
            if (r.sms && r.sms.ok !== false) results.sms_sent += 1;
            else if (sendJazzSMS) results.sms_skipped += 1;
        }
    }

    const { rows: approverRows } = await pool.query(
        `SELECT DISTINCT s.approver_email, s.period_id,
                p.claim_month, p.claim_year, p.settlement_month, p.settlement_year,
                p.approve_close_at, p.campaign_mode,
                a.invite_sent_at AS pack_sent_at,
                a.last_reminder_at AS pack_last_reminder
         FROM portal_claim_submissions s
         JOIN portal_claim_periods p ON p.id = s.period_id
         LEFT JOIN portal_claim_approver_packs a
           ON a.period_id = s.period_id AND LOWER(a.approver_email) = LOWER(s.approver_email)
         WHERE s.status = 'submitted'
           AND (p.approve_close_at > NOW() OR (p.claim_month = 7 AND p.claim_year = 2026))
           AND COALESCE(p.campaign_mode, 'actual') <> 'sample'
           AND s.approver_email IS NOT NULL AND TRIM(s.approver_email) <> ''`
    );

    const seenApprovers = new Set();
    for (const row of approverRows) {
        const key = `${row.period_id}:${String(row.approver_email).toLowerCase()}`;
        if (seenApprovers.has(key)) continue;
        seenApprovers.add(key);
        if (!isDueForReminder(row.pack_last_reminder, row.pack_sent_at)) {
            results.skipped_not_due += 1;
            continue;
        }
        const r = await sendApproverPeriodReminder(pool, row.period_id, row.approver_email, sendAppEmail, sendJazzSMS);
        if (r.ok && r.count > 0) {
            results.approver += 1;
            if (r.sms && r.sms.ok !== false) results.sms_sent += 1;
            else if (sendJazzSMS) results.sms_skipped += 1;
        }
    }

    return results;
}

async function resendFillerInvite(pool, batchId, sendAppEmail) {
    const { rows } = await pool.query(
        `SELECT b.*, p.claim_month, p.claim_year, p.campaign_mode FROM portal_claim_batches b
         JOIN portal_claim_periods p ON p.id = b.period_id WHERE b.id = $1`,
        [batchId]
    );
    if (!rows[0]) return { ok: false, error: 'Batch not found' };
    const b = rows[0];
    const token = stableFillerToken(b.period_id, b.filler_email);
    await pool.query(
        `UPDATE portal_claim_batches
         SET invite_sent_at = NOW(), invite_delivered = TRUE WHERE id = $1`,
        [batchId]
    );
    const { rows: emps } = await pool.query(
        `SELECT s.employee_id AS id, e.name FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id WHERE s.batch_id = $1 ORDER BY e.name`,
        [batchId]
    );
    const link = `${claimsFrontendUrl()}/?asil_claims=fill&token=${token}`;
    if (sendAppEmail) {
        const period = { claim_month: b.claim_month, claim_year: b.claim_year, campaign_mode: b.campaign_mode };
        const mail = resolveOutboundEmail(period, b.filler_email, { roleLabel: 'Focal resend' });
        await sendAppEmail({
            to: mail.to,
            subject: `${sampleSubjectPrefix(period, 'resend')}ASIL Claims link (resent) — due day ${FILL_CLOSE_DAY}`,
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

async function sendSubmitRecordEmail(pool, sendAppEmail, batch, period) {
    if (!sendAppEmail || !shouldSendRecordEmail(period)) return;
    const { rows: subs } = await pool.query(
        `SELECT s.*, e.name AS employee_name FROM portal_claim_submissions s
         JOIN employees e ON e.id = s.employee_id WHERE s.batch_id = $1 AND s.status = 'submitted'`,
        [batch.id]
    );
    if (!subs.length) return;
    const ids = subs.map(s => s.id);
    const { rows: items } = await pool.query(
        `SELECT * FROM portal_claim_items WHERE submission_id = ANY($1::int[]) AND active = TRUE`, [ids]
    );
    const review = computeBatchTotals(subs, items);
    const mail = resolveOutboundEmail(period, batch.filler_email, { roleLabel: 'Focal record' });
    const dest = isFinalSubmitProfile(batch.routing_profile) ? 'You are final — no further approval.' : `Submitted to: ${subs[0]?.approver_email || 'Line Manager'}`;
    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:20px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px;border:1px solid #e2e8f0">
<h2>Claims submission record</h2>
<p>Claim month <strong>${period.claim_month}/${period.claim_year}</strong></p>
<p>OT hours: <strong>${review.totals.otHours}</strong> · Expense: <strong>PKR ${review.totals.expense}</strong> · Medical: <strong>PKR ${review.totals.medical}</strong></p>
<p>${dest}</p>
<p style="font-size:12px;color:#94a3b8">ASIL HCM — keep this for your records</p>
</div></body></html>`;
    await sendAppEmail({
        to: mail.to,
        subject: `${sampleSubjectPrefix(period, 'record')}ASIL Claims submitted — ${period.claim_month}/${period.claim_year}`,
        html: sampleBodyBanner(period, batch.filler_email, 'Focal record') + html,
    }).catch(() => {});
}

async function autoApproveSelfFinal(pool, batch, sendAppEmail) {
    if (!isFinalSubmitProfile(batch.routing_profile)) return { autoApproved: 0 };
    const { rows: subs } = await pool.query(
        `SELECT * FROM portal_claim_submissions WHERE batch_id = $1 AND status = 'submitted'`,
        [batch.id]
    );
    let count = 0;
    for (const sub of subs) {
        const { rows: items } = await pool.query(
            `SELECT * FROM portal_claim_items WHERE submission_id = $1 AND active = TRUE`, [sub.id]
        );
        const snapshot = { items, decided_at: new Date().toISOString(), by: batch.filler_email, auto: true };
        await pool.query(
            `UPDATE portal_claim_submissions SET status = 'approved', approved_at = NOW(), approved_snapshot = $2::jsonb, updated_at = NOW() WHERE id = $1`,
            [sub.id, JSON.stringify(snapshot)]
        );
        count++;
    }
    return { autoApproved: count };
}

async function batchSubmitAll(pool, { token, sendAppEmail }) {
    const batch = await getBatchByToken(pool, token);
    if (!batch) return { ok: false, status: 404, error: 'Invalid link' };
    if (isAfterFillClose(batch)) return { ok: false, status: 403, error: 'Payroll entry is now closed.' };

    const { rows: periodRows } = await pool.query(`SELECT * FROM portal_claim_periods WHERE id = $1`, [batch.period_id]);
    const period = periodRows[0];

    const { rows: drafts } = await pool.query(
        `SELECT * FROM portal_claim_submissions WHERE batch_id = $1 AND status IN ('draft','invited')`,
        [batch.id]
    );
    const results = [];
    for (const sub of drafts) {
        const { rows: items } = await pool.query(`SELECT * FROM portal_claim_items WHERE submission_id = $1 AND active = TRUE`, [sub.id]);
        if (!items.length) continue;
        const r = await saveSubmissionItems(pool, {
            token, employeeId: sub.employee_id, items: items.map(i => ({
                claim_type: i.claim_type,
                claim_date: i.claim_date,
                ot_hours: i.ot_hours,
                ot_multiplier: i.ot_multiplier,
                amount: i.amount,
                description: i.description,
                expense_type: i.expense_type,
                patient_name: i.patient_name,
                nature: i.nature,
                time_from: i.time_from,
                time_to: i.time_to,
            })),
            asDraft: false,
        });
        results.push({ employeeId: sub.employee_id, ...r });
        if (r.ok && r.notifyApprover && r.periodId && sendAppEmail) {
            await ensureApproverPacks(pool, r.periodId, sendAppEmail, { forceEmail: true }).catch(() => {});
        }
    }

    await refreshBatchStatus(pool, batch.id);
    const freshBatch = (await pool.query(`SELECT * FROM portal_claim_batches WHERE id = $1`, [batch.id])).rows[0];
    await sendSubmitRecordEmail(pool, sendAppEmail, freshBatch, period);
    const auto = await autoApproveSelfFinal(pool, freshBatch, sendAppEmail);

    return { ok: true, submitted: results.filter(r => r.ok).length, results, autoApproved: auto.autoApproved };
}

async function addBatchAttachment(pool, { token, filename, mimeType, contentBase64, category }) {
    const batch = await getBatchByToken(pool, token);
    if (!batch) return { ok: false, status: 404, error: 'Invalid link' };
    const cat = ['expense_support', 'medical_support'].includes(category) ? category : null;
    if (!cat) return { ok: false, status: 400, error: 'category must be expense_support or medical_support' };
    const buf = Buffer.from(contentBase64, 'base64');
    if (buf.length > 12 * 1024 * 1024) return { ok: false, status: 400, error: 'File too large (max 12MB)' };

    await pool.query(
        `INSERT INTO portal_claim_batch_attachments (batch_id, category, filename, mime_type, content_base64, byte_size)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (batch_id, category) DO UPDATE SET
           filename = EXCLUDED.filename, mime_type = EXCLUDED.mime_type,
           content_base64 = EXCLUDED.content_base64, byte_size = EXCLUDED.byte_size, uploaded_at = NOW()`,
        [batch.id, cat, filename, mimeType || 'application/octet-stream', contentBase64, buf.length]
    );

    const { rows: subs } = await pool.query(`SELECT id FROM portal_claim_submissions WHERE batch_id = $1`, [batch.id]);
    for (const sub of subs) {
        await pool.query(
            `INSERT INTO portal_claim_attachments (submission_id, filename, mime_type, content_base64, byte_size, retain_until, category)
             SELECT $1, $2, $3, $4, $5, (CURRENT_DATE + INTERVAL '2 years')::date, $6
             WHERE NOT EXISTS (
               SELECT 1 FROM portal_claim_attachments WHERE submission_id = $1 AND category = $6
             )`,
            [sub.id, filename, mimeType, contentBase64, buf.length, cat]
        );
    }
    return { ok: true, category: cat };
}

async function getClaimsCategoryForEmployee(pool, employeeId) {
    const { rows } = await pool.query(
        `SELECT id, name, email, claim_authority, supervisor_email, line_manager_email, client, dept, contract_id
         FROM employees WHERE id = $1`, [employeeId]
    );
    if (!rows.length) return null;
    const { evaluateEmployeeEligibility } = require('./claimsEligibility');
    const eligibility = await evaluateEmployeeEligibility(pool, rows[0]);
    return resolveClaimsCategory(rows[0], eligibility);
}

async function flushPortalClaimsSample(pool, { claimMonth, claimYear, clientPattern } = {}) {
    const vals = [];
    let where = `WHERE p.campaign_mode = 'sample'`;
    if (claimMonth && claimYear) {
        vals.push(claimMonth, claimYear);
        where += ` AND p.claim_month = $1 AND p.claim_year = $2`;
    }
    if (clientPattern) {
        vals.push(`%${clientPattern}%`);
        where += ` AND EXISTS (
          SELECT 1 FROM portal_claim_submissions s2
          JOIN employees e ON e.id = s2.employee_id
          WHERE s2.period_id = p.id AND e.client ILIKE $${vals.length}
        )`;
    }
    const { rows: periods } = await pool.query(
        `SELECT p.id FROM portal_claim_periods p ${where}`, vals
    );
    const periodIds = periods.map(p => p.id);
    if (!periodIds.length) return { deletedPeriods: 0 };
    await pool.query(`DELETE FROM portal_claim_periods WHERE id = ANY($1::int[])`, [periodIds]);
    return { deletedPeriods: periodIds.length, periodIds };
}

module.exports = {
    FILL_OPEN_DAY, FILL_CLOSE_DAY, APPROVE_CLOSE_DAY,
    normalizeAuthority,
    resolveFillerEmail,
    resolveApproverEmail,
    ensureClaimAuthorityColumn,
    listEligibleEmployees,
    createCampaign,
    openFillerSession,
    saveSubmissionItems,
    addAttachment,
    resolveSupportCategory,
    importExcelWorkbook,
    getMasterClaimsTemplatePath,
    buildPersonalizedTemplateForToken,
    ensureApproverPacks,
    openApproverSession,
    approverDecide,
    listClaimsForAdmin,
    getResponseBoard,
    chaseDeskAction,
    importIfSheetEmpty,
    pushSelectedToPayroll,
    reopenAugustRejectedOnce,
    writePortalAmountsToSheet,
    exportClaimsPayrollTieout,
    applyManualOverride,
    applyPortalCorrection,
    notifyManualOverride,
    autoCloseNoClaims,
    sendReminders,
    resendFillerInvite,
    getAttachmentContent,
    getOrCreatePeriod,
    getOrCreatePeriodForClaimMonth,
    findPeriodForUi,
    periodWindow,
    periodWindowFromClaim,
    periodWindowForClaimMonth,
    formatPeriodBanner,
    isAfterFillClose,
    isAfterApproveClose,
    refreshOpenPeriodFillClose,
    extendJuly2026ClaimsWindow,
    sendDeadlineExtensionNotice,
    validateOtRow,
    getPkDateType,
    listGazettedHolidayDates,
    pkHolidayMapForClient,
    APPROVER_NOTIFY_MODE,
    MANUAL_OVERRIDE_NOTIFY,
    resetPortalClaimsSample,
    batchSubmitAll,
    addBatchAttachment,
    getClaimsCategoryForEmployee,
    flushPortalClaimsSample,
    listEligibilityRules: listRules,
    upsertEligibilityRule: upsertRule,
    previewEligibilityRule: previewRuleMatch,
    getClaimsPolicy,
    upsertClaimsPolicy: require('./claimsPolicy').upsertClaimsPolicy,
    resolveClaimsCategory,
    resolveClaimsRouting,
    HUZAIFA_FALLBACK,
    buildFillerInviteHtml,
    buildApproverInviteHtml,
    claimsFrontendUrl,
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
