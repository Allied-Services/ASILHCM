#!/usr/bin/env node
'use strict';
const path = require('path');
const XLSX = require(path.join(__dirname, '..', 'backend', 'node_modules', 'xlsx'));
const wb = XLSX.readFile(process.env.JUNE26_XLSX
  || 'G:\\My Drive\\Experiments\\BPOFMSystem\\Attachments\\BPO FM Payroll & Invoice File (1).xlsx');

function cell(ws, r, c) {
  const x = ws[XLSX.utils.encode_cell({ r, c })];
  return x ? x.v : '';
}
function num(v) { return Number(String(v || '').replace(/,/g, '')) || 0; }

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['ASIL/PSO-024/25', 'ASIL/PSO-020/25', 'ASIL/PSO-097/25'];
const j = wb.Sheets['June-26'];
const p = wb.Sheets['PSO Operational PR June-26'];

// Print header row cols 15-35
console.log('June-26 headers (cols 15-35):');
for (let c = 15; c <= 35; c++) {
  console.log(c, String(cell(j, 0, c)).trim());
}

for (const id of ids) {
  for (let r = 3; r < 520; r++) {
    if (String(cell(j, r, 1)).trim() !== id) continue;
    console.log('\n===', id, 'June-26 row', r + 1, '===');
    console.log({
      newSalary: num(cell(j, r, 17)),
      workingDays: num(cell(j, r, 18)),
      paidDays: num(cell(j, r, 19)),
      col20: num(cell(j, r, 20)),
      ot2_col21: num(cell(j, r, 21)),
      ot3_col22: num(cell(j, r, 22)),
      opd: num(cell(j, r, 24)),
      expense: num(cell(j, r, 25)),
      arrears: num(cell(j, r, 26)),
      special: num(cell(j, r, 27)),
      fuel: num(cell(j, r, 28)),
      otherDed: num(cell(j, r, 29)),
      gross: num(cell(j, r, 30)),
      tax: num(cell(j, r, 31)),
      pf: num(cell(j, r, 32)),
      eobi: num(cell(j, r, 33)),
      net: num(cell(j, r, 35)),
    });
  }
  if (!p) continue;
  for (let r = 3; r < 170; r++) {
    if (String(cell(p, r, 1)).trim() !== id) continue;
    console.log('===', id, 'PSO ops row', r + 1, '===');
    console.log({
      paidDays: num(cell(p, r, 19)),
      ot2: num(cell(p, r, 21)),
      gross: num(cell(p, r, 30)),
      net: num(cell(p, r, 35)),
    });
  }
}
