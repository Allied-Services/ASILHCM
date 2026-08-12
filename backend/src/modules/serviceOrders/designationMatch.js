'use strict';

/**
 * Strip punctuation / trailing "service(s)" so sheet labels and SO role
 * titles compare on the same keyspace.
 */
function normalizeDesignation(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/&/g, ' ')
        .replace(/[/_.,\-]+/g, ' ')
        .replace(/\b(services?|svc)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Expand a normalized designation into match keys (aliases + self).
 * Pump Room has no dedicated Tarujabba SO role — Habibabad/Faqirabad bill it
 * under "Filling Pumproom / Invoicing Room"; Tarujabba has "Invoicing Room"
 * on the same Office/Misc line, so we alias there.
 */
function designationMatchKeys(designation) {
    const key = normalizeDesignation(designation);
    if (!key) return [];

    const ALIASES = {
        lab: ['lab', 'laboratory'],
        laboratory: ['lab', 'laboratory'],
        'pump room': ['pump room', 'pumproom', 'filling pumproom', 'invoicing room'],
        pumproom: ['pump room', 'pumproom', 'filling pumproom', 'invoicing room'],
        'filling pumproom': ['pump room', 'pumproom', 'filling pumproom', 'invoicing room'],
        'filling pumproom invoicing room': ['pump room', 'pumproom', 'filling pumproom', 'invoicing room'],
        'invoicing room': ['invoicing room', 'pump room', 'pumproom', 'filling pumproom'],
        // Sheet vs SO wording drift
        'lube handling': ['lube handling', 'lubricant handling'],
        'lubricant handling': ['lube handling', 'lubricant handling'],
        storekeeper: ['storekeeper', 'store keeping', 'store keeping services'],
        'store keeping': ['storekeeper', 'store keeping'],
        'general additional': ['general additional', 'additional general', 'additional', 'general'],
        'additional general': ['general additional', 'additional general', 'additional', 'general'],
        'general housekeeping': ['general housekeeping', 'sweeping cleaning', 'housekeeping', 'janitor'],
        'sweeping cleaning': ['sweeping cleaning', 'general housekeeping', 'housekeeping', 'janitor'],
        // Live roster often stores "Janitor" while SO roles say "Sweeping / Cleaning Services"
        janitor: ['janitor', 'sweeping cleaning', 'general housekeeping', 'housekeeping'],
        'mechanical technician': ['mechanical technician', 'fitter', 'm r support'],
        fitter: ['fitter', 'mechanical technician', 'm r support'],
        'm r support': ['m r support', 'fitter', 'mechanical technician'],
    };

    return ALIASES[key] || [key];
}

function designationsMatch(a, b) {
    const na = normalizeDesignation(a);
    const nb = normalizeDesignation(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;

    const keysA = designationMatchKeys(a);
    const keysB = designationMatchKeys(b);
    for (const ka of keysA) {
        for (const kb of keysB) {
            if (ka === kb) return true;
            if (ka.includes(kb) || kb.includes(ka)) return true;
        }
        if (nb.includes(ka) || ka.includes(nb)) return true;
    }
    for (const kb of keysB) {
        if (na.includes(kb) || kb.includes(na)) return true;
    }
    return false;
}

/**
 * Find the first manpower-dependent SO line whose roles match `designation`.
 * Accepts snake_case (`is_manpower_dependent`) or camelCase (`isManpowerDependent`).
 */
function findLineForDesignation(lines, designation) {
    const target = normalizeDesignation(designation);
    if (!target) return null;
    for (const line of lines || []) {
        if (!(line.is_manpower_dependent || line.isManpowerDependent)) continue;
        const roles = Array.isArray(line.roles)
            ? line.roles
            : (typeof line.roles === 'string' ? JSON.parse(line.roles || '[]') : []);
        if (roles.some((r) => designationsMatch(designation, r.designation || r.role))) {
            return { line, roles };
        }
    }
    return null;
}

module.exports = {
    normalizeDesignation,
    designationMatchKeys,
    designationsMatch,
    findLineForDesignation,
};
