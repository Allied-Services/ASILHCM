const fs = require('fs');
const src = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/frontend/src/BillingProcurement.jsx', 'utf8');
const lines = src.split('\n');

// Show lines 435-460 (grandTotal calc area)
console.log('=== Lines 435-460 (grand total calc) ===');
for (let i = 434; i < 462; i++) console.log((i+1) + ': ' + lines[i]);

// Show lines 445-455 (save function)
console.log('\n=== Lines 445-460 (save function) ===');
for (let i = 444; i < 462; i++) console.log((i+1) + ': ' + lines[i]);

// Show lines 620-640 (totals display)
console.log('\n=== Lines 620-645 (totals display) ===');
for (let i = 619; i < 647; i++) console.log((i+1) + ': ' + lines[i]);

// Look for any dangling JSX attributes or unmatched angle brackets
// Particularly in the new Official/Unofficial toggle section
console.log('\n=== Lines 540-590 (Official/Unofficial toggle) ===');
for (let i = 539; i < 592; i++) console.log((i+1) + ': ' + lines[i]);
