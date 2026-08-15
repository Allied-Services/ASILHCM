'use strict';

/**
 * PSO Conservancy Excel map:
 * Attachments/PSO_Conservancy_Services_by_Location.xlsx
 * Location + Designation (and Service Included) → SO item number.
 *
 * Owner override 2026-08-15: Chakpirana Fitter (M Rasab) → item 06
 * (Excel has no Chakpirana Fitter; live SO line 6 is Office/Misc for Fitter).
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

/** site_code → { [normalized designation]: lineNumber } */
const SITE_DESIGNATION_LINE = {
    CHAKPIRANA: {
        'fm supervisor': 1,
        'conservancy supervisory': 1,
        janitor: 1,
        'sweeping cleaning': 1,
        gardener: 1,
        gardening: 1,
        'm r technician': 1,
        'm r support': 1,
        'sealing offier': 1,
        'sealing officer': 1,
        sealing: 1,
        'lube handling officer': 1,
        'lube handling': 1,
        'laboratory assistant': 1,
        lab: 1,
        laboratory: 1,
        'office boy': 1,
        'office service': 1,
        'omc reporting officer': 1,
        'omc physical reporting': 1,
        'general worker': 1,
        'additional general': 1,
        'forklift operator': 2,
        'forklift operation': 2,
        'fuel oil handling officer': 5,
        'fuel oil handling': 5,
        fitter: 6,
        'fitter services': 6,
        'mechanical technician': 6,
    },
    FAQIRABAD: {
        'fm supervisor': 1,
        'conservancy supervisory': 1,
        janitor: 1,
        'sweeping cleaning': 1,
        gardener: 1,
        gardening: 1,
        'lube handling officer': 1,
        'lube handling': 1,
        'invoicing support': 1,
        'invoicing room': 1,
        'pump room': 1,
        'pump room operator': 1,
        'filling pumproom': 1,
        'sealing offier': 1,
        'sealing officer': 1,
        sealing: 1,
        'm r technician': 1,
        'm r support': 1,
        'office boy': 1,
        'office service': 1,
        'laboratory assistant': 1,
        lab: 1,
        laboratory: 1,
        'general worker': 1,
        additional: 1,
        'forklift operator': 2,
        'forklift operation': 2,
        'fuel oil handling officer': 5,
        'fuel oil handling': 5,
        electrician: 6,
        electrical: 6,
        'mechanical technician': 6,
        'mechanical fitting': 6,
        fitter: 6,
        'fitter services': 6,
    },
    SIHALA: {
        'fm supervisor': 1,
        'conservancy supervisory': 1,
        janitor: 1,
        'sweeping cleaning': 1,
        gardener: 1,
        gardening: 1,
        'office boy': 1,
        'ops office': 1,
        'logistics office': 1,
        'laboratory assistant': 1,
        lab: 1,
        laboratory: 1,
        'invoicing support': 1,
        'invoicing room': 1,
        'lube handling officer': 1,
        'lube handling': 1,
        'lubricant handling': 1,
        'general worker': 1,
        'additional general': 1,
        'forklift operator': 2,
        'forklift operation': 2,
        electrician: 5,
        electrical: 5,
        fitter: 5,
        'fitter services': 5,
        'fuel oil handling officer': 6,
        'fuel oil handling': 6,
        'pesh imam': 7,
        driver: 11,
        driving: 11,
    },
    TARUJABBA: {
        'fm supervisor': 1,
        'conservancy supervisory': 1,
        janitor: 1,
        'sweeping cleaning': 1,
        gardener: 1,
        gardening: 1,
        'sealing offier': 1,
        'sealing officer': 1,
        sealing: 1,
        'office boy': 1,
        'ops office': 1,
        'logistics office': 1,
        'invoicing support': 1,
        'invoicing room': 1,
        'pump room': 1,
        'laboratory assistant': 1,
        lab: 1,
        laboratory: 1,
        storekeeper: 1,
        'store keeping': 1,
        'lube handling officer': 1,
        'lube handling': 1,
        'general worker': 1,
        additional: 1,
        'forklift operator': 2,
        'forklift operation': 2,
        'fuel oil handling officer': 5,
        'fuel oil handling': 5,
        'pesh imam': 6,
        electrician: 7,
        electrical: 7,
        'mechanical technician': 7,
        'mechanical fitting': 7,
        fitter: 7,
        'fitter services': 7,
    },
    KUNDIAN: {
        'pump room operator': 1,
        'pump room': 1,
        'invoicing room': 1,
        'invoicing support': 1,
        gardener: 1,
        gardening: 1,
        'lube handling officer': 1,
        'lube handling': 1,
        janitor: 1,
        'general housekeeping': 1,
        'general worker': 1,
        'fuel oil handling officer': 2,
        'fuel oil handling': 2,
    },
    JUGLOT: {
        'fm supervisor': 1,
        'conservancy supervisory': 1,
        janitor: 1,
        'sweeping cleaning': 1,
        gardener: 1,
        gardening: 1,
        'sealing offier': 1,
        'sealing officer': 1,
        sealing: 1,
        'fuel oil handling officer': 2,
        'fuel oil handling': 2,
    },
};

function lineNumberForDesignation(siteCode, designation) {
    const site = String(siteCode || '').trim().toUpperCase();
    const key = normalizeDesignation(designation);
    if (!site || !key) return null;
    const table = SITE_DESIGNATION_LINE[site];
    if (!table) return null;
    if (table[key] != null) return table[key];
    return null;
}

function findLineByNumber(lines, lineNumber) {
    const want = String(Number(lineNumber));
    if (!want || want === 'NaN') return null;
    for (const line of lines || []) {
        const nums = [
            line.line_number,
            line.lineNumber,
            line.soLineNumber,
            line.so_line_number,
        ];
        if (nums.some((n) => n != null && String(Number(n)) === want)) return line;
        const id = String(line.id || '');
        const m = id.match(/item-(\d+)$/i);
        if (m && String(Number(m[1])) === want) return line;
    }
    const idx = Number(lineNumber) - 1;
    if (idx >= 0 && lines && lines[idx] && lines.every((l) => l.line_number == null && l.soLineNumber == null)) {
        return lines[idx];
    }
    return null;
}

module.exports = {
    SITE_DESIGNATION_LINE,
    lineNumberForDesignation,
    findLineByNumber,
};
