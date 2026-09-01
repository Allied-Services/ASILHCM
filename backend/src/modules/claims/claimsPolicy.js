'use strict';

const ALL_CLAIM_TYPES = ['ATTENDANCE', 'OT', 'EXPENSE', 'MEDICAL'];
const DEFAULT_ENABLED_TYPES = ['OT', 'EXPENSE', 'MEDICAL'];
const COLLECTION_MODES = ['monthly_form', 'machine_file', 'daily_marks', 'mixed'];
const DEADLINE_MONTHS = ['current_month', 'following_month'];

const POLICY_COLUMNS = `claims_pay_timing, submit_deadline_day, approve_deadline_day,
                submit_deadline_month, approve_deadline_month, calendar_apply,
                enabled_types, collection_mode, reviewer_required`;

const DEFAULTS = {
    calendar_apply: false,
    claims_pay_timing: 'following_month',
    submit_deadline_day: null,
    approve_deadline_day: null,
    submit_deadline_month: 'following_month',
    approve_deadline_month: 'following_month',
    enabled_types: [...DEFAULT_ENABLED_TYPES],
    collection_mode: 'monthly_form',
    reviewer_required: false,
};

function normalizeEnabledTypes(raw) {
    if (!raw || !Array.isArray(raw) || !raw.length) return [...DEFAULT_ENABLED_TYPES];
    const out = raw
        .map((t) => String(t || '').trim().toUpperCase())
        .filter((t) => ALL_CLAIM_TYPES.includes(t));
    return out.length ? [...new Set(out)] : [...DEFAULT_ENABLED_TYPES];
}

function normalizeCollectionMode(raw) {
    const v = String(raw || '').trim().toLowerCase();
    return COLLECTION_MODES.includes(v) ? v : DEFAULTS.collection_mode;
}

function normalizeDeadlineMonth(raw, fallback = 'following_month') {
    const v = String(raw || '').trim();
    if (DEADLINE_MONTHS.includes(v)) return v;
    return fallback === 'current_month' ? 'current_month' : 'following_month';
}

function parseOptionalDeadlineDay(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n;
}

function hasSubmitDeadline(policy) {
    return !!(policy && policy.calendar_apply === true && policy.submit_deadline_day != null);
}

function hasApproveDeadline(policy) {
    return !!(policy && policy.calendar_apply === true && policy.approve_deadline_day != null);
}

function inferCalendarApply(body = {}) {
    if (body.calendar_apply != null) {
        return body.calendar_apply === true || body.calendar_apply === 'true';
    }
    return body.submit_deadline_day != null || body.approve_deadline_day != null;
}

