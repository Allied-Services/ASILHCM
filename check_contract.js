const https = require('https');
const zlib = require('zlib');

// Check what's stored in WAFI BPO contract
const API_BASE = 'https://asil-hcm-backend.onrender.com';

function get(path) {
    return new Promise((res, rej) => {
        https.get(API_BASE + path, r => {
            let chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => {
                const raw = Buffer.concat(chunks);
                const enc = r.headers['content-encoding'];
                if (enc === 'gzip') {
                    zlib.gunzip(raw, (err, data) => err ? rej(err) : res(JSON.parse(data.toString())));
                } else {
                    try { res(JSON.parse(raw.toString())); } catch(e) { res(raw.toString()); }
                }
            });
        }).on('error', rej);
    });
}

async function main() {
    try {
        const data = await get('/api/contracts');
        const contracts = data.contracts || data || [];
        console.log('Total contracts:', contracts.length);
        
        // Find WAFI BPO
        const wafi = contracts.filter(c => 
            (c.contractName || '').toLowerCase().includes('wafi') ||
            (c.clientName || '').toLowerCase().includes('wafi')
        );
        
        if (wafi.length === 0) {
            console.log('No WAFI contract found. All clients:', contracts.map(c => c.clientName || c.contractName).join(', '));
        } else {
            wafi.forEach(c => {
                console.log('\n--- Contract:', c.contractName, '(', c.clientName, ')');
                console.log('Status:', c.status);
                console.log('costs.bonus_months:', c.costs?.bonus_months);
                console.log('costs.bonus_disbursement_month:', c.costs?.bonus_disbursement_month);
                console.log('costs.bonus_min_months:', c.costs?.bonus_min_months);
            });
        }
    } catch(e) {
        console.log('Error:', e.message);
    }
}
main();
