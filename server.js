/* Minimal static file server. Usage: node server.js [port] (HOST env var to override bind address) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400); res.end('bad request'); return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  const rel = path.relative(ROOT, file);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const candidates = [Number(process.argv[2]) || 3000, 8080, 0];
(function tryPort(i) {
  if (i >= candidates.length) { console.error('no port available'); process.exit(1); }
  server.once('error', () => tryPort(i + 1));
  const host = process.env.HOST || '0.0.0.0';
  server.listen(candidates[i], host, () => {
    console.log('DAM DEFENDER serving at http://' + host + ':' + server.address().port);
  });
})(0);
