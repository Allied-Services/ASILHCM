const fs = require('fs');
const server = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/backend/server.js', 'utf8');
const api = fs.readFileSync('G:/My Drive/Experiments/BPOFMSystem/frontend/src/api.js', 'utf8');
const lines = server.split('\n');
const apiLines = api.split('\n');

// SIGTERM line
const sigtermLine = lines.findIndex(l => l.includes('process.on') && l.includes('SIGTERM'));
console.log('SIGTERM at line:', sigtermLine+1);
console.log('Exact:', JSON.stringify(lines[sigtermLine].substring(0, 50)));

// 3 lines before SIGTERM
for (let i = sigtermLine-3; i <= sigtermLine; i++) {
    console.log((i+1) + ': ' + JSON.stringify(lines[i]));
}

// Payment ledger loop
const plLine = lines.findIndex(l => l.includes('for (const emp of empRows.rows)'));
console.log('\nPayment ledger loop at:', plLine+1);
for (let i = plLine; i < Math.min(plLine+15, lines.length); i++) {
    console.log((i+1) + ': ' + JSON.stringify(lines[i]));
}

// SMS loop
const smsLine = lines.findIndex(l => l.includes('for (const r of recipients)'));
console.log('\nSMS loop at:', smsLine+1);
for (let i = smsLine; i < Math.min(smsLine+20, lines.length); i++) {
    console.log((i+1) + ': ' + JSON.stringify(lines[i]));
}

// api.js patterns
const empLine = apiLines.findIndex(l => l.includes('getEmployees'));
console.log('\ngetEmployees at:', empLine+1);
for (let i = empLine; i < Math.min(empLine+6, apiLines.length); i++) {
    console.log((i+1) + ': ' + JSON.stringify(apiLines[i]));
}

const ctLine = apiLines.findIndex(l => l.includes('getContracts'));
console.log('\ngetContracts at:', ctLine+1);
for (let i = ctLine; i < Math.min(ctLine+4, apiLines.length); i++) {
    console.log((i+1) + ': ' + JSON.stringify(apiLines[i]));
}

const createEmpLine = apiLines.findIndex(l => l.includes('createEmployee'));
console.log('\ncreateEmployee at:', createEmpLine+1, ':', JSON.stringify(apiLines[createEmpLine]));
const updateEmpLine = apiLines.findIndex(l => l.includes('updateEmployee'));
console.log('updateEmployee at:', updateEmpLine+1, ':', JSON.stringify(apiLines[updateEmpLine]));
const deleteEmpLine = apiLines.findIndex(l => l.includes('deleteEmployee'));
console.log('deleteEmployee at:', deleteEmpLine+1, ':', JSON.stringify(apiLines[deleteEmpLine]));
