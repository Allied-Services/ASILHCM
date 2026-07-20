/**
 * Inject attendance routes into server.js at the right location
 */
const fs = require('fs');
const { execSync } = require('child_process');

const serverFile = 'G:/My Drive/Experiments/BPOFMSystem/backend/server.js';
const routesFile = 'G:/My Drive/Experiments/BPOFMSystem/backend/_attendance_routes.js';

const server = fs.readFileSync(serverFile, 'utf8');
const routes = fs.readFileSync(routesFile, 'utf8');

// Check not already injected
if (server.includes('setupAttendanceTables')) {
    console.log('Attendance routes already injected — skipping');
    process.exit(0);
}

// Find the marker to inject before: the Performance Indexes block
const marker = '// ── Performance Indexes';
const insertAt = server.indexOf(marker);
if (insertAt === -1) {
    console.error('Could not find injection point — aborting');
    process.exit(1);
}

const injected = server.slice(0, insertAt) +
    '\n// ──────────────────────────────────────────────────────────────────────────────\n' +
    '// ATTENDANCE MANAGEMENT ROUTES\n' +
    '// ──────────────────────────────────────────────────────────────────────────────\n' +
    routes + '\n\n' +
    server.slice(insertAt);

fs.writeFileSync(serverFile, injected, 'utf8');
console.log('Attendance routes injected. Lines:', injected.split('\n').length);

try {
    execSync(`node --check "${serverFile}"`, { stdio: 'pipe' });
    console.log('server.js syntax: ✅ VALID');
} catch(e) {
    const msg = (e.stderr || Buffer.from('')).toString().split('\n').slice(0,8).join('\n');
    console.error('server.js syntax: ❌', msg);
}
