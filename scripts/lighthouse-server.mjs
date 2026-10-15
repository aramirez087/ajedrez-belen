// Local static landing-page audit only; does not emulate authenticated Worker routes.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve('dist/client');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
const compressible = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.webmanifest']);
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    let data = await readFile(file);
    const ext = extname(file);
    res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', pathname.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
    if (compressible.has(ext)) {
      res.setHeader('Vary', 'Accept-Encoding');
      if (/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
        data = gzipSync(data);
        res.setHeader('Content-Encoding', 'gzip');
      }
    }
    res.setHeader('Content-Length', data.length);
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4324, '127.0.0.1', () => console.log('Static gzip audit server: http://127.0.0.1:4324'));
