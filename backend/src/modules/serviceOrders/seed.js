'use strict';

/**
 * PSO North Zone seed — thin wrapper over contractCrud.resyncNorthZoneFromSeed.
 * Kept for CLI / POST /api/fixed-value/seed-pso backward compatibility.
 */

const { resyncNorthZoneFromSeed, PSO_CLIENT_ID } = require('./contractCrud');

const FOCAL_SITES = new Set(['MORGAH', 'CHAKPIRANA', 'SIHALA']);

/**
 * Full seed (first-time or re-sync with employees).
 * Re-sync of SO lines only: use resyncNorthZoneFromSeed({ confirm: true, syncEmployees: false }).
 */
async function seedPsoNorthZone(pool, { actor } = {}) {
    return resyncNorthZoneFromSeed(pool, {
        confirm: true,
        syncEmployees: true,
        actor,
    });
}

module.exports = { seedPsoNorthZone, PSO_CLIENT_ID, FOCAL_SITES, resyncNorthZoneFromSeed };
