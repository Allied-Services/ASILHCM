/**
 * Final structural validation: try to parse as a module 
 * and check specific sections look correct
 */
const fs = require('fs');
const src = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/frontend/src/BillingProcurement.jsx', 'utf8');
const lines = src.split('\n');

// 1. Show the totals block
const totalsLine = lines.findIndex(l => l.includes("const rows = [['Subtotal'"));
console.log('=== TOTALS IIFE BLOCK ===');
for (let i = totalsLine - 2; i < totalsLine + 20; i++) {
    console.log((i+1) + ': ' + lines[i]);
}

// 2. Show the grand total area around line 443
console.log('\n=== grandTotal calc ===');
const gtLine = lines.findIndex(l => l.includes('grandTotal = subtotal + gstAmount'));
for (let i = gtLine - 2; i < gtLine + 8; i++) {
    console.log((i+1) + ': ' + lines[i]);
}

// 3. Show save() function
console.log('\n=== save() function ===');
const saveLine = lines.findIndex(l => l.trim() === 'const save = () => {');
for (let i = saveLine; i < saveLine + 15; i++) {
    console.log((i+1) + ': ' + lines[i]);
}

// 4. Check parenthesis balance in the IIFE section
console.log('\n=== Paren check in totals display ===');
const iifeLine = lines.findIndex(l => l.includes('const rows = ['));
let depth = 0;
for (let i = iifeLine; i < Math.min(iifeLine + 30, lines.length); i++) {
    const line = lines[i];
    const opens = (line.match(/\(/g)||[]).length;
    const closes = (line.match(/\)/g)||[]).length;
    depth += opens - closes;
    console.log(`  depth=${depth}  L${i+1}: ${line.trim().substring(0,80)}`);
}

// 5. Count total open vs close parens in whole file
const totalOpen = (src.match(/\(/g)||[]).length;
const totalClose = (src.match(/\)/g)||[]).length;
console.log('\nGlobal paren balance:', totalOpen, '( vs', totalClose, ') ->', totalOpen === totalClose ? 'BALANCED' : 'MISMATCH diff=' + (totalOpen - totalClose));

// 6. Check JSX tag balance (simplified)
const totalOpen2 = (src.match(/\{/g)||[]).length;
const totalClose2 = (src.match(/\}/g)||[]).length;
console.log('Global brace balance:', totalOpen2, '{ vs', totalClose2, '} ->', totalOpen2 === totalClose2 ? 'BALANCED' : 'MISMATCH diff=' + (totalOpen2 - totalClose2));
