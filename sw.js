/* Offline shell only. Rooms and WebRTC streaming require connectivity. */
const CACHE = 'marmalade-shell-v24-transparent-corners';
const FILES = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './assets/marmalade-icon.webp', './assets/marmalade-transparent.png', './assets/marmalade-maskable.png', './assets/cosmic-02.svg', './assets/apple-touch-icon.png', './public-movie-info.js', './public-movie-info.js?v=20261103-imdb-score-v3', './movie-info.js', './movie-info.js?v=20261103-imdb-score-v3', './movie-info.css?v=20261103-imdb-official-flow-v2', './watch-sync-subtitles.js', './watch-sync-subtitles.js?v=20261103-theater-fixes-v1', './subtitle-match.js', './subtitle-match.js?v=20261022-multisource2', './subtitle-search.js', './subtitle-search.js?v=20261103-theater-fixes-v1'];
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