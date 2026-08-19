'use strict';

const crypto = require('crypto');

const ENV_HASH_KEY = 'MONTH_CLOSE_UNLOCK_CODE_HASH';

function sha256Hex(input) {
    return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

/**
 * Verify unlock code against MONTH_CLOSE_UNLOCK_CODE_HASH (hex SHA-256 of the code).
 * Never log the provided code.
 */
function verifyUnlockCode(provided) {
    const stored = process.env[ENV_HASH_KEY];
    if (!stored || String(stored).trim() === '') {
        return { ok: false, reason: 'NOT_CONFIGURED' };
    }
    if (!provided || typeof provided !== 'string') {
        return { ok: false, reason: 'DENIED' };
    }
    const digest = sha256Hex(provided.trim());
    const a = Buffer.from(digest, 'utf8');
    const b = Buffer.from(String(stored).trim().toLowerCase(), 'utf8');
    if (a.length !== b.length) {
        return { ok: false, reason: 'DENIED' };
    }
    const match = crypto.timingSafeEqual(a, b);
    return match ? { ok: true } : { ok: false, reason: 'DENIED' };
}

function requireUnlockCodeBody(req, res) {
    const result = verifyUnlockCode(req.body?.unlock_code);
    if (result.reason === 'NOT_CONFIGURED') {
        res.status(503).json({ error: 'Unlock not configured' });
        return false;
    }
    if (!result.ok) {
        res.status(403).json({ error: 'Forbidden' });
        return false;
    }
    return true;
}

module.exports = {
    ENV_HASH_KEY,
    sha256Hex,
    verifyUnlockCode,
    requireUnlockCodeBody,
};
