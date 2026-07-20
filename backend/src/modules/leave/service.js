'use strict';

// Pakistan government-mandated defaults (days/year). Overridable per contract
// via the contract_leave_policies table (backend/migrations/20260720120000_leave_policies.js).
const DEFAULTS = { cl: 10, ml: 8, el: 14 };

async function getLeavePolicy(pool, contractId) {
    if (!contractId) return { ...DEFAULTS };
    const { rows } = await pool.query(
        `SELECT cl_days, ml_days, el_days FROM contract_leave_policies WHERE contract_id = $1`,
        [contractId]
    );
    if (!rows.length) return { ...DEFAULTS };
    const r = rows[0];
    return {
        cl: r.cl_days != null ? Number(r.cl_days) : DEFAULTS.cl,
        ml: r.ml_days != null ? Number(r.ml_days) : DEFAULTS.ml,
        el: r.el_days != null ? Number(r.el_days) : DEFAULTS.el,
    };
}

async function upsertLeavePolicy(pool, contractId, { cl, ml, el }) {
    const clDays = cl != null && cl !== '' ? Number(cl) : DEFAULTS.cl;
    const mlDays = ml != null && ml !== '' ? Number(ml) : DEFAULTS.ml;
    const elDays = el != null && el !== '' ? Number(el) : DEFAULTS.el;
    if ([clDays, mlDays, elDays].some(n => !Number.isFinite(n) || n < 0)) {
        const err = new Error('cl, ml, el must be non-negative numbers');
        err.status = 400;
        throw err;
    }
    const { rows } = await pool.query(
        `INSERT INTO contract_leave_policies (contract_id, cl_days, ml_days, el_days, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (contract_id) DO UPDATE
           SET cl_days = EXCLUDED.cl_days, ml_days = EXCLUDED.ml_days, el_days = EXCLUDED.el_days, updated_at = NOW()
         RETURNING *`,
        [contractId, clDays, mlDays, elDays]
    );
    return rows[0];
}

module.exports = { getLeavePolicy, upsertLeavePolicy, DEFAULTS };
