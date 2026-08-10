'use strict';

const crypto = require('crypto');
const { hashToken } = require('../../intake/autoAck');

const TOKEN_TTL_DAYS = 7;

function newRawToken() {
    return crypto.randomBytes(16).toString('hex');
}

async function mintAccessToken(pool, { employeeId, year, month, documentId }) {
    const raw = newRawToken();
    const tokenHash = hashToken(raw);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const { rows } = await pool.query(
        `INSERT INTO payslip_access_tokens (token_hash, employee_id, year, month, document_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, expires_at`,
        [tokenHash, employeeId, year, month, documentId, expiresAt]
    );
    return { rawToken: raw, tokenId: rows[0].id, expiresAt: rows[0].expires_at };
}

async function resolveAccessToken(pool, rawToken) {
    const tokenHash = hashToken(rawToken);
    const { rows } = await pool.query(
        `SELECT t.*, d.pdf_bytes, d.content_hash
         FROM payslip_access_tokens t
         JOIN payslip_documents d ON d.id = t.document_id
         WHERE t.token_hash = $1
           AND t.revoked_at IS NULL
           AND t.expires_at > NOW()
         LIMIT 1`,
        [tokenHash]
    );
    if (!rows.length) return null;
    await pool.query(
        `UPDATE payslip_access_tokens SET access_count = access_count + 1 WHERE id = $1`,
        [rows[0].id]
    );
    return rows[0];
}

module.exports = {
    TOKEN_TTL_DAYS,
    mintAccessToken,
    resolveAccessToken,
};
