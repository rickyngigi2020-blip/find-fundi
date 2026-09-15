import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
// Pages and assets live in public/, which is also what Vercel serves.
const publicDir = path.join(root, 'public');
const assetsDir = path.join(publicDir, 'assets');
const port = 3000;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Only site pages and the assets folder in public/ are served. The project root holds
// .env (with the Supabase service-role key), source code and node_modules, none
// of which may ever be reachable over HTTP.
function resolvePublicFile(urlPath) {
  if (urlPath === '/') return path.join(publicDir, 'index.html');

  const page = urlPath.match(/^\/([a-z0-9-]+)\.html$/);
  if (page) return path.join(publicDir, `${page[1]}.html`);

  if (urlPath.startsWith('/assets/')) {
    const segments = urlPath.slice('/assets/'.length).split('/');
    if (segments.some((s) => !s || s.startsWith('.'))) return null;
    const filePath = path.join(assetsDir, ...segments);
    return filePath.startsWith(assetsDir + path.sep) ? filePath : null;
  }
  return null;
}

http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  const filePath = resolvePublicFile(urlPath);
  if (!filePath) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mime[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(data);
  });
// Bound to this computer only, so nothing on the local network can reach it.
}).listen(port, '127.0.0.1', () => {
  console.log(`Serving "${publicDir}" at http://localhost:${port}`);
});
