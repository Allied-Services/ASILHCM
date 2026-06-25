/**
 * Deep syntax validation of BillingProcurement.jsx
 * Checks for common JSX pitfalls that pass brace-counting but fail Vite build
 */
const fs = require('fs');
const src = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/frontend/src/BillingProcurement.jsx', 'utf8');
const lines = src.split('\n');

let issues = [];

// 1. Check for backtick template literals broken across lines with JSX inside
lines.forEach((line, i) => {
    // Orphaned template literal openers
    const bt = (line.match(/`/g) || []).length;
    if (bt % 2 !== 0) {
        issues.push(`Line ${i+1}: odd number of backticks (${bt}): ${line.trim().substring(0,80)}`);
    }
    // Unclosed single-quote in JSX attribute
    if (line.includes("style={{") && (line.match(/'/g)||[]).length % 2 !== 0) {
        // Not an issue in JSX style objects necessarily, but flag if it's odd
        // issues.push(`Line ${i+1}: odd single-quotes: ${line.trim().substring(0,80)}`);
    }
});

// 2. Check every const/let/var declaration that ends with ; exists
// 3. Find the whtAmount calculation to make sure it references correct var
const whtLines = lines.map((l,i) => ({l, i})).filter(x => x.l.includes('whtAmount'));
console.log('\n=== whtAmount occurrences ===');
whtLines.forEach(({l, i}) => console.log(`  L${i+1}: ${l.trim().substring(0,100)}`));

// 4. Find isUnofficial 
const unoffLines = lines.map((l,i) => ({l, i})).filter(x => x.l.includes('isUnofficial'));
console.log('\n=== isUnofficial occurrences ===');
unoffLines.forEach(({l, i}) => console.log(`  L${i+1}: ${l.trim().substring(0,100)}`));

// 5. Find the grandTotal line
const grandLines = lines.map((l,i) => ({l, i})).filter(x => x.l.includes('grandTotal'));
console.log('\n=== grandTotal occurrences ===');
grandLines.forEach(({l, i}) => console.log(`  L${i+1}: ${l.trim().substring(0,100)}`));

// 6. Find the save function that references whtAmount
const saveLines = lines.map((l,i) => ({l, i})).filter(x => x.l.includes('whtAmount') && x.l.includes('billCategory'));
console.log('\n=== save with whtAmount+billCategory ===');
saveLines.forEach(({l, i}) => console.log(`  L${i+1}: ${l.trim().substring(0,100)}`));

// 7. Show the doAction function area
const doActionLine = lines.findIndex(l => l.includes('const doAction = async'));
console.log('\n=== doAction function (lines', doActionLine+1, '-', doActionLine+15, ') ===');
for (let i = doActionLine; i < Math.min(doActionLine+15, lines.length); i++) {
    console.log(`  L${i+1}: ${lines[i].trim().substring(0,100)}`);
}

// 8. Check the patch status call in doPayment
const doPayLine = lines.findIndex(l => l.includes('const doPayment = async'));
console.log('\n=== doPayment function ===');
for (let i = doPayLine; i < Math.min(doPayLine+20, lines.length); i++) {
    console.log(`  L${i+1}: ${lines[i].trim().substring(0,100)}`);
}

// 9. Check api.updateBillStatus call - does it send paymentMethod?
const apiUpdateLine = lines.findIndex(l => l.includes('api.updateBillStatus'));
console.log('\n=== api.updateBillStatus usage ===');
if (apiUpdateLine > -1) console.log(`  L${apiUpdateLine+1}: ${lines[apiUpdateLine].trim()}`);

// 10. Show any lines with 'gstAmount' that might have the wrong variable context
const gstCalcLines = lines.map((l,i) => ({l, i})).filter(x => x.l.includes('gstAmount') && (x.l.includes('const') || x.l.includes('Math.round')));
console.log('\n=== gstAmount calculation ===');
gstCalcLines.forEach(({l, i}) => console.log(`  L${i+1}: ${l.trim().substring(0,100)}`));

if (issues.length > 0) {
    console.log('\n=== ISSUES FOUND ===');
    issues.forEach(i => console.log(' ', i));
} else {
    console.log('\n=== No obvious template-literal issues ===');
}
