// Liefert die gebaute App aus und stellt die lokale Strava-API bereit.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.mjs';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 5174;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    await handleApi(req, res);
    return;
  }
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = path.normalize(path.join(DIST, pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (pathname.endsWith('/')) file = path.join(file, 'index.html');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    try {
      const data = await readFile(path.join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': TYPES['.html'] });
      res.end(data);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Die App ist noch nicht gebaut. Bitte zuerst "npm run build" ausführen.');
    }
  }
});

// Nur auf dem eigenen Rechner erreichbar
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Rollwerk läuft: http://localhost:${PORT}`);
});
