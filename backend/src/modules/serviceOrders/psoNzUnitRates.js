'use strict';

/**
 * North Zone nested Service Order unit rates (column L = per-resource monthly).
 * Site-specific. Do not copy Morgah onto other depots.
 *
 * Source: North Zone rate card (column L = per-resource monthly).
 */
const { normalizeDesignation } = require('./designationMatch');

const SITE_UNIT_RATES = {
    MORGAH: {
        'conservancy supervisory': 60246,
        'sweeping cleaning': 52040,
        'gardening': 52183,
        'decanting filling': 57298,
        'sealing': 56991,
    },
    CHAKPIRANA: {
        'conservancy supervisory': 60216,
        'sweeping cleaning': 52046,
        'gardening': 52189,
        'm r support': 56991,
        'sealing': 56991,
        'lube handling': 56991,
        'lab': 56991,
        'office': 56991,
        'omc physical reporting': 56991,
        'additional general': 52046,
        'forklift operation': 56991,
        'fuel oil handling': 57304,
        'fitter': 56991,
    },
    FAQIRABAD: {
        'conservancy supervisory': 60222,
        'sweeping cleaning': 52109,
        'gardening': 52252,
        'lube handling': 57054,
        'filling pumproom invoicing room': 57054,
        'sealing': 57054,
        'm r support': 57054,
        'office': 57054,
        'lab': 57054,
        'additional': 52109,
        'forklift operation': 56991,
        'fuel oil handling': 57304,
        'electrical': 56991,
        'fitter': 56991,
        'mechanical': 56991,
    },
    SIHALA: {
        'conservancy supervisory': 60213,
        'sweeping cleaning': 52043,
        'gardening': 52185,
        'ops office': 56987,
        'logistics office': 56987,
        'lab': 56987,
        'invoicing room': 56987,
        'lubricant handling': 56987,
        'lube handling': 56987,
        'general': 52040,
        'general gantry cleaning material movement': 52040,
        'additional general': 52040,
        'forklift operation': 56991,
        'electrical': 56991,
        'fitter': 56991,
        'fuel oil handling': 57304,
        'pesh imam': 56991,
        'driving': 56991,
    },
    JUGLOT: {
        'conservancy supervisory': 60216,
        'sweeping cleaning': 52046,
        'gardening': 52189,
        'sealing': 56991,
        'fuel oil handling': 57304,
    },
    CHITRAL: {
        'sweeping cleaning': 52046,
        'gardening': 52189,
        'lube handling': 56991,
    },
    TARUJABBA: {
        'conservancy supervisory': 60207,
        'sweeping cleaning': 52030,
        'gardening': 52173,
        'sealing': 56975,
        'ops office': 56975,
        'logistics office': 56975,
        'invoicing room': 56975,
        'pump room invoicing room': 56975,
        'lab': 56975,
        'lab sampling': 56975,
        'store keeping': 52375,
        'storekeeper': 52375,
        'lube handling': 56975,
        'general': 52030,
        'additional': 52030,
        'forklift operation': 56991,
        'fuel oil handling': 57304,
        'pesh imam': 56991,
        'electrical': 56991,
        'fitter': 56991,
        'mechanical fitting': 56991,
    },
    SERAINOURANG: {
        'sweeping cleaning': 52046,
        'gardening': 52189,
        'sealing': 56991,
        'juglot depot': 56991,
        'office': 56991,
        'invoicing room': 56991,
        'pump room invoicing room': 56991,
        'fuel oil handling': 57304,
    },
    KOHAT: {
        'sweeping cleaning': 52046,
        'gardening': 52189,
        'general housekeeping': 52046,
    },
    KUNDIAN: {
        'invoicing room': 52046,
        'pump room invoicing room': 52046,
        'gardening': 52189,
        'lube handling': 56991,
        'housekeeping': 52046,
        'general housekeeping': 52046,
        'fuel oil handling': 57304,
    },
    DGM_OPS: {
        'driving': 56991,
    },
    PR_FUELING: {
        'conservancy supervisory': 60120,
        'sweeping cleaning': 51950,
        'general': 52094,
        'electrical': 56991,
    },
};

function siteCodeOf(code) {
    return String(code || '').trim().toUpperCase();
}

function lookupNzUnitRate(siteCode, designation) {
    const site = SITE_UNIT_RATES[siteCodeOf(siteCode)];
    if (!site) return 0;
    const key = normalizeDesignation(designation);
    if (!key) return 0;
    if (site[key] != null) return site[key];
    return 0;
}

function applyNzUnitRate(siteCode, role) {
    if (!role || typeof role !== 'object') return { role, changed: false };
    const next = lookupNzUnitRate(siteCode, role.designation || role.role);
    if (!(next > 0)) return { role, changed: false };
    const prev = Number(role.rate);
    if (prev === next) return { role, changed: false };
    return { role: { ...role, rate: next }, changed: true, from: Number.isFinite(prev) ? prev : null, to: next };
}

function stampSeedSites(sites) {
    const changes = [];
    const next = (sites || []).map((site) => {
        const code = site.id || site.site_code;
        const key = site.lineItems ? 'lineItems' : 'lines';
        const lines = site[key];
        if (!Array.isArray(lines)) return site;
        return {
            ...site,
            [key]: lines.map((line) => {
                if (!Array.isArray(line.roles)) return line;
                return {
                    ...line,
                    roles: line.roles.map((role) => {
                        const applied = applyNzUnitRate(code, role);
                        if (applied.changed) {
                            changes.push({
                                site: code,
                                line: line.name || line.id,
                                designation: role.designation || role.role,
                                from: applied.from,
                                to: applied.to,
                            });
                        }
                        return applied.role;
                    }),
                };
            }),
        };
    });
    return { sites: next, changes };
}

module.exports = {
    SITE_UNIT_RATES,
    lookupNzUnitRate,
    applyNzUnitRate,
    stampSeedSites,
};
