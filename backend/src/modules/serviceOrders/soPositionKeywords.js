'use strict';

const { normalizeDesignation, phrasesOverlap } = require('./designationMatch');

/**
 * Roster titles that bind an employee designation to an SO nested service.
 * First matching rule wins (more specific names before "general").
 */
const SERVICE_KEYWORD_RULES = [
    ['conservancy supervisory', 'FM Supervisor'],
    ['sweeping cleaning', 'Janitor'],
    ['gardening', 'Gardener'],
    ['ops office', 'Office Boy'],
    ['logistics office', 'Office Boy'],
    ['office service', 'Office Boy'],
    ['filling pumproom', 'Invoicing Support'],
    ['invoicing', 'Invoicing Support'],
    ['lubricant handling', 'Lube Handling Officer'],
    ['lube handling', 'Lube Handling Officer'],
    ['fuel oil handling', 'Fuel / Oil Handling Officer'],
    ['additional general', 'General Worker'],
    ['additional', 'General Worker'],
    ['general housekeeping', 'Janitor'],
    ['laboratory', 'Laboratory Assistant'],
    ['lab', 'Laboratory Assistant'],
    ['general', 'General Worker'],
    ['forklift', 'Forklift Operator'],
    ['electrical', 'Electrician'],
    ['fitter', 'Fitter'],
    ['pesh imam', 'Pesh Imam'],
    ['driv', 'Driver'],
    ['m r support', 'M&R Technician'],
    ['decanting', 'Filling / Decanting Officer'],
    ['sealing', 'Sealing Officer'],
    ['omc physical', 'OMC Reporting Officer'],
    ['store keep', 'Storekeeper'],
];

function defaultKeywordsForService(designation) {
    const n = normalizeDesignation(designation);
    if (!n) return '';
    for (const [needle, kw] of SERVICE_KEYWORD_RULES) {
        if (n === needle || n.includes(needle) || phrasesOverlap(n, needle)) return kw;
    }
    return '';
}

function withDefaultKeywords(role) {
    if (!role || typeof role !== 'object') return role;
    const existing = String(role.keywords || role.position_keywords || '').trim();
    if (existing) return { ...role, keywords: existing };
    const keywords = defaultKeywordsForService(role.designation || role.role);
    if (!keywords) return role;
    return { ...role, keywords };
}

module.exports = {
    SERVICE_KEYWORD_RULES,
    defaultKeywordsForService,
    withDefaultKeywords,
};
