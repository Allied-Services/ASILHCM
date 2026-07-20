// Upload March 2026 payroll CSV data to production API
// Run: node upload_payroll.js

const fs = require('fs');
const https = require('https');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjExMDg3MzY0MTI0MjgyNDE4OTg4NCIsImVtYWlsIjoic2hlemFkLm11bXRhekBhc2lsLmNvbS5wayIsIm5hbWUiOiJTaGV6YWQgUyBNdW10YXoiLCJhdmF0YXIiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NJSTZTMWx4RWxISklIUWVXdGQ0d1h0ODFVb0RZdWFKQUR1cm12cGFEdnpLXzZTSWc9czk2LWMiLCJyb2xlIjoic3RhZmYiLCJpYXQiOjE3NzQ2ODIxOTYsImV4cCI6MTc3NDcxMDk5Nn0.U_j6__fnJLovFPUCTpmPGChOOqQJV8loCA9O9zS-1ss';
const CSV_PATH = 'G:\\My Drive\\Experiments\\BPOFMSystem\\frontend\\public\\payroll_import_template Mar-26.csv';
const API_BASE = 'asilhcm.onrender.com';

async function fetchJson(path, options = {}) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: API_BASE,
            path,
            method: options.method || 'GET',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch(e) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

async function main() {
    // 1. Fetch employees
    console.log('Fetching employees...');
    const empResp = await fetchJson('/api/employees');
    if (empResp.status !== 200) {
        console.error('Auth failed:', empResp.status, 'Token may be expired');
        console.error('Body:', JSON.stringify(empResp.body).substring(0, 200));
        process.exit(1);
    }
    const employees = empResp.body.employees || empResp.body;
    console.log(`Loaded ${employees.length} employees`);

    // 2. Parse CSV
    const csvText = fs.readFileSync(CSV_PATH, 'utf8');
    const lines = csvText.replace(/\r/g, '').split('\n').filter(Boolean);
    const hdrs = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    console.log('CSV Headers:', hdrs.slice(0, 10).join(' | '));
    console.log(`CSV rows: ${lines.length - 1}`);

    const n = (v) => parseFloat(String(v || '').replace(/,/g, '')) || 0;
    const rows = [];
    const notFound = [];

    lines.slice(1).forEach((line, i) => {
        const vals = []; let cur = '', inQ = false;
        for (const ch of line) {
            if (ch === '"') inQ = !inQ;
            else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
            else cur += ch;
        }
        vals.push(cur.trim());
        const obj = {}; hdrs.forEach((h, j) => { obj[h] = vals[j] || ''; });
        
        const cnic = obj['CNIC'];
        const empCode = obj['ASIL Employee Code'];
        const match = employees.find(e => e.cnic === cnic) || employees.find(e => e.id === empCode);
        
        if (!match) {
            notFound.push(`Row ${i+2}: CNIC=${cnic} Code=${empCode}`);
        } else {
            const presentDays = n(obj['Present Days']) || 26;
            rows.push({
                employee_id: match.id,
                ov: {
                    paid_days:         presentDays,
                    ot2_hrs:           n(obj['OT Hrs @ 2X']),
                    ot3_hrs:           n(obj['OT Hrs @ 3X']),
                    opd_claim:         n(obj['OPD']),
                    reimbursement:     n(obj['Expense Reimbursement']),
                    arrears:           n(obj['Arrears']),
                    bonus_amount:      n(obj['Bonus']),
                    special_allowance: n(obj['Special Allowance']),
                    fuel_mobile:       n(obj['Other Allowance Fuel | Mobile']),
                    other_deduction:   n(obj['Other Deduction']),
                },
                calc: {}
            });
        }
    });

    console.log(`\nMatched: ${rows.length} employees`);
    if (notFound.length) {
        console.log(`Not found (${notFound.length}):`);
        notFound.slice(0, 10).forEach(x => console.log(' ', x));
    }
    
    // Show sample row
    if (rows.length > 0) {
        console.log('\nSample row:', JSON.stringify(rows[0]));
    }

    // 3. POST to API
    console.log('\nUploading to /api/payroll/2026/3...');
    const saveResp = await fetchJson('/api/payroll/2026/3', {
        method: 'POST',
        body: JSON.stringify({ rows })
    });

    console.log(`\nSave status: ${saveResp.status}`);
    console.log('Result:', JSON.stringify(saveResp.body));

    if (saveResp.status === 200 && saveResp.body.ok) {
        console.log(`\n✅ SUCCESS: Saved ${saveResp.body.saved} payroll rows for March 2026`);
    } else if (saveResp.status === 401) {
        console.error('\n❌ Token EXPIRED - needs fresh browser login');
    } else {
        console.error('\n❌ Save failed');
    }
}

main().catch(console.error);
