'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeEmployeeId } = require('./julyBonusAccrual');

const WAFI_CLIENT = 'Wafi Energy Pakistan Pvt Ltd';
const JULY_MONTH = 7;
const JULY_YEAR = 2026;

const DEFAULT_VERIFY_CSV = (() => {
    const candidates = [
        path.join(__dirname, '..', '..', '..', 'audit', 'july_inputs', 'july_verify.csv'),
        path.join(__dirname, '..', '..', 'audit', 'july_inputs', 'july_verify.csv'),
        process.env.JULY_VERIFY_CSV,
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return candidates[0];
})();

let cachedMap = null;
let cachedPath = null;

function num(v) {
    if (v == null || v === '') return 0;
    const n = Number(String(v).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
}

/** RFC-style CSV parse (handles multiline quoted fields — e.g. SPL-385 bank account). */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '"') {
            if (inQ && text[i + 1] === '"') { cur += '"'; i += 1; }
            else inQ = !inQ;
        } else if (ch === ',' && !inQ) {
            row.push(cur); cur = '';
        } else if ((ch === '\n' || ch === '\r') && !inQ) {
            if (ch === '\r' && text[i + 1] === '\n') i += 1;
            row.push(cur);
            if (row.some((c) => String(c).trim() !== '')) rows.push(row);
            row = []; cur = '';
        } else cur += ch;
    }
    if (cur.length || row.length) {
        row.push(cur);
        if (row.some((c) => String(c).trim() !== '')) rows.push(row);
    }
    return rows;
}

/**
 * July 2026 Wafi verify sheet → Map(id → { paidDays, ot2, ot3, excelNet }).
 */
function loadJulyVerifyInputsMap(csvPath = DEFAULT_VERIFY_CSV) {
    if (cachedMap && cachedPath === csvPath) return cachedMap;

    const resolved = path.resolve(csvPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`July verify CSV not found: ${resolved}`);
    }

    const rows = parseCsv(fs.readFileSync(resolved, 'utf8'));
    const headerIdx = rows.findIndex((r) => r.some((c) => /ASIL Employee Code/i.test(String(c))));
    if (headerIdx < 0) throw new Error('July verify CSV: header not found');

    const hdr = rows[headerIdx].map((h) => String(h).replace(/\n/g, ' ').trim());
    const idx = (re) => hdr.findIndex((h) => re.test(h));
    const col = {
        id: idx(/ASIL Employee/i),
        client: idx(/^Client$/i),
        active: idx(/^Active$/i),
        month: idx(/Month #/i),
        year: idx(/^Year$/i),
        paidDays: idx(/Paid Days/i),
        ot2: idx(/OT Hrs @ 2X/i),
        ot3: idx(/OT Hrs @ 3X/i),
        net: idx(/Net Pay for the Month/i),
    };

    const map = new Map();
    for (let i = headerIdx + 1; i < rows.length; i += 1) {
        const v = rows[i];
        const id = normalizeEmployeeId(v[col.id]);
        if (!id || !/^ASIL/i.test(id)) continue;
        if (String(v[col.client] || '').trim() !== WAFI_CLIENT) continue;
        const active = String(v[col.active] || '').toLowerCase();
        if (active === 'no' || active === 'false') continue;
        if (num(v[col.month]) !== JULY_MONTH || num(v[col.year]) !== JULY_YEAR) continue;

        map.set(id, {
            paidDays: num(v[col.paidDays]) || 31,
            ot2: num(v[col.ot2]),
            ot3: num(v[col.ot3]),
            excelNet: Math.round(num(v[col.net])),
        });
    }

    cachedMap = map;
    cachedPath = csvPath;
    return map;
}

function clearJulyVerifyCache() {
    cachedMap = null;
    cachedPath = null;
}

module.exports = {
    WAFI_CLIENT,
    JULY_MONTH,
    JULY_YEAR,
    DEFAULT_VERIFY_CSV,
    loadJulyVerifyInputsMap,
    clearJulyVerifyCache,
};
