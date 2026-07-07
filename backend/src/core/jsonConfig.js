'use strict';

/** system_config.value is JSONB — pg may return object or legacy string */
function parseConfigValue(v) {
    return typeof v === 'string' ? JSON.parse(v) : v;
}

module.exports = { parseConfigValue };
