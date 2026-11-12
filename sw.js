/* Offline shell only. Rooms and WebRTC streaming require connectivity. */
const CACHE = 'marmalade-shell-v33-compact-settings';
const FILES = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './favicon.ico', './favicon-32.png', './assets/marmalade-icon.webp', './assets/marmalade-transparent.png', './assets/marmalade-maskable.png', './assets/cosmic-02.svg', './assets/apple-touch-icon.png', './auto-mkv-audio.js', './auto-mkv-audio.js?v=20261111-streaming-aac-v1', './public-movie-info.js', './public-movie-info.js?v=20261103-imdb-score-v3', './movie-info.js', './movie-info.js?v=20261103-imdb-score-v3', './movie-info.css?v=20261103-imdb-official-flow-v2', './watch-sync-subtitles.js', './subtitle-codec.js', './subtitle-codec.js?v=20261112-subdl-fix-v2', './subtitle-archive.js', './subtitle-archive.js?v=20261112-subdl-zip-v2', './settings-layout.css', './settings-layout.css?v=20261112-compact-v2', './settings-layout.js', './settings-layout.js?v=20261112-compact-v2', './watch-sync-subtitles.js?v=20261112-timing-v1', './subtitle-match.js', './subtitle-match.js?v=20261112-matching-v1', './subtitle-search.js', './subtitle-search.js?v=20261112-subdl-fix-v2'];
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