const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Change process cwd to the temp build folder, then run vite build
process.chdir('C:\\tmp\\asilhcm_build');
console.log('CWD:', process.cwd());
console.log('Files:', fs.readdirSync('.').join(', '));

try {
    const output = execSync('node "C:\\tmp\\asilhcm_build\\node_modules\\vite\\bin\\vite.js" build', {
        cwd: 'C:\\tmp\\asilhcm_build',
        stdio: 'pipe',
        timeout: 120000,
        env: { ...process.env, NODE_ENV: 'production' }
    });
    console.log('BUILD SUCCESS:\n' + output.toString());
} catch(e) {
    console.error('BUILD FAILED:');
    console.error((e.stdout||Buffer.from('')).toString());
    console.error((e.stderr||Buffer.from('')).toString());
}
