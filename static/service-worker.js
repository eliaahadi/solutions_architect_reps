// Simple SW: cache static assets and offline shell
const CACHE = 'sa-reps-v2'; // bumped version
const ASSETS = [
  '/',
  '/daily',
  '/static/styles.css',
  '/static/app.js',
  '/manifest.webmanifest',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  } else {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
  }
});
