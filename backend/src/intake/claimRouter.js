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

async function extractClaimFromEmail(msg) {
    if (!process.env.OPENAI_API_KEY) return null;
    try {
        const OpenAI = require('openai');
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const body = (msg.body_text || '').slice(0, 4000);
        const response = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: 'Extract employee claim data from email. Return STRICT JSON: {"claimType":"overtime"|"medical"|"expense","items":[{"ot2":n,"ot3":n}|{"amount":n,"description":str}],"confidence":0-1}',
                },
                {
                    role: 'user',
                    content: `Subject: ${msg.subject || ''}\n\n${body}`,
                },
            ],
        });
        const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
        if (Number(parsed.confidence || 0) < 0.5) return null;
        console.log(`[claimRouter] extracted ${(parsed.items || []).length} items (confidence ${parsed.confidence}) for intake #${msg.id}`);
        return parsed;
    } catch (err) {
        console.warn('[claimRouter] extraction failed:', err.message);
        return null;
    }
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
    if (process.env.CLAIMS_INTAKE_ROUTING !== 'true') {
        return { routed: 0, skipped: 'CLAIMS_INTAKE_ROUTING off' };
    }
    const { rows: messages } = await pool.query(
        `SELECT * FROM intake_messages WHERE status = 'new' AND classification = 'claim' ORDER BY id LIMIT 50`
    );
    let routed = 0;
    for (const msg of messages) {
        let claimType = mapClaimType(msg.from_address, msg.subject);
        let items = [];
        const extracted = await extractClaimFromEmail(msg);
        if (extracted) {
            if (extracted.claimType) claimType = extracted.claimType;
            items = extracted.items || [];
        }

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
            items,
            focalEmail,
            contractId,
        });

        await pool.query(`UPDATE intake_messages SET status = 'routed', processed_at = NOW() WHERE id = $1`, [msg.id]);
        routed += 1;
    }
    return { routed };
}

module.exports = { routeIntakeToClaims, extractClaimFromEmail };
