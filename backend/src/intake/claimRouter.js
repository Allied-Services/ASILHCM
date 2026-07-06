'use strict';

const { matchInboxRules } = require('./classifier');
const { createClaimFromIntake } = require('../modules/claims/service');

const CLAIM_CLASSIFICATIONS = new Set(['claim']);

function mapClaimType(fromAddress, subject) {
    const meta = matchInboxRules(fromAddress, subject);
    if (meta.category === 'overtime') return 'overtime';
    if (meta.category === 'medical') return 'medical';
    return 'expense';
}

async function resolveEmployeeByEmail(pool, email) {
    if (!email) return null;
    const addr = email.toLowerCase().trim();
    const { rows } = await pool.query(
        `SELECT id FROM employees WHERE LOWER(email) = $1 LIMIT 1`,
        [addr]
    );
    return rows[0]?.id || null;
}

async function resolveFocalEmail(pool, contractId) {
    if (!contractId) return null;
    const { rows } = await pool.query(
        `SELECT client_focal_email FROM contracts WHERE id = $1`,
        [contractId]
    );
    return rows[0]?.client_focal_email || null;
}

async function routeIntakeToClaims(pool) {
    const { rows: messages } = await pool.query(
        `SELECT * FROM intake_messages WHERE status = 'new' AND classification = 'claim' ORDER BY id LIMIT 50`
    );
    let routed = 0;
    for (const msg of messages) {
        const claimType = mapClaimType(msg.from_address, msg.subject);
        const employeeId = await resolveEmployeeByEmail(pool, msg.from_address);
        let contractId = null;
        if (employeeId) {
            const { rows: empRows } = await pool.query(`SELECT contract_id FROM employees WHERE id = $1`, [employeeId]);
            contractId = empRows[0]?.contract_id || null;
        }
        const focalEmail = contractId ? await resolveFocalEmail(pool, contractId) : null;

        await createClaimFromIntake(pool, {
            intakeMessageId: msg.id,
            employeeId,
            claimType,
            items: [],
            focalEmail,
        });

        await pool.query(`UPDATE intake_messages SET status = 'routed', processed_at = NOW() WHERE id = $1`, [msg.id]);
        routed += 1;
    }
    return { routed };
}

module.exports = { routeIntakeToClaims };
