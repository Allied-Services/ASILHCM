import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');
const indexHtml = path.join(dist, 'index.html');

if (!fs.existsSync(indexHtml)) {
  console.error('copy-spa-fallbacks: dist/index.html missing — build may have failed');
  process.exit(1);
}

// Physical copies so hosts that ignore SPA rewrites still serve the app
// for deep links like /portal and /cmms.
const routes = ['portal', 'cmms', 'claims-fill', 'claims-approve'];
for (const route of routes) {
  const dir = path.join(dist, route);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(indexHtml, path.join(dir, 'index.html'));
  console.log(`copy-spa-fallbacks: wrote dist/${route}/index.html`);
}
