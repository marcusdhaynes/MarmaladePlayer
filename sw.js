/* Offline shell only. Rooms and WebRTC streaming require connectivity. */
const CACHE = 'marmalade-shell-v5';
const FILES = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './movie-info.js', './movie-info.css', './watch-sync-subtitles.js', './subtitle-search.js', './watch-sync-subtitles.js?v=20261020-substudio', './subtitle-search.js?v=20261020-substudio'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(req, copy)));
    }
    return response;
  }).catch(() => caches.match(req).then(cached => cached || Response.error())));
});