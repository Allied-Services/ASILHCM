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

// Render Static Sites: a folder dist/portal/ is a "resource" at /portal.
// Requests to /portal (no slash) then return HTTP 200 with an empty body and
// skip rewrite rules. Publish a real .html file instead, plus a same-name
// symlink so /portal can resolve to portal.html (text/html).
const routes = ['portal', 'cmms', 'claims-fill', 'claims-approve'];
for (const route of routes) {
  const htmlFile = path.join(dist, `${route}.html`);
  const alias = path.join(dist, route);

  fs.copyFileSync(indexHtml, htmlFile);

  if (fs.existsSync(alias)) {
    const st = fs.lstatSync(alias);
    if (st.isDirectory()) {
      fs.rmSync(alias, { recursive: true, force: true });
    } else {
      fs.unlinkSync(alias);
    }
  }

  try {
    fs.symlinkSync(`${route}.html`, alias);
    console.log(`copy-spa-fallbacks: wrote dist/${route}.html + symlink dist/${route}`);
  } catch (err) {
    // Windows without symlink privilege: copy bytes under the extensionless name.
    fs.copyFileSync(htmlFile, alias);
    console.log(`copy-spa-fallbacks: wrote dist/${route}.html + file dist/${route} (${err.code || err.message})`);
  }
}
