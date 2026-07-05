'use strict';

async function storeAttachment(pool, { filename, contentType, buffer }) {
    if (!buffer || !buffer.length) return null;
    const { rows } = await pool.query(
        `INSERT INTO uploaded_files (kind, filename, mime, size_bytes, data, uploaded_by)
         VALUES ('intake', $1, $2, $3, $4, 'intake-hub')
         RETURNING id`,
        [filename || 'attachment', contentType || 'application/octet-stream', buffer.length, buffer]
    );
    return rows[0]?.id || null;
}

module.exports = { storeAttachment };
