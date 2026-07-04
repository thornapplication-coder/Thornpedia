// Gemeinsame Test-Infrastruktur: statischer Server, Browser-Start,
// In-Memory-Mock des Dateisystems und ein kleiner Assertion-Sammler.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

// In-Memory-Nachbau der File-System-Access-Handles. Damit laufen die Tests
// ohne nativen Ordner-Dialog; window.__WA_MOCK_ROOT__ aktiviert in der App
// zusaetzlich die Test-Bruecke window.WA.
export const MOCK = `
function makeFile(name){ let blob=new Blob([]); return { kind:'file', name,
  async getFile(){ return new File([blob], name); },
  async createWritable(){ const chunks=[]; return { async write(d){ chunks.push(d); }, async close(){ blob=new Blob(chunks); } }; } }; }
function makeDir(name){ const files=new Map(), dirs=new Map();
  return { kind:'directory', name,
    async getDirectoryHandle(n,o){ if(dirs.has(n))return dirs.get(n); if(o&&o.create){const d=makeDir(n);dirs.set(n,d);return d;} throw new DOMException('nf','NotFoundError'); },
    async getFileHandle(n,o){ if(files.has(n))return files.get(n); if(o&&o.create){const f=makeFile(n);files.set(n,f);return f;} throw new DOMException('nf','NotFoundError'); },
    async removeEntry(n){ files.delete(n); dirs.delete(n); },
    async *entries(){ for(const e of dirs) yield e; for(const e of files) yield e; },
    async queryPermission(){ return 'granted'; }, async requestPermission(){ return 'granted'; } }; }
window.__WA_MOCK_ROOT__ = makeDir('Wissensarchiv-Test');
`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.css': 'text/css',
};

export async function startServer(root) {
  root = path.resolve(root);
  const srv = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch (e) { res.writeHead(400); res.end('bad request'); return; }
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    // Traversal-sicher: Ziel muss echt unterhalb von root liegen (mit Pfadtrenner).
    if ((f !== root && !f.startsWith(root + path.sep)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { port: srv.address().port, url: `http://127.0.0.1:${srv.address().port}/index.html`, close: () => srv.close() };
}

export function launchBrowser() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

export function collectErrors(page, arr) {
  page.on('pageerror', (e) => arr.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') arr.push('CONSOLE ' + m.text()); });
}

export function makeChecker(suiteName) {
  let fails = 0;
  console.log(`\n=== ${suiteName} ===`);
  return {
    check(name, cond, info = '') {
      if (cond) console.log(`  ✓ ${name}`);
      else { fails++; console.log(`  ✗ ${name}${info ? ' — ' + String(info).slice(0, 200) : ''}`); }
    },
    fails: () => fails,
  };
}
