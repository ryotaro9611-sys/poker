// オフライン用 Service Worker：アプリ本体を端末にキャッシュする（為替APIへの通信はキャッシュしない）
const VERSION = 'v1.2.5';
const CACHE = `tripledger-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/actions.js',
  './js/calc.js',
  './js/rates.js',
  './js/util.js',
  './js/ui.js',
  './js/chart.js',
  './js/demo.js',
  './js/backup.js',
  './js/tags.js',
  './js/schema.js',
  './js/views/fields.js',
  './js/views/home.js',
  './js/views/live.js',
  './js/views/sessionForm.js',
  './js/views/sessions.js',
  './js/views/stats.js',
  './js/views/trips.js',
  './js/views/settings.js',
  './js/views/tripCompare.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tripledger-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 為替APIなどは通常どおりネットワークへ

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./index.html');
      if (cached) return cached;
      return fetch(req);
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response('offline', { status: 503, statusText: 'offline' });
    }
  })());
});
