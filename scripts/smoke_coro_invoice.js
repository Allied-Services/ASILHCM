'use strict';
/**
 * Offline CORO invoice math smoke (no DB).
 * Usage: node scripts/smoke_coro_invoice.js
 */
const path = require('path');
const fs = require('fs');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const candidates = [
    path.join(__dirname, '../backend/src/modules/serviceOrders/seedData/pso_coro_ss94.json'),
    path.join(__dirname, 'seeds/pso_coro_ss94.json'),
];
const file = candidates.find(p => fs.existsSync(p));
if (!file) {
    console.error('pso_coro_ss94.json not found');
    process.exit(1);
}
const coro = JSON.parse(fs.readFileSync(file, 'utf8'));
const gross = round2(coro.sites[0].lines.reduce((s, l) => s + Number(l.rate), 0));
const st = round2(gross * 0.16);
const grand = round2(gross + st);
const expected = { gross: 4136919.94, salesTax: 661907.19, grand: 4798827.13 };
const pass = gross === expected.gross && st === expected.salesTax && grand === expected.grand;
console.log(JSON.stringify({ file, gross, st, grand, expected, pass }, null, 2));
process.exit(pass ? 0 : 2);
