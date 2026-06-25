const fs = require('fs');
const app = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/frontend/src/App.jsx','utf8');
const lines = app.split('\n');

// Find where activeTab is compared
const compLines = lines.map((l,i)=>({i,l})).filter(x=>x.l.includes('activeTab'));
compLines.slice(0,10).forEach(x=>console.log(x.i+1, x.l.substring(0,120)));

// Find where nav items are defined (look for icon: and label:)
const navItems = lines.map((l,i)=>({i,l})).filter(x=>x.l.includes('icon:') && x.l.includes('label:'));
console.log('\nNav items:');
navItems.forEach(x=>console.log(x.i+1, x.l.substring(0,120)));

// Show lines 20-60 (role definitions area)
console.log('\nLines 20-70:');
for (let i=19;i<70;i++) console.log(i+1, lines[i]?.substring(0,120));
