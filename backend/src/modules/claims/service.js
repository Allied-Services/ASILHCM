'use strict';

const { formatDate, addDays, monthYear } = require('../../core/dates');
const crypto = require('crypto');
const { validateAction, getPolicy } = require('../constraints/service');
const { hashToken } = require('../../intake/autoAck');

async function createClaimFromIntake(pool, { intakeMessageId, employeeId, claimType, items, focalEmail }) {
    const token = crypto.randomBytes(24).toString('hex');
    const { rows } = await pool.query(
        `INSERT INTO employee_claims
         (intake_message_id, employee_id, claim_type, claimed_items, status, focal_email, focal_token_hash, period_month, period_year)
         VALUES ($1, $2, $3, $4, 'pending_focal', $5, $6, $7, $8)
         RETURNING *`,
        [
            intakeMessageId,
            employeeId,
            claimType,
            JSON.stringify(items || []),
            focalEmail,
            hashToken(token),
            monthYear().month,
            monthYear().year,
        ]
    );
    return { claim: rows[0], focalToken: token };
}

async function validateOtClaim(pool, { contractId, projectId, ot2, ot3 }) {
    const policy = await getPolicy(pool, contractId, projectId);
    const totalHours = Number(ot2 || 0) + Number(ot3 || 0);
    return validateAction(pool, 'ot_claim', {
        contractId,
        projectId,
        policy,
        otHours: totalHours,
    });
}

async function getMedicalUtilization(pool, employeeId, contractId) {
    const { rows } = await pool.query(
        `SELECT * FROM benefit_utilization
         WHERE employee_id = $1 AND benefit_type = 'medical'
           AND cycle_start <= CURRENT_DATE AND cycle_end >= CURRENT_DATE
         ORDER BY cycle_start DESC LIMIT 1`,
        [employeeId]
    );
    if (rows.length) return rows[0];

    const policy = await getPolicy(pool, contractId);
    const cap = Number(policy?.medical_annual_cap || 0);
    if (!cap) return { cap_amount: null, used_amount: 0 };

    const { rows: empRows } = await pool.query('SELECT doj FROM employees WHERE id = $1', [employeeId]);
    const doj = empRows[0]?.doj ? new Date(empRows[0].doj) : new Date();
    const cycleStart = policy.medical_cycle_anchor === 'calendar_year'
        ? new Date(new Date().getFullYear(), 0, 1)
        : doj;
    const cycleEnd = addDays(new Date(cycleStart.getFullYear() + 1, cycleStart.getMonth(), cycleStart.getDate()), -1);

    const { rows: created } = await pool.query(
        `INSERT INTO benefit_utilization (employee_id, contract_id, benefit_type, cycle_start, cycle_end, cap_amount, used_amount)
         VALUES ($1, $2, 'medical', $3, $4, $5, 0)
         RETURNING *`,
        [employeeId, contractId, formatDate(cycleStart), formatDate(cycleEnd), cap]
    );
    return created[0];
}

async function assignClaimEmployee(pool, claimId, employeeId) {
    const { rows } = await pool.query(
        `UPDATE employee_claims SET employee_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [claimId, employeeId]
    );
    if (!rows.length) throw new Error('Claim not found');
    return rows[0];
}

async function verifyFocalToken(pool, claimId, token) {
    const { rows } = await pool.query(`SELECT * FROM employee_claims WHERE id = $1`, [claimId]);
    if (!rows.length) return { ok: false, status: 404 };
    const claim = rows[0];
    if (claim.focal_token_hash !== hashToken(token)) return { ok: false, status: 403 };
    return { ok: true, claim };
}

async function processFocalDecision(pool, { claimId, token, decision, comment }) {
    const check = await verifyFocalToken(pool, claimId, token);
    if (!check.ok) return check;
    const claim = check.claim;
    if (claim.focal_approved_at || claim.focal_rejected_at) {
        return { ok: false, status: 409, already: true };
    }

    if (decision === 'approved') {
        await pool.query(
            `UPDATE employee_claims SET status = 'focal_approved', focal_approved_at = NOW(), focal_comment = $2, updated_at = NOW() WHERE id = $1`,
            [claimId, comment || null]
        );
        if (claim.claim_type === 'medical' && claim.employee_id) {
            const items = typeof claim.claimed_items === 'string' ? JSON.parse(claim.claimed_items) : (claim.claimed_items || []);
            const amount = items.reduce((s, i) => s + Number(i.amount || 0), 0);
            const { rows: empRows } = await pool.query(`SELECT contract_id FROM employees WHERE id = $1`, [claim.employee_id]);
            const contractId = empRows[0]?.contract_id;
            if (amount > 0 && contractId) {
                await getMedicalUtilization(pool, claim.employee_id, contractId);
                await pool.query(
                    `UPDATE benefit_utilization SET used_amount = used_amount + $1, updated_at = NOW()
                     WHERE employee_id = $2 AND benefit_type = 'medical'
                       AND cycle_start <= CURRENT_DATE AND cycle_end >= CURRENT_DATE`,
                    [amount, claim.employee_id]
                );
            }
        }
    } else {
        await pool.query(
            `UPDATE employee_claims SET status = 'focal_rejected', focal_rejected_at = NOW(), focal_comment = $2, updated_at = NOW() WHERE id = $1`,
            [claimId, comment || null]
        );
    }
    return { ok: true, decision };
}

module.exports = {
    createClaimFromIntake,
    validateOtClaim,
    getMedicalUtilization,
    assignClaimEmployee,
    verifyFocalToken,
    processFocalDecision,
};
