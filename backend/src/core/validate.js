'use strict';

function parseBody(schema, body) {
    if (typeof schema === 'function') {
        const result = schema(body);
        if (result.error) {
            const err = new Error(result.error);
            err.status = 400;
            throw err;
        }
        return result.data;
    }
    return body;
}

function handleRouteError(res, routeName, err) {
    console.error(`[${routeName}]`, err);
    if (err.status === 400) {
        return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Internal server error' });
}

function requireFields(body, fields) {
    const missing = fields.filter(f => body[f] == null || body[f] === '');
    if (missing.length) {
        return { error: `Missing required fields: ${missing.join(', ')}` };
    }
    return { data: body };
}

module.exports = { parseBody, handleRouteError, requireFields };
