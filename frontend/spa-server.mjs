import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, 'dist');
const port = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function safeJoin(root, pathname) {
  const resolved = path.resolve(root, `.${pathname}`);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  let pathname = decodeURIComponent(url.pathname);

  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  const filePath = safeJoin(dist, pathname === '/' ? '/index.html' : pathname);
  const tryRead = (p) => {
    try {
      return fs.readFileSync(p);
    } catch {
      return null;
    }
  };

  let data = null;
  let ext = filePath ? path.extname(filePath) : '';

  if (filePath && !ext) {
    data = tryRead(`${filePath}.html`);
    if (data) ext = '.html';
  }
  if (!data && filePath) {
    data = tryRead(filePath);
    if (data && !ext) {
      const head = data.subarray(0, 32).toString('utf8').toLowerCase();
      if (head.includes('<!doctype') || head.includes('<html')) ext = '.html';
    }
  }

  if (!data) {
    data = tryRead(path.join(dist, 'index.html'));
    ext = '.html';
  }

  if (!data) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dist/index.html missing');
    return;
  }

  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(data);
});

server.listen(port, () => {
  console.log(`spa-server listening on ${port}`);
});
