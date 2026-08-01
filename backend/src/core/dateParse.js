'use strict';

const MONTHS = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
};

function isBlank(v) {
    return v == null || String(v).trim() === '';
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function isoDate(y, m, d) {
    if (!y || !m || !d) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Expand 2-digit year.
 * @param {number} yy
 * @param {'dob'|'expiry'|'default'} kind
 */
function expandYear(yy, kind = 'default') {
    const n = Number(yy);
    if (!Number.isFinite(n) || n < 0) return null;
    if (n >= 100) return n;
    if (kind === 'expiry') return 2000 + n;
    if (kind === 'dob') return n > 30 ? 1900 + n : 2000 + n;
    // default: assume 20xx for recent operational dates
    return 2000 + n;
}

/**
 * Parse common roster date forms to YYYY-MM-DD.
 * Supports: YYYY-MM-DD, DD-Mon-YY, DD/MM/YYYY, DD-MM-YYYY, excel serials via Date().
 *
 * @param {*} v
 * @param {{ kind?: 'dob'|'expiry'|'default' }} [opts]
 * @returns {string|null}
 */
function parseDateOrNull(v, opts = {}) {
    if (isBlank(v)) return null;
    const kind = opts.kind || 'default';
    const s = String(v).trim();
    if (/^n\/?a$/i.test(s)) return null;

    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

    // DD-Mon-YY / DD-Mon-YYYY / DD Mon YYYY
    let m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{2,4})$/);
    if (m) {
        const day = Number(m[1]);
        const mon = MONTHS[m[2].toLowerCase()];
        const year = expandYear(Number(m[3]), kind);
        return isoDate(year, mon, day);
    }

    // DD/MM/YYYY or DD-MM-YYYY (or 2-digit year)
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
        const day = Number(m[1]);
        const mon = Number(m[2]);
        const year = expandYear(Number(m[3]), kind);
        return isoDate(year, mon, day);
    }

    // Excel serial number
    if (/^\d+(\.\d+)?$/.test(s)) {
        const n = Number(s);
        if (n > 20000 && n < 80000) {
            const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
            return utc.toISOString().slice(0, 10);
        }
    }

    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
        // Prefer local YMD when string already had explicit parts; avoid TZ shift for ISO-like.
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        return d.toISOString().slice(0, 10);
    }
    return null;
}

/** Convenience wrappers */
function parseDobOrNull(v) {
    return parseDateOrNull(v, { kind: 'dob' });
}

function parseExpiryOrNull(v) {
    return parseDateOrNull(v, { kind: 'expiry' });
}

module.exports = {
    parseDateOrNull,
    parseDobOrNull,
    parseExpiryOrNull,
    expandYear,
};
