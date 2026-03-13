// Simple static server to preview the contract test page
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, 'frontend', 'public');
const TEST_HTML = path.join(__dirname, 'contract_preview.html');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(TEST_HTML, 'utf8'));
  } else {
    // Serve image files from public/
    const file = path.join(PUBLIC, path.basename(req.url));
    if (fs.existsSync(file)) {
      const ext = path.extname(file).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(fs.readFileSync(file));
    } else {
      res.writeHead(404); res.end('Not found');
    }
  }
});

server.listen(8765, () => console.log('Preview server running at http://localhost:8765'));
