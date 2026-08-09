#!/usr/bin/env node
'use strict';
/**
 * Flush SAMPLE-mode portal claim periods (August Wafi test data).
 * Usage: node backend/scripts/flush_portal_claims_sample.js --period=2026-07 --client=Wafi
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const { flushPortalClaimsSample } = require('../src/modules/claims/portalService');

function arg(name) {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : null;
}

async function main() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const period = arg('period');
        let claimMonth = null;
        let claimYear = null;
        if (period && /^\d{4}-\d{2}$/.test(period)) {
            const [y, m] = period.split('-');
            claimYear = parseInt(y, 10);
            claimMonth = parseInt(m, 10);
        }
        const client = arg('client') || 'wafi';
        const result = await flushPortalClaimsSample(pool, { claimMonth, claimYear, clientPattern: client });
        console.log(JSON.stringify(result, null, 2));
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
