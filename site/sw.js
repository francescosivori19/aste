// Service worker: app installabile e utilizzabile offline con gli ultimi dati scaricati.
// Codice dell'app: prima la cache. Dati: prima la rete, cache se offline.
const VERSION = 'v1';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isTile = url.hostname.endsWith('tile.openstreetmap.org');
  const isData = url.pathname.includes('/data/');
  const isOwnCode = url.origin === location.origin && !isData;
  if (isTile) return; // le tessere della mappa le gestisce il browser
  if (isData || isOwnCode) {
    // rete prima (così l'app si aggiorna da sola), cache come riserva offline
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // librerie da CDN: cache prima
  e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => {
    const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r;
  })));
});
