'use strict';
// Локальный HTTP-сервер (только 127.0.0.1): отдаёт страницу плеера,
// файлы EmulatorJS и сам ROM. Так эмулятор работает без file:// ограничений.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function safeJoin(root, rel) {
  const full = path.normalize(path.join(root, rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function serveFile(res, file, extra) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
      ...extra,
    });
    fs.createReadStream(file).pipe(res);
  });
}

/**
 * @param {{emuDir:string, rendererDir:string, romPath:string}} o
 * @returns {Promise<{port:number, close:()=>void}>}
 */
function start(o) {
  const server = http.createServer((req, res) => {
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (pathname === '/rom') return serveFile(res, o.romPath);
    if (pathname.startsWith('/emu/')) {
      const f = safeJoin(o.emuDir, pathname.slice(5));
      if (!f) return res.writeHead(403).end();
      return serveFile(res, f);
    }
    const rel = pathname === '/' ? 'player.html' : pathname.slice(1);
    const f = safeJoin(o.rendererDir, rel);
    if (!f) return res.writeHead(403).end();
    serveFile(res, f);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

module.exports = { start };
