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

module.exports = { createClaimFromIntake, validateOtClaim, getMedicalUtilization };
