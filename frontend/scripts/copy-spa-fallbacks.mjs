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

// Do NOT write an extensionless dist/portal file. Render serves that as
// binary/octet-stream + nosniff, so the browser downloads a file named "portal"
// and skips rewrite rules because a resource already exists at /portal.
const routes = ['portal', 'cmms', 'claims-fill', 'claims-approve'];
for (const route of routes) {
  const htmlFile = path.join(dist, `${route}.html`);
  const dir = path.join(dist, route);
  const alias = path.join(dist, route);

  fs.copyFileSync(indexHtml, htmlFile);

  if (fs.existsSync(alias) && !fs.lstatSync(alias).isDirectory()) {
    fs.unlinkSync(alias);
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(indexHtml, path.join(dir, 'index.html'));
  console.log(`copy-spa-fallbacks: wrote dist/${route}.html and dist/${route}/index.html`);
}
