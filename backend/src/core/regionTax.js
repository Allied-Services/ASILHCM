'use strict';

const STATUTORY_DEFAULTS = [
    { match: ['gilgit', 'baltistan'], rate: 0 },
    { match: ['punjab', 'lahore', 'faisalabad', 'rawalpindi', 'multan', 'gujranwala'], rate: 0.16 },
    { match: ['sindh', 'karachi', 'hyderabad', 'sukkur'], rate: 0.15 },
    { match: ['kpk', 'khyber', 'peshawar', 'abbottabad', 'kohat'], rate: 0.15 },
    { match: ['balochistan', 'quetta'], rate: 0.15 },
    { match: ['ict', 'federal', 'islamabad'], rate: 0.13 },
];

function provinceSalesTaxRate(province, rates = []) {
    const p = (province || '').toLowerCase().trim();
    if (p === 'gb') return 0;
    if (Array.isArray(rates) && rates.length > 0) {
        const match = rates.find((r) => p.includes((r.province || '').toLowerCase().split('/')[0].trim()));
        if (match) return (parseFloat(match.salesTaxPct) || 0) / 100;
    }
    for (const def of STATUTORY_DEFAULTS) {
        if (def.match.some((token) => p.includes(token))) return def.rate;
    }
    return 0.13;
}

module.exports = { provinceSalesTaxRate };
