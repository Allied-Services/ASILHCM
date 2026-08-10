'use strict';

const DEFAULTS = {
    claims_pay_timing: 'following_month',
    submit_deadline_day: 17,
    approve_deadline_day: 22,
};

async function getClaimsPolicy(pool, contractId) {
    if (!contractId) return { ...DEFAULTS };
    const { rows } = await pool.query(
        `SELECT claims_pay_timing, submit_deadline_day, approve_deadline_day
         FROM contract_claim_policies WHERE contract_id = $1`,
        [contractId]
    );
    if (!rows.length) return { ...DEFAULTS };
    const r = rows[0];
    return {
        claims_pay_timing: r.claims_pay_timing || DEFAULTS.claims_pay_timing,
        submit_deadline_day: r.submit_deadline_day != null ? Number(r.submit_deadline_day) : DEFAULTS.submit_deadline_day,
        approve_deadline_day: r.approve_deadline_day != null ? Number(r.approve_deadline_day) : DEFAULTS.approve_deadline_day,
    };
}

/** Resolve policy for portal period creation — uses first matching Wafi-style contract or defaults. */
async function getDefaultClaimsPolicy(pool) {
    const { rows } = await pool.query(
        `SELECT claims_pay_timing, submit_deadline_day, approve_deadline_day
         FROM contract_claim_policies
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`
    );
    if (!rows.length) return { ...DEFAULTS };
    return {
        claims_pay_timing: rows[0].claims_pay_timing || DEFAULTS.claims_pay_timing,
        submit_deadline_day: Number(rows[0].submit_deadline_day) || DEFAULTS.submit_deadline_day,
        approve_deadline_day: Number(rows[0].approve_deadline_day) || DEFAULTS.approve_deadline_day,
    };
}

async function upsertClaimsPolicy(pool, contractId, { claims_pay_timing, submit_deadline_day, approve_deadline_day }) {
    const timing = claims_pay_timing === 'same_month' ? 'same_month' : 'following_month';
    const submitDay = submit_deadline_day != null && submit_deadline_day !== ''
        ? Number(submit_deadline_day) : DEFAULTS.submit_deadline_day;
    const approveDay = approve_deadline_day != null && approve_deadline_day !== ''
        ? Number(approve_deadline_day) : DEFAULTS.approve_deadline_day;
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
    const { rows } = await pool.query(
        `INSERT INTO contract_claim_policies
         (contract_id, claims_pay_timing, submit_deadline_day, approve_deadline_day, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (contract_id) DO UPDATE SET
           claims_pay_timing = EXCLUDED.claims_pay_timing,
           submit_deadline_day = EXCLUDED.submit_deadline_day,
           approve_deadline_day = EXCLUDED.approve_deadline_day,
           updated_at = NOW()
         RETURNING *`,
        [contractId, timing, submitDay, approveDay]
    );
    return rows[0];
}

module.exports = {
    getClaimsPolicy,
    getDefaultClaimsPolicy,
    upsertClaimsPolicy,
    DEFAULTS,
};
