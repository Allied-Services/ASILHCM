'use strict';

const { DEFAULT_XERO_SITE_ACCOUNTS, OWNED_TRACKING_OPTIONS } = require('./config');

function extractTrackingOption(lineItems = []) {
    for (const li of lineItems) {
        for (const tr of li.Tracking || []) {
            const name = String(tr.Name || '').toLowerCase();
            if (name.includes('tracking') || name.includes('category') || name.includes('bpo')) {
                if (tr.Option) return String(tr.Option).trim();
            }
        }
        if (li.Tracking?.[0]?.Option) return String(li.Tracking[0].Option).trim();
    }
    return null;
}

function extractAccountCode(lineItems = []) {
    for (const li of lineItems) {
        if (li.AccountCode) return String(li.AccountCode).trim().toUpperCase();
    }
    return null;
}

function deriveSite(accountCode, siteAccounts = DEFAULT_XERO_SITE_ACCOUNTS) {
    if (!accountCode) return null;
    const code = accountCode.toUpperCase();
    if (siteAccounts[code]) return siteAccounts[code];
    const m = code.match(/^(FM-\d{3})/);
    if (m && siteAccounts[m[1]]) return siteAccounts[m[1]];
    return null;
}

function isWafiImprest(invoice) {
    const ref = String(invoice.Reference || invoice.reference || '').toLowerCase();
    const type = String(invoice.Type || invoice.type || '').toLowerCase();
    return ref.includes('imprest') || type.includes('imprest');
}

function classifyXeroBill(invoice, siteAccounts = DEFAULT_XERO_SITE_ACCOUNTS) {
    const lineItems = invoice.LineItems || [];
    const trackingCategory = extractTrackingOption(lineItems);
    const accountCode = extractAccountCode(lineItems);
    const site = deriveSite(accountCode, siteAccounts);
    const imprest = isWafiImprest(invoice);

    let owned = false;
    let billType = null;
    let importStatus = 'Imported';

    if (imprest) {
        owned = true;
        billType = 'Wafi Imprest';
    } else if (trackingCategory && OWNED_TRACKING_OPTIONS.has(trackingCategory)) {
        owned = true;
        billType = trackingCategory === 'Wafi Procurement' ? 'Wafi Procurement' : trackingCategory;
    }

    if (!owned) {
        return {
            owned: false,
            trackingCategory,
            accountCode,
            site,
            billType,
            importStatus: 'Needs Review',
        };
    }

    if (!site && trackingCategory === 'FM') {
        importStatus = 'Needs Review';
    }

    return {
        owned: true,
        trackingCategory,
        accountCode,
        site,
        billType,
        importStatus,
    };
}

module.exports = {
    classifyXeroBill,
    deriveSite,
    extractTrackingOption,
    extractAccountCode,
};
