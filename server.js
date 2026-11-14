#!/usr/bin/env node
// LensLease - camera & gear rental demo. Zero dependencies: node:http + a JSON file.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, userForToken, HttpError } from './src/api.js';
import { load, DB_PATH } from './src/store.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, 'public');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) {
        reject(new HttpError(413, 'Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/** Match '/api/cameras/:id' against a pathname; returns params or null. */
function matchPath(pattern, pathname) {
  const p = pattern.split('/').filter(Boolean);
  const a = pathname.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

async function serveStatic(res, pathname) {
  const rel = normalize(pathname === '/' ? 'index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // Unknown path with no extension => let the single-page app route it.
    if (extname(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    filePath = join(PUBLIC_DIR, 'index.html');
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? HOST}`);
  const started = Date.now();

  try {
    if (url.pathname.startsWith('/api/')) {
      const route = routes.find((r) => r.method === req.method && matchPath(r.path, url.pathname));
      if (!route) {
        // Distinguish "no such endpoint" from "wrong verb".
        const pathExists = routes.some((r) => matchPath(r.path, url.pathname));
        throw new HttpError(pathExists ? 405 : 404, pathExists ? 'Method not allowed.' : 'Unknown endpoint.');
      }
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || null;
      const ctx = {
        params: matchPath(route.path, url.pathname),
        query: Object.fromEntries(url.searchParams),
        body: ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : {},
        token,
        user: userForToken(token),
      };
      const payload = route.handler(ctx);
      sendJson(res, req.method === 'POST' && url.pathname === '/api/bookings' ? 201 : 200, payload);
    } else {
      await serveStatic(res, url.pathname);
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('[error]', err);
    sendJson(res, status, { error: err.message || 'Something went wrong.' });
  } finally {
    const method = req.method.padEnd(6);
    console.log(`${method} ${url.pathname}${url.search} -> ${res.statusCode} (${Date.now() - started}ms)`);
  }
});

const db = load();
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  LensLease  camera & gear rental demo');
  console.log(`  running at   http://${HOST}:${PORT}`);
  console.log(`  catalogue    ${db.cameras.length} items, ${db.bookings.length} bookings`);
  console.log(`  data file    ${DB_PATH}`);
  console.log('  sign in as   alex@demo.io (customer)  /  admin@lenslease.io (staff)');
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nShutting down.');
    server.close(() => process.exit(0));
  });
}
