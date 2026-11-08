const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const publicFiles = new Set(['/index.html', '/styles.css', '/sw.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/src/core.js', '/src/app.js']);

function createServer() {
  return http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end('Invalid URL'); return; }
    if (pathname === '/') pathname = '/index.html';
    if (!publicFiles.has(pathname)) { response.writeHead(404).end('File unavailable'); return; }
    const file = path.join(root, ...pathname.slice(1).split('/'));
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('File unavailable'); return; }
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(data);
    });
  });
}

if (require.main === module) createServer().listen(8765, '127.0.0.1', () => console.log('Elk: http://127.0.0.1:8765'));
module.exports = { createServer };
