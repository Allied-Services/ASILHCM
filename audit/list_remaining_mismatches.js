#!/usr/bin/env node
'use strict';
const fs = require('fs');
const lines = fs.readFileSync('C:/Projects/ASILHCM-Staging/audit/june26_reconcile/variance_main.csv', 'utf8').trim().split('\n');
const hdr = lines[0].split(',');
const idx = (k) => hdr.indexOf(k);
const rows = lines.slice(1).map((l) => {
  const p = l.split(',');
  return {
    id: p[idx('employee_id')],
    epd: Number(p[idx('excel_paid_days')]),
    hpd: Number(p[idx('hcm_paid_days')]),
    eg: Number(p[idx('excel_gross')]),
    hg: Number(p[idx('hcm_gross')]),
    en: Number(p[idx('excel_net_pay')]),
    hn: Number(p[idx('hcm_net_pay')]),
    dnet: Number(p[idx('delta_net_pay')]),
    dg: Number(p[idx('delta_gross')]),
  };
});
const bad = rows.filter((r) => Math.abs(r.dnet) > 1).sort((a, b) => Math.abs(b.dnet) - Math.abs(a.dnet));
console.log(JSON.stringify(bad, null, 2));
console.log('Perfect <=1:', rows.filter((r) => Math.abs(r.dnet) <= 1).length);
console.log('Sheet net total:', rows.reduce((s, r) => s + r.en, 0));
console.log('HCM net total:', rows.reduce((s, r) => s + r.hn, 0));
