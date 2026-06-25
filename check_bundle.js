const https = require('https');

// Step 1: Get the HTML to find the current JS bundle name
function get(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve(d));
        }).on('error', reject);
    });
}

(async () => {
    // Get main page
    const html = await get('https://asil-hcm-frontend.onrender.com');
    
    // Extract JS bundle filename
    const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (!match) {
        console.log('Could not find JS bundle in HTML');
        console.log('HTML:', html.substring(0, 500));
        return;
    }
    
    const bundlePath = match[1];
    console.log('Current bundle:', bundlePath);
    
    // Old bundle was: index-BihRc4AV.js
    // New build produces: index-DRGleS22.js
    if (bundlePath.includes('BihRc4AV')) {
        console.log('STATUS: OLD BUILD still deployed - Render has NOT picked up the new commit yet');
    } else {
        console.log('STATUS: NEW BUILD detected!');
    }
    
    // Fetch the JS bundle and check for attendance
    console.log('\nFetching bundle to check content...');
    const js = await get('https://asil-hcm-frontend.onrender.com' + bundlePath);
    
    console.log('Bundle size:', (js.length / 1024).toFixed(0) + 'KB');
    console.log('Contains "attendance":', js.includes('attendance'));
    console.log('Contains "AttendanceManagement":', js.includes('AttendanceManagement'));
    console.log('Contains "DailyMarking":', js.includes('DailyMarking'));
    console.log('Contains "supervisor":', js.toLowerCase().includes('supervisor'));
    console.log('Contains "BILL_TYPE_DEFS":', js.includes('BILL_TYPE_DEFS'));
    
    // Check ROLE_NAV has attendance for superadmin
    const roleNavIdx = js.indexOf('superadmin');
    if (roleNavIdx > -1) {
        const snippet = js.substring(roleNavIdx, roleNavIdx + 300);
        console.log('\nRole section snippet:', snippet.substring(0, 200));
    }
})().catch(e => console.error('Error:', e.message));
