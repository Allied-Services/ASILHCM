'use strict';

const fs = require('fs');
const path = require('path');

/** Facility Management — bonus paid in April, zero on July payroll sheet. */
const FM_CONTRACT_IDS = new Set([
    'CTR-1773048704450',
    'CTR-1773048523696',
]);

/** Wafi BPO headcount — July 2026 bonus from 12-month accrual sheet. */
const WAFI_BPO_CONTRACT_IDS = new Set([
    'CTR-1773046722553',
]);

const SPL420_OVERRIDE_ID = 'ASIL/SPL-420/21';
const SPL420_OVERRIDE_AMOUNT = 105000;

const JULY_CUTOVER_MONTH = 7;
const JULY_CUTOVER_YEAR = 2026;

const DEFAULT_BONUS_CSV = (() => {
    const candidates = [
        path.join(__dirname, '..', '..', '..', 'audit', 'july_inputs', 'bonus_working_bpo.csv'),
        path.join(__dirname, '..', '..', 'july_inputs', 'bonus_working_bpo.csv'),
        process.env.JULY_BONUS_CSV,
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return candidates[0];
})();

let cachedMap = null;
let cachedCsvPath = null;

function normalizeEmployeeId(id) {
    return String(id || '').trim().toUpperCase().replace(/\s+/g, '');
}

function parseNum(v) {
    if (v == null || v === '') return 0;
    const s = String(v).replace(/,/g, '').replace(/[^\d.\-]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

function parseCsvLine(line) {
    const vals = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
        if (ch === '"') inQ = !inQ;
        else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    vals.push(cur.trim());
    return vals;
}

/**
 * Parse Bonus Working for BPO Staff.csv → Map(normalizedId → { total, salary }).
 */
function loadBonusWorkingMap(csvPath = DEFAULT_BONUS_CSV) {
    if (cachedMap && cachedCsvPath === csvPath) return cachedMap;

    const resolved = path.resolve(csvPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Bonus working CSV not found: ${resolved}`);
    }

    const raw = fs.readFileSync(resolved, 'utf8').replace(/\r/g, '');
    const lines = raw.split('\n').filter(Boolean);
    const hdrs = parseCsvLine(lines[0]).map(h => h.replace(/"/g, '').trim());
    const codeIdx = hdrs.findIndex(h => /^code$/i.test(h));
    const totalIdx = hdrs.findIndex(h => /^total$/i.test(h));
    const salaryIdx = hdrs.findIndex(h => /^salary$/i.test(h));
    if (codeIdx < 0 || totalIdx < 0) {
        throw new Error(`Bonus CSV missing Code or Total column: ${resolved}`);
    }

    const map = new Map();
    for (let i = 1; i < lines.length; i += 1) {
        const vals = parseCsvLine(lines[i]);
        const code = normalizeEmployeeId(vals[codeIdx]);
        if (!code || !/^ASIL/i.test(code)) continue;
        map.set(code, {
            total: Math.round(parseNum(vals[totalIdx])),
            salary: salaryIdx >= 0 ? Math.round(parseNum(vals[salaryIdx])) : 0,
        });
    }

    cachedMap = map;
    cachedCsvPath = csvPath;
    return map;
}

function clearBonusWorkingCache() {
    cachedMap = null;
    cachedCsvPath = null;
}

function isWafiBpoJulyContext({ employeeId, contractId }) {
    if (contractId && WAFI_BPO_CONTRACT_IDS.has(String(contractId).trim())) {
        return true;
    }
    return /^ASIL\/SPL-/i.test(normalizeEmployeeId(employeeId));
}

/**
 * July 2026 WAFI bonus from 12-month accrual sheet (+ owner overrides).
 * Returns null when cutover rules do not apply (caller falls back to contract formula).
 */
function resolveJuly2026WafiBonus({
    employeeId,
    contractId,
    month,
    year,
    manualBonusAmount,
    bonusMap,
}) {
    if (Number(month) !== JULY_CUTOVER_MONTH || Number(year) !== JULY_CUTOVER_YEAR) {
        return null;
    }

    if (!isWafiBpoJulyContext({ employeeId, contractId })) {
        return null;
    }

    if (manualBonusAmount != null && manualBonusAmount !== '') {
        return Math.round(Number(manualBonusAmount) || 0);
    }

    const normId = normalizeEmployeeId(employeeId);
    if (normId === normalizeEmployeeId(SPL420_OVERRIDE_ID)) {
        return SPL420_OVERRIDE_AMOUNT;
    }

    if (contractId && FM_CONTRACT_IDS.has(String(contractId).trim())) {
        return 0;
    }

    const map = bonusMap || loadBonusWorkingMap();
    const row = map.get(normId);
    return row ? row.total : 0;
}

/** Convenience alias for seed scripts and audits. */
function loadJulyBonusAmount(employeeId, opts = {}) {
    const amount = resolveJuly2026WafiBonus({
        employeeId,
        contractId: opts.contractId,
        month: JULY_CUTOVER_MONTH,
        year: JULY_CUTOVER_YEAR,
        manualBonusAmount: opts.manualBonusAmount,
        bonusMap: opts.bonusMap,
    });
    return amount != null ? amount : 0;
}

module.exports = {
    FM_CONTRACT_IDS,
    WAFI_BPO_CONTRACT_IDS,
    SPL420_OVERRIDE_ID,
    SPL420_OVERRIDE_AMOUNT,
    JULY_CUTOVER_MONTH,
    JULY_CUTOVER_YEAR,
    DEFAULT_BONUS_CSV,
    normalizeEmployeeId,
    loadBonusWorkingMap,
    clearBonusWorkingCache,
    resolveJuly2026WafiBonus,
    loadJulyBonusAmount,
    isWafiBpoJulyContext,
};
