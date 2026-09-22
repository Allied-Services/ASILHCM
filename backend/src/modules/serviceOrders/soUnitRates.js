'use strict';

const { normalizeDesignation } = require('./designationMatch');
const { explicitRoleRate, lineRoles, isLineManpower } = require('./sitesMeta');

function round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

function positiveRate(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function designationKey(s) {
    return normalizeDesignation(s);
}

function roleCountOf(role) {
    const n = Number(role?.count);
    return n > 0 ? n : 0;
}

function manpowerRolesOf(line) {
    const list = lineRoles(line);
    if (!list.length) return [];
    return list.filter((role) => {
        if (role.is_manpower_dependent != null || role.isManpowerDependent != null) {
            return !!(role.is_manpower_dependent || role.isManpowerDependent);
        }
        return isLineManpower(line);
    });
}

/** Known PSO per-resource units recovered from dedicated SO lines. */
const KNOWN_DEDICATED_UNITS = [60246, 57304, 57298, 56991, 56985, 52183, 52043, 52040];

function matchesKnownUnit(n) {
    const v = round2(n);
    return KNOWN_DEDICATED_UNITS.some((u) => Math.abs(u - v) < 0.05);
}

/**
 * When the billed line *is* those nested services, unit = line.rate / headcount.
 * Kitchen-sink Office/Misc lumps are skipped unless the implied unit is a known catalog rate.
 */
function dedicatedUnit(line) {
    const roles = manpowerRolesOf(line);
    if (!roles.length) return 0;
    const lineRate = positiveRate(line?.rate);
    if (!lineRate) return 0;
    const headcount = roles.reduce((n, r) => n + (roleCountOf(r) || 0), 0) || roles.length;
    const unit = round2(lineRate / headcount);
    if (roles.length === 1) return unit;
    if (matchesKnownUnit(unit)) return unit;
    return 0;
}

function rateFromRoleOrLine(line, role) {
    if (explicitRoleRate(role)) return explicitRoleRate(role);
    const unit = dedicatedUnit(line);
    return unit > 0 ? unit : 0;
}

function emptyCatalog() {
    return { bySite: new Map(), byDesignation: new Map() };
}

function rememberRate(catalog, siteCode, designation, rate) {
    const key = designationKey(designation);
    const n = positiveRate(rate);
    if (!key || !n) return;
    const site = String(siteCode || '').trim().toUpperCase();
    if (site) catalog.bySite.set(`${site}|${key}`, n);
    const bucket = catalog.byDesignation.get(key) || [];
    bucket.push(n);
    catalog.byDesignation.set(key, bucket);
}

function catalogUnitRate(catalog, designation, siteCode) {
    const key = designationKey(designation);
    if (!key || !catalog) return 0;
    const site = String(siteCode || '').trim().toUpperCase();
    if (site && catalog.bySite.has(`${site}|${key}`)) return catalog.bySite.get(`${site}|${key}`);
    return 0;
}

function collectFromLine(catalog, siteCode, line) {
    for (const role of lineRoles(line)) {
        const rate = rateFromRoleOrLine(line, role);
        if (rate) rememberRate(catalog, siteCode, role.designation || role.role, rate);
    }
}

function buildUnitRateCatalog(sites) {
    const catalog = emptyCatalog();
    for (const site of sites || []) {
        const code = site.id || site.site_code || site.siteCode;
        const lines = site.lineItems || site.lines || [];
        for (const line of lines) collectFromLine(catalog, code, line);
    }
    return catalog;
}

function fillRoleUnitRate(role, line, catalog, siteCode) {
    if (!role || typeof role !== 'object') return role;
    if (explicitRoleRate(role)) return role;
    const fromCatalog = catalogUnitRate(catalog, role.designation || role.role, siteCode);
    const fromLine = dedicatedUnit(line);
    const rate = fromCatalog || fromLine;
    if (!rate) return role;
    return { ...role, rate };
}

function fillLineRoleRates(line, catalog, siteCode) {
    const roles = lineRoles(line);
    if (!roles.length) return line;
    return {
        ...line,
        roles: roles.map((role) => fillRoleUnitRate(role, line, catalog, siteCode)),
    };
}

function fillSeedSites(sites) {
    const catalog = buildUnitRateCatalog(sites);
    return (sites || []).map((site) => {
        const code = site.id || site.site_code || site.siteCode;
        const key = site.lineItems ? 'lineItems' : 'lines';
        const lines = site[key];
        if (!Array.isArray(lines)) return site;
        return {
            ...site,
            [key]: lines.map((line) => fillLineRoleRates(line, catalog, code)),
        };
    });
}

module.exports = {
    round2,
    positiveRate,
    dedicatedUnit,
    catalogUnitRate,
    buildUnitRateCatalog,
    fillRoleUnitRate,
    fillLineRoleRates,
    fillSeedSites,
};
