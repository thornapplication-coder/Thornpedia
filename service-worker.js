/* Wissensarchiv – Service Worker
 * Cacht die App-Shell und die lokal mitgelieferten Bibliotheken (/vendor),
 * damit die App nach dem ersten Start vollständig offline läuft.
 * Strategie: network-first für den App-Code (index.html, parse-worker.js) –
 * damit Updates sofort ankommen – und cache-first für die (unveränderlichen)
 * Bibliotheken und Icons, mit Offline-Fallback auf den Cache. */

const VERSION = 'wa-1.5.8';
const CACHE = `wissensarchiv-${VERSION}`;

// Kern der App-Shell, der beim Installieren fest vorgeladen wird.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './parse-worker.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  // Bibliotheken lokal – damit die App nach dem ersten Start vollstaendig offline laeuft.
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/mammoth.browser.min.js',
  './vendor/xlsx.full.min.js',
  './vendor/jszip.min.js',
  './vendor/docx.umd.js',
  './vendor/jspdf.umd.min.js',
  // OCR (tesseract.js) – vorab gecacht, damit Texterkennung auch offline geht
  './vendor/tesseract/tesseract.min.js',
  './vendor/tesseract/worker.min.js',
  './vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-relaxedsimd-lstm.wasm.js',
  './vendor/tesseract/tesseract-core-lstm.wasm.js',
  './vendor/tesseract/lang/deu.traineddata.gz',
  './vendor/tesseract/lang/eng.traineddata.gz',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Einzeln hinzufügen, damit ein fehlendes optionales Asset die Installation nicht abbricht.
      await Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      // Bewusst KEIN skipWaiting() hier: Eine neue Version bleibt im "waiting"-
      // Zustand, bis der Nutzer im Update-Banner auf "Jetzt aktualisieren" klickt
      // (die App schickt dann die 'skipWaiting'-Nachricht, siehe message-Listener).
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('wissensarchiv-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// App-Code (index.html, parse-worker.js) laden wir network-first, damit Updates
// sofort ankommen; offline faellt er auf den Cache zurueck. Bibliotheken und
// Icons sind quasi unveraenderlich -> cache-first (schnell, offline).
function isAppCode(req, url) {
  return req.mode === 'navigate'
    || url.pathname.endsWith('/index.html')
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('/parse-worker.js');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // externe Requests (z. B. Claude API) nicht abfangen

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (isAppCode(req, url)) {
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          const cached = await cache.match(req) || await cache.match('./index.html');
          if (cached) return cached;
          throw err;
        }
      }

      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        if (req.mode === 'navigate') {
          const shell = await cache.match('./index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
