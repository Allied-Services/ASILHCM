'use strict';

const fs = require('fs');
const path = require('path');
const { designationsMatch } = require('./designationMatch');
const { explicitRoleRate, lineRoles } = require('./sitesMeta');
const { withDefaultKeywords } = require('./soPositionKeywords');

let sitesCache = null;

function loadSeedSites() {
    if (sitesCache) return sitesCache;
    const file = path.join(__dirname, 'seedData', 'pso_sites.json');
    try {
        sitesCache = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        sitesCache = [];
    }
    return sitesCache;
}

function normalizeName(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function seedSite(siteCode) {
    const code = String(siteCode || '').trim().toUpperCase();
    if (!code) return null;
    return (loadSeedSites() || []).find((s) => String(s.id || '').toUpperCase() === code) || null;
}

function matchSeedLine(seedLines, liveLine, idx) {
    const liveName = normalizeName(liveLine?.name);
    const liveNo = String(liveLine?.line_number || liveLine?.lineNumber || '').trim();
    const byName = (seedLines || []).find((s) => normalizeName(s.name) === liveName);
    if (byName) return byName;
    if (liveNo) {
        const byNo = (seedLines || []).find((s, i) => String(s.soLineNumber || s.line_number || i + 1) === liveNo);
        if (byNo) return byNo;
    }
    return (seedLines || [])[idx] || null;
}

function matchSeedRole(seedRoles, liveRole) {
    const desig = liveRole?.designation || liveRole?.role;
    return (seedRoles || []).find((sr) => designationsMatch(desig, sr.designation || sr.role)) || null;
}

/**
 * Fill missing per-resource rates / manpower flags from the PSO seed catalog.
 * Does not change the billed line total. Live edits (an explicit role.rate) win.
 */
function enrichLinesWithSeedRoleRates(siteCode, lines) {
    const site = seedSite(siteCode);
    const seedLines = site?.lineItems || site?.lines || [];
    if (!seedLines.length || !Array.isArray(lines) || !lines.length) return lines || [];

    return lines.map((line, idx) => {
        const seedLine = matchSeedLine(seedLines, line, idx);
        if (!seedLine) return line;
        const liveRoles = lineRoles(line);
        if (!liveRoles.length) return line;
        const seedRoles = seedLine.roles || [];
        const nextRoles = liveRoles.map((role) => {
            const seedRole = matchSeedRole(seedRoles, role);
            const out = { ...role };
            if (seedRole) {
                if (!explicitRoleRate(out) && explicitRoleRate(seedRole)) {
                    out.rate = explicitRoleRate(seedRole);
                }
                if (out.is_manpower_dependent == null && out.isManpowerDependent == null) {
                    const mp = seedRole.isManpowerDependent ?? seedRole.is_manpower_dependent;
                    if (mp != null) {
                        out.is_manpower_dependent = !!mp;
                        out.isManpowerDependent = !!mp;
                    }
                }
                if (!String(out.keywords || '').trim() && seedRole.keywords) {
                    out.keywords = seedRole.keywords;
                }
            }
            return withDefaultKeywords(out);
        });
        return { ...line, roles: nextRoles };
    });
}

function enrichServiceOrder(so) {
    if (!so) return so;
    const raw = Array.isArray(so.lines)
        ? so.lines
        : (typeof so.lines === 'string' ? JSON.parse(so.lines || '[]') : []);
    return { ...so, lines: enrichLinesWithSeedRoleRates(so.site_code || so.siteCode, raw) };
}

module.exports = {
    loadSeedSites,
    enrichLinesWithSeedRoleRates,
    enrichServiceOrder,
};
