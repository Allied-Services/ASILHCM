'use strict';

const crypto = require('crypto');

function buildAckReference(intakeId) {
    return `ASIL-INT-${String(intakeId).padStart(6, '0')}`;
}

function buildAckEmailHtml({ reference, category, slaHours }) {
    const hours = slaHours || 48;
    return `
        <div style="font-family:Arial,sans-serif;color:#222;">
            <p>Dear colleague,</p>
            <p>We have received your email and logged it under reference <strong>${reference}</strong>.</p>
            <p>Category: <strong>${category || 'General'}</strong></p>
            <p>Our team will respond within <strong>${hours} working hours</strong>.</p>
            <p>Regards,<br/>Allied Services International — Operations Desk</p>
        </div>
    `;
}

async function sendAutoAck(pool, sendAppEmail, intakeRow) {
    if (!intakeRow.from_address || intakeRow.ack_sent_at) return null;

    const reference = buildAckReference(intakeRow.id);
    const html = buildAckEmailHtml({
        reference,
        category: intakeRow.classification,
        slaHours: intakeRow.sla_hours || 48,
    });

    if (sendAppEmail) {
        await sendAppEmail({
            to: intakeRow.from_address,
            subject: `We received your request — ${reference}`,
            html,
        }).catch(err => {
            console.error('[autoAck]', err);
        });
    }

    await pool.query(
        `UPDATE intake_messages SET ack_sent_at = NOW(), ack_reference = $1 WHERE id = $2`,
        [reference, intakeRow.id]
    );

    await pool.query(
        `INSERT INTO response_sla_tracker (intake_message_id, category, sla_hours, status)
         VALUES ($1, $2, $3, 'within_sla')
         ON CONFLICT DO NOTHING`,
        [intakeRow.id, intakeRow.classification || 'general', intakeRow.sla_hours || 48]
    ).catch(() => {
        return pool.query(
            `INSERT INTO response_sla_tracker (intake_message_id, category, sla_hours, status)
             VALUES ($1, $2, $3, 'within_sla')`,
            [intakeRow.id, intakeRow.classification || 'general', intakeRow.sla_hours || 48]
        );
    });

    return reference;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { buildAckReference, buildAckEmailHtml, sendAutoAck, hashToken };
