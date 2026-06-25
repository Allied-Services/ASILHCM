const https = require('https');

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
    const html = await get('https://asil-hcm-frontend.onrender.com');
    const match = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    const bundlePath = match[1];
    console.log('Bundle:', bundlePath);
    
    const js = await get('https://asil-hcm-frontend.onrender.com' + bundlePath);
    
    // Search for attendance-related strings in minified bundle
    // Vite minifies component names but keeps string literals
    const searches = [
        'Attendance',
        'attendance',
        'Daily Marking',
        'DailyMarking',
        'Monthly Report',
        'my-team',
        'mark-attendance',
        '/api/attendance',
        'supervisor_teams',
        'getMyTeam',
        'markAttendance',
        'ROLE_NAV',
        'supervisor',
        'Clock',  // Clock icon used for attendance nav
        'Attendance Management',
    ];
    
    searches.forEach(s => {
        const idx = js.indexOf(s);
        if (idx > -1) {
            console.log(`FOUND "${s}" at pos ${idx}:`, js.substring(idx, idx + 80).replace(/\n/g, ' '));
        } else {
            console.log(`NOT FOUND: "${s}"`);
        }
    });
    
    // Check the ROLE_NAV area - find superadmin array
    const snIdx = js.indexOf('"attendance"');
    if (snIdx > -1) {
        console.log('\n"attendance" string context:');
        console.log(js.substring(Math.max(0, snIdx-100), snIdx+150));
    }
})().catch(e => console.error('Error:', e.message));
