'use strict';

const CUTOVER_MONTH = 7;
const CUTOVER_YEAR = 2026;
const CUTOVER_DATE = '2026-07-01';
const ARCHIVE_EMAIL = 'huzaifa.rafaqat@asil.com.pk';

function parseJsonValue(val, fallback) {
    if (val == null) return fallback;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return fallback; }
}

function canUseArchiveToggle(user) {
    if (!user) return false;
    const email = (user.email || '').toLowerCase().trim();
    return user.role === 'superadmin' || email === ARCHIVE_EMAIL;
}

function wantsArchiveFromRequest(req) {
    const header = req.headers['x-show-archive'];
    const query = req.query?.archive;
    return header === '1' || header === 'true' || query === '1' || query === 'true';
}

async function loadCutoverConfig(pool) {
    const { rows } = await pool.query(
        `SELECT key, value FROM system_config WHERE key IN ('cutover_period', 'show_pre_cutover_archive')`
    );
    const cfg = {};
    for (const r of rows) cfg[r.key] = r.value;
    const period = parseJsonValue(cfg.cutover_period, { month: CUTOVER_MONTH, year: CUTOVER_YEAR });
    const raw = cfg.show_pre_cutover_archive;
    const showPreCutoverArchive = raw === true || raw === 'true' || raw?.enabled === true;
    return {
        cutoverMonth: Number(period.month) || CUTOVER_MONTH,
        cutoverYear: Number(period.year) || CUTOVER_YEAR,
        showPreCutoverArchive,
    };
}

async function resolveArchiveMode(req, pool) {
    const config = await loadCutoverConfig(pool);
    const archive = canUseArchiveToggle(req.user)
        && wantsArchiveFromRequest(req)
        && config.showPreCutoverArchive;
    return { archive, config };
}

function isArchiveVisible(req, config) {
    return canUseArchiveToggle(req.user) && config.showPreCutoverArchive;
}

function periodAtOrAfterCutover(month, year, cutoverMonth = CUTOVER_MONTH, cutoverYear = CUTOVER_YEAR) {
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!m || !y) return false;
    return y > cutoverYear || (y === cutoverYear && m >= cutoverMonth);
}

function employeeVisibilityClause(alias = 'e', { archive = false } = {}) {
    if (archive) return 'TRUE';
    const a = alias;
    return `(
        (${a}.active IS NULL
            OR LOWER(TRIM(${a}.active::text)) IN ('yes','true','1','active','')
            OR ${a}.active::text = 'Yes')
        AND (
            ${a}.last_working_day IS NULL
            OR ${a}.last_working_day >= '${CUTOVER_DATE}'::date
        )
    )`;
}

function applyPeriodFloor(monthCol, yearCol, { archive = false, cutoverMonth = CUTOVER_MONTH, cutoverYear = CUTOVER_YEAR } = {}) {
    if (archive) return 'TRUE';
    return `(
        ${yearCol} > ${cutoverYear}
        OR (${yearCol} = ${cutoverYear} AND ${monthCol} >= ${cutoverMonth})
    )`;
}

function claimMonthFloor(dateCol, { archive = false } = {}) {
    if (archive) return 'TRUE';
    return `(${dateCol} IS NULL OR ${dateCol} >= '${CUTOVER_DATE}'::date)`;
}

function payrollTransactionPeriodFloor(alias = 'pt', opts = {}) {
    return applyPeriodFloor(`${alias}.month`, `${alias}.year`, opts);
}

module.exports = {
    CUTOVER_MONTH,
    CUTOVER_YEAR,
    CUTOVER_DATE,
    ARCHIVE_EMAIL,
    canUseArchiveToggle,
    wantsArchiveFromRequest,
    loadCutoverConfig,
    resolveArchiveMode,
    isArchiveVisible,
    periodAtOrAfterCutover,
    employeeVisibilityClause,
    applyPeriodFloor,
    claimMonthFloor,
    payrollTransactionPeriodFloor,
};
