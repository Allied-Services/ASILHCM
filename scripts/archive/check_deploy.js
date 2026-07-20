const https = require('https');
const zlib = require('zlib');

function get(url) {
    return new Promise((res, rej) => {
        https.get(url, { headers: { 'Accept-Encoding': 'gzip', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } }, r => {
            let chunks = [];
            r.on('data', c => chunks.push(c));
            r.on('end', () => {
                const raw = Buffer.concat(chunks);
                const enc = r.headers['content-encoding'];
                if (enc === 'gzip') {
                    zlib.gunzip(raw, (err, data) => err ? rej(err) : res(data.toString()));
                } else {
                    res(raw.toString());
                }
            });
        }).on('error', rej);
    });
}

async function main() {
    // Force fresh fetch of index.html
    const page = await get('https://asil-hcm-frontend.onrender.com/?nocache=' + Date.now());
    const bundleMatch = page.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (!bundleMatch) { console.log('No bundle found. Page content:', page.slice(0, 200)); return; }
    
    const bundlePath = bundleMatch[1];
    console.log('Current bundle:', bundlePath);
    
    const bundle = await get('https://asil-hcm-frontend.onrender.com' + bundlePath + '?nocache=' + Date.now());
    console.log('Bundle size:', bundle.length, 'chars');
    
    const checks = [
        ['Bonus Amount', 'CSV bonus fix'],
        ['total_medical_csv', 'Medical CSV fallback'],
        ['bonusTPC', 'Bonus TPC fix'],
        ['spouse_count', 'Spouse count'],
        ['EditCtx', 'EditCtx module (was broken JSX)'],
    ];
    
    checks.forEach(([str, desc]) => {
        console.log(bundle.includes(str) ? '✓' : '✗', desc, '(' + str + ')');
    });
}
main().catch(e => console.log('Error:', e.message));
