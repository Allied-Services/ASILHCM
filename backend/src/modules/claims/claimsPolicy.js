'use strict';

const ALL_CLAIM_TYPES = ['ATTENDANCE', 'OT', 'EXPENSE', 'MEDICAL'];
const DEFAULT_ENABLED_TYPES = ['OT', 'EXPENSE', 'MEDICAL'];
const COLLECTION_MODES = ['monthly_form', 'machine_file', 'daily_marks', 'mixed'];

const DEFAULTS = {
    claims_pay_timing: 'following_month',
    submit_deadline_day: 18,
    approve_deadline_day: 22,
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

function shapePolicyRow(r) {
    if (!r) return { ...DEFAULTS };
    return {
        claims_pay_timing: r.claims_pay_timing || DEFAULTS.claims_pay_timing,
        submit_deadline_day: r.submit_deadline_day != null ? Number(r.submit_deadline_day) : DEFAULTS.submit_deadline_day,
        approve_deadline_day: r.approve_deadline_day != null ? Number(r.approve_deadline_day) : DEFAULTS.approve_deadline_day,
        enabled_types: normalizeEnabledTypes(r.enabled_types),
        collection_mode: normalizeCollectionMode(r.collection_mode),
        reviewer_required: !!r.reviewer_required,
    };
}

async function getClaimsPolicy(pool, contractId) {
    if (!contractId) return { ...DEFAULTS };
    const { rows } = await pool.query(
        `SELECT claims_pay_timing, submit_deadline_day, approve_deadline_day,
                enabled_types, collection_mode, reviewer_required
         FROM contract_claim_policies WHERE contract_id = $1`,
        [contractId]
    );
    return shapePolicyRow(rows[0]);
}

/** Resolve policy for portal period creation — uses first matching Wafi-style contract or defaults. */
async function getDefaultClaimsPolicy(pool) {
    const { rows } = await pool.query(
        `SELECT claims_pay_timing, submit_deadline_day, approve_deadline_day,
                enabled_types, collection_mode, reviewer_required
         FROM contract_claim_policies
         ORDER BY updated_at DESC NULLS LAST
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
    const timing = body.claims_pay_timing === 'same_month' ? 'same_month' : 'following_month';
    const submitDay = body.submit_deadline_day != null && body.submit_deadline_day !== ''
        ? Number(body.submit_deadline_day) : DEFAULTS.submit_deadline_day;
    const approveDay = body.approve_deadline_day != null && body.approve_deadline_day !== ''
        ? Number(body.approve_deadline_day) : DEFAULTS.approve_deadline_day;
    if (!Number.isFinite(submitDay) || submitDay < 1 || submitDay > 28) {
        const err = new Error('submit_deadline_day must be 1–28');
        err.status = 400;
        throw err;
    }
    if (!Number.isFinite(approveDay) || approveDay < 1 || approveDay > 28) {
        const err = new Error('approve_deadline_day must be 1–28');
        err.status = 400;
        throw err;
    }
    const enabledTypes = normalizeEnabledTypes(body.enabled_types);
    const collectionMode = normalizeCollectionMode(body.collection_mode);
    const reviewerRequired = body.reviewer_required === true || body.reviewer_required === 'true';

    const { rows } = await pool.query(
        `INSERT INTO contract_claim_policies
         (contract_id, claims_pay_timing, submit_deadline_day, approve_deadline_day,
          enabled_types, collection_mode, reviewer_required, updated_at)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, NOW())
         ON CONFLICT (contract_id) DO UPDATE SET
           claims_pay_timing = EXCLUDED.claims_pay_timing,
           submit_deadline_day = EXCLUDED.submit_deadline_day,
           approve_deadline_day = EXCLUDED.approve_deadline_day,
           enabled_types = EXCLUDED.enabled_types,
           collection_mode = EXCLUDED.collection_mode,
           reviewer_required = EXCLUDED.reviewer_required,
           updated_at = NOW()
         RETURNING *`,
        [contractId, timing, submitDay, approveDay, enabledTypes, collectionMode, reviewerRequired]
    );
    return shapePolicyRow(rows[0]);
}

module.exports = {
    getClaimsPolicy,
    getDefaultClaimsPolicy,
    upsertClaimsPolicy,
    normalizeEnabledTypes,
    assertEnabledType,
    shapePolicyRow,
    ALL_CLAIM_TYPES,
    DEFAULT_ENABLED_TYPES,
    COLLECTION_MODES,
    DEFAULTS,
};
