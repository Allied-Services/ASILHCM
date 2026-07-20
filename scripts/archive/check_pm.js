const fs = require('fs');
const src = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/frontend/src/BillingProcurement.jsx', 'utf8');
const lines = src.split('\n');

// Show payment modal start
const pmLine = lines.findIndex(l => l.includes('paymentModal &&'));
console.log('=== Payment Modal JSX start (line ' + (pmLine+1) + ') ===');
for (let i = pmLine; i < Math.min(pmLine + 5, lines.length); i++) {
    console.log((i+1) + ': ' + lines[i].trim().substring(0,100));
}

// Find all lines that contain paymentModal
const pmLines = lines.map((l,i) => ({l, i})).filter(x => x.l.includes('paymentModal'));
console.log('\n=== All paymentModal references ===');
pmLines.forEach(({l, i}) => console.log((i+1) + ': ' + l.trim().substring(0,100)));

// Show last 15 lines of file
console.log('\n=== Last 15 lines of file ===');
for (let i = lines.length - 15; i < lines.length; i++) {
    console.log((i+1) + ': ' + lines[i]);
}

// Show lines 1290-1320 area (where payment modal JSX should be)
console.log('\n=== Lines 1290-1330 ===');
for (let i = 1289; i < Math.min(1330, lines.length); i++) {
    console.log((i+1) + ': ' + lines[i].substring(0, 100));
}