function deadlineYearMonth(claimYear, claimMonth, monthMode) {
    if (monthMode === 'current_month') {
        return { year: Number(claimYear), month: Number(claimMonth) };
    }
    const d = new Date(Number(claimYear), Number(claimMonth), 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function assertDeadlineDay(day, field) {
    if (day == null) return;
    if (!Number.isFinite(day) || day < 1 || day > 28) {
        const err = new Error(`${field} must be 1–28`);
        err.status = 400;
        throw err;
    }
}

function shapePolicyRow(r) {
    if (!r) return { ...DEFAULTS };
    const payTiming = r.claims_pay_timing || DEFAULTS.claims_pay_timing;
    const monthFallback = payTiming === 'same_month' ? 'current_month' : 'following_month';
    return {
        calendar_apply: !!r.calendar_apply,
        claims_pay_timing: payTiming,
        submit_deadline_day: parseOptionalDeadlineDay(r.submit_deadline_day),
        approve_deadline_day: parseOptionalDeadlineDay(r.approve_deadline_day),
        submit_deadline_month: normalizeDeadlineMonth(r.submit_deadline_month, monthFallback),
        approve_deadline_month: normalizeDeadlineMonth(r.approve_deadline_month, monthFallback),
        enabled_types: normalizeEnabledTypes(r.enabled_types),
        collection_mode: normalizeCollectionMode(r.collection_mode),
        reviewer_required: !!r.reviewer_required,
    };
}

async function getClaimsPolicy(pool, contractId) {
    if (!contractId) return { ...DEFAULTS };
    const { rows } = await pool.query(
        `SELECT ${POLICY_COLUMNS}
         FROM contract_claim_policies WHERE contract_id = $1`,
        [contractId]
    );
    return shapePolicyRow(rows[0]);
}

/** Resolve policy for portal period creation — prefer a pack that applies calendar. */
async function getDefaultClaimsPolicy(pool) {
    const { rows } = await pool.query(
        `SELECT ${POLICY_COLUMNS}
         FROM contract_claim_policies
         ORDER BY calendar_apply DESC, updated_at DESC NULLS LAST
         LIMIT 1`
    );
    return shapePolicyRow(rows[0]);
}

function assertEnabledType(policy, claimType) {
    const t = String(claimType || '').trim().toUpperCase();
    const allowed = normalizeEnabledTypes(policy?.enabled_types);
    if (!allowed.includes(t)) {
        const err = new Error(`Claim type ${t} is not enabled for this contract`);
        err.status = 400;
        err.code = 'CLAIM_TYPE_DISABLED';
        throw err;
    }
}

async function upsertClaimsPolicy(pool, contractId, body) {
    const calendarApply = inferCalendarApply(body);
    const timing = body.claims_pay_timing === 'same_month' ? 'same_month' : 'following_month';
    const monthFallback = timing === 'same_month' ? 'current_month' : 'following_month';
    const submitDay = calendarApply ? parseOptionalDeadlineDay(body.submit_deadline_day) : null;
    const approveDay = calendarApply ? parseOptionalDeadlineDay(body.approve_deadline_day) : null;
    assertDeadlineDay(submitDay, 'submit_deadline_day');
    assertDeadlineDay(approveDay, 'approve_deadline_day');
    const submitMonth = normalizeDeadlineMonth(body.submit_deadline_month, monthFallback);
    const approveMonth = normalizeDeadlineMonth(body.approve_deadline_month, monthFallback);
    const enabledTypes = normalizeEnabledTypes(body.enabled_types);
    const collectionMode = normalizeCollectionMode(body.collection_mode);
    const reviewerRequired = body.reviewer_required === true || body.reviewer_required === 'true';

    const { rows } = await pool.query(
        `INSERT INTO contract_claim_policies
         (contract_id, claims_pay_timing, submit_deadline_day, approve_deadline_day,
          submit_deadline_month, approve_deadline_month, calendar_apply,
          enabled_types, collection_mode, reviewer_required, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, NOW())
         ON CONFLICT (contract_id) DO UPDATE SET
           claims_pay_timing = EXCLUDED.claims_pay_timing,
           submit_deadline_day = EXCLUDED.submit_deadline_day,
           approve_deadline_day = EXCLUDED.approve_deadline_day,
           submit_deadline_month = EXCLUDED.submit_deadline_month,
           approve_deadline_month = EXCLUDED.approve_deadline_month,
           calendar_apply = EXCLUDED.calendar_apply,
           enabled_types = EXCLUDED.enabled_types,
           collection_mode = EXCLUDED.collection_mode,
           reviewer_required = EXCLUDED.reviewer_required,
           updated_at = NOW()
         RETURNING *`,
        [
            contractId, timing, submitDay, approveDay,
            submitMonth, approveMonth, calendarApply,
            enabledTypes, collectionMode, reviewerRequired,
        ]
    );
    return shapePolicyRow(rows[0]);
}

module.exports = {
    getClaimsPolicy,
    getDefaultClaimsPolicy,
    upsertClaimsPolicy,
    normalizeEnabledTypes,
    normalizeDeadlineMonth,
    parseOptionalDeadlineDay,
    inferCalendarApply,
    hasSubmitDeadline,
    hasApproveDeadline,
    deadlineYearMonth,
    assertEnabledType,
    shapePolicyRow,
    ALL_CLAIM_TYPES,
    DEFAULT_ENABLED_TYPES,
    COLLECTION_MODES,
    DEADLINE_MONTHS,
    DEFAULTS,
};
