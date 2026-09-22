'use strict';

/**
 * Stamp North Zone nested unit rates from psoNzUnitRates.js onto both
 * pso_sites.json copies. Dry-run unless --write.
 *
 *   node backend/scripts/stamp_nz_sheet_unit_rates.js
 *   node backend/scripts/stamp_nz_sheet_unit_rates.js --write
 */

const fs = require('fs');
const path = require('path');
const { stampSeedSites, lookupNzUnitRate } = require('../src/modules/serviceOrders/psoNzUnitRates');

const WRITE = process.argv.includes('--write');
const FILES = [
    path.join(__dirname, '../src/modules/serviceOrders/seedData/pso_sites.json'),
    path.join(__dirname, '../../scripts/seeds/pso_sites.json'),
];

function missingRoles(sites) {
    const missing = [];
    for (const site of sites || []) {
        const code = site.id;
        for (const line of site.lineItems || []) {
            for (const role of line.roles || []) {
                const rate = lookupNzUnitRate(code, role.designation || role.role);
                if (!(rate > 0)) {
                    missing.push({
                        site: code,
                        line: line.name || line.id,
                        designation: role.designation || role.role,
                        current: role.rate || null,
                    });
                }
            }
        }
    }
    return missing;
}

function main() {
    const first = JSON.parse(fs.readFileSync(FILES[0], 'utf8'));
    const { sites, changes } = stampSeedSites(first);
    const missing = missingRoles(sites);
    const report = {
        write: WRITE,
        changed: changes.length,
        changes,
        unmatched_roles: missing,
    };
    if (WRITE) {
        const json = `${JSON.stringify(sites, null, 2)}\n`;
        for (const file of FILES) fs.writeFileSync(file, json);
        report.files = FILES;
    }
    console.log(JSON.stringify(report, null, 2));
    if (missing.length) process.exitCode = 2;
}

main();
